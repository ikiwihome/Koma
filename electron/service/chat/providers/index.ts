/**
 * 内置 LLM Provider 注册入口
 * 在主进程启动时调用 registerBuiltinLLMProviders()
 */
import { llmProviderRegistry } from './registry';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GoogleGenAIProvider } from './GoogleGenAIProvider';

export { llmProviderRegistry } from './registry';
export type {
  LLMProvider,
  LLMProviderDefinition,
  CreateChatModelOptions,
  ILLMProviderRegistry,
} from './types';

/**
 * 注册所有内置 LLM Provider
 * 幂等：重复调用不会抛错
 */
export function registerBuiltinLLMProviders(): void {
  // OpenAI 原生
  if (!llmProviderRegistry.has('openai')) {
    llmProviderRegistry.register({
      type: 'openai',
      name: 'OpenAI',
      description: 'OpenAI ChatCompletion API',
      factory: () => new OpenAIProvider(),
    });
  }

  // OpenAI 兼容（DeepSeek / Moonshot / Qwen / Zhipu / 自建 OpenAI-compatible 网关）
  // 与 OpenAI 同源行为，仅用不同 baseUrl 区分
  if (!llmProviderRegistry.has('openai-compatible')) {
    llmProviderRegistry.register({
      type: 'openai-compatible',
      name: 'OpenAI Compatible',
      description: 'OpenAI ChatCompletion 兼容协议（DeepSeek / Moonshot / Qwen / Zhipu 等）',
      factory: () => new OpenAIProvider(),
    });
  }

  // Anthropic Claude
  if (!llmProviderRegistry.has('anthropic')) {
    llmProviderRegistry.register({
      type: 'anthropic',
      name: 'Anthropic',
      description: 'Claude 系列',
      factory: () => new AnthropicProvider(),
    });
  }

  // Google Gemini
  if (!llmProviderRegistry.has('google')) {
    llmProviderRegistry.register({
      type: 'google',
      name: 'Google Gemini',
      description: 'Google Generative AI (Gemini)',
      factory: () => new GoogleGenAIProvider(),
    });
  }
}
