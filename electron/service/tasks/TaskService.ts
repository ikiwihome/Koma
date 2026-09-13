/**
 * TaskService — 主进程通用后台任务存储服务
 *
 * Phase 1：仅做存储 + 广播。状态机和 handler 调度后续 Phase 进。
 *
 * 对外形状对前端两个旧 store（TaskManager / taskQueueStore）保持兼容：
 *   - upsert：传完整 record；payload_json 直接装载业务侧序列化对象
 *   - 列冗余字段（status/scope/target/...）由 service 从 record 推导填入
 */
import { sqliteTaskRepository } from '../storage';
import type { TaskQuery, TaskRow } from '../storage';
import { SqliteAppSettingsKvRepository } from '../storage/repositories/SqliteAppSettingsKvRepository';

const KV_KEY_RETENTION_DAYS = 'tasks.retentionDays';
const KV_KEY_PER_SCOPE_LIMIT = 'tasks.perScopeLimit';

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_PER_SCOPE_LIMIT = 200;

const kvRepo = new SqliteAppSettingsKvRepository();

export interface TaskRecord {
  id: string;
  scope: string;
  type: string;
  status: string;
  progress: number;
  targetKind?: string | null;
  targetId?: string | null;
  remoteTaskId?: string | null;
  attempt?: number;
  maxRetries?: number;
  error?: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  heartbeatAt?: number | null;
  completedAt?: number | null;
}

export interface TaskQueryInput {
  scope?: string;
  scopes?: string[];
  status?: string | string[];
  targetKind?: string;
  targetId?: string;
  type?: string;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function recordToRow(record: TaskRecord): TaskRow {
  return {
    id: record.id,
    scope: record.scope,
    type: record.type,
    target_kind: record.targetKind ?? null,
    target_id: record.targetId ?? null,
    status: record.status,
    progress: typeof record.progress === 'number' ? record.progress : 0,
    remote_task_id: record.remoteTaskId ?? null,
    attempt: record.attempt ?? 0,
    max_retries: record.maxRetries ?? 3,
    error: record.error ?? null,
    payload_json: JSON.stringify(record.payload ?? {}),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    heartbeat_at: record.heartbeatAt ?? null,
    completed_at:
      record.completedAt ?? (TERMINAL.has(record.status) ? record.updatedAt : null),
  };
}

function rowToRecord(row: TaskRow): TaskRecord {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    scope: row.scope,
    type: row.type,
    status: row.status,
    progress: row.progress,
    targetKind: row.target_kind,
    targetId: row.target_id,
    remoteTaskId: row.remote_task_id,
    attempt: row.attempt,
    maxRetries: row.max_retries,
    error: row.error,
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    heartbeatAt: row.heartbeat_at,
    completedAt: row.completed_at,
  };
}

