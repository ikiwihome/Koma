/**
 * Provider 相关类型定义
 *
 * 规格真源（source of truth）。运行时实现位于：
 *   - frontend/src/providers/registry.types.ts
 *   - electron/service/plugin/types.ts
 *
 * 修改本文件中的字段时，必须同步以上两处，并升级 SDK package.json:version。
 * 字段语义说明：
 *   - 媒体 Provider（tti / itv / tts）的 contractVersion 必填且需等于
 *     MEDIA_PROVIDER_CONTRACT_VERSION，否则 ProviderRegistry.register 抛错
 *   - 'llm' 与 'image-hosting' 不强制 contractVersion
 */

export const MEDIA_PROVIDER_CONTRACT_VERSION = 'media-request-v1';

// 渠道类型
export type ChannelKind = 'llm' | 'tti' | 'itv' | 'tts' | 'image-hosting';

// 渠道能力
export type ChannelCapability =
  | 'llm'
  | 'tti'
  | 'itv'
  | 'tts'
  | 'character-extract'
  | 'remix'
  | 'image-hosting';

/**
 * tti / itv / tts 必须填 contractVersion；llm / image-hosting 暂不强制。
 * 与 frontend/src/providers/registry.types.ts 中的同名函数保持一致。
 */
export function requiresMediaContractVersion(kind: ChannelKind): boolean {
  return kind === 'tti' || kind === 'itv' || kind === 'tts';
}

export interface ProviderAssetInput {
  transport: 'remote-url' | 'data-url';
  value: string;
  mimeType?: string;
}

export type ProviderStartResult<T> =
  | { mode: 'immediate'; output: T }
  | { mode: 'async'; taskId: string };

export interface ProviderTaskSnapshot<T> {
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  progress?: number;
  output?: T;
  error?: string;
}

export interface TTIRequest<TAsset = ProviderAssetInput, TOptions = Record<string, unknown>> {
  prompt: string;
  references?: TAsset[];
  options?: TOptions;
}

export interface ITVRequest<TAsset = ProviderAssetInput, TOptions = Record<string, unknown>> {
  prompt: string;
  primaryImage: TAsset;
  additionalReferences?: TAsset[];
  options?: TOptions;
}

export interface TTSRequest<TOptions = Record<string, unknown>> {
  text: string;
  voiceId: string;
  options?: TOptions;
}

// 轮询配置
export interface PollingConfig {
  interval: number;       // 轮询间隔（毫秒）
  maxDuration: number;    // 最大等待时间（毫秒）
  initialDelay?: number;  // 首次查询延迟（毫秒）
}

// Provider 上下文
export interface ProviderContext {
  pluginId?: string;
  sandboxedFetch: typeof fetch;
  logger?: {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
  };
}

/**
 * 凭据/连接要求声明。
 * 由 channel/catalog 与 presets 派生使用，避免在 catalog 中按 provider id 写死 if 分支。
 *  - apiKey:   远程付费/付费兼容服务通常 required；免费/本地服务为 none
 *  - baseUrl:  本地自建服务（ComfyUI/GPT-SoVITS）通常 required；多数远程服务为 optional
 * 缺省时（未声明 auth）按"远程服务"语义处理：apiKey=required，baseUrl=optional。
 */
export interface ProviderAuthRequirements {
  apiKey?: 'required' | 'optional' | 'none';
  baseUrl?: 'required' | 'optional' | 'none';
}

export interface ProviderModelDefinition {
  id: string;
  label: string;
  description?: string;
  capabilities: string[];
  defaults?: Record<string, unknown>;
}

// Provider 定义
export interface ProviderDefinition<T = any> {
  type: string;              // 唯一标识，如 'sora2', 'vectorengine'
  kind: ChannelKind;         // 'llm' | 'tti' | 'itv' | 'tts' | 'image-hosting'
  name: string;              // 显示名称
  description?: string;      // 描述
  factory: (config: Record<string, any>, ctx: ProviderContext) => T;
  contractVersion?: string;
  capabilities?: ChannelCapability[];
  models?: ProviderModelDefinition[];
  pluginId?: string;         // 关联插件 ID
  configSchema?: Record<string, any>;  // JSON Schema for UI
  defaultConfig?: Record<string, any>;
  polling?: PollingConfig;
  /**
   * UI 元数据：用户在"添加渠道"下拉中看到的预设 baseUrl。
   * 用于派生 ProviderPreset 与 ChannelDefinition.configSchema 的 baseUrl.default。
   */
  presetBaseUrl?: string;
  /** UI 元数据：声明 apiKey/baseUrl 是否必填。catalog 据此推导 required[]。 */
  auth?: ProviderAuthRequirements;
  /**
   * UI 元数据：在 ChannelDefinition 中暴露的运行时 provider 类型标识。
   * 主要用于 LLM 渠道把多个"渠道身份"映射到同一套协议路由
   * （openai/deepseek/qwen/zhipu/moonshot 均使用 'openai-compatible'）。
   * 缺省与 type 相同。
   */
  runtimeProviderType?: string;
  /**
   * 跨渠道回退策略。当用户主动选中此 provider 的某个渠道，但请求失败时：
   *  - 'cross-provider'（缺省）：按 listCapabilityFallbackCandidates 顺位换其他渠道，包括其他 providerType
   *  - 'lock-to-provider-type'：仅在同 providerType 的其他渠道里回退
   *  - 'lock-to-selection'：完全不回退，原样把错误抛给用户
   *
   * 用于像 openai-video 这种"用户期望明确"的渠道，避免失败被静默换成完全不同上游
   * （比如用户选 OpenAI 但实际跑了 Grok）。
   */
  fallbackPolicy?: 'cross-provider' | 'lock-to-provider-type' | 'lock-to-selection';
}
