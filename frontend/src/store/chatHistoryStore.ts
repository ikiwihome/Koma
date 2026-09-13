/**
 * 对话历史存储
 *
 * 使用 Zustand 管理 UI 状态；持久层通过 chatIPC.history.* 走 SQLite（settings.db）。
 * Zustand 中只缓存元数据列表与当前会话，消息明细按需从 SQLite 拉取。
 */
import { create } from 'zustand';
import type { ChatMessage } from '../chat/types';
import type { ChatMessageRow, ChatSessionRow } from '../chat/ipc';
import { chatIPC } from '../chat/ipc';
import { createLogger } from './logger';

const logger = createLogger('ChatHistory');

const MAX_TITLE_LENGTH = 30;

// 会话元数据
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// 完整会话数据
export interface SessionData extends SessionMeta {
  messages: ChatMessage[];
}

interface ChatHistoryState {
  sessions: SessionMeta[];
  currentSessionId: string | null;

  loadSessions: () => Promise<void>;
  createSession: (title?: string) => string;
  deleteSession: (id: string) => Promise<void>;
  setCurrentSession: (id: string | null) => void;

  saveMessages: (sessionId: string, messages: ChatMessage[]) => Promise<void>;
  loadMessages: (sessionId: string) => Promise<SessionData | null>;
}

function normalizeTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > MAX_TITLE_LENGTH
    ? `${cleaned.slice(0, MAX_TITLE_LENGTH)}...`
    : cleaned;
}

function extractMessageText(message: ChatMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content.reduce((acc, part) => {
    if (part.type === 'text') {
      return acc ? `${acc} ${part.text}` : part.text;
    }
    return acc;
  }, '');
}

function generateTitle(messages: ChatMessage[]): string {
  const firstAssistantMsg = messages.find(m => m.role === 'assistant');
  if (firstAssistantMsg) {
    const title = normalizeTitle(extractMessageText(firstAssistantMsg));
    if (title) return title;
  }
  const firstUserMsg = messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    const title = normalizeTitle(extractMessageText(firstUserMsg));
    if (title) return title;
  }
  return '新对话';
}

function rowToSessionMeta(row: ChatSessionRow): SessionMeta {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  };
}

function rowToChatMessage(row: ChatMessageRow): ChatMessage {
  let content: ChatMessage['content'];
  try {
    const parsed = JSON.parse(row.content_json);
    content = typeof parsed === 'string' ? parsed : (parsed as ChatMessage['content']);
  } catch {
    content = row.content_json;
  }

  let extras: Partial<ChatMessage> = {};
  if (row.extras_json) {
    try {
      extras = JSON.parse(row.extras_json) as Partial<ChatMessage>;
    } catch (e) {
      logger.warn('解析 extras_json 失败', e);
    }
  }

  return {
    id: row.id,
    role: row.role as ChatMessage['role'],
    content,
    reasoning: row.reasoning ?? undefined,
    timestamp: row.created_at,
    ...extras,
  };
}

function chatMessageToRow(
  message: ChatMessage,
  sessionId: string,
  seq: number,
): ChatMessageRow {
  const { id, role, content, reasoning, timestamp, ...rest } = message;
  // extras 收纳 toolCalls / toolCallId / name / metadata / status 等长尾字段
  const extras = Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
  return {
    id,
    session_id: sessionId,
    seq,
    role,
    content_json: JSON.stringify(content),
    reasoning: reasoning ?? null,
    extras_json: extras,
    created_at: timestamp,
  };
}

function newSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useChatHistoryStore = create<ChatHistoryState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,

  loadSessions: async () => {
    try {
      const rows = await chatIPC.history.listSessions();
      const sessions = rows.map(rowToSessionMeta);
      set({ sessions });
    } catch (e) {
      logger.error('加载会话列表失败', e);
    }
  },

  createSession: (title?: string) => {
    const id = newSessionId();
    const now = Date.now();
    const session: SessionMeta = {
      id,
      title: title || '新对话',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };
    set(state => ({
      sessions: [session, ...state.sessions],
      currentSessionId: id,
    }));
    // 注意：不立即落库，等到 saveMessages 时才写入；空会话不进 SQLite
    return id;
  },

  deleteSession: async (id) => {
    try {
      await chatIPC.history.deleteSession(id);
    } catch (e) {
      logger.error('删除会话失败', e);
    }
    set(state => ({
      sessions: state.sessions.filter(s => s.id !== id),
      currentSessionId: state.currentSessionId === id ? null : state.currentSessionId,
    }));
  },

  setCurrentSession: (id) => {
    set({ currentSessionId: id });
  },

  saveMessages: async (sessionId, messages) => {
    if (messages.length === 0) return;
    const state = get();
    const existing = state.sessions.find(s => s.id === sessionId);
    const now = Date.now();
    const meta: SessionMeta = {
      id: sessionId,
      title: existing?.title && existing.title !== '新对话' ? existing.title : generateTitle(messages),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messageCount: messages.length,
    };

    const sessionRow: ChatSessionRow = {
      id: meta.id,
      title: meta.title,
      created_at: meta.createdAt,
      updated_at: meta.updatedAt,
      message_count: meta.messageCount,
    };
    const messageRows = messages.map((msg, idx) => chatMessageToRow(msg, sessionId, idx));

    try {
      const result = await chatIPC.history.saveSession(sessionRow, messageRows);
      if (!result?.success) {
        logger.error('保存会话失败（IPC 返回 success=false）', {
          sessionId,
          messageCount: messageRows.length,
          error: (result as any)?.error,
        });
        return;
      }
      logger.info('保存会话成功', { sessionId, messageCount: messageRows.length });
    } catch (e) {
      logger.error('保存会话异常', e);
      return;
    }

    set(state => {
      const others = state.sessions.filter(s => s.id !== sessionId);
      return { sessions: [meta, ...others] };
    });
  },

  loadMessages: async (sessionId) => {
    try {
      const result = await chatIPC.history.getSession(sessionId);
      if (!result) return null;
      return {
        ...rowToSessionMeta(result.session),
        messages: result.messages.map(rowToChatMessage),
      };
    } catch (e) {
      logger.error('加载会话数据失败', e);
      return null;
    }
  },
}));

export default useChatHistoryStore;