function readKvNumber(key: string, fallback: number): number {
  const row = kvRepo.get(key);
  if (!row) return fallback;
  try {
    const parsed = JSON.parse(row.value_json);
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

export interface TaskMutationContext {
  /** 触发本次变更的 renderer webContents id；用于广播自写抑制 */
  sourceWebContentsId?: number;
}

export type TaskUpdateListener = (
  record: TaskRecord,
  kind: 'upsert' | 'delete',
  context: TaskMutationContext
) => void;

export class TaskService {
  private listeners = new Set<TaskUpdateListener>();

  list(query: TaskQueryInput = {}): TaskRecord[] {
    const repoQuery: TaskQuery = {
      scope: query.scope,
      scopes: query.scopes,
      status: query.status,
      targetKind: query.targetKind,
      targetId: query.targetId,
      type: query.type,
    };
    return sqliteTaskRepository.list(repoQuery).map(rowToRecord);
  }

  get(id: string): TaskRecord | null {
    const row = sqliteTaskRepository.get(id);
    return row ? rowToRecord(row) : null;
  }

  upsert(record: TaskRecord, context: TaskMutationContext = {}): TaskRecord {
    const row = recordToRow(record);
    sqliteTaskRepository.upsert(row);
    const saved = rowToRecord(row);
    this.emit(saved, 'upsert', context);
    return saved;
  }

  delete(id: string, context: TaskMutationContext = {}): boolean {
    const existing = sqliteTaskRepository.get(id);
    if (!existing) return false;
    const ok = sqliteTaskRepository.delete(id);
    if (ok) {
      this.emit(rowToRecord(existing), 'delete', context);
    }
    return ok;
  }

  removeByScope(scope: string, context: TaskMutationContext = {}): number {
    const rows = sqliteTaskRepository.list({ scope });
    const removed = sqliteTaskRepository.deleteByScope(scope);
    for (const row of rows) {
      this.emit(rowToRecord(row), 'delete', context);
    }
    return removed;
  }

  removeByTarget(
    scope: string,
    targetKind: string,
    targetId: string,
    context: TaskMutationContext = {}
  ): number {
    const rows = sqliteTaskRepository.list({ scope, targetKind, targetId });
    const removed = sqliteTaskRepository.deleteByTarget(scope, targetKind, targetId);
    for (const row of rows) {
      this.emit(rowToRecord(row), 'delete', context);
    }
    return removed;
  }

  /**
   * 取消任务：把非终态任务翻成 'cancelled' 并广播。
   * 当前 handler 还在 renderer，handler 应订阅广播自己中止 in-flight 工作；
   * Phase 3 主进程 handler 上线后会改为 main 内部 AbortController.signal。
   *
   * 已是终态的任务忽略；不存在的任务返回 false。
   */
  cancel(id: string, reason?: string, context: TaskMutationContext = {}): boolean {
    const existing = sqliteTaskRepository.get(id);
    if (!existing) return false;
    if (TERMINAL.has(existing.status)) return false;
    const now = Date.now();
    const next: TaskRow = {
      ...existing,
      status: 'cancelled',
      error: reason ?? 'cancelled',
      updated_at: now,
      completed_at: now,
    };
    sqliteTaskRepository.upsert(next);
    this.emit(rowToRecord(next), 'upsert', context);
    return true;
  }

  /**
   * 启动时调一次：超时未恢复的任务标 failed（除非可恢复）。
   * 详见 SqliteTaskRepository.reconcileInterrupted 的逻辑。
   */
  reconcileOnBoot(): number {
    return sqliteTaskRepository.reconcileInterrupted();
  }

  /**
   * 启动 / 周期 GC：按保留天数 + 每 scope 上限清理终态任务。
   * 配置走 settings KV，缺省 7 天 / 200 条。
   */
  runGc(): { purgedByAge: number; purgedByLimit: number } {
    const retentionDays = readKvNumber(KV_KEY_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
    const perScopeLimit = readKvNumber(KV_KEY_PER_SCOPE_LIMIT, DEFAULT_PER_SCOPE_LIMIT);
    const purgedByAge = sqliteTaskRepository.purgeOldFinished(
      retentionDays * 24 * 60 * 60 * 1000
    );
    const purgedByLimit = sqliteTaskRepository.enforceScopeLimit(perScopeLimit);
    return { purgedByAge, purgedByLimit };
  }

  getRetentionConfig(): { retentionDays: number; perScopeLimit: number } {
    return {
      retentionDays: readKvNumber(KV_KEY_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
      perScopeLimit: readKvNumber(KV_KEY_PER_SCOPE_LIMIT, DEFAULT_PER_SCOPE_LIMIT),
    };
  }

  setRetentionConfig(input: { retentionDays?: number; perScopeLimit?: number }): {
    retentionDays: number;
    perScopeLimit: number;
  } {
    if (typeof input.retentionDays === 'number' && input.retentionDays > 0) {
      kvRepo.set(KV_KEY_RETENTION_DAYS, JSON.stringify(input.retentionDays));
    }
    if (typeof input.perScopeLimit === 'number' && input.perScopeLimit > 0) {
      kvRepo.set(KV_KEY_PER_SCOPE_LIMIT, JSON.stringify(input.perScopeLimit));
    }
    return this.getRetentionConfig();
  }

  addListener(listener: TaskUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(record: TaskRecord, kind: 'upsert' | 'delete', context: TaskMutationContext): void {
    for (const listener of this.listeners) {
      try {
        listener(record, kind, context);
      } catch {
        // 单个 listener 异常不影响其他订阅者
      }
    }
  }
}

export const taskService = new TaskService();
