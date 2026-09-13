import { app, BrowserWindow, ipcMain } from 'electron';
import { createOrchestrator, AgentOrchestrator } from './AgentOrchestrator';
import { chatService } from './ChatService';
import { llmExecutionEngine } from '../llm';
import type { LLMConnectionTestRequest, LLMQueryRequest } from '../llm';
import { importFromFile, importFromObject, exportConfig, exportToFile } from './mcp/MCPConfigLoader';
import type {
  ChatInput,
  ChatOptions,
  MCPServerConfig,
  SessionConfig,
  StreamChunkEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  StreamToolEvent,
} from './types';
import { mcpRegistry } from '../plugin/registries';
import { capabilityRegistry } from '../plugin/capability';
import { sqliteChatHistoryRepository } from '../storage';
import type { ChatMessageRow, ChatSessionRow } from '../storage';

const VALID_ROLES = new Set(['system', 'user', 'assistant']);
const MAX_CONTENT_LENGTH = 100_000;
const MAX_MESSAGES = 200;
const MAX_CONCURRENT_LLM_QUERIES = 5;
const MAX_CONCURRENT_WORKFLOW_QUERIES = 3;
const MAX_CONCURRENT_USER_QUERIES = 2;
const QUEUE_TIMEOUT_MS = 30_000;

const WORKFLOW_SOURCE_PATTERNS = ['workflow', 'script', 'shot', 'entity', 'episode'];

function isWorkflowSource(source: string): boolean {
  const lower = source.toLowerCase();
  return WORKFLOW_SOURCE_PATTERNS.some(p => lower.includes(p));
}

function validateLLMQueryRequest(args: unknown): args is LLMQueryRequest {
  if (!args || typeof args !== 'object') return false;
  const req = args as Record<string, unknown>;

  // messages array
  if (!Array.isArray(req.messages)) return false;
  if (req.messages.length === 0 || req.messages.length > MAX_MESSAGES) return false;
  for (const msg of req.messages) {
    if (!msg || typeof msg !== 'object') return false;
    const m = msg as Record<string, unknown>;
    if (!VALID_ROLES.has(m.role as string)) return false;
    if (typeof m.content !== 'string') return false;
    if (m.content.length > MAX_CONTENT_LENGTH) return false;
  }

  // config object
  if (!req.config || typeof req.config !== 'object') return false;
  const cfg = req.config as Record<string, unknown>;
  // modelProvider 放宽为任意非空 string（放行 openai-compatible / 插件 provider / registry 扩展）
  if (
    cfg.modelProvider !== undefined
    && (typeof cfg.modelProvider !== 'string' || cfg.modelProvider.trim().length === 0)
  ) {
    return false;
  }

  return true;
}

class ChatIpc {
  private initialized = false;
  private activeLLMQueries = 0;
  private activeWorkflowQueries = 0;
  private activeUserQueries = 0;
  private waitQueue: Array<() => void> = [];

  private canAcquireSlot(isWorkflow: boolean): boolean {
    if (this.activeLLMQueries >= MAX_CONCURRENT_LLM_QUERIES) return false;
    if (isWorkflow && this.activeWorkflowQueries >= MAX_CONCURRENT_WORKFLOW_QUERIES) return false;
    if (!isWorkflow && this.activeUserQueries >= MAX_CONCURRENT_USER_QUERIES) return false;
    return true;
  }

  private acquireSlot(isWorkflow: boolean): void {
    this.activeLLMQueries++;
    if (isWorkflow) this.activeWorkflowQueries++;
    else this.activeUserQueries++;
  }

