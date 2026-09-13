/**
 * llmTaskClient —— 让 LLM 调用走"任务化"通道
 *
 * 与现有 IPCLLMProvider 的差异：
 *  - IPCLLMProvider.chat() 直接 invoke 'llm:query'：one-shot；renderer 关窗口 → 响应丢失
 *  - llmQueryViaTask()：submit 到主进程 TaskRunner；状态写 SQLite；
 *    关窗口 main 仍跑；reopen 后通过 task.id 取回完成结果（task.payload.output）
 *
 * 适用场景：
 *  - 长 prompt（剧本解析阶段、规划生成）
 *  - 用户希望"提交后能切走做别的"
 *  - 多窗口 / 多视图共享同一次推理结果
 *
 * 不适用：
 *  - 实时 streaming（仍走 chat:* 通道）
 *  - 极轻量的同步交互（每次 IPC + DB 写入有 ~5ms 开销）
 */
import { submitTask, waitForTaskCompletion, type TaskRecord } from './tasksIPC';

export interface LLMTaskRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  config: {
    profileId?: string;
    modelProvider?: string;
    modelName?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
  };
  options?: {
    traceId?: string;
    source?: string;
    operation?: string;
    taskKind?: string;
    taskProfileId?: string;
    timeoutMs?: number;
    disableChunking?: boolean;
    responseFormat?: 'json_object' | 'text';
  };
}

export interface LLMTaskResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMTaskOptions {
  /** 任务 scope，默认 'global'。可传 'project:<id>' 把 LLM 任务挂到项目下统一清理 */
  scope?: string;
  /** 任务面板显示的名字 */
  taskName?: string;
  /** 取消信号；abort 后会发 tasks:cancel 让主进程中止 handler */
  signal?: AbortSignal;
  /** 业务侧 target，便于 hooks 投影 loading */
  targetKind?: string;
  targetId?: string;
}

/**
 * 提交一次 LLM 调用作为任务，等待完成后返回内容。
 * 返回 [content, taskId] —— 调用方可用 taskId 在 UI 投影 / 取消 / 之后查询。
 */
export async function llmQueryViaTask(
  request: LLMTaskRequest,
  options: LLMTaskOptions = {}
): Promise<{ result: LLMTaskResult; taskId: string }> {
  const submitted = await submitTask({
    type: 'llm:complete',
    scope: options.scope ?? 'global',
    targetKind: options.targetKind,
    targetId: options.targetId,
    input: request,
    initialPayload: {
      targetName: options.taskName ?? request.options?.operation ?? 'LLM 调用',
    },
  });
  const final = await waitForTaskCompletion(submitted.id, { signal: options.signal });
  const output = (final.payload as { output?: LLMTaskResult } | undefined)?.output;
  if (!output) throw new Error('LLM 任务完成但缺少结果');
  return { result: output, taskId: submitted.id };
}

/** 拿到既有任务的最终结果（用于 reopen 后取回历史完成项） */
export function readLLMTaskRecord(record: TaskRecord): LLMTaskResult | null {
  const payload = record.payload as { output?: LLMTaskResult } | undefined;
  return payload?.output ?? null;
}
