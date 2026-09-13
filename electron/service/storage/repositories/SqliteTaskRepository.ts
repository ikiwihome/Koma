/**
 * tasks 表 Repository — 通用后台任务统一存储
 *
 * 落地全局 settings.db，跨项目 / 跨对话 / 全局任务都共用一张表。
 * 设计：
 *  - scope 形如 'project:<id>' | 'chat:<sessionId>' | 'global'
 *  - payload_json 装载完整业务对象（兼容旧 Task / AsyncTask 形状）
 *  - 冗余 columns（status / target_kind / target_id 等）只为索引和过滤
 */
import { settingsDB } from '../SettingsDB';

export interface TaskRow {
  id: string;
  scope: string;
  type: string;
  target_kind: string | null;
  target_id: string | null;
  status: string;
  progress: number;
  remote_task_id: string | null;
  attempt: number;
  max_retries: number;
  error: string | null;
  payload_json: string;
  created_at: number;
  updated_at: number;
  heartbeat_at: number | null;
  completed_at: number | null;
}

export interface TaskQuery {
  scope?: string;
  scopes?: string[];
  status?: string | string[];
  targetKind?: string;
  targetId?: string;
  type?: string;
}

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

function buildWhere(query: TaskQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.scope !== undefined) {
    clauses.push('scope = ?');
    params.push(query.scope);
  }
  if (query.scopes && query.scopes.length > 0) {
    clauses.push(`scope IN (${query.scopes.map(() => '?').join(',')})`);
    params.push(...query.scopes);
  }
  if (query.status !== undefined) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    if (statuses.length > 0) {
      clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }
  }
  if (query.targetKind !== undefined) {
    clauses.push('target_kind = ?');
    params.push(query.targetKind);
  }
  if (query.targetId !== undefined) {
    clauses.push('target_id = ?');
    params.push(query.targetId);
  }
  if (query.type !== undefined) {
    clauses.push('type = ?');
    params.push(query.type);
  }

  const sql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { sql, params };
}

export class SqliteTaskRepository {
  list(query: TaskQuery = {}): TaskRow[] {
    const db = settingsDB.getDb();
    const { sql, params } = buildWhere(query);
    return db
      .prepare(`SELECT * FROM tasks ${sql} ORDER BY created_at DESC`)
      .all(...params) as TaskRow[];
  }

  get(id: string): TaskRow | null {
    const db = settingsDB.getDb();
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ?? null;
  }

  upsert(row: TaskRow): void {
    const db = settingsDB.getDb();
    db.prepare(
      `INSERT INTO tasks (
         id, scope, type, target_kind, target_id, status, progress,
         remote_task_id, attempt, max_retries, error, payload_json,
         created_at, updated_at, heartbeat_at, completed_at
       ) VALUES (
         @id, @scope, @type, @target_kind, @target_id, @status, @progress,
         @remote_task_id, @attempt, @max_retries, @error, @payload_json,
         @created_at, @updated_at, @heartbeat_at, @completed_at
       )
       ON CONFLICT(id) DO UPDATE SET
         scope          = excluded.scope,
         type           = excluded.type,
         target_kind    = excluded.target_kind,
         target_id      = excluded.target_id,
         status         = excluded.status,
         progress       = excluded.progress,
         remote_task_id = excluded.remote_task_id,
         attempt        = excluded.attempt,
         max_retries    = excluded.max_retries,
         error          = excluded.error,
         payload_json   = excluded.payload_json,
         updated_at     = excluded.updated_at,
         heartbeat_at   = excluded.heartbeat_at,
         completed_at   = excluded.completed_at`
    ).run(row);
  }

  delete(id: string): boolean {
    const db = settingsDB.getDb();
    const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 按 scope 批量删除（删项目 / 删对话时调用）。
   * 返回删除的行数。
   */
  deleteByScope(scope: string): number {
    const db = settingsDB.getDb();
    const info = db.prepare('DELETE FROM tasks WHERE scope = ?').run(scope);
    return info.changes;
  }

  /**
   * 按 target 批量删除（删 shot/character/scene/prop 等子实体）。
   */
  deleteByTarget(scope: string, targetKind: string, targetId: string): number {
    const db = settingsDB.getDb();
    const info = db
      .prepare('DELETE FROM tasks WHERE scope = ? AND target_kind = ? AND target_id = ?')
      .run(scope, targetKind, targetId);
    return info.changes;
  }

  /**
   * 清理终态 N 天前完成的任务。返回删除的行数。
   */
  purgeOldFinished(olderThanMs: number, now: number = Date.now()): number {
    const db = settingsDB.getDb();
    const cutoff = now - olderThanMs;
    const info = db
      .prepare(
        `DELETE FROM tasks
         WHERE status IN (${TERMINAL_STATUSES.map(() => '?').join(',')})
           AND COALESCE(completed_at, updated_at) < ?`
      )
      .run(...TERMINAL_STATUSES, cutoff);
    return info.changes;
  }

  /**
   * 每个 scope 只保留最新 N 条终态任务（运行中不参与限制）。
   * 返回删除的行数。
   */
  enforceScopeLimit(perScopeLimit: number): number {
    if (perScopeLimit <= 0) return 0;
    const db = settingsDB.getDb();
    const placeholders = TERMINAL_STATUSES.map(() => '?').join(',');
    const info = db
      .prepare(
        `DELETE FROM tasks
         WHERE id IN (
           SELECT id FROM (
             SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY scope
                 ORDER BY COALESCE(completed_at, updated_at) DESC
               ) AS rn
             FROM tasks
             WHERE status IN (${placeholders})
           )
           WHERE rn > ?
         )`
      )
      .run(...TERMINAL_STATUSES, perScopeLimit);
    return info.changes;
  }

  /**
   * 启动恢复用：把所有非终态任务标记为 failed（除非显式可恢复）。
   * 返回受影响行数。
   * recoverable 判定：payload_json 中带 recoverable=true 且有 remote_task_id 的，保留 pending；
   * 其它一律标 failed（"任务在软件重启后中断"）。
   */
  reconcileInterrupted(now: number = Date.now()): number {
    const db = settingsDB.getDb();
    const rows = db
      .prepare(
        `SELECT id, payload_json, remote_task_id
         FROM tasks
         WHERE status NOT IN (${TERMINAL_STATUSES.map(() => '?').join(',')})`
      )
      .all(...TERMINAL_STATUSES) as Array<{
      id: string;
      payload_json: string;
      remote_task_id: string | null;
    }>;

    if (rows.length === 0) return 0;

    const failStmt = db.prepare(
      `UPDATE tasks
       SET status = 'failed', error = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`
    );
    const resumeStmt = db.prepare(
      `UPDATE tasks
       SET status = 'pending', error = NULL, updated_at = ?
       WHERE id = ?`
    );

    let changed = 0;
    const tx = db.transaction(() => {
      for (const row of rows) {
        let recoverable = false;
        try {
          const payload = JSON.parse(row.payload_json);
          recoverable = !!payload?.recoverable && !!row.remote_task_id;
        } catch {
          // payload 损坏，按不可恢复处理
        }
        if (recoverable) {
          resumeStmt.run(now, row.id);
        } else {
          failStmt.run('任务在软件重启后中断', now, now, row.id);
        }
        changed++;
      }
    });
    tx();
    return changed;
  }
}

export const sqliteTaskRepository = new SqliteTaskRepository();
