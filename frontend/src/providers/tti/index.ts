/**
 * TTI Provider 工厂和导出
 * 重构版：注册到 ProviderRegistry
 *
 * 当前内置渠道收敛为 3 个，统一以 https://komaapi.com 作为默认 baseUrl，
 * 三者都默认启用 Koma 协议（内部仍用 'grok-image-index' 作为编译标识）：
 *   - openai-compatible-tti  → OpenAI 标准协议
 *   - grok2api-imagine-tti   → Koma官方Grok（多参考 chat/completions）
 *   - gemini-native-tti      → Koma官方Nano banana（Gemini 原生 generateContent）
 *
 * 之前注册过的 nano-banana / comfyui / gemini-3-pro 已下线；用户旧渠道
 * 仍存于 SQLite 但不会再被工厂创建（createTTIProvider 会抛"未知服务商"）。
 */
import type { TTIModelConfig } from '../../types';
import type { TTIProvider } from './types';
import { OpenAICompatibleTTIProvider } from './OpenAICompatibleTTIProvider';
import { Grok2ApiImagineTTIProvider } from './Grok2ApiImagineTTIProvider';
import { GeminiNativeTTIProvider } from './GeminiNativeTTIProvider';
import type { ProviderDefinition } from '../registry.types';
import { DEFAULT_POLLING_CONFIG, MEDIA_PROVIDER_CONTRACT_VERSION } from '../registry.types';
import { ttiRegistry } from '../registry';

export type { TTIProvider, ImageResult, TTIOptions } from './types';
export { OpenAICompatibleTTIProvider } from './OpenAICompatibleTTIProvider';
export { Grok2ApiImagineTTIProvider } from './Grok2ApiImagineTTIProvider';
export { GeminiNativeTTIProvider } from './GeminiNativeTTIProvider';

// 注册内置 Provider
function registerBuiltinProviders() {
  const builtins: ProviderDefinition<TTIProvider>[] = [
    {
      type: 'openai-compatible-tti',
      kind: 'tti',
      name: 'OpenAI 标准协议',
      description: 'OpenAI 兼容文生图（/v1/images/generations 等）',
      factory: (config) => new OpenAICompatibleTTIProvider(config as TTIModelConfig),
      contractVersion: MEDIA_PROVIDER_CONTRACT_VERSION,
      capabilities: ['tti'],
      polling: DEFAULT_POLLING_CONFIG,
      presetBaseUrl: 'https://komaapi.com',
      auth: { apiKey: 'required', baseUrl: 'optional' },
    },
    {
      type: 'grok2api-imagine-tti',
      kind: 'tti',
      name: 'Koma官方Grok',
      description: 'Koma 官方 Grok 文生图（多参考 chat/completions）',
      factory: (config) => new Grok2ApiImagineTTIProvider(config as TTIModelConfig),
      contractVersion: MEDIA_PROVIDER_CONTRACT_VERSION,
      capabilities: ['tti'],
      polling: DEFAULT_POLLING_CONFIG,
      presetBaseUrl: 'https://komaapi.com',
      auth: { apiKey: 'required', baseUrl: 'optional' },
    },
    {
      type: 'gemini-native-tti',
      kind: 'tti',
      name: 'Koma官方Nano banana',
      description: 'Koma 官方 Nano banana 文生图（Gemini 原生 generateContent，支持多图参考）',
      factory: (config) => new GeminiNativeTTIProvider(config as TTIModelConfig),
      contractVersion: MEDIA_PROVIDER_CONTRACT_VERSION,
      capabilities: ['tti'],
      presetBaseUrl: 'https://komaapi.com',
      auth: { apiKey: 'required', baseUrl: 'optional' },
    },
  ];

  for (const def of builtins) {
    if (!ttiRegistry.has(def.type)) {
      ttiRegistry.register(def);
    }
  }
}

// 初始化时注册
registerBuiltinProviders();

/**
 * 创建 TTI Provider
 * 从 Registry 获取，不再使用 switch-case
 */
export function createTTIProvider(config: TTIModelConfig): TTIProvider {
  const def = ttiRegistry.get(config.provider);
  if (!def) {
    throw new Error(`未知的图片生成服务商: ${config.provider}`);
  }
  // 使用包装函数保持 fetch 的上下文，避免 "Illegal invocation" 错误
  return def.factory(config, { sandboxedFetch: (...args: Parameters<typeof fetch>) => fetch(...args) });
}
