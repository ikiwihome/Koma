/**
 * chat_sessions / chat_messages 表 Repository
 *
 * 落地全局 settings.db，跨项目共享聊天历史。
 */
import { settingsDB } from '../SettingsDB';

export interface ChatSessionRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  seq: number;
  role: string;
  content_json: string;
  reasoning: string | null;
  extras_json: string | null;
  created_at: number;
}

export class SqliteChatHistoryRepository {
  listSessions(): ChatSessionRow[] {
    const db = settingsDB.getDb();
    return db
      .prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC')
      .all() as ChatSessionRow[];
  }

  getSession(id: string): ChatSessionRow | null {
    const db = settingsDB.getDb();
    const row = db
      .prepare('SELECT * FROM chat_sessions WHERE id = ?')
      .get(id) as ChatSessionRow | undefined;
    return row ?? null;
  }

  upsertSession(row: ChatSessionRow): void {
    const db = settingsDB.getDb();
    db.prepare(
      `INSERT INTO chat_sessions (id, title, created_at, updated_at, message_count)
       VALUES (@id, @title, @created_at, @updated_at, @message_count)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at,
         message_count = excluded.message_count`
    ).run(row);
  }

  deleteSession(id: string): boolean {
    const db = settingsDB.getDb();
    // 外键 ON DELETE CASCADE 已自动清理 chat_messages
    const info = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
    return info.changes > 0;
  }

  listMessages(sessionId: string): ChatMessageRow[] {
    const db = settingsDB.getDb();
    return db
      .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as ChatMessageRow[];
  }

  /**
   * 整体替换某个会话的全部消息（最直接的同步策略）
   */
  replaceMessages(sessionId: string, rows: ChatMessageRow[]): void {
    const db = settingsDB.getDb();
    const tx = db.transaction((items: ChatMessageRow[]) => {
      db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
      const stmt = db.prepare(
        `INSERT INTO chat_messages
           (id, session_id, seq, role, content_json, reasoning, extras_json, created_at)
         VALUES
           (@id, @session_id, @seq, @role, @content_json, @reasoning, @extras_json, @created_at)`
      );
      for (const row of items) {
        stmt.run(row);
      }
    });
    tx(rows);
  }

  /**
   * 原子地保存会话元信息 + 全部消息。任何一步失败都会回滚，避免出现"会话存在但消息为空"的不一致状态。
   */
  saveSessionAtomic(session: ChatSessionRow, rows: ChatMessageRow[]): void {
    const db = settingsDB.getDb();
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO chat_sessions (id, title, created_at, updated_at, message_count)
         VALUES (@id, @title, @created_at, @updated_at, @message_count)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           updated_at = excluded.updated_at,
           message_count = excluded.message_count`
      ).run(session);
      db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(session.id);
      const stmt = db.prepare(
        `INSERT INTO chat_messages
           (id, session_id, seq, role, content_json, reasoning, extras_json, created_at)
         VALUES
           (@id, @session_id, @seq, @role, @content_json, @reasoning, @extras_json, @created_at)`
      );
      for (const row of rows) {
        stmt.run(row);
      }
    });
    tx();
  }
}

export const sqliteChatHistoryRepository = new SqliteChatHistoryRepository();
