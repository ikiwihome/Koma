import type { BaseMessage } from '@langchain/core/messages';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequestConfig {
  profileId?: string;
  modelProvider?: string;
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMRequestOptions {
  traceId?: string;
  source?: string;
  operation?: string;
  taskKind?: LLMTaskKind;
  taskProfileId?: string;
  timeoutMs?: number;
  disableChunking?: boolean;
  responseFormat?: 'json_object' | 'text';
}

export interface LLMQueryRequest {
  messages: LLMMessage[];
  config: LLMRequestConfig;
  options?: LLMRequestOptions;
}

export interface LLMConnectionTestRequest extends LLMRequestConfig {}

export interface LLMServiceError {
  code: 'EMPTY_MESSAGES' | 'EMPTY_RESPONSE' | 'TIMEOUT' | 'ABORTED' | 'API_ERROR' | 'UNKNOWN';
  message: string;
}

export interface LLMConnectionTestResponse {
  success: boolean;
  error?: LLMServiceError;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMQueryResponse {
  content: string;
  usage?: LLMUsage;
  error?: LLMServiceError;
  retryCount?: number;
}

export type LongTextStrategy = 'direct' | 'compact-first' | 'chunked';

export type LLMTaskKind = 'chat' | 'extract' | 'analyze' | 'rewrite' | 'generate' | 'structured';

export interface ProviderCapability {
  provider: string;
  contextWindowTokens: number;
  supportsPromptCache: boolean;
  supportsJsonResponseFormat: boolean;
  prefersStreamingForLongOutput: boolean;
  recommendedOutputReserve: number;
}

export interface BudgetSnapshot {
  estimatedInputTokens: number;
  estimatedUserTokens: number;
  inputBudget: number;
}

export interface StrategyDecision {
  strategy: LongTextStrategy;
  taskKind: LLMTaskKind;
  taskProfileMatched?: boolean;
  taskClassificationSource?: 'explicit' | 'profile' | 'heuristic';
  capability: ProviderCapability;
  budget: BudgetSnapshot;
  compactedRequest?: LLMQueryRequest;
  compactedEstimatedTokens?: number;
  collapseApplied?: boolean;
}

export interface ChunkPlan {
  systemMessages: LLMMessage[];
  prefixUserMessages: LLMMessage[];
  lastUserMessage: LLMMessage;
  longText: string;
  chunks: string[];
}

export interface ResolvedExecutionConfig {
  llmProfileId?: string;
  modelProvider?: string;
  modelName?: string;
  apiKey?: string | null;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onDone: (result: { content: string; usage?: LLMUsage }) => void;
  onError: (error: { code: string; message: string }) => void;
  abortSignal?: AbortSignal;
}

export interface QueryLogContext {
  traceId: string;
  source: string;
  operation: string;
  provider: string;
  model: string;
  msgCount: number;
}

export type LangChainMessageList = BaseMessage[];
