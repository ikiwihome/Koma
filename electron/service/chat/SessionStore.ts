/**
 * 会话存储管理
 */
import type { Session, SessionConfig, SessionSummary, ChatMessage } from './types';
import { generateId as genId } from './types';

const SESSION_TTL = 30 * 60 * 1000; // 30 分钟
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 分钟检查一次

export class SessionStore {
  private sessions: Map<string, Session> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleSessions();
    }, CLEANUP_INTERVAL);
  }

  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.updatedAt > SESSION_TTL) {
        this.dispose(id);
      }
    }
  }

  create(windowId: number, config: SessionConfig = {}): Session {
    const session: Session = {
      id: genId(),
      windowId,
      config,
      messages: [],
      langchainMessages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, updates: Partial<Session>): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    Object.assign(session, updates, { updatedAt: Date.now() });
    return session;
  }

  updateConfig(sessionId: string, config: Partial<SessionConfig>): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.config = { ...session.config, ...config };
    session.updatedAt = Date.now();
    return session;
  }

  addMessage(sessionId: string, message: ChatMessage): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.messages.push(message);
    session.updatedAt = Date.now();
    return session;
  }

  dispose(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // 取消进行中的流式请求
    if (session.abortController) {
      session.abortController.abort();
    }

    this.sessions.delete(sessionId);
    return true;
  }

  disposeByWindow(windowId: number): number {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.windowId === windowId) {
        this.dispose(id);
        count++;
      }
    }
    return count;
  }

  list(windowId?: number): SessionSummary[] {
    const summaries: SessionSummary[] = [];
    for (const session of this.sessions.values()) {
      if (windowId !== undefined && session.windowId !== windowId) continue;
      summaries.push({
        id: session.id,
        windowId: session.windowId,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }
    return summaries;
  }

  setAbortController(sessionId: string, controller: AbortController): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController = controller;
    }
  }

  clearAbortController(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController = undefined;
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const sessionId of this.sessions.keys()) {
      this.dispose(sessionId);
    }
  }
}

export const sessionStore = new SessionStore();
export default sessionStore;
