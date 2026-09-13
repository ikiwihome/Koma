import type { LLMRequestConfig, ProviderCapability } from '../types';
import { PROVIDER_CAPABILITY_CONFIGS } from '../config';

export function normalizeProviderAlias(provider?: string): string {
  const normalized = (provider || 'openai-compatible').trim().toLowerCase();
  if (normalized === 'claude') return 'anthropic';
  if (normalized === 'gemini') return 'google';
  return normalized;
}

export function resolveContextWindowTokens(config: LLMRequestConfig): number {
  const provider = normalizeProviderAlias(config.modelProvider);
  return PROVIDER_CAPABILITY_CONFIGS[provider]?.contextWindowTokens
    ?? PROVIDER_CAPABILITY_CONFIGS['openai-compatible'].contextWindowTokens;
}

export function resolveProviderCapability(config: LLMRequestConfig): ProviderCapability {
  const provider = normalizeProviderAlias(config.modelProvider);
  const defaults = PROVIDER_CAPABILITY_CONFIGS[provider] ?? PROVIDER_CAPABILITY_CONFIGS['openai-compatible'];
  const { contextWindowTokens, ...rest } = defaults;
  return {
    provider,
    contextWindowTokens,
    ...rest,
  };
}

export function targetChunkCharSize(config: LLMRequestConfig, chunkTargetTokenSize: number): number {
  const provider = normalizeProviderAlias(config.modelProvider);
  return Math.max(4_000, Math.floor(chunkTargetTokenSize * (provider === 'anthropic' ? 2.2 : provider === 'google' ? 3.2 : 2.8)));
}
