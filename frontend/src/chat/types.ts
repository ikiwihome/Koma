/**
 * 对话模块核心类型定义
 */

// 消息角色
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

// 内容部分类型
export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image';
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
}

export interface FileContentPart {
  type: 'file';
  fileName: string;
  fileData: string; // base64
  mimeType: string;
}

export interface VideoContentPart {
  type: 'video';
  videoUrl: string;
  mimeType?: string;
  poster?: string;
}

export type ContentPart = TextContentPart | ImageContentPart | FileContentPart | VideoContentPart;

// 工具调用
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// 工具定义
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

// 消息状态
export type MessageStatus = 'pending' | 'sent' | 'error';

// 对话消息
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string | ContentPart[];
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
  status?: MessageStatus;
}

// 错误码
export enum ChatErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  TOOL_EXECUTION_ERROR = 'TOOL_EXECUTION_ERROR',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  ABORTED = 'ABORTED',
  UNKNOWN = 'UNKNOWN',
}

// 对话错误
export class ChatError extends Error {
  constructor(
    message: string,
    public code: ChatErrorCode,
    public cause?: Error
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

// 生成唯一 ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// 获取消息文本内容
export function getMessageText(message: ChatMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .filter((part): part is TextContentPart => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}

// 创建用户消息
export function createUserMessage(content: string | ContentPart[], status?: MessageStatus): ChatMessage {
  return {
    id: generateId(),
    role: 'user',
    content,
    timestamp: Date.now(),
    status,
  };
}

// 创建助手消息
export function createAssistantMessage(content: string, toolCalls?: ToolCall[], reasoning?: string): ChatMessage {
  return {
    id: generateId(),
    role: 'assistant',
    content,
    reasoning,
    toolCalls,
    timestamp: Date.now(),
  };
}

// 创建系统消息
export function createSystemMessage(content: string): ChatMessage {
  return {
    id: generateId(),
    role: 'system',
    content,
    timestamp: Date.now(),
  };
}

// 创建工具结果消息
export function createToolMessage(toolCallId: string, name: string, content: string): ChatMessage {
  return {
    id: generateId(),
    role: 'tool',
    content,
    toolCallId,
    name,
    timestamp: Date.now(),
  };
}
