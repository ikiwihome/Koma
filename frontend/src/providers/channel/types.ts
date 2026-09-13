/**
 * 渠道配置类型定义
 * 重构版：移除模板引擎，改为 Provider 注入
 */
import type { ProgressInfo } from '../../types';
import type { PollingConfig, ChannelCapability } from '../registry.types';

// 重新导出 PollingConfig 和 ChannelCapability
export type { PollingConfig, ChannelCapability };

// 渠道类型
export type ChannelType = 'tti' | 'itv' | 'character' | 'remix' | 'tts';
export type MediaCategory = 'llm' | 'tti' | 'itv' | 'tts' | 'image-hosting';
export type ModelCapability =
  | 'llm.chat'
  | 'image.text-to-image'
  | 'image.image-to-image'
  | 'video.text-to-video'
  | 'video.image-to-video'
  | 'video.reference-to-video'
  | 'video.start-end-to-video'
  | 'speech.text-to-speech';

export function isModelCapability(value: string): value is ModelCapability {
  return value === 'llm.chat'
    || value === 'image.text-to-image'
    || value === 'image.image-to-image'
    || value === 'video.text-to-video'
    || value === 'video.image-to-video'
    || value === 'video.reference-to-video'
    || value === 'video.start-end-to-video'
    || value === 'speech.text-to-speech';
}

export interface CapabilityDefinition {
  type: ModelCapability;
  label: string;
  inputContract: string;
  promptCompiler: string;
  editorVariant?: string;
  optionSchema?: Record<string, unknown>;
}

export interface ChannelModelDefinition {
  id: string;
  label: string;
  /**
   * The real upstream model identifier that will be sent to the provider.
   * Keep `id` stable (selection keys, overrides, etc.) and edit this field freely.
   */
  providerModelName?: string;
  description?: string;
  capabilities: ModelCapability[];
  defaults?: Record<string, unknown>;
}

export interface ChannelDefinition {
  id: string;
  category: MediaCategory;
  vendor: string;
  name: string;
  description?: string;
  runtimeProviderType?: string;
  models: ChannelModelDefinition[];
  configSchema?: Record<string, unknown>;
}

export interface MediaModelSelection {
  channelId: string;
  modelId: string;
}

export type MediaDefaults = Partial<Record<MediaCategory, MediaModelSelection>>;

// 鉴权配置
export interface AuthConfig {
  type: 'bearer' | 'header' | 'query' | 'none';
  keyName?: string;
  keyValue: string;
  prefix?: string;
}

// 渠道进度信息
export interface ChannelProgressInfo extends ProgressInfo {
  rawResponse?: any;
  extra?: Record<string, any>;
}

// 渠道验证结果
export interface ChannelValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 渠道配置（Provider 注入版）
 * 不再包含模板配置，改为引用 Provider 类型
 */
export interface ChannelConfig {
  id: string;
  name: string;
  description?: string;
  category: MediaCategory;

  // Provider 类型（对应 ProviderRegistry 中的 type）
  providerType: string;

  // Provider 配置（传给 factory 的参数）
  providerConfig: Record<string, any>;

  // 渠道内模型选择
  defaultModelId?: string;
  models: ChannelModelDefinition[];

  // 能力列表（插件渠道可显式声明；内置渠道由 definition.models 推导）
  capabilities?: ChannelCapability[];

  // 轮询配置（可覆盖 Provider 默认值）
  polling?: PollingConfig;

  // 是否启用
  enabled: boolean;

  // 兼容旧页面展示默认标记；新的全局默认以 settings.mediaDefaults 为准
  isDefault?: boolean;

  // 来源标识
  source: 'builtin' | 'plugin';
  pluginId?: string;

  // 元数据
  createdAt: number;
  updatedAt: number;
}

// 获取渠道能力列表
export function getChannelCapabilities(config: ChannelConfig): ChannelCapability[] {
  return config.capabilities || [];
}

// 检查渠道是否具有指定能力
export function hasChannelCapability(config: ChannelConfig, capability: ChannelCapability): boolean {
  return config.capabilities?.includes(capability) ?? false;
}

export function getChannelCategory(config: ChannelConfig): MediaCategory {
  if (config.category) return config.category;
  switch (config.providerType) {
    case 'vidu':
    case 'runway':
    case 'kling':
    case 'pika':
    case 'sora2':
    case 'custom':
    case 'seedance':
    case 'grok2api-imagine-itv':
    case 'comfyui-animatediff':
      return 'itv';
    default:
      return config.capabilities?.includes('tts')
        ? 'tts'
        : config.capabilities?.includes('itv')
          ? 'itv'
          : config.capabilities?.includes('tti')
            ? 'tti'
            : 'image-hosting';
  }
}

/**
 * @deprecated 使用 ChannelConfig 代替
 * 兼容旧代码，将在后续版本删除
 */
export type UnifiedChannelConfig = ChannelConfig;
