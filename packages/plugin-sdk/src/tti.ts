/**
 * TTI Provider 类型定义（OpenSpec: request-based + start/snapshot lifecycle）
 */
import type {
  PollingConfig,
  ProviderAssetInput,
  ProviderStartResult,
  ProviderTaskSnapshot,
  TTIRequest as BaseTTIRequest,
} from './provider';

export interface ImageResult {
  path: string;
  url?: string;
  width?: number;
  height?: number;
  seed?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface TTIOptions {
  width?: number;
  height?: number;
  seed?: number;
  negativePrompt?: string;
  steps?: number;
  cfgScale?: number;
  aspectRatio?: string;
  imageSize?: string; // 1K, 2K, 4K
}

export type TTIRequest = BaseTTIRequest<ProviderAssetInput, TTIOptions>;

export interface TTIProvider {
  type: string;
  config: Record<string, any>;

  validate(): boolean;
  testConnection(): Promise<boolean>;

  start(request: TTIRequest): Promise<ProviderStartResult<ImageResult>>;
  getTaskSnapshot?(taskId: string): Promise<ProviderTaskSnapshot<ImageResult>>;
  cancelTask?(taskId: string): Promise<void>;

  polling?: PollingConfig;
}

