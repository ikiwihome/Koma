/**
 * ProviderAdapter
 * 将 ProviderRegistry 中的 Provider 自动包装为 Capability
 * TTI → image-generation tool, ITV → video-generation tool, etc.
 */
import { providerRegistry } from '../registries';
import { capabilityRegistry } from './CapabilityRegistry';
import type { ProviderDefinition } from '../types';
import type { CapabilityDescriptor, CapabilityResult, CapabilitySource } from './types';
import { buildCapabilityId, PROVIDER_KIND_TAGS } from './types';

// Provider 能力的标准输入 Schema
const PROVIDER_SCHEMAS: Record<string, Record<string, unknown>> = {
  tti: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '图片描述 (正向提示词)' },
      negativePrompt: { type: 'string', description: '负向提示词' },
      width: { type: 'number', description: '图片宽度' },
      height: { type: 'number', description: '图片高度' },
      steps: { type: 'number', description: '推理步数' },
      seed: { type: 'number', description: '随机种子' },
    },
    required: ['prompt'],
  },
  itv: {
    type: 'object',
    properties: {
      imageUrl: { type: 'string', description: '输入图片 URL 或 base64' },
      prompt: { type: 'string', description: '视频描述/运动提示' },
      duration: { type: 'number', description: '视频时长 (秒)' },
      fps: { type: 'number', description: '帧率' },
    },
    required: ['imageUrl'],
  },
  tts: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要转换的文本' },
      voice: { type: 'string', description: '语音角色' },
      speed: { type: 'number', description: '语速倍率' },
      language: { type: 'string', description: '语言' },
    },
    required: ['text'],
  },
  llm: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '输入文本' },
      systemPrompt: { type: 'string', description: '系统提示词' },
      temperature: { type: 'number', description: '温度' },
      maxTokens: { type: 'number', description: '最大 Token 数' },
    },
    required: ['prompt'],
  },
};

/**
 * 将单个 Provider 注册为 Capability
 */
function registerProviderCapability(def: ProviderDefinition): void {
  const source: CapabilitySource = {
    kind: 'provider',
    pluginId: def.pluginId,
    providerKind: def.kind,
  };

  const descriptor: CapabilityDescriptor = {
    id: buildCapabilityId(source, def.type),
    name: `${def.name} (${def.kind.toUpperCase()})`,
    type: def.kind === 'llm' ? 'provider' : 'tool',
    description: def.description || `${def.kind.toUpperCase()} Provider: ${def.name}`,
    tags: [
      ...(PROVIDER_KIND_TAGS[def.kind] || []),
      def.type,
      ...def.capabilities,
    ],
    inputSchema: PROVIDER_SCHEMAS[def.kind],
    source,
  };

  // 创建调用器：通过 Provider factory 创建实例并调用
  const invoker = async (args: unknown): Promise<CapabilityResult> => {
    try {
      const currentDef = providerRegistry.get(def.type);
      if (!currentDef) {
        return { success: false, error: `Provider "${def.type}" no longer available` };
      }

      // 创建 Provider 实例
      const instance = currentDef.factory(args, {}) as any;

      // 通用调用约定：Provider 实例应实现 execute/generate/invoke 方法
      let result: unknown;
      if (typeof instance.execute === 'function') {
        result = await instance.execute(args);
      } else if (typeof instance.generate === 'function') {
        result = await instance.generate(args);
      } else if (typeof instance.invoke === 'function') {
        result = await instance.invoke(args);
      } else if (typeof instance === 'function') {
        result = await instance(args);
      } else {
        // factory 直接返回结果
        result = instance;
      }

      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  capabilityRegistry.register(descriptor, invoker);
}

/**
 * 同步所有 Provider 到 CapabilityRegistry
 */
export function syncProviders(): void {
  // 先清除旧的 provider capabilities
  const existing = capabilityRegistry.list({ sourceKind: 'provider' });
  existing.forEach(d => capabilityRegistry.unregister(d.id));

  // 重新注册
  const providers = providerRegistry.list();
  for (const def of providers) {
    registerProviderCapability(def);
  }

  console.log(`[ProviderAdapter] Synced ${providers.length} providers as capabilities`);
}

/**
 * 注册单个新 Provider
 */
export function onProviderRegistered(def: ProviderDefinition): void {
  registerProviderCapability(def);
}

/**
 * 注销 Provider
 */
export function onProviderUnregistered(type: string): void {
  // 查找并删除对应的 capability
  const all = capabilityRegistry.list({ sourceKind: 'provider' });
  const toRemove = all.filter(d => d.id.endsWith(`:${type}`));
  toRemove.forEach(d => capabilityRegistry.unregister(d.id));
}
