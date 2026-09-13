/**
 * MCP IPC 服务
 * 前端通过 IPC 与 Electron 主进程的 MCPManager 通信
 */

import type {
  MCPServerConfig,
  MCPTool,
  MCPResource,
  MCPConnection,
} from '../types/mcp';

// Electron API 类型
interface ElectronMCPAPI {
  mcp: {
    connect: (config: MCPServerConfig) => Promise<MCPConnection>;
    disconnect: (name: string) => Promise<void>;
    list: (includeTools?: boolean) => Promise<
      MCPConnection[]
      | {
        connections?: MCPConnection[];
      }
    >;
    listTools: () => Promise<MCPTool[]>;
    listResources: () => Promise<MCPResource[]>;
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    readResource: (uri: string) => Promise<{ content: string; mimeType?: string }>;
  };
  toolApproval: {
    approve: (callId: string) => Promise<{ success: boolean }>;
    reject: (callId: string, reason?: string) => Promise<{ success: boolean }>;
    listPending: (sessionId?: string) => Promise<Array<{
      callId: string;
      sessionId: string;
      toolName: string;
      args: Record<string, unknown>;
    }>>;
    onPending: (callback: (event: any, data: any) => void) => () => void;
    onApproved: (callback: (event: any, data: any) => void) => () => void;
    onRejected: (callback: (event: any, data: any) => void) => () => void;
  };
}

// 获取 Electron API
function getElectronAPI(): ElectronMCPAPI | null {
  if (typeof window !== 'undefined' && window.electronAPI?.chat) {
    return window.electronAPI.chat as ElectronMCPAPI;
  }
  return null;
}

function normalizeConnectionsResponse(
  value: MCPConnection[] | { connections?: MCPConnection[] } | null | undefined
): MCPConnection[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && Array.isArray(value.connections)) {
    return value.connections;
  }
  return [];
}

/**
 * MCP 服务
 */
export const mcpService = {
  /**
   * 连接 MCP 服务器
   */
  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    const api = getElectronAPI();
    if (!api) {
      throw new Error('Electron API not available');
    }
    return api.mcp.connect(config);
  },

  /**
   * 断开 MCP 服务器
   */
  async disconnect(name: string): Promise<void> {
    const api = getElectronAPI();
    if (!api) {
      throw new Error('Electron API not available');
    }
    return api.mcp.disconnect(name);
  },

  /**
   * 获取所有连接
   */
  async getConnections(includeTools = true): Promise<MCPConnection[]> {
    const api = getElectronAPI();
    if (!api) {
      return [];
    }
    return normalizeConnectionsResponse(await api.mcp.list(includeTools));
  },

  /**
   * 获取所有工具
   */
  async getTools(): Promise<MCPTool[]> {
    const api = getElectronAPI();
    if (!api) {
      return [];
    }
    return api.mcp.listTools();
  },

  /**
   * 获取所有资源
   */
  async getResources(): Promise<MCPResource[]> {
    const api = getElectronAPI();
    if (!api) {
      return [];
    }
    return api.mcp.listResources();
  },

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const api = getElectronAPI();
    if (!api) {
      throw new Error('Electron API not available');
    }
    return api.mcp.callTool(name, args);
  },

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<{ content: string; mimeType?: string }> {
    const api = getElectronAPI();
    if (!api) {
      throw new Error('Electron API not available');
    }
    return api.mcp.readResource(uri);
  },

  /**
   * 审批工具调用
   */
  async approveToolCall(callId: string): Promise<boolean> {
    const api = getElectronAPI();
    if (!api) {
      throw new Error('Electron API not available');
    }
    const result = await api.toolApproval.approve(callId);
    return result.success;
  },

  /**
   * 拒绝工具调用
   */
  async rejectToolCall(callId: string, reason?: string): Promise<boolean> {
    const api = getElectronAPI();
    if (!api) {
      throw new Error('Electron API not available');
    }
    const result = await api.toolApproval.reject(callId, reason);
    return result.success;
  },

  /**
   * 获取待审批的工具调用列表
   */
  async listPendingToolCalls(sessionId?: string): Promise<Array<{
    callId: string;
    sessionId: string;
    toolName: string;
    args: Record<string, unknown>;
  }>> {
    const api = getElectronAPI();
    if (!api) {
      return [];
    }
    return api.toolApproval.listPending(sessionId);
  },

  /**
   * 监听待审批工具调用事件
   */
  onToolCallPending(callback: (data: {
    callId: string;
    sessionId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => void): () => void {
    const api = getElectronAPI();
    if (!api) {
      return () => {};
    }
    return api.toolApproval.onPending((_, data) => callback(data));
  },

  /**
   * 监听工具调用审批通过事件
   */
  onToolCallApproved(callback: (data: {
    callId: string;
    sessionId: string;
    toolName: string;
  }) => void): () => void {
    const api = getElectronAPI();
    if (!api) {
      return () => {};
    }
    return api.toolApproval.onApproved((_, data) => callback(data));
  },

  /**
   * 监听工具调用拒绝事件
   */
  onToolCallRejected(callback: (data: {
    callId: string;
    sessionId: string;
    toolName: string;
    reason?: string;
  }) => void): () => void {
    const api = getElectronAPI();
    if (!api) {
      return () => {};
    }
    return api.toolApproval.onRejected((_, data) => callback(data));
  },
};

export default mcpService;
