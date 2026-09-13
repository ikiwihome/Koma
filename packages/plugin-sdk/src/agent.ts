/**
 * Agent 相关类型定义
 * 与 electron/service/plugin/types.ts 完全对齐
 */

import type { MCPToolDefinition } from './mcp';

// Agent 元数据（manifest 中使用）
export interface AgentMeta {
  capabilities: string[];
  tools?: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

// Agent 输入
export interface AgentInput {
  message: string;
  context?: Record<string, unknown>;
  tools?: MCPToolDefinition[];
}

// Agent 事件
export interface AgentEvent {
  type: 'chunk' | 'tool_call' | 'tool_result' | 'done' | 'error';
  data: unknown;
}

// Worker Agent 定义（插件 createAgent 返回）
export interface WorkerAgentDefinition {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  tools?: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  invoke?: (input: AgentInput) => AsyncGenerator<AgentEvent>;
  pluginId?: string;
}
