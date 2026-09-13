import type { ProviderCapability } from '../types';

export interface ProviderCapabilityConfig extends Omit<ProviderCapability, 'provider' | 'contextWindowTokens'> {
  contextWindowTokens: number;
}

export const PROVIDER_CAPABILITY_CONFIGS: Record<string, ProviderCapabilityConfig> = {
  anthropic: {
    contextWindowTokens: 200_000,
    supportsPromptCache: true,
    supportsJsonResponseFormat: false,
    prefersStreamingForLongOutput: true,
    recommendedOutputReserve: 8_192,
  },
  claude: {
    contextWindowTokens: 200_000,
    supportsPromptCache: true,
    supportsJsonResponseFormat: false,
    prefersStreamingForLongOutput: true,
    recommendedOutputReserve: 8_192,
  },
  openai: {
    contextWindowTokens: 128_000,
    supportsPromptCache: false,
    supportsJsonResponseFormat: true,
    prefersStreamingForLongOutput: true,
    recommendedOutputReserve: 8_192,
  },
  'openai-compatible': {
    contextWindowTokens: 128_000,
    supportsPromptCache: false,
    supportsJsonResponseFormat: false,
    prefersStreamingForLongOutput: true,
    recommendedOutputReserve: 8_192,
  },
  google: {
    contextWindowTokens: 1_000_000,
    supportsPromptCache: false,
    supportsJsonResponseFormat: false,
    prefersStreamingForLongOutput: false,
    recommendedOutputReserve: 12_288,
  },
  gemini: {
    contextWindowTokens: 1_000_000,
    supportsPromptCache: false,
    supportsJsonResponseFormat: false,
    prefersStreamingForLongOutput: false,
    recommendedOutputReserve: 12_288,
  },
};
