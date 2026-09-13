/**
 * Provider / Model / Channel 配置类型与 AppSettings
 *
 * 由 P1#4 从 frontend/src/types.ts 拆出，types.ts 现仅 re-export 本文件。
 * 调用方继续 `import { TTIModelConfig } from '../types'` 不变。
 *
 * 真源说明：ProviderDefinition 等"运行时类型"住在 ../providers/registry.types.ts，
 * 与 SDK 对账（见 packages/plugin-sdk/src/provider.ts 与
 * scripts/check-plugin-sdk-parity.cjs）。本文件只放"用户设置"层面的配置类型。
 */
import type { ChannelConfig, MediaDefaults } from '../providers/channel/types';
import type { ThemeId } from '../theme/types';
import type { ThemePreset } from './project';

export type AppThemeId = ThemeId;

/**
 * Provider 类型标识。真源是 frontend/src/providers/{llm,tti,itv,tts}/index.ts 中
 * 注册到 ProviderRegistry 的 ProviderDefinition.type；Registry 同时承载内置与插件，
 * 因此这里不再维护字面量 union（避免与 Registry 漂移），保留语义别名供调用点标注。
 *
 * - LLMProviderType  使用底层协议路由标识（'openai-compatible' | 'gemini' | 'claude'）
 * - ModelProviderType / TTI / ITV / TTS  使用渠道 ID（'sora2' / 'kling' / 'edge-tts' …）
 */
export type ModelProviderType = string;
export type LLMProviderType = string;
export type TTIProviderType = string;
export type ITVProviderType = string;
export type TTSProviderType = string;

// 通用媒体配置基类
export interface MediaProviderConfig {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  /**
   * 主进程侧 ChannelConfig 主键；由前端 resolver 填入。
   * Provider 发起 HTTP 请求时应通过 `x-koma-channel-id` Header 携带此值，
   * 由主进程 NetController 解密后自动注入 Authorization。
   * 明文 apiKey 不出主进程。
   */
  profileId?: string;
  /**
   * Optional prompt compilation protocol.
   * When set, MediaGenerationService may compile prompt + align reference arrays before provider.start().
   */
  promptProtocol?: 'grok-image-index' | 'koma-jimeng';
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

// TTI 配置（文生图）
export interface TTIModelConfig extends MediaProviderConfig {
  provider: TTIProviderType;
  workflowPath?: string;           // ComfyUI 工作流文件路径
  workflowMapping?: Record<string, string>; // 节点映射 { prompt: "node_id", negative: "node_id", ... }
  modelName?: string;
  defaultSize?: string;            // "1024x1024"
  defaultSteps?: number;
}

// ITV 配置（图生视频）
export interface ITVModelConfig extends MediaProviderConfig {
  provider: ITVProviderType;
  modelName?: string;
  workflowPath?: string;           // ComfyUI AnimateDiff 工作流
  workflowMapping?: Record<string, string>;
  defaultDuration?: number;        // 默认时长（秒）
  defaultResolution?: string;      // "1280x720"
}

// 解析后的配置类型（区分内置和插件渠道）
export type ResolvedTTIConfig =
  | (TTIModelConfig & { source: 'builtin' })
  | (TTIModelConfig & { source: 'channel'; channelConfig: ChannelConfig });

export type ResolvedITVConfig =
  | (ITVModelConfig & { source: 'builtin' })
  | (ITVModelConfig & { source: 'channel'; channelConfig: ChannelConfig });

export type ResolvedTTSConfig =
  | (TTSModelConfig & { source: 'builtin' })
  | (TTSModelConfig & { source: 'channel'; channelConfig: ChannelConfig });

// TTS 配置（语音合成）
export interface TTSModelConfig extends MediaProviderConfig {
  provider: TTSProviderType;
  modelName?: string;
  defaultVoice?: string;
  defaultSpeed?: number;           // 0.5-2.0
}

// 厂商预设
export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl?: string;
  models?: string[];
}

// LLM 模型配置（新版，支持多模型管理）
export interface LLMModelConfig {
  id: string;
  name: string;                              // 用户自定义名称
  provider: LLMProviderType;
  profileId?: string;
  hasStoredCredential?: boolean;
  baseUrl?: string;                          // API 地址，openai-compatible 必填
  apiKey: string;
  modelName: string;                         // 模型名称
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

// OpenAI 兼容渠道预设
export interface LLMChannelPreset {
  id: string;
  name: string;
  baseUrl: string;
  /**
   * Optional suggestion list. Do not rely on this for actual runtime models.
   * Models are maintained per-channel in settings (ChannelConfig.models).
   */
  models?: string[];
}


export interface ModelConfig {
  provider: ModelProviderType;
  profileId?: string;
  hasStoredCredential?: boolean;
  apiKey: string;
  baseUrl?: string;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TTSConfig {
  provider: TTSProviderType;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  defaultVoice?: string;
  profileId?: string; // 渠道凭据代理 ID（与 ITVConfig/TTIModelConfig 对齐）；仅远程 TTS（OpenAI/Fish）使用
}

export interface ITVConfig {
  provider: ITVProviderType;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  defaultDuration?: number;  // 默认视频时长（秒）
  defaultResolution?: string; // 默认分辨率
  profileId?: string; // 渠道凭据代理 ID（与 MediaProviderConfig 对齐），主进程通过 x-koma-channel-id 解密注入 Authorization
  /**
   * Optional prompt compilation protocol.
   * When set, videoRequestCompiler will compile @mentions into protocol-specific tokens
   * (e.g. 'grok-image-index' rewrites `@角色名` → `@Image N` and caps additionalReferences to 3).
   */
  promptProtocol?: 'grok-image-index' | 'koma-jimeng';
  /**
   * 渠道模型上的 defaults（durationMin / durationMax / durationStep / durationValues 等）。
   * 用户通过设置面板编辑模型时填入，运行时由 Provider 读取（例如 OpenAIVideoITVProvider 的时长 spec）。
   */
  modelDefaults?: Record<string, unknown>;
}

export interface AppSettings {
  uiThemeId?: AppThemeId;
  channelConfigs: ChannelConfig[];
  mediaDefaults?: MediaDefaults;
  promptTemplates?: Record<string, {
    template: string;
    updatedAt: number;
  }>;
  /**
   * 用户手动新增的提示词模板（id 不在 PromptTemplateType union 中）。
   * 与 promptTemplates（覆盖默认模板）互补：promptTemplates 是 override，本字段是 new。
   */
  customPromptTemplates?: Array<{
    id: string;                  // 用户自定义的唯一 id（不能与默认模板 id 冲突）
    name: string;
    category: string;            // PromptTemplateCategory（用 string 是为了避免类型循环依赖）
    description: string;
    template: string;
    variables?: Array<{ name: string; required?: boolean }>;
    createdAt: number;
    updatedAt: number;
  }>;
  customThemePresets?: ThemePreset[];  // 用户自定义视觉风格预设
  stylePrompts?: { prompt: string; isDefault?: boolean }[];  // 风格提示词列表
}
