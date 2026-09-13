/**
 * LLM 无状态查询服务
 *
 * 兼容层：对 IPC 暴露旧接口，内部委托给新的 LLMExecutionEngine。
 */
import { llmExecutionEngine } from '../llm/engine/LLMExecutionEngine';
import type {
  LLMConnectionTestRequest,
  LLMConnectionTestResponse,
  LLMQueryRequest,
  LLMQueryResponse,
} from '../llm/types';

export type {
  LLMQueryRequest,
  LLMConnectionTestRequest,
  LLMConnectionTestResponse,
  LLMQueryResponse,
} from '../llm/types';

export class LLMQueryService {
  async testConnection(request: LLMConnectionTestRequest): Promise<LLMConnectionTestResponse> {
    return llmExecutionEngine.testConnection(request);
  }

  async query(request: LLMQueryRequest): Promise<LLMQueryResponse> {
    return llmExecutionEngine.query(request);
  }

  async queryStream(
    request: LLMQueryRequest,
    onChunk: (delta: string) => void,
    onDone: (result: { content: string; usage?: LLMQueryResponse['usage'] }) => void,
    onError: (error: { code: string; message: string }) => void,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    return llmExecutionEngine.queryStream(request, { onChunk, onDone, onError, abortSignal });
  }
}

export const llmQueryService = new LLMQueryService();
