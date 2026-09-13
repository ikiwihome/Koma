/**
 * Google Generative AI Provider（Gemini 系列）
 */
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LLMProvider, CreateChatModelOptions } from './types';

export class GoogleGenAIProvider implements LLMProvider {
  createChatModel(options: CreateChatModelOptions): BaseChatModel {
    const {
      modelName,
      apiKey,
      temperature = 0.7,
      maxTokens,
    } = options;

    return new ChatGoogleGenerativeAI({
      model: modelName || 'gemini-2.0-flash',
      apiKey,
      temperature,
      maxOutputTokens: maxTokens,
    });
  }
}
