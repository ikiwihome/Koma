/**
 * localStorage 键常量
 * 统一管理所有 localStorage 键名，避免硬编码和键名冲突
 */

// 应用级配置
export const STORAGE_KEYS = {
  // 存储配置
  STORAGE_CONFIG: 'koma_storage_config',

  // 应用设置
  SETTINGS: 'koma_settings',

  // 最近项目
  RECENT_PROJECTS: 'koma_recent_projects',

  // 模型预设
  PRESETS: 'koma_presets',

  // 提示词模板
  PROMPT_TEMPLATES: 'koma_prompt_templates',

  // 语言设置
  LANGUAGE: 'app-language',
} as const;

// 项目相关键（带项目 ID 前缀）
export const PROJECT_STORAGE_KEYS = {
  SCRIPT_VERSIONS_PREFIX: 'koma_script_versions_',
} as const;

// 生成带项目 ID 的键
export function getProjectStorageKey(prefix: string, projectId: string): string {
  return `${prefix}${projectId}`;
}

// 生成脚本版本键
export function getScriptVersionsKey(projectId: string): string {
  return getProjectStorageKey(PROJECT_STORAGE_KEYS.SCRIPT_VERSIONS_PREFIX, projectId);
}
