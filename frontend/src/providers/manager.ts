/**
 * ProviderManager - 统一 Provider 管理入口
 * 作为唯一的 Provider 创建入口，强制要求 kind 参数
 */
import type { LLMProvider } from './llm/types';
import type { TTIProvider } from './tti/types';
import type { ITVProvider } from './itv/types';
import type { TTSProvider } from './tts/types';
import type { ImageHostingProvider } from './imageHosting/types';
import {
  type ChannelKind,
  type ProviderDefinition,
  type ProviderContext,
  type IProviderRegistry,
  llmRegistry,
  ttiRegistry,
  itvRegistry,
  ttsRegistry,
  imageHostingRegistry,
} from './registry';

// 类型安全映射
export type ProviderKindMap = {
  llm: LLMProvider;
  tti: TTIProvider;
  itv: ITVProvider;
  tts: TTSProvider;
  'image-hosting': ImageHostingProvider;
};

/**
 * Provider 管理器
 * 统一管理 LLM/TTI/ITV/TTS/image-hosting 五种类型的 Provider
 */
export class ProviderManager {
  private readonly registries: Record<ChannelKind, IProviderRegistry<any>>;

  constructor() {
    this.registries = {
      llm: llmRegistry,
      tti: ttiRegistry,
      itv: itvRegistry,
      tts: ttsRegistry,
      'image-hosting': imageHostingRegistry,
    };
  }

  /**
   * 注册 Provider
   */
  register<T>(def: ProviderDefinition<T>): void {
    if (!def.kind) {
      throw new Error('Provider definition must include explicit kind');
    }
    this.registries[def.kind].register(def);
  }

  /**
   * 反注册 Provider
   */
  unregister(kind: ChannelKind, type: string): void {
    this.registries[kind].unregister(type);
  }

  /**
   * 反注册插件的所有 Provider
   */
  unregisterByPlugin(pluginId: string): void {
    Object.values(this.registries).forEach(registry => {
      registry.unregisterByPlugin(pluginId);
    });
  }

  /**
   * 创建 Provider 实例（类型安全）
   */
  create<K extends ChannelKind>(
    kind: K,
    type: string,
    config: Record<string, any>,
    ctx?: Partial<ProviderContext>
  ): ProviderKindMap[K] {
    const registry = this.registries[kind];
    const def = registry.get(type);

    if (!def) {
      throw new Error(`Provider "${type}" not found in ${kind} registry`);
    }

    // 插件 Provider 必须提供 sandboxedFetch
    const isPluginProvider = !!def.pluginId;
    if (isPluginProvider && !ctx?.sandboxedFetch) {
      throw new Error(`Plugin provider "${type}" requires sandboxedFetch in context`);
    }

    const fullCtx: ProviderContext = {
      sandboxedFetch: ctx?.sandboxedFetch || fetch,
      pluginId: ctx?.pluginId || def.pluginId,
      logger: ctx?.logger || console,
    };

    return def.factory(config, fullCtx);
  }

  /**
   * 获取 Provider 定义
   */
  get<K extends ChannelKind>(kind: K, type: string): ProviderDefinition<ProviderKindMap[K]> | undefined {
    return this.registries[kind].get(type);
  }

  /**
   * 列出指定类型的所有 Provider
   */
  list<K extends ChannelKind>(kind: K): ProviderDefinition<ProviderKindMap[K]>[] {
    return this.registries[kind].list();
  }

  /**
   * 列出所有 Provider
   */
  listAll(): ProviderDefinition<any>[] {
    return [
      ...this.registries.llm.list(),
      ...this.registries.tti.list(),
      ...this.registries.itv.list(),
      ...this.registries.tts.list(),
      ...this.registries['image-hosting'].list(),
    ];
  }

  /**
   * 检查 Provider 是否存在
   */
  has(kind: ChannelKind, type: string): boolean {
    return this.registries[kind].has(type);
  }
}

// 单例导出
export const providerManager = new ProviderManager();
