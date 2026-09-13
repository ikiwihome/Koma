import type { ChannelDefinition, MediaCategory } from './types';
import type { ProviderDefinition, ChannelKind } from '../registry.types';
import { getRegistry } from '../registry';

// 触发内置 Provider 注册副作用（顺序无关，模块顶层 registerBuiltinProviders 会执行）
import '../llm';
import '../tti';
import '../itv';
import '../tts';

/**
 * Built-in channel definitions are provider templates only.
 *
 * Important: do NOT hardcode upstream model lists here. Models (and their capability matrix)
 * are maintained in user settings (ChannelConfig.models) so they can be updated dynamically
 * without shipping a new app build.
 */

/**
 * 从 ProviderDefinition.auth 推导 configSchema.required[]。
 * 默认按"远程付费服务"语义：apiKey 必填、baseUrl 可选。
 */
function deriveRequiredFields(def: ProviderDefinition<any>): string[] {
  const required: string[] = [];
  const apiKey = def.auth?.apiKey ?? 'required';
  const baseUrl = def.auth?.baseUrl ?? 'optional';
  if (baseUrl === 'required') required.push('baseUrl');
  if (apiKey === 'required') required.push('apiKey');
  return required;
}

function defToChannel(category: MediaCategory, def: ProviderDefinition<any>): ChannelDefinition {
  return {
    id: def.type,
    category,
    vendor: def.name,
    name: def.name,
    description: def.description,
    runtimeProviderType: def.runtimeProviderType ?? def.type,
    models: [],
    configSchema: {
      required: deriveRequiredFields(def),
      properties: {
        baseUrl: { type: 'string', default: def.presetBaseUrl ?? '' },
        apiKey: { type: 'string' },
      },
    },
  };
}

function listChannelsFromRegistry(category: MediaCategory): ChannelDefinition[] {
  const kind = category as ChannelKind;
  const defs = getRegistry(kind).list().filter(def => !def.pluginId);
  return defs.map(def => defToChannel(category, def));
}

/**
 * 列出所有内置渠道定义。
 *
 * 不再缓存为模块级常量，避免插件运行时注册新 Provider 后此列表失效。
 * 当下游需要稳定快照时，应在调用点自行缓存。
 */
export function listBuiltInChannelDefinitions(category?: MediaCategory): ChannelDefinition[] {
  if (category) {
    return listChannelsFromRegistry(category);
  }
  return [
    ...listChannelsFromRegistry('llm'),
    ...listChannelsFromRegistry('tti'),
    ...listChannelsFromRegistry('itv'),
    ...listChannelsFromRegistry('tts'),
  ];
}

export function getBuiltInChannelDefinition(channelId: string): ChannelDefinition | undefined {
  return listBuiltInChannelDefinitions().find((item) => item.id === channelId);
}
