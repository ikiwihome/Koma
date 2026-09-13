/**
 * Chat 核心服务
 * 整合 SessionStore, MCPManager, AgentGraph, AgentOrchestrator, CapabilityRegistry
 */
import { EventEmitter } from 'events';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { sessionStore } from './SessionStore';
import { mcpManager } from './mcp';
import { mcpRegistry } from '../plugin/registries';
import { createLLM, createAgentGraph, createToolsFromMCP, streamAgentGraph } from './AgentGraph';
import { createOrchestrator } from './AgentOrchestrator';
import { resolveAndCreateTools } from './CapabilityBridge';
import type {
  Session,
  SessionConfig,
  ChatInput,
  ChatOptions,
  ChatMessage,
  StreamChunkEvent,
  StreamToolEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  MCPServerConfig,
  MCPConnection,
  MCPToolDefinition,
  AgentMode,
} from './types';
import { generateId as genId, createUserMessage, createAssistantMessage } from './types';
import { onMCPConnectionChanged } from '../plugin/capability';

export class ChatService extends EventEmitter {
  private activeRequests = new Map<string, AbortController>();
  // 待审批的工具调用
  private pendingToolCalls = new Map<string, {
    sessionId: string;
    toolName: string;
    args: Record<string, unknown>;
    resolve: (approved: boolean) => void;
    reject: (error: Error) => void;
  }>();

  constructor() {
    super();
    // 监听 MCP 连接变化，自动同步 Capability
    mcpManager.on('connected', () => onMCPConnectionChanged());
    mcpManager.on('disconnected', () => onMCPConnectionChanged());
  }

  // ========== 会话管理 ==========

  createSession(windowId: number, config?: SessionConfig): Session {
    return sessionStore.create(windowId, config);
  }

  getSession(sessionId: string): Session | undefined {
    return sessionStore.get(sessionId);
  }

  disposeSession(sessionId: string): boolean {
    this.cancelRequest(sessionId);
    return sessionStore.dispose(sessionId);
  }

  disposeSessionsByWindow(windowId: number): number {
    // 取消该窗口所有活跃请求
    for (const [requestId, controller] of this.activeRequests) {
      if (requestId.startsWith(`${windowId}_`)) {
        controller.abort();
        this.activeRequests.delete(requestId);
      }
    }
    return sessionStore.disposeByWindow(windowId);
  }

  updateSessionConfig(sessionId: string, config: Partial<SessionConfig>): Session | undefined {
    return sessionStore.updateConfig(sessionId, config);
  }

  listSessions(windowId?: number) {
    return sessionStore.list(windowId);
  }

  // ========== 消息发送 ==========

  async sendMessage(
    sessionId: string,
    input: ChatInput
  ): Promise<ChatMessage | undefined> {
    const session = sessionStore.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 创建用户消息
    const userMessage = createUserMessage(input.content);
    sessionStore.addMessage(sessionId, userMessage);

    // 构建 LangChain 消息
    const humanMsg = this.contentToHumanMessage(input.content);
    session.langchainMessages.push(humanMsg);

    // 创建 LLM 和工具
    const llm = createLLM(session.config);
    const allMcpTools = this.listAllMCPTools();
    const tools = createToolsFromMCP(allMcpTools, session.config.enabledTools);

    // 创建图
    const graph = createAgentGraph(llm, tools, session.config.systemPrompt);

    // 执行
    const result = await graph.invoke({
      messages: session.langchainMessages,
      pendingToolCalls: [],
    });

    // 提取结果
    const lastMessage = result.messages[result.messages.length - 1];
    if (lastMessage instanceof AIMessage) {
      const content = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

      const assistantMessage = createAssistantMessage(content);
      sessionStore.addMessage(sessionId, assistantMessage);
      session.langchainMessages.push(lastMessage);

      return assistantMessage;
    }

    return undefined;
  }

  async *sendMessageStream(
    sessionId: string,
    input: ChatInput,
    options?: ChatOptions
  ): AsyncGenerator<StreamChunkEvent | StreamToolEvent | StreamDoneEvent | StreamErrorEvent> {
    const session = sessionStore.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const requestId = genId();

    // 创建取消控制器
    const abortController = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener('abort', () => abortController.abort());
    }
    this.activeRequests.set(requestId, abortController);
    sessionStore.setAbortController(sessionId, abortController);

