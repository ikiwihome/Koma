/**
 * MCP 前端类型定义
 * 与后端类型对齐，用于 IPC 通信
 */

// MCP 传输类型
export type MCPTransportType = 'stdio' | 'sse' | 'websocket' | 'internal';

// MCP 服务器配置
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransportType;
  // stdio 模式
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse/websocket 模式
  url?: string;
  // 关联插件
  pluginId?: string;
}

// MCP 工具定义
export interface MCPTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  serverName?: string;
  pluginId?: string;
}

// MCP 资源定义
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverName?: string;
}

// MCP 连接状态
export interface MCPConnection {
  name: string;
  transport: MCPTransportType;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  tools: MCPTool[];
  resources: MCPResource[];
  error?: string;
}

// 工具调用状态
export type ToolCallStatus = 'pending_approval' | 'calling' | 'running' | 'success' | 'error';

// 工具调用状态
export interface ToolCallState {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
  startTime: number;
  endTime?: number;
}

// MCP 服务器 UI 状态
export interface MCPServerUIState {
  id: string;
  config: MCPServerConfig;
  status: 'connected' | 'disconnected' | 'error';
  toolCount: number;
  resourceCount: number;
  lastError?: string;
}
