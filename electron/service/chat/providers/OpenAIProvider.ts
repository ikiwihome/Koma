/**
 * OpenAI（及 OpenAI 兼容）Provider
 * 覆盖：原生 OpenAI、DeepSeek、Moonshot、Qwen、Zhipu 等所有 ChatCompletion 兼容渠道
 */
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LLMProvider, CreateChatModelOptions } from './types';

export class OpenAIProvider implements LLMProvider {
  createChatModel(options: CreateChatModelOptions): BaseChatModel {
    const {
      modelName,
      apiKey,
      baseUrl,
      temperature = 0.7,
      maxTokens,
      modelKwargs,
    } = options;

    return new ChatOpenAI({
      model: modelName || 'gpt-4o',
      apiKey,
      temperature,
      maxTokens,
      configuration: baseUrl ? { baseURL: baseUrl } : undefined,
      ...(modelKwargs ? { modelKwargs } : {}),
    });
  }
}
