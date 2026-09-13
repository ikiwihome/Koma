/**
 * 通用任务系统 IPC 客户端
 *
 * 主进程权威源：settings.db / tasks 表。前端任何旧 store 都应转发到这里，
 * 不要再走项目目录下的 background-tasks.json / tasks.json。
 */

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

export interface TaskQuery {
  scope?: string;
  scopes?: string[];
  status?: string | string[];
  targetKind?: string;
  targetId?: string;
  type?: string;
}

export interface TaskUpdatedEnvelope {
  record: TaskRecord;
  kind: 'upsert' | 'delete';
  sourceWebContentsId?: number;
}

export interface SubmitTaskInput<I = unknown> {
  type: string;
  scope: string;
  input: I;
  targetKind?: string | null;
  targetId?: string | null;
  taskId?: string;
  initialPayload?: Record<string, unknown>;
  maxRetries?: number;
}

type TasksAPI = {
  list: (query?: TaskQuery) => Promise<TaskRecord[]>;
  get: (id: string) => Promise<TaskRecord | null>;
  upsert: (record: TaskRecord) => Promise<TaskRecord>;
  delete: (id: string) => Promise<boolean>;
  cancel: (id: string, reason?: string) => Promise<boolean>;
  submit: (input: SubmitTaskInput) => Promise<TaskRecord>;
  removeByScope: (scope: string) => Promise<number>;
  removeByTarget: (
    scope: string,
    targetKind: string,
    targetId: string
  ) => Promise<number>;
  gc: () => Promise<{ purgedByAge: number; purgedByLimit: number }>;
  getRetention: () => Promise<{ retentionDays: number; perScopeLimit: number }>;
  setRetention: (
    input: { retentionDays?: number; perScopeLimit?: number }
  ) => Promise<{ retentionDays: number; perScopeLimit: number }>;
  getWebContentsId?: () => Promise<number>;
  onUpdated: (
    callback: (event: unknown, data: TaskUpdatedEnvelope) => void
  ) => () => void;
};

export function isTasksIpcAvailable(): boolean {
  return (
    typeof window !== 'undefined'
    && !!(window as any).electronAPI
    && !!(window as any).electronAPI.tasks
  );
}

function getApi(): TasksAPI {
  const api = (window as any).electronAPI?.tasks as TasksAPI | undefined;
  if (!api) {
    throw new Error('tasks IPC unavailable — preload bridge missing');
  }
  return api;
}

export async function listTaskRecords(query?: TaskQuery): Promise<TaskRecord[]> {
  if (!isTasksIpcAvailable()) return [];
  return getApi().list(query);
}

const ACTIVE_TASK_STATUSES = ['pending', 'running', 'processing'] as const;

/**
 * 找出符合 (scope, type, targetKind, targetId) 且仍未到终态的任务。
 * 用途：批量类入口在创建新任务前先查 DB 防重复提交（用户切走再回来后短暂看
 * 不到 loading，可能再次点击触发批量；这一步阻止重复跑）。
 */
export async function findActiveTask(args: {
  scope: string;
  type: string;
  targetKind?: string;
  targetId?: string;
}): Promise<TaskRecord | null> {
  if (!isTasksIpcAvailable()) return null;
  const records = await listTaskRecords({
    scope: args.scope,
    type: args.type,
    targetKind: args.targetKind,
    targetId: args.targetId,
    status: ACTIVE_TASK_STATUSES as unknown as string[],
  });
  return records[0] ?? null;
}

export async function getTaskRecord(id: string): Promise<TaskRecord | null> {
  if (!isTasksIpcAvailable()) return null;
  return getApi().get(id);
}

export async function upsertTaskRecord(record: TaskRecord): Promise<TaskRecord> {
  return getApi().upsert(record);
}

export async function deleteTaskRecord(id: string): Promise<boolean> {
  if (!isTasksIpcAvailable()) return false;
  return getApi().delete(id);
}

export async function removeTasksByScope(scope: string): Promise<number> {
  if (!isTasksIpcAvailable()) return 0;
  return getApi().removeByScope(scope);
}

export async function removeTasksByTarget(
  scope: string,
  targetKind: string,
  targetId: string
): Promise<number> {
  if (!isTasksIpcAvailable()) return 0;
  return getApi().removeByTarget(scope, targetKind, targetId);
}

export async function runTasksGc(): Promise<{ purgedByAge: number; purgedByLimit: number }> {
  if (!isTasksIpcAvailable()) return { purgedByAge: 0, purgedByLimit: 0 };
  return getApi().gc();
}

