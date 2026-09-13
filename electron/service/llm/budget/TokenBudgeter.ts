import type { BudgetSnapshot, LLMMessage, LLMRequestConfig } from '../types';
import { normalizeProviderAlias, resolveProviderCapability } from '../providers/ProviderCapabilityRegistry';

const DEFAULT_OUTPUT_TOKEN_RESERVE = 8_192;
const INPUT_TOKEN_SAFETY_MARGIN = 2_048;

export class TokenBudgeter {
  estimateTextTokens(text: string, provider?: string): number {
    if (!text) return 0;

    const normalizedProvider = normalizeProviderAlias(provider);
    const cjkWeight = normalizedProvider === 'anthropic' ? 1.2 : normalizedProvider === 'google' ? 0.7 : 0.85;
    const latinWordWeight = normalizedProvider === 'anthropic' ? 1.12 : normalizedProvider === 'google' ? 1.15 : 1.02;
    const digitWeight = normalizedProvider === 'anthropic' ? 1.6 : 1.5;
    const symbolWeight = 0.4;

    let count = 0;
    let currentWord = '';

    const flushWord = () => {
      if (!currentWord) return;
      count += /^\d+$/.test(currentWord) ? digitWeight : latinWordWeight;
      currentWord = '';
    };

    for (const char of text) {
      if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char)) {
        flushWord();
        count += cjkWeight;
        continue;
      }
      if (/[A-Za-z0-9]/.test(char)) {
        currentWord += char;
        continue;
      }
      flushWord();
      if (/\s/.test(char)) {
        count += char === '\n' || char === '\t' ? 0.5 : 0.15;
      } else {
        count += symbolWeight;
      }
    }

    flushWord();
    return Math.max(1, Math.ceil(count));
  }

  estimateMessageTokens(messages: LLMMessage[], provider?: string): number {
    return messages.reduce((sum, message) => {
      const roleOverhead = message.role === 'system' ? 24 : 12;
      return sum + roleOverhead + this.estimateTextTokens(message.content, provider);
    }, 0);
  }

  totalUserContentTokens(messages: LLMMessage[], provider?: string): number {
    return messages
      .filter(message => message.role === 'user')
      .reduce((sum, message) => sum + this.estimateTextTokens(message.content, provider), 0);
  }

  resolveInputTokenBudget(config: LLMRequestConfig): number {
    const capability = resolveProviderCapability(config);
    const contextWindow = capability.contextWindowTokens;
    const requestedOutput = typeof config.maxTokens === 'number' && config.maxTokens > 0
      ? config.maxTokens
      : capability.recommendedOutputReserve || DEFAULT_OUTPUT_TOKEN_RESERVE;
    const outputReserve = Math.min(Math.max(requestedOutput, 2_048), Math.floor(contextWindow * 0.35));
    return Math.max(8_000, contextWindow - outputReserve - INPUT_TOKEN_SAFETY_MARGIN);
  }

  snapshot(messages: LLMMessage[], config: LLMRequestConfig): BudgetSnapshot {
    return {
      estimatedInputTokens: this.estimateMessageTokens(messages, config.modelProvider),
      estimatedUserTokens: this.totalUserContentTokens(messages, config.modelProvider),
      inputBudget: this.resolveInputTokenBudget(config),
    };
  }
}

export const tokenBudgeter = new TokenBudgeter();
