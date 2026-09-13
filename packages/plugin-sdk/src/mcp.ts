/**
 * MCP (Model Context Protocol) 相关类型定义
 * 与 electron/service/plugin/types.ts 完全对齐
 */

// MCP 传输类型
export type MCPTransportType = 'stdio' | 'sse' | 'websocket' | 'internal';

// MCP 元数据（manifest 中使用）
export interface MCPMeta {
  transport: MCPTransportType;
  // stdio 模式
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse/websocket 模式
  url?: string;
  // 工具声明（用于 UI 展示，实际定义在插件代码中）
  tools?: Array<{
    name: string;
    description: string;
  }>;
  // 资源声明
  resources?: Array<{
    uri: string;
    description: string;
  }>;
}

// MCP 工具定义
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName?: string;
  pluginId?: string;
}

// MCP 工具处理器
export interface MCPToolHandler {
  definition: MCPToolDefinition;
  handler: (args: unknown) => Promise<unknown>;
}

// MCP 资源定义
export interface MCPResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  pluginId?: string;
}

// MCP 资源处理器
export interface MCPResourceHandler {
  definition: MCPResourceDefinition;
  handler: (uri: string) => Promise<{ content: string; mimeType?: string }>;
}

// MCP 服务器定义（插件 createMCPServer 返回）
export interface MCPServerDefinition {
  name: string;
  transport: MCPTransportType;
  tools: MCPToolHandler[];
  resources?: MCPResourceHandler[];
  pluginId?: string;
}
