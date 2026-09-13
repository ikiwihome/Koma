/**
 * TaskBackedLLMProvider —— 透明把 LLM 调用包成主进程任务。
 *
 * 实现 LLMProvider 接口，内部委托：
 *  - non-streaming 调用 → llmQueryViaTask（走主进程 TaskRunner.handle('llm:complete')）
 *  - streaming 调用 → 透传给底层 provider（流式分片入 task 留作后续优化）
 *
 * 收益：
 *  - 关窗口期间 LLM 调用仍在主进程跑完，结果写到 SQLite（payload.output）
 *  - reopen 后 UI 通过 useTasks/useActiveTask 看到这次调用的状态
 *  - cancel 信号传到主进程
 *
 * 与 ScriptAnalysisService / ShotAnalysisService 集成：
 *   两个服务都走 ctx.llmProvider.{generateText|chat}，
 *   把 ctx.llmProvider 换成本类的实例，业务代码零改动即受益。
 */
import type { LLMProvider, LLMCallOptions, LLMStreamChunkHandler, ChatMessage } from './types';
import type { ModelConfig } from '../../types';
import { llmQueryViaTask, type LLMTaskRequest, type LLMTaskOptions } from '../../services/llmTaskClient';

interface TaskScopeBuilder {
  /** 默认 'global'；建议传 () => `project:${projectId}` 让任务面板分组清晰 */
  scope?: string | (() => string);
  /** 任务面板显示名 */
  taskName?: string | ((options?: LLMCallOptions) => string);
}

export class TaskBackedLLMProvider implements LLMProvider {
  type: string;
  config: ModelConfig;
  private readonly inner: LLMProvider;
  private readonly scopeBuilder: TaskScopeBuilder;

  constructor(inner: LLMProvider, scope: TaskScopeBuilder = {}) {
    this.inner = inner;
    this.config = inner.config;
    this.type = `task-backed:${inner.type}`;
    this.scopeBuilder = scope;
  }

  validate(): boolean {
    return this.inner.validate();
  }

  testConnection(): Promise<boolean> {
    return this.inner.testConnection();
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: LLMCallOptions,
  ): Promise<string> {
    if (options?.stream || typeof options?.onChunk === 'function') {
      // 流式：直接走原 provider；后续可以做"流式分片入 task"
      return this.inner.generateText(prompt, systemPrompt, options);
    }
    const messages: ChatMessage[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    return this.runViaTask(messages, options ?? {});
  }

  async chat(
    messages: ChatMessage[],
    options?: LLMCallOptions,
    onChunk?: LLMStreamChunkHandler,
  ): Promise<string> {
    if (options?.stream || onChunk || typeof options?.onChunk === 'function') {
      return this.inner.chat(messages, options, onChunk);
    }
    return this.runViaTask(messages, options ?? {});
  }

  private async runViaTask(messages: ChatMessage[], options: LLMCallOptions): Promise<string> {
    const cfg = this.inner.config;
    const request: LLMTaskRequest = {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      config: {
        profileId: cfg.profileId,
        modelProvider: this.normalizeProvider(cfg.provider),
        modelName: String(cfg.modelName || '').trim(),
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
      },
      options: {
        traceId: options.traceId,
        source: options.source,
        operation: options.operation,
        taskKind: options.taskKind,
        taskProfileId: options.taskProfileId,
        timeoutMs: options.timeoutMs,
        disableChunking: options.disableChunking,
        responseFormat: options.responseFormat,
      },
    };
    const taskOptions: LLMTaskOptions = {
      scope: this.resolveScope(),
      taskName: this.resolveTaskName(options),
      targetKind: options.targetId ? 'episode' : undefined,
      targetId: options.targetId,
    };
    const { result } = await llmQueryViaTask(request, taskOptions);
    return result.content;
  }

  private resolveScope(): string {
    const builder = this.scopeBuilder.scope;
    if (typeof builder === 'function') return builder();
    return builder ?? 'global';
  }

  private resolveTaskName(options: LLMCallOptions): string {
    const builder = this.scopeBuilder.taskName;
    if (typeof builder === 'function') return builder(options);
    if (typeof builder === 'string') return builder;
    return options.operation || options.source || 'LLM 调用';
  }

  private normalizeProvider(provider: string | undefined): string {
    if (!provider) return '';
    if (provider === 'claude') return 'anthropic';
    if (provider === 'gemini') return 'google';
    return provider;
  }
}

/** 包装一个已经创建好的 LLMProvider，使其 non-streaming 调用走主进程任务 */
export function wrapTaskBackedLLM(
  inner: LLMProvider,
  scope: TaskScopeBuilder = {},
): TaskBackedLLMProvider {
  return new TaskBackedLLMProvider(inner, scope);
}
