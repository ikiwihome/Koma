/**
 * TTI Provider 类型定义（OpenSpec: request-based + start/snapshot lifecycle）
 */
import type { TTIModelConfig } from '../../types';
import type {
  ProviderAssetInput,
  ProviderStartResult,
  ProviderTaskSnapshot,
  TTIRequest as BaseTTIRequest,
} from '../../types';
import type { PollingConfig } from '../registry.types';

export interface ImageResultMetadata extends Record<string, unknown> {
  batchImages?: ImageResult[];
}

export interface ImageResult {
  /**
   * 生成结果来源：
   * - http/https URL
   * - data: URL
   * - 本地文件路径
   */
  path: string;
  url?: string;
  width?: number;
  height?: number;
  seed?: number;
  mimeType?: string;
  metadata?: ImageResultMetadata;
}

export interface TTIOptions {
  width?: number;
  height?: number;
  seed?: number;
  negativePrompt?: string;
  steps?: number;
  cfgScale?: number;
  aspectRatio?: string; // nano-banana 用
  imageSize?: string;   // nano-banana 用：1K, 2K, 4K
}

export interface TTIRequest extends BaseTTIRequest<ProviderAssetInput, TTIOptions> {
  count?: number;
}

export interface TTIProvider {
  type: string;
  config: TTIModelConfig;
  /**
   * 是否能直接吃 koma-local:// / data-url 等本地参考。
   * true：调用方（如 chat）可以跳过图床上传，直接把本地字节当 data-url 喂进来。
   * 默认 undefined/false：保守起见，调用方应先把本地文件转为公网可访问的 URL。
   */
  supportsLocalReferences?: boolean;

  validate(): boolean;
  testConnection(): Promise<boolean>;

  start(request: TTIRequest): Promise<ProviderStartResult<ImageResult>>;
  getTaskSnapshot?(taskId: string): Promise<ProviderTaskSnapshot<ImageResult>>;
  cancelTask?(taskId: string): Promise<void>;

  polling?: PollingConfig;
}
