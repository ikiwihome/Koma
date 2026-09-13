/**
 * Provider 注册表
 * 管理 TTI/ITV/TTS/LLM/image-hosting Provider 定义
 *
 * 行为与 frontend/src/providers/registry.ts 保持一致：
 *  - 媒体 Provider（tti/itv/tts）必填 contractVersion，且与运行时常量一致
 *  - 同名 type 不同 pluginId 抛错（throw-on-conflict），同 pluginId 视为重新注册
 *  - 反注册按 type / pluginId 两种维度
 */
import type { ProviderDefinition, IRegistry } from '../types';
import { MEDIA_PROVIDER_CONTRACT_VERSION, requiresMediaContractVersion } from '../types';

class ProviderRegistry implements IRegistry<ProviderDefinition> {
  private providers = new Map<string, ProviderDefinition>();

  register(def: ProviderDefinition): void {
    if (requiresMediaContractVersion(def.kind)) {
      if (!def.contractVersion) {
        throw new Error(
          `Provider "${def.type}" must declare contractVersion=${MEDIA_PROVIDER_CONTRACT_VERSION}`,
        );
      }
      if (def.contractVersion !== MEDIA_PROVIDER_CONTRACT_VERSION) {
        throw new Error(
          `Provider "${def.type}" uses unsupported contractVersion "${def.contractVersion}", expected "${MEDIA_PROVIDER_CONTRACT_VERSION}"`,
        );
      }
    }

    const existing = this.providers.get(def.type);
    if (existing && existing.pluginId !== def.pluginId) {
      throw new Error(
        `Provider type "${def.type}" already registered by ${existing.pluginId || 'built-in'}`,
      );
    }
    this.providers.set(def.type, def);
    console.log(`[ProviderRegistry] Registered provider: ${def.type} (${def.kind})`);
  }

  unregister(type: string): void {
    if (this.providers.delete(type)) {
      console.log(`[ProviderRegistry] Unregistered provider: ${type}`);
    }
  }

  get(type: string): ProviderDefinition | undefined {
    return this.providers.get(type);
  }

  list(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  listByKind(kind: 'tti' | 'itv' | 'tts' | 'llm' | 'image-hosting'): ProviderDefinition[] {
    return this.list().filter(p => p.kind === kind);
  }

  listByPlugin(pluginId: string): ProviderDefinition[] {
    return this.list().filter(p => p.pluginId === pluginId);
  }

  unregisterByPlugin(pluginId: string): void {
    const toRemove = this.listByPlugin(pluginId).map(p => p.type);
    toRemove.forEach(type => this.unregister(type));
  }

  clear(): void {
    this.providers.clear();
  }
}

export const providerRegistry = new ProviderRegistry();
