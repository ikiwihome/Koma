/**
 * IPC LLM Provider
 * 通过 Electron IPC 调用主进程的 LLMExecutionEngine，替代前端直连 LLM API
 */
import type { ModelConfig } from '../../types';
import type { LLMProvider, ChatMessage, LLMCallOptions, LLMStreamChunkHandler } from './types';
import { llmQuery, llmQueryStream, isLLMIPCAvailable, testLLMConnection } from '../../chat/ipc/chatIPC';

export { isLLMIPCAvailable };

export class IPCLLMProvider implements LLMProvider {
  type = 'ipc';
  config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  validate(): boolean {
    return Boolean(
      ((this.config.profileId && this.config.profileId.length > 0)
        || (this.config.apiKey && this.config.apiKey.length > 0)) &&
      String(this.config.modelName || '').trim()
    );
  }

  async testConnection(): Promise<boolean> {
    const result = await testLLMConnection({
      modelProvider: this.mapProvider(this.config.provider),
      profileId: this.config.profileId,
      modelName: String(this.config.modelName || '').trim(),
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
    return result.success;
  }

  async generateText(prompt: string, systemPrompt?: string, options?: LLMCallOptions): Promise<string> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const request = {
      messages,
      config: this.buildConfig(),
      options: {
        traceId: options?.traceId,
        source: options?.source,
        operation: options?.operation || 'generateText',
        taskKind: options?.taskKind,
        taskProfileId: options?.taskProfileId,
        disableChunking: options?.disableChunking,
        timeoutMs: options?.timeoutMs,
        responseFormat: options?.responseFormat,
      },
    };

    const response = (options?.stream || typeof options?.onChunk === 'function')
      ? await llmQueryStream(request, options?.onChunk)
      : await llmQuery(request);
    return response.content;
  }

  async chat(
    messages: ChatMessage[],
    options?: LLMCallOptions,
    onChunk?: LLMStreamChunkHandler,
  ): Promise<string> {
    const request = {
      messages: messages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      config: this.buildConfig(),
      options: {
        traceId: options?.traceId,
        source: options?.source,
        operation: options?.operation || 'chat',
        taskKind: options?.taskKind,
        taskProfileId: options?.taskProfileId,
        disableChunking: options?.disableChunking,
        timeoutMs: options?.timeoutMs,
        responseFormat: options?.responseFormat,
      },
    };

    const response = options?.stream
      ? await llmQueryStream(request, onChunk || options?.onChunk)
      : await llmQuery(request);
    return response.content;
  }

  private buildConfig() {
    return {
      profileId: this.config.profileId,
      modelProvider: this.mapProvider(this.config.provider),
      modelName: String(this.config.modelName || '').trim(),
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };
  }

  private mapProvider(provider: string): string {
    // 别名归一化；任意其它字符串原样透传（openai-compatible / plugin provider / registry 扩展）
    if (provider === 'claude') return 'anthropic';
    if (provider === 'gemini') return 'google';
    return provider;
  }
}
