/**
 * LLM Provider 注册表（主进程单例）
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  ILLMProviderRegistry,
  LLMProviderDefinition,
  CreateChatModelOptions,
} from './types';

class LLMProviderRegistry implements ILLMProviderRegistry {
  private providers = new Map<string, LLMProviderDefinition>();

  register(def: LLMProviderDefinition): void {
    const existing = this.providers.get(def.type);
    if (existing && existing.pluginId !== def.pluginId) {
      throw new Error(
        `LLM provider type "${def.type}" already registered by ${existing.pluginId || 'built-in'}`,
      );
    }
    this.providers.set(def.type, def);
  }

  unregister(type: string): void {
    this.providers.delete(type);
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [type, def] of this.providers.entries()) {
      if (def.pluginId === pluginId) {
        this.providers.delete(type);
      }
    }
  }

  get(type: string): LLMProviderDefinition | undefined {
    return this.providers.get(type);
  }

  has(type: string): boolean {
    return this.providers.has(type);
  }

  list(): LLMProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  create(type: string, options: CreateChatModelOptions): BaseChatModel {
    const def = this.get(type);
    if (!def) {
      throw new Error(`LLM provider not found: ${type}`);
    }
    const provider = def.factory();
    return provider.createChatModel(options);
  }
}

export const llmProviderRegistry = new LLMProviderRegistry();
