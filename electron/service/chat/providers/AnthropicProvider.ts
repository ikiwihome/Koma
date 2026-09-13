/**
 * Anthropic Claude Provider
 */
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LLMProvider, CreateChatModelOptions } from './types';

export class AnthropicProvider implements LLMProvider {
  createChatModel(options: CreateChatModelOptions): BaseChatModel {
    const {
      modelName,
      apiKey,
      baseUrl,
      temperature = 0.7,
      maxTokens,
      modelKwargs,
    } = options;

    return new ChatAnthropic({
      model: modelName || 'claude-3-5-sonnet-latest',
      apiKey,
      temperature,
      maxTokens,
      ...(baseUrl ? { clientOptions: { baseURL: baseUrl } } : {}),
      ...(modelKwargs ? { modelKwargs } : {}),
    });
  }
}
