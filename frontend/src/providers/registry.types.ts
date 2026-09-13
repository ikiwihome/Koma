/**
 * Provider 注册表类型定义（前端运行时入口）
 *
 * 规格真源：packages/plugin-sdk/src/provider.ts —— 通过 path alias
 * "@komastudio/plugin-sdk" 直接 type-import，不再维护本地副本。
 *
 * 仍由本文件维护：
 *   - DEFAULT_POLLING_CONFIG（运行时常量值；SDK 仅定义类型）
 *   - 本地 wrapper：ChannelKind 别名（带 import-friendly 名称导出）
 *   - IProviderRegistry 接口（注册表实现细节，不属 SDK 公开契约）
 *   - MEDIA_PROVIDER_CONTRACT_VERSION 与 requiresMediaContractVersion 运行时值
 *     仍本地保留（避免 erase-only 类型导入误触发对值的依赖），由 parity 脚本
 *     scripts/check-plugin-sdk-parity.cjs 守护与 SDK 一致。
 */

// 运行时值（带 polling 默认配置）
export type { PollingConfig } from './polling';
export { DEFAULT_POLLING_CONFIG } from './polling';

// 类型规格真源：SDK
export type {
  ChannelKind,
  ChannelCapability,
  ProviderAuthRequirements,
  ProviderModelDefinition,
  ProviderContext,
  ProviderDefinition,
} from '@komastudio/plugin-sdk';

import type { ChannelKind } from '@komastudio/plugin-sdk';

// 运行时常量与函数（值层；与 SDK 同步由 parity 脚本守护）
export const MEDIA_PROVIDER_CONTRACT_VERSION = 'media-request-v1';

export function requiresMediaContractVersion(kind: ChannelKind): boolean {
  return kind === 'tti' || kind === 'itv' || kind === 'tts';
}

import type { ProviderDefinition } from '@komastudio/plugin-sdk';

// 注册表接口（前端实现细节，不属 SDK 公开契约）
export interface IProviderRegistry<T> {
  register(def: ProviderDefinition<T>): void;
  unregister(type: string): void;
  unregisterByPlugin(pluginId: string): void;
  get(type: string): ProviderDefinition<T> | undefined;
  list(kind?: ChannelKind): ProviderDefinition<T>[];
  has(type: string): boolean;
}
