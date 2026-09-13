/**
 * LLM Provider 抽象
 *
 * 目的：把 AgentGraph.createLLM 里硬编码的 switch 迁移成 Registry 模式，
 * 对齐 TTI/ITV/TTS 在前端的 ProviderRegistry 架构。
 *
 * 运行环境：主进程（LangChain 只能在 Node 端跑，与前端 fetch 型 Provider 天然分离）。
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * 主进程 LLM 调用入口 —— 封装具体 LangChain 实现
 */
export interface LLMProvider {
  /**
   * 构造一个 LangChain BaseChatModel 实例
   * @param options 运行时参数（modelName/apiKey/baseUrl/temperature/maxTokens/modelKwargs 等）
   */
  createChatModel(options: CreateChatModelOptions): BaseChatModel;
}

export interface CreateChatModelOptions {
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * 原生透传参数（如 OpenAI 的 response_format、stop、seed 等）。
   * 不支持的 provider 应忽略未知键。
   */
  modelKwargs?: Record<string, unknown>;
}

/**
 * Provider 注册定义
 */
export interface LLMProviderDefinition {
  /** 唯一 type 标识（= SessionConfig.modelProvider / ChannelConfig.providerType） */
  type: string;
  /** 显示名 */
  name: string;
  description?: string;
  /** 构造 Provider 实例（每次 createChatModel 调用时都会重新 factory 一次，保持无状态） */
  factory: () => LLMProvider;
  /** 关联插件 ID（内置 provider 留空） */
  pluginId?: string;
}

export interface ILLMProviderRegistry {
  register(def: LLMProviderDefinition): void;
  unregister(type: string): void;
  unregisterByPlugin(pluginId: string): void;
  get(type: string): LLMProviderDefinition | undefined;
  has(type: string): boolean;
  list(): LLMProviderDefinition[];
  /** 便捷方法：根据 type 直接构造 BaseChatModel */
  create(type: string, options: CreateChatModelOptions): BaseChatModel;
}
