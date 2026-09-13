/**
 * 渠道框架导出
 * 重构版：移除模板引擎，改为 Provider 注入
 */
export * from './types';
export * from './catalog';
export * from './resolver';

// 导出 Registry 和 Polling
export {
  type ChannelKind,
  type ProviderContext,
  type ProviderDefinition,
  type IProviderRegistry,
  ttiRegistry,
  itvRegistry,
  getRegistry,
  registerProvider,
  unregisterProvider,
  unregisterProvidersByPlugin,
  listProviders,
  createProviderInstance,
} from '../registry';

export {
  pollTask,
  pollTaskById,
  DEFAULT_POLLING_CONFIG,
  type PollTaskParams,
} from '../polling';

import type { ChannelConfig, ChannelValidationResult } from './types';

/**
 * 验证渠道配置
 */
export function validateChannelConfig(config: ChannelConfig): ChannelValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.id) errors.push('缺少 id');
  if (!config.name) errors.push('缺少名称');
  if (!config.providerType) errors.push('缺少 providerType');
  if (!config.category) errors.push('缺少 category');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * @deprecated 模板系统已删除，此常量保留仅供兼容
 */
export const UNIFIED_CHANNEL_TEMPLATES: Record<string, any> = {};
