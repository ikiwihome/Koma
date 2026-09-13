/**
 * 全局任务记录缓存（renderer 侧）
 *
 * 设计：
 *  - 单一 module-scope 缓存：跨组件 / 跨 hook 复用，避免每个组件都各自 IPC 拉
 *  - 一次性首屏 hydrate：第一次 subscribe 时拉全量 + 订阅 tasks:updated 广播
 *  - 写路径复用 tasksIPC：UI 不直接 mutate 缓存，统一通过 IPC 上行后由广播回填
 *
 * Hook 通过 subscribe + getSnapshot 用 useSyncExternalStore 接入。
 */
import {
  getOwnWebContentsId,
  isTasksIpcAvailable,
  listTaskRecords,
  subscribeTaskUpdates,
  type TaskRecord,
} from '../services/tasksIPC';
import { createLogger } from './logger';

const logger = createLogger('TasksStore');

type Listener = () => void;

const cache = new Map<string, TaskRecord>();
const listeners = new Set<Listener>();
let snapshot: ReadonlyArray<TaskRecord> = [];
let snapshotDirty = true;

let hydratePromise: Promise<void> | null = null;
let unsubscribeBroadcast: (() => void) | null = null;

function notify(): void {
  snapshotDirty = true;
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      logger.error('Task store listener error', err);
    }
  }
}

// 任务状态转换订阅（edge-triggered：从某状态 → 某状态时触发，便于"刚完成"的副作用）
export interface TransitionEvent {
  record: TaskRecord;
  prevStatus: string | null;
  currStatus: string;
}
type TransitionListener = (event: TransitionEvent) => void;
const transitionListeners = new Set<TransitionListener>();

function emitTransition(record: TaskRecord, prevStatus: string | null): void {
  if (prevStatus === record.status) return;
  const event: TransitionEvent = {
    record,
    prevStatus,
    currStatus: record.status,
  };
  for (const listener of transitionListeners) {
    try {
      listener(event);
    } catch (err) {
      logger.error('Task transition listener error', err);
    }
  }
}

function applyUpsert(record: TaskRecord): void {
  const existing = cache.get(record.id);
  // 防回退：如果 cache 里已有的版本比传入 record 更新（updatedAt 更大），保留 cache。
  // 触发场景：hydrate 期间订阅与 list 并发，list 之前已被广播的更新如果再被 list
  // 旧快照覆盖，UI 会显示旧状态（典型：广播 completed 已到，list 旧快照仍是 running，
  // 状态卡在 running 直到下一次广播）。
  if (existing && record.updatedAt < existing.updatedAt) return;
  const prevStatus = existing?.status ?? null;
  cache.set(record.id, record);
  emitTransition(record, prevStatus);
  notify();
}

function applyDelete(id: string): void {
  const prev = cache.get(id);
  if (cache.delete(id)) {
    if (prev) emitTransition({ ...prev, status: 'deleted' }, prev.status);
    notify();
  }
}

/**
 * 订阅任务状态转换事件。注意：hydrate 时已有任务的初始 prevStatus 视为 null，
 * 即 "新出现"也会触发一次（callback 自行按需过滤）。
 */
export function subscribeTaskTransitions(listener: TransitionListener): () => void {
  transitionListeners.add(listener);
  return () => {
    transitionListeners.delete(listener);
  };
}