export async function getTasksRetention(): Promise<{
  retentionDays: number;
  perScopeLimit: number;
}> {
  if (!isTasksIpcAvailable()) return { retentionDays: 7, perScopeLimit: 200 };
  return getApi().getRetention();
}

export async function setTasksRetention(input: {
  retentionDays?: number;
  perScopeLimit?: number;
}): Promise<{ retentionDays: number; perScopeLimit: number }> {
  if (!isTasksIpcAvailable()) return { retentionDays: 7, perScopeLimit: 200 };
  return getApi().setRetention(input);
}

/**
 * 订阅任务变更广播。所有 scope / 所有 type 的更新都会送达，
 * 调用方按需用 record.scope / type / target 自己过滤。
 *
 * 第三个参数 sourceWebContentsId 是该变更的发起 renderer 的 id，
 * 调用方可与自身 id（getOwnWebContentsId）比较实现自写抑制。
 */
export function subscribeTaskUpdates(
  callback: (
    record: TaskRecord,
    kind: 'upsert' | 'delete',
    sourceWebContentsId?: number
  ) => void
): () => void {
  if (!isTasksIpcAvailable()) return () => undefined;
  return getApi().onUpdated((_event, data) => {
    if (data && data.record) {
      callback(data.record, data.kind, data.sourceWebContentsId);
    }
  });
}

export async function cancelTaskRecord(id: string, reason?: string): Promise<boolean> {
  if (!isTasksIpcAvailable()) return false;
  return getApi().cancel(id, reason);
}

/**
 * 提交一个由主进程 handler 执行的任务。
 *
 * 与 upsertTaskRecord 的区别：
 *  - upsert：UI 直接写状态（兼容旧的 renderer-driven 流程）
 *  - submit：UI 只交输入；主进程负责创建任务行 + 调度 handler 执行
 *
 * 调用前主进程必须已通过 taskRunner.registerHandler(type) 注册过对应 handler。
 */
export async function submitTask<I>(input: SubmitTaskInput<I>): Promise<TaskRecord> {
  return getApi().submit(input);
}

/**
 * 等待一个任务进入终态（completed / failed / cancelled），
 * 返回最终的 TaskRecord。
 *
 * 行为：
 *  - completed：resolve TaskRecord（output 在 record.payload.output）
 *  - failed / cancelled：reject Error(record.error || status)
 *  - 已经在终态的任务：立即 resolve / reject
 *  - signal 提前 abort：reject AbortError；不再等待，但任务本身**不会**被取消
 *    （需要取消请调 cancelTaskRecord）
 */
export function waitForTaskCompletion(
  taskId: string,
  options: { signal?: AbortSignal } = {}
): Promise<TaskRecord> {
  return new Promise<TaskRecord>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error('aborted'));
    };
    let unsub: (() => void) | null = null;

    const cleanup = () => {
      if (unsub) {
        try { unsub(); } catch { /* noop */ }
        unsub = null;
      }
      options.signal?.removeEventListener('abort', onAbort);
    };

    if (options.signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    // 1) 立即检查现状（任务可能在 promise 创建前就已完成）
    void getTaskRecord(taskId).then(current => {
      if (!current) {
        // 任务还没写库可能；等广播
        return;
      }
      if (current.status === 'completed') {
        cleanup();
        resolve(current);
      } else if (current.status === 'failed' || current.status === 'cancelled') {
        cleanup();
        reject(new Error(current.error || current.status));
      }
    }).catch(() => undefined);

    // 2) 订阅广播，捕获后续的状态变化
    unsub = subscribeTaskUpdates((record) => {
      if (record.id !== taskId) return;
      if (record.status === 'completed') {
        cleanup();
        resolve(record);
      } else if (record.status === 'failed' || record.status === 'cancelled') {
        cleanup();
        reject(new Error(record.error || record.status));
      }
    });
  });
}

let cachedWebContentsId: number | null = null;
let webContentsIdPromise: Promise<number | null> | null = null;

export async function getOwnWebContentsId(): Promise<number | null> {
  if (cachedWebContentsId !== null) return cachedWebContentsId;
  if (!isTasksIpcAvailable()) return null;
  if (webContentsIdPromise) return webContentsIdPromise;
  const fn = getApi().getWebContentsId;
  if (!fn) return null;
  webContentsIdPromise = fn()
    .then((id) => {
      cachedWebContentsId = id;
      return id;
    })
    .catch(() => null);
  return webContentsIdPromise;
}

/** 仅测试用：清掉缓存的 webContents id 与 promise */
export function __resetWebContentsIdForTesting(): void {
  cachedWebContentsId = null;
  webContentsIdPromise = null;
}
