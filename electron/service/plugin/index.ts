/**
 * 插件系统统一导出
 */

// 类型
export * from './types';

// 注册表
export * from './registries';

// 运行时
export { pluginRuntime } from './runtime';

// 桥接
export { pluginBridge } from './bridge';

// Capability 能力系统
export * from './capability';
