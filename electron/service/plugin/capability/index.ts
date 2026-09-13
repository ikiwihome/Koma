/**
 * Capability 模块统一导出
 */
export * from './types';
export { CapabilityRegistry, capabilityRegistry } from './CapabilityRegistry';
export { syncProviders, onProviderRegistered, onProviderUnregistered } from './ProviderAdapter';
export { syncAllMCP, syncExternalMCP, syncInternalMCP, onMCPConnectionChanged, onInternalMCPChanged } from './MCPAdapter';