async function hydrateOnce(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  if (!isTasksIpcAvailable()) {
    hydratePromise = Promise.resolve();
    return hydratePromise;
  }
  hydratePromise = (async () => {
    try {
      // 拿自己 id 仅供调用方调试，不再用于"自写抑制"。
      // 之前的自写抑制把"自己发起"的写入广播全过滤掉，但 tasksStore 的 cache
      // 唯一更新路径就是这里的广播 —— 没有本地 mutator 先行写入，过滤掉=丢数据。
      // 典型坑：runWithTask → TaskManager.createTask 通过 tasks:upsert 写入主进程，
      // 主进程广播带 sourceWebContentsId=本 renderer，被自写抑制后 useTasks 永远
      // 看不到这个任务（任务面板里"图像/视频提示词推理"消失就是这个原因）。
      const idPromise = getOwnWebContentsId().then(() => {
        // Resolved value retained for completeness; tasksStore does not currently filter by webContentsId.
      });

      // hydrate 期间订阅与 list 并发：subscribe 必须先挂上以免漏事件，但
      // list 拿到的快照可能比期间到达的广播旧。
      // - upsert：走 applyUpsert（带 updatedAt 防回退），list 的旧版本不会盖广播的新版本。
      // - delete：list 期间到达的删除事件记下来，list 回填时跳过这些 id；不能让
      //   list 把刚被删除的任务再插回 cache（UI 会看到"幽灵任务"）。
      const deletedDuringHydrate = new Set<string>();
      unsubscribeBroadcast = subscribeTaskUpdates((record, kind /*, sourceId */) => {
        if (kind === 'delete') {
          deletedDuringHydrate.add(record.id);
          applyDelete(record.id);
        } else {
          applyUpsert(record);
        }
      });
      const records = await listTaskRecords();
      for (const record of records) {
        if (deletedDuringHydrate.has(record.id)) continue;
        applyUpsert(record);
      }
      await idPromise;
      notify();
    } catch (err) {
      logger.error('Failed to hydrate tasks store', err);
    }
  })();
  return hydratePromise;
}

/**
 * 本地 mutator 调用后，把结果同步到 cache，并触发订阅者重渲。
 * 用于自写抑制路径下保持 UI 即时响应（不必等服务端广播回来）。
 */
export function applyLocalUpsert(record: TaskRecord): void {
  applyUpsert(record);
}

export function applyLocalDelete(id: string): void {
  applyDelete(id);
}

export interface TasksFilter {
  scope?: string;
  scopes?: string[];
  status?: string | string[];
  targetKind?: string;
  targetId?: string;
  type?: string;
  /** 仅返回非终态（pending/running/processing），便于 useActiveTask 过滤 */
  activeOnly?: boolean;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function matchesFilter(record: TaskRecord, filter: TasksFilter): boolean {
  if (filter.scope !== undefined && record.scope !== filter.scope) return false;
  if (filter.scopes && !filter.scopes.includes(record.scope)) return false;
  if (filter.status !== undefined) {
    const list = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!list.includes(record.status)) return false;
  }
  if (filter.targetKind !== undefined && record.targetKind !== filter.targetKind) return false;
  if (filter.targetId !== undefined && record.targetId !== filter.targetId) return false;
  if (filter.type !== undefined && record.type !== filter.type) return false;
  if (filter.activeOnly && TERMINAL_STATUSES.has(record.status)) return false;
  return true;
}

/**
 * 订阅缓存变化。返回 unsubscribe。
 * 第一次调用会触发 hydrate（异步），hydrate 完成会通过 listener 通知。
 */
export function subscribeTasks(listener: Listener): () => void {
  listeners.add(listener);
  // 首次订阅触发 hydrate；返回前 listener 还未触发，等 hydrate 完成 notify 才会推
  void hydrateOnce();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 获取全量快照（不可变）。useSyncExternalStore 会调它，必须 stable，
 * 同一缓存状态下要返回同一引用，否则 React 会警告。
 */
export function getTasksSnapshot(): ReadonlyArray<TaskRecord> {
  if (snapshotDirty) {
    snapshot = Array.from(cache.values()).sort((a, b) => b.createdAt - a.createdAt);
    snapshotDirty = false;
  }
  return snapshot;
}

export function getTaskById(id: string): TaskRecord | undefined {
  return cache.get(id);
}

/**
 * 单元测试与卸载场景使用：清缓存 + 取消订阅。
 */
export function __resetTasksStoreForTesting(): void {
  cache.clear();
  listeners.clear();
  snapshotDirty = true;
  snapshot = [];
  if (unsubscribeBroadcast) {
    try { unsubscribeBroadcast(); } catch { /* noop */ }
    unsubscribeBroadcast = null;
  }
  hydratePromise = null;
}
