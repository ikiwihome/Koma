/**
 * 全局存储
 * 管理全局设置、最近项目、模型预设
 *
 * 注意：此文件已重构为重新导出 settings 模块
 * 实际实现已迁移到 store/settings/ 目录
 */

// 统一使用静态导出
export {
  // 核心
  loadSettings,
  saveSettings,
  generateId,
  getGlobalPath,
  DEFAULT_SETTINGS,
  APP_THEME_OPTIONS,
  DEFAULT_APP_THEME_ID,
  normalizeAppThemeId,
  // 预设常量
  LLM_CHANNEL_PRESETS,
  TTI_PRESETS,
  ITV_PRESETS,
  TTS_PRESETS,
  // LLM 配置读取
  getDefaultLLMConfig,
  getLLMConfigById,
  getActiveLLMConfig,
  // TTI 配置读取
  getDefaultTTIConfig,
  getTTIConfigById,
  getActiveTTIConfig,
  // ITV 配置读取
  getDefaultITVConfig,
  getITVConfigById,
  getActiveITVConfig,
  // TTS 配置读取
  getDefaultTTSConfig,
  getTTSConfigById,
  getActiveTTSConfig,
  // 最近项目
  loadRecentProjects,
  saveRecentProjects,
  addRecentProject,
  removeRecentProject,
  // 模型预设
  loadPresets,
  savePreset,
  deletePreset,
  // 视觉风格预设
  getCustomThemePresets,
  addCustomThemePreset,
  updateCustomThemePreset,
  deleteCustomThemePreset,
  // 渠道配置（重构版）
  getChannelConfigs,
  getChannelsByCategory,
  getChannelsByCapability,
  addChannelConfig,
  updateChannelConfig,
  deleteChannelConfig,
  deleteChannelsByPlugin,
  setDefaultChannelConfig,
  getDefaultChannelConfig,
  setDefaultMediaModelSelection,
  getDefaultMediaModelSelection,
} from './settings';

// 重新导出类型（用于外部引用）
export type { ModelPreset } from './settings';