    try {
      // 创建用户消息
      const userMessage = createUserMessage(input.content);
      sessionStore.addMessage(sessionId, userMessage);

      // 构建 LangChain 消息
      const humanMsg = this.contentToHumanMessage(input.content);
      session.langchainMessages.push(humanMsg);

      // 判断模式: orchestrated 走编排器，single 走普通 AgentGraph
      const mode: AgentMode = session.config.agentMode || 'single';

      if (mode === 'orchestrated') {
        yield* this.sendOrchestratedStream(session, requestId, input, abortController);
      } else {
        yield* this.sendSingleStream(session, requestId, abortController);
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        yield {
          requestId,
          sessionId,
          finishReason: 'stop',
        } as StreamDoneEvent;
      } else {
        yield {
          requestId,
          sessionId,
          error: {
            code: err.code || 'UNKNOWN_ERROR',
            message: err.message,
          },
        } as StreamErrorEvent;
      }
    } finally {
      this.activeRequests.delete(requestId);
      sessionStore.clearAbortController(sessionId);
    }
  }

  /**
   * 单 Agent 模式流式执行（原有逻辑）
   */
  private async *sendSingleStream(
    session: Session,
    requestId: string,
    abortController: AbortController
  ): AsyncGenerator<StreamChunkEvent | StreamToolEvent | StreamDoneEvent> {
    // 创建 LLM 和工具
    const llm = createLLM(session.config);

    // 如果有 requiredCapabilities，优先用 CapabilityRegistry 解析工具
    let tools;
    if (session.config.requiredCapabilities && session.config.requiredCapabilities.length > 0) {
      tools = resolveAndCreateTools(session.config.requiredCapabilities);
    } else {
      // 合并外部 MCP + 内部插件 MCP 工具
      const allMcpTools = this.listAllMCPTools();
      tools = createToolsFromMCP(allMcpTools, session.config.enabledTools);
    }

    const graph = createAgentGraph(llm, tools, session.config.systemPrompt);

    let seq = 0;
    let fullContent = '';
    let fullReasoning = '';

    for await (const event of streamAgentGraph(
      graph,
      session.langchainMessages,
      abortController.signal
    )) {
      if (abortController.signal.aborted) break;

      if (event.type === 'chunk') {
        fullContent += event.content || '';
        if (event.reasoning) fullReasoning += event.reasoning;

        yield {
          requestId,
          sessionId: session.id,
          delta: event.content || '',
          reasoning: event.reasoning,
          seq: seq++,
        } as StreamChunkEvent;
      }

      if (event.type === 'tool') {
        if (event.toolCall) {
          yield { requestId, sessionId: session.id, toolCall: event.toolCall } as StreamToolEvent;
        }
        if (event.toolResult) {
          yield {
            requestId,
            sessionId: session.id,
            toolCall: { id: event.toolResult.toolCallId, name: event.toolResult.name, arguments: {} },
            result: event.toolResult.result,
          } as StreamToolEvent;
        }
      }

      if (event.type === 'done') {
        const assistantMessage = createAssistantMessage(fullContent, undefined, fullReasoning || undefined);
        sessionStore.addMessage(session.id, assistantMessage);
        session.langchainMessages.push(new AIMessage(fullContent));

        yield {
          requestId,
          sessionId: session.id,
          finishReason: 'stop',
          message: assistantMessage,
        } as StreamDoneEvent;
      }
    }
  }

  /**
   * Orchestrated 模式流式执行（多 Worker 编排）
   */
  private async *sendOrchestratedStream(
    session: Session,
    requestId: string,
    input: ChatInput,
    abortController: AbortController
  ): AsyncGenerator<StreamChunkEvent | StreamToolEvent | StreamDoneEvent> {
    const orchestrator = createOrchestrator(session.config, {
      requiredCapabilities: session.config.requiredCapabilities,
    });

    const userText = typeof input.content === 'string'
      ? input.content
      : input.content.map(p => p.text || '').join(' ');

    let seq = 0;

    for await (const event of orchestrator.orchestrateStream(userText)) {
      if (abortController.signal.aborted) break;

      switch (event.type) {
        case 'plan':
        case 'dispatch':
        case 'synthesize':
          // 编排过程事件，作为 chunk 发送（带标记）
          yield {
            requestId,
            sessionId: session.id,
            delta: '',
            reasoning: `[${event.type}] ${JSON.stringify(event.data)}`,
            seq: seq++,
          } as StreamChunkEvent;
          break;

        case 'worker_done': {
          const data = event.data as { taskId: string; content?: string };
          yield {
            requestId,
            sessionId: session.id,
            delta: '',
            reasoning: `[worker:${data.taskId}] ${data.content || ''}`,
            seq: seq++,
          } as StreamChunkEvent;
          break;
        }

        case 'worker_error': {
          const err = event.data as { taskId: string; error: string };
          yield {
            requestId,
            sessionId: session.id,
            delta: '',
            reasoning: `[error:${err.taskId}] ${err.error}`,
            seq: seq++,
          } as StreamChunkEvent;
          break;
        }

        case 'done': {
          const result = event.data as { response: string };
          const assistantMessage = createAssistantMessage(result.response);
          sessionStore.addMessage(session.id, assistantMessage);
          session.langchainMessages.push(new AIMessage(result.response));

          yield {
            requestId,
            sessionId: session.id,
            finishReason: 'stop',
            message: assistantMessage,
          } as StreamDoneEvent;
          break;
        }

        case 'error': {
          const errorData = event.data as { message: string };
          throw new Error(errorData.message);
        }
      }
    }
  }

  cancelRequest(requestIdOrSessionId: string): boolean {
    // 尝试作为 requestId
    const controller = this.activeRequests.get(requestIdOrSessionId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestIdOrSessionId);
      return true;
    }

    // 尝试作为 sessionId
    const session = sessionStore.get(requestIdOrSessionId);
    if (session?.abortController) {
      session.abortController.abort();
      sessionStore.clearAbortController(requestIdOrSessionId);
      return true;
    }

    return false;
  }

  // ========== MCP 管理 ==========

  async connectMCP(config: MCPServerConfig): Promise<MCPConnection> {
    return mcpManager.connect(config);
  }

  async disconnectMCP(name: string): Promise<void> {
    return mcpManager.disconnect(name);
  }

  listMCPConnections(): MCPConnection[] {
    return mcpManager.listConnections();
  }

  listMCPTools(): MCPToolDefinition[] {
    return mcpManager.listTools();
  }

  /**
   * 获取所有 MCP 工具（合并外部连接 + 内部插件注册）
   */
  listAllMCPTools(): MCPToolDefinition[] {
    const externalTools = mcpManager.listTools();
    const internalTools = mcpRegistry.tools.listDefinitions();

    // 去重，内部优先（与 chat:tools:list 一致）
    const toolMap = new Map<string, MCPToolDefinition>();
    for (const t of internalTools) {
      toolMap.set(t.name, t);
    }
    for (const t of externalTools) {
      if (!toolMap.has(t.name)) {
        toolMap.set(t.name, t);
      }
    }
    return Array.from(toolMap.values());
  }

  async callMCPTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return mcpManager.callTool(name, args);
  }

  // ========== 工具调用审批 ==========

  /**
   * 添加待审批的工具调用
   */
  addPendingToolCall(
    callId: string,
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.pendingToolCalls.set(callId, {
        sessionId,
        toolName,
        args,
        resolve,
        reject,
      });

      // 发送事件通知前端
      this.emit('toolCallPending', { callId, sessionId, toolName, args });
    });
  }

  /**
   * 审批工具调用
   */
  approveToolCall(callId: string): boolean {
    const pending = this.pendingToolCalls.get(callId);
    if (!pending) {
      return false;
    }

    this.pendingToolCalls.delete(callId);
    pending.resolve(true);
    this.emit('toolCallApproved', { callId, sessionId: pending.sessionId, toolName: pending.toolName });
    return true;
  }

  /**
   * 拒绝工具调用
   */
  rejectToolCall(callId: string, reason?: string): boolean {
    const pending = this.pendingToolCalls.get(callId);
    if (!pending) {
      return false;
    }

    this.pendingToolCalls.delete(callId);
    pending.resolve(false);
    this.emit('toolCallRejected', {
      callId,
      sessionId: pending.sessionId,
      toolName: pending.toolName,
      reason: reason || 'User rejected',
    });
    return true;
  }

  /**
   * 获取待审批的工具调用列表
   */
  listPendingToolCalls(sessionId?: string): Array<{
    callId: string;
    sessionId: string;
    toolName: string;
    args: Record<string, unknown>;
  }> {
    const result: Array<{
      callId: string;
      sessionId: string;
      toolName: string;
      args: Record<string, unknown>;
    }> = [];

    for (const [callId, pending] of this.pendingToolCalls) {
      if (!sessionId || pending.sessionId === sessionId) {
        result.push({
          callId,
          sessionId: pending.sessionId,
          toolName: pending.toolName,
          args: pending.args,
        });
      }
    }

    return result;
  }

  // ========== 工具方法 ==========

  private contentToHumanMessage(content: string | { type: string; text?: string; imageUrl?: string }[]): HumanMessage {
    if (typeof content === 'string') {
      return new HumanMessage(content);
    }

    // 多内容类型
    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    for (const part of content) {
      if (part.type === 'text' && part.text) {
        parts.push({ type: 'text', text: part.text });
      } else if (part.type === 'image' && part.imageUrl) {
        parts.push({ type: 'image_url', image_url: { url: part.imageUrl } });
      }
    }

    return new HumanMessage({ content: parts });
  }

  // ========== 生命周期 ==========

  destroy(): void {
    // 取消所有活跃请求
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();

    // 断开所有 MCP 连接
    mcpManager.disconnectAll();

    // 销毁会话存储
    sessionStore.destroy();
  }
}

export const chatService = new ChatService();
export default chatService;