  private releaseSlot(isWorkflow: boolean): void {
    this.activeLLMQueries--;
    if (isWorkflow) this.activeWorkflowQueries--;
    else this.activeUserQueries--;
    // 唤醒队列中等待的请求
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    }
  }

  private waitForSlot(isWorkflow: boolean): Promise<boolean> {
    if (this.canAcquireSlot(isWorkflow)) {
      this.acquireSlot(isWorkflow);
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.indexOf(tryAcquire);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        resolve(false);
      }, QUEUE_TIMEOUT_MS);

      const tryAcquire = () => {
        if (this.canAcquireSlot(isWorkflow)) {
          clearTimeout(timer);
          this.acquireSlot(isWorkflow);
          resolve(true);
        } else {
          // 槽位被其他类型请求拿走，重新排队
          this.waitQueue.push(tryAcquire);
        }
      };
      this.waitQueue.push(tryAcquire);
    });
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // ========== 无状态 LLM 查询（供 workflow 服务使用） ==========

    ipcMain.handle('llm:query', async (_event, args: LLMQueryRequest) => {
      const traceId = args?.options?.traceId || `ipc-${Date.now()}`;
      const source = args?.options?.source || 'unknown';
      const isWorkflow = isWorkflowSource(source);

      if (!validateLLMQueryRequest(args)) {
        console.warn('[ChatIpc] llm:query 参数校验失败', { traceId, source });
        return { content: '', error: { code: 'API_ERROR' as const, message: 'Invalid request: bad messages, role, content length, or provider' } };
      }
      const acquired = await this.waitForSlot(isWorkflow);
      if (!acquired) {
        console.warn('[ChatIpc] llm:query 排队超时', {
          traceId,
          source,
          isWorkflow,
          active: this.activeLLMQueries,
          activeWorkflow: this.activeWorkflowQueries,
          activeUser: this.activeUserQueries,
          queued: this.waitQueue.length,
          limits: {
            total: MAX_CONCURRENT_LLM_QUERIES,
            workflow: MAX_CONCURRENT_WORKFLOW_QUERIES,
            user: MAX_CONCURRENT_USER_QUERIES,
            queueTimeoutMs: QUEUE_TIMEOUT_MS,
          },
        });
        return { content: '', error: { code: 'API_ERROR' as const, message: 'LLM query queue timeout, please retry later' } };
      }
      console.info('[ChatIpc] llm:query 接收请求', { traceId, source, isWorkflow, active: this.activeLLMQueries, activeWorkflow: this.activeWorkflowQueries, activeUser: this.activeUserQueries });
      try {
        // query() 内部已捕获所有异常并返回结构化错误，此处 catch 仅作保底
        const result = await llmExecutionEngine.query(args);
        if (result.error) {
          console.warn('[ChatIpc] llm:query 返回错误', { traceId, source, error: result.error });
        }
        return result;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[ChatIpc] llm:query 未预期异常', { traceId, source, error: errMsg });
        return { content: '', error: { code: 'UNKNOWN' as const, message: 'LLM query failed' } };
      } finally {
        this.releaseSlot(isWorkflow);
      }
    });

    // ========== 流式 LLM 查询（供长文本精炼等重量级任务使用） ==========

    ipcMain.handle('llm:queryStream', async (event, args: LLMQueryRequest) => {
      const traceId = args?.options?.traceId || `ipc-stream-${Date.now()}`;
      const source = args?.options?.source || 'unknown';
      const isWorkflow = isWorkflowSource(source);

      if (!validateLLMQueryRequest(args)) {
        console.warn('[ChatIpc] llm:queryStream 参数校验失败', { traceId, source });
        return { content: '', error: { code: 'API_ERROR' as const, message: 'Invalid request' } };
      }

      const acquired = await this.waitForSlot(isWorkflow);
      if (!acquired) {
        console.warn('[ChatIpc] llm:queryStream 排队超时', {
          traceId,
          source,
          isWorkflow,
          active: this.activeLLMQueries,
          activeWorkflow: this.activeWorkflowQueries,
          activeUser: this.activeUserQueries,
          queued: this.waitQueue.length,
          limits: {
            total: MAX_CONCURRENT_LLM_QUERIES,
            workflow: MAX_CONCURRENT_WORKFLOW_QUERIES,
            user: MAX_CONCURRENT_USER_QUERIES,
            queueTimeoutMs: QUEUE_TIMEOUT_MS,
          },
        });
        return { content: '', error: { code: 'API_ERROR' as const, message: 'LLM query queue timeout' } };
      }

      const sender = event.sender;
      const streamId = traceId;

      console.info('[ChatIpc] llm:queryStream 接收请求', { traceId, source, isWorkflow });

      // Fire-and-forget: 先返回 streamId，让前端注册监听后再接收流式事件
      void (async () => {
        try {
          await llmExecutionEngine.queryStream(args, {
            onChunk: (delta) => {
              if (!sender.isDestroyed()) {
                sender.send('llm:stream:chunk', { streamId, delta });
              }
            },
            onDone: (result) => {
              if (!sender.isDestroyed()) {
                sender.send('llm:stream:done', { streamId, content: result.content, usage: result.usage });
              }
            },
            onError: (error) => {
              if (!sender.isDestroyed()) {
                sender.send('llm:stream:error', { streamId, error });
              }
            },
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[ChatIpc] llm:queryStream 未预期异常', { traceId, source, error: errMsg });
          if (!sender.isDestroyed()) {
            sender.send('llm:stream:error', { streamId, error: { code: 'UNKNOWN', message: 'LLM stream query failed' } });
          }
        } finally {
          this.releaseSlot(isWorkflow);
        }
      })();

      return { streamId, accepted: true };
    });

    ipcMain.handle('llm:testConnection', async (_event, args: LLMConnectionTestRequest) => {
      try {
        return await llmExecutionEngine.testConnection(args);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'UNKNOWN' as const, message } };
      }
    });

    ipcMain.handle('chat:session:create', async (event, args: { config?: SessionConfig }) => {
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id || 0;
      const session = chatService.createSession(windowId, args?.config);
      return {
        id: session.id,
        windowId: session.windowId,
        config: session.config,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
      };
    });

    ipcMain.handle('chat:session:get', async (_event, args: { sessionId: string }) => {
      const session = chatService.getSession(args.sessionId);
      if (!session) return null;
      return {
        id: session.id,
        windowId: session.windowId,
        config: session.config,
        messages: session.messages,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    });

    ipcMain.handle('chat:session:dispose', async (_event, args: { sessionId: string }) => {
      return chatService.disposeSession(args.sessionId);
    });

    ipcMain.handle('chat:session:list', async (event, args?: { windowId?: number }) => {
      const windowId = args?.windowId ?? BrowserWindow.fromWebContents(event.sender)?.id;
      return chatService.listSessions(windowId);
    });

    ipcMain.handle('chat:session:updateConfig', async (_event, args: {
      sessionId: string;
      config: Partial<SessionConfig>;
    }) => {
      const session = chatService.updateSessionConfig(args.sessionId, args.config);
      if (!session) return null;
      return {
        id: session.id,
        config: session.config,
      };
    });

    ipcMain.handle('chat:message:send', async (_event, args: {
      sessionId: string;
      input: ChatInput;
    }) => {
      return chatService.sendMessage(args.sessionId, args.input);
    });

    ipcMain.handle('chat:message:sendStream', async (event, args: {
      sessionId: string;
      input: ChatInput;
      options?: ChatOptions;
    }) => {
      const sender = event.sender;

      void (async () => {
        try {
          for await (const chunk of chatService.sendMessageStream(args.sessionId, args.input, args.options)) {
            if (sender.isDestroyed()) break;

            if ('delta' in chunk) {
              sender.send('chat:stream:chunk', chunk as StreamChunkEvent);
            } else if ('toolCall' in chunk) {
              sender.send('chat:stream:tool', chunk as StreamToolEvent);
            } else if ('finishReason' in chunk) {
              sender.send('chat:stream:done', chunk as StreamDoneEvent);
            } else if ('error' in chunk) {
              sender.send('chat:stream:error', chunk as StreamErrorEvent);
            }
          }
        } catch (err: any) {
          if (!sender.isDestroyed()) {
            sender.send('chat:stream:error', {
              requestId: '',
              sessionId: args.sessionId,
              error: { code: 'STREAM_ERROR', message: err.message },
            });
          }
        }
      })();

      return { accepted: true };
    });

    ipcMain.handle('chat:message:cancel', async (_event, args: { requestId?: string; sessionId?: string }) => {
      const id = args.requestId || args.sessionId;
      if (!id) return false;
      return chatService.cancelRequest(id);
    });

    ipcMain.handle('chat:mcp:connect', async (_event, args: { config: MCPServerConfig }) => {
      return chatService.connectMCP(args.config);
    });

    ipcMain.handle('chat:mcp:disconnect', async (_event, args: { name: string }) => {
      await chatService.disconnectMCP(args.name);
      return { success: true };
    });

    ipcMain.handle('chat:mcp:list', async (_event, args?: { includeTools?: boolean }) => {
      const connections = chatService.listMCPConnections();
      if (args?.includeTools) {
        return {
          connections,
          tools: chatService.listMCPTools(),
        };
      }
      return { connections };
    });

    ipcMain.handle('chat:mcp:callTool', async (_event, args: {
      name: string;
      arguments: Record<string, unknown>;
    }) => {
      return chatService.callMCPTool(args.name, args.arguments);
    });

    ipcMain.handle('chat:mcp:listTools', async () => {
      return chatService.listMCPTools();
    });

    ipcMain.handle('chat:tool:approve', async (_event, args: { callId: string }) => {
      return { success: chatService.approveToolCall(args.callId) };
    });

    ipcMain.handle('chat:tool:reject', async (_event, args: { callId: string; reason?: string }) => {
      return { success: chatService.rejectToolCall(args.callId, args.reason) };
    });

    ipcMain.handle('chat:tool:listPending', async (_event, args?: { sessionId?: string }) => {
      return chatService.listPendingToolCalls(args?.sessionId);
    });

    chatService.on('toolCallPending', data => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('chat:tool:pending', data);
        }
      });
    });

    chatService.on('toolCallApproved', data => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('chat:tool:approved', data);
        }
      });
    });

    chatService.on('toolCallRejected', data => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('chat:tool:rejected', data);
        }
      });
    });

    ipcMain.handle('chat:tools:list', async () => {
      const externalTools = chatService.listMCPTools();
      const internalTools = mcpRegistry.tools.listDefinitions();
      const toolMap = new Map<string, any>();

      for (const tool of internalTools) {
        toolMap.set(tool.name, { ...tool, source: 'plugin' });
      }
      for (const tool of externalTools) {
        if (!toolMap.has(tool.name)) {
          toolMap.set(tool.name, { ...tool, source: 'mcp' });
        }
      }

      return Array.from(toolMap.values());
    });

    ipcMain.handle('chat:tools:call', async (_event, args: {
      name: string;
      arguments: Record<string, unknown>;
    }) => {
      const internalTool = mcpRegistry.tools.get(args.name);
      if (internalTool) {
        return internalTool.handler(args.arguments);
      }
      return chatService.callMCPTool(args.name, args.arguments);
    });

    const orchestrators = new Map<string, AgentOrchestrator>();

    ipcMain.handle('chat:agent:list', async () => {
      const orchestrator = createOrchestrator({});
      return orchestrator.listAvailableWorkers().map(worker => ({
        id: worker.id,
        name: worker.name,
        description: worker.description,
        capabilities: worker.capabilities,
        pluginId: worker.pluginId,
      }));
    });

    ipcMain.handle('chat:agent:orchestrate', async (event, args: {
      sessionId: string;
      message: string;
      config?: { maxIterations?: number; parallelExecution?: boolean };
    }) => {
      const session = chatService.getSession(args.sessionId);
      if (!session) {
        return { error: 'Session not found' };
      }

      const orchestrator = createOrchestrator(session.config, args.config);
      const orchestrateId = `orch_${Date.now()}`;
      orchestrators.set(orchestrateId, orchestrator);

      const sender = event.sender;

      void (async () => {
        try {
          for await (const ev of orchestrator.orchestrateStream(args.message)) {
            if (sender.isDestroyed()) break;
            sender.send('chat:agent:event', { orchestrateId, ...ev });
          }
        } catch (err: any) {
          if (!sender.isDestroyed()) {
            sender.send('chat:agent:event', {
              orchestrateId,
              type: 'error',
              data: { message: err.message },
            });
          }
        } finally {
          orchestrators.delete(orchestrateId);
        }
      })();

      return { orchestrateId, accepted: true };
    });

    ipcMain.handle('chat:agent:cancel', async (_event, args: { orchestrateId: string }) => {
      const orchestrator = orchestrators.get(args.orchestrateId);
      if (orchestrator) {
        orchestrator.cancel();
        orchestrators.delete(args.orchestrateId);
        return { success: true };
      }
      return { success: false, error: 'Orchestrator not found' };
    });

    ipcMain.handle('chat:capability:list', async (_event, args?: {
      type?: string;
      tags?: string[];
      sourceKind?: string;
    }) => {
      return capabilityRegistry.list({
        type: args?.type as any,
        tags: args?.tags,
        sourceKind: args?.sourceKind as any,
      });
    });

    ipcMain.handle('chat:capability:invoke', async (_event, args: {
      id: string;
      arguments: unknown;
    }) => {
      return capabilityRegistry.invoke(args.id, args.arguments);
    });

    ipcMain.handle('chat:capability:resolve', async (_event, args: {
      requirements: string[];
    }) => {
      return capabilityRegistry.resolve(args.requirements);
    });

    ipcMain.handle('chat:mcp:importConfig', async (_event, args: {
      filePath?: string;
      config?: { mcpServers: Record<string, any> };
    }) => {
      if (args.filePath) {
        return importFromFile(args.filePath);
      }
      if (args.config) {
        return importFromObject(args.config);
      }
      return { error: 'Either filePath or config is required' };
    });

    ipcMain.handle('chat:mcp:exportConfig', async (_event, args?: {
      filePath?: string;
    }) => {
      if (args?.filePath) {
        await exportToFile(args.filePath);
        return { success: true, filePath: args.filePath };
      }
      return exportConfig();
    });

    ipcMain.handle('chat:agent:templates', async () => {
      const workers = createOrchestrator({}).listAvailableWorkers();
      return workers.map(worker => ({
        id: worker.id,
        name: worker.name,
        description: worker.description,
        capabilities: worker.capabilities,
        tools: worker.tools,
        systemPrompt: worker.systemPrompt,
        pluginId: worker.pluginId,
      }));
    });

    // ========== 聊天历史持久化（SQLite settings.db） ==========

    ipcMain.handle('chat:history:listSessions', async () => {
      return sqliteChatHistoryRepository.listSessions();
    });

    ipcMain.handle('chat:history:getSession', async (_event, args: { sessionId: string }) => {
      const session = sqliteChatHistoryRepository.getSession(args.sessionId);
      if (!session) return null;
      const messages = sqliteChatHistoryRepository.listMessages(args.sessionId);
      return { session, messages };
    });

    ipcMain.handle('chat:history:saveSession', async (_event, args: {
      session: ChatSessionRow;
      messages: ChatMessageRow[];
    }) => {
      try {
        // 原子保存：session + messages 同进同退，避免"session 存在但消息为空"的旧 bug
        sqliteChatHistoryRepository.saveSessionAtomic(args.session, args.messages);
        console.info('[ChatHistory] saveSession ok', {
          id: args.session.id,
          title: args.session.title,
          messageCount: args.messages.length,
        });
        return { success: true };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[ChatHistory] saveSession 失败', {
          id: args.session.id,
          messageCount: args.messages.length,
          error: errorMessage,
          stack: err instanceof Error ? err.stack : undefined,
        });
        return { success: false, error: errorMessage };
      }
    });

    ipcMain.handle('chat:history:deleteSession', async (_event, args: { sessionId: string }) => {
      const ok = sqliteChatHistoryRepository.deleteSession(args.sessionId);
      // 联动清理：与该会话相关的后台任务一并移除
      try {
        const { taskService } = await import('../tasks/TaskService');
        taskService.removeByScope(`chat:${args.sessionId}`);
      } catch (err) {
        console.error('[ChatHistory] 清理会话相关任务失败', err);
      }
      return { success: ok };
    });

    app.on('window-all-closed', () => {
      // Handle window closed event if needed
    });

    // Handle window closed events via app lifecycle
    app.on('window-all-closed', () => {
      // Cleanup handled by disposeSessionsByWindow
    });
  }

  destroy(): void {
    chatService.destroy();
  }
}

export const chatIpc = new ChatIpc();
