/**
 * Settings Store 统一导出
 */

// 核心
export { loadSettings, saveSettings, generateId, getGlobalPath, DEFAULT_SETTINGS } from './core';
export {
  APP_THEME_OPTIONS,
  DEFAULT_APP_THEME_ID,
  normalizeAppThemeId,
} from './uiTheme';
export type { AppThemeOption } from './uiTheme';

// 预设常量
export { LLM_CHANNEL_PRESETS, TTI_PRESETS, ITV_PRESETS, TTS_PRESETS } from './presets';

// LLM 配置读取
export {
  getDefaultLLMConfig,
  getLLMConfigById,
  getActiveLLMConfig,
} from './llmConfig';

// 媒体配置读取 (TTI/ITV/TTS)
export {
  getDefaultTTIConfig,
  getTTIConfigById,
  getActiveTTIConfig,
  getDefaultITVConfig,
  getITVConfigById,
  getActiveITVConfig,
  getDefaultTTSConfig,
  getTTSConfigById,
  getActiveTTSConfig,
} from './mediaConfig';

// 最近项目
export {
  loadRecentProjects,
  saveRecentProjects,
  addRecentProject,
  removeRecentProject,
} from './recentProjects';

// 模型预设
export {
  loadPresets,
  savePreset,
  deletePreset,
} from './modelPresets';
export type { ModelPreset } from './modelPresets';

// 视觉风格预设
export {
  getCustomThemePresets,
  addCustomThemePreset,
  updateCustomThemePreset,
  deleteCustomThemePreset,
} from './themePresets';

// 渠道配置（重构版）- 使用静态导出
export type { ChannelConfig, ChannelCapability } from '../../providers/channel/types';
export {
  getChannelConfigs,
  getChannelsByCategory,
  getChannelsByCapability,
  addChannelConfig,
  updateChannelConfig,
  deleteChannelConfig,
  deleteChannelsByPlugin,
  deleteChannelByProviderType,
  setDefaultChannelConfig,
  getDefaultChannelConfig,
  setDefaultMediaModelSelection,
  getDefaultMediaModelSelection,
} from './channelConfig';
