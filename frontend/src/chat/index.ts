/**
 * 对话模块
 * 通过 IPC 与 Electron 主进程通信，支持流式输出、MCP 工具、多模型
 */

// 核心类型
export * from './types';

// Hooks (IPC 驱动)
export { useChat } from './hooks';
export type { UseChatOptions, UseChatReturn } from './hooks';

// IPC 客户端 - 避免重复导出类型
export { chatIPC } from './ipc';
export type {
  SessionConfig,
  SessionSummary,
  SessionDetail,
  ChatInput,
  StreamChunkEvent,
  StreamToolEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  MCPTransportType,
  MCPConnection,
  MCPToolDefinition,
  AgentMode,
  ToolResult,
  StreamEventCallback,
  UnsubscribeFn,
  LLMQueryRequest,
  LLMQueryResponse,
} from './ipc';
export {
  createSession,
  getSession,
  disposeSession,
  listSessions,
  updateSessionConfig,
  sendMessage,
  sendMessageStream,
  cancelStream,
  onStreamChunk,
  onStreamTool,
  onStreamDone,
  onStreamError,
  connectMCP,
  disconnectMCP,
  listMCPConnections,
  listMCPTools,
  callMCPTool,
  listAllTools,
  callTool,
  createUserInput,
  llmQuery,
  isLLMIPCAvailable,
} from './ipc';

// 组件
export { ChatRenderer, MessageBubble } from './components';
export type { ChatRendererProps } from './components';
