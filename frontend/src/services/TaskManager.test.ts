import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from './TaskManager';
import type { TaskRecord } from './tasksIPC';

const PROJECT_ID = 'project-1';
const SCOPE = `project:${PROJECT_ID}`;

function makeRecord(partial: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    id: partial.id,
    scope: partial.scope ?? SCOPE,
    type: partial.type ?? 'script-analysis',
    status: partial.status ?? 'pending',
    progress: partial.progress ?? 0,
    targetKind: partial.targetKind ?? 'episode',
    targetId: partial.targetId ?? 'episode-1',
    remoteTaskId: partial.remoteTaskId ?? null,
    attempt: partial.attempt ?? 0,
    maxRetries: partial.maxRetries ?? 3,
    error: partial.error ?? null,
    payload: partial.payload ?? {
      id: partial.id,
      projectId: PROJECT_ID,
      type: 'script-analysis',
      category: 'script',
      subType: 'script-analysis',
      targetType: 'episode',
      targetId: 'episode-1',
      status: partial.status ?? 'pending',
      progress: partial.progress ?? 0,
      createdAt: 1,
      updatedAt: 2,
      lastHeartbeat: 2,
    },
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 2,
    heartbeatAt: partial.heartbeatAt ?? null,
    completedAt: partial.completedAt ?? null,
  };
}

describe('TaskManager restart reconciliation', () => {
  const store = new Map<string, TaskRecord>();
  let upsertSpy: ReturnType<typeof vi.fn>;
  let listSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store.clear();
    listSpy = vi.fn(async (query?: { scope?: string }) => {
      const list = Array.from(store.values());
      if (query?.scope) return list.filter(r => r.scope === query.scope);
      return list;
    });
    upsertSpy = vi.fn(async (record: TaskRecord) => {
      store.set(record.id, record);
      return record;
    });

    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      tasks: {
        list: listSpy,
        get: vi.fn(async (id: string) => store.get(id) ?? null),
        upsert: upsertSpy,
        delete: vi.fn(async (id: string) => store.delete(id)),
        removeByScope: vi.fn(async () => 0),
        removeByTarget: vi.fn(async () => 0),
        gc: vi.fn(async () => ({ purgedByAge: 0, purgedByLimit: 0 })),
        getRetention: vi.fn(async () => ({ retentionDays: 7, perScopeLimit: 200 })),
        setRetention: vi.fn(async () => ({ retentionDays: 7, perScopeLimit: 200 })),
        onUpdated: vi.fn(() => () => undefined),
      },
    };
  });

  afterEach(() => {
    TaskManager.dispose();
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  });

  it.each(['pending', 'running', 'processing'] as const)(
    'marks %s script-analysis tasks from a previous launch as failed on initialize',
    async (status) => {
      store.set('old-' + status, makeRecord({ id: 'old-' + status, status }));

      await TaskManager.initialize(PROJECT_ID);

      const task = TaskManager.getTask('old-' + status);
      expect(task?.status).toBe('failed');
      expect(task?.error).toBe('任务在软件重启后中断');

      // 持久化通过 IPC 上行
      const persistedCalls = upsertSpy.mock.calls.map(c => c[0]) as TaskRecord[];
      const last = persistedCalls.find(r => r.id === 'old-' + status);
      expect(last?.status).toBe('failed');
      expect(last?.error).toBe('任务在软件重启后中断');
    }
  );

  it('persists updateTask via IPC fallback when local cache is missing the task', async () => {
    // 场景：用户切到别的项目，App.tsx useEffect 调 TaskManager.dispose() 清掉
    // 当前项目的 cache。但原来项目里的 service.runAnalysis 还在跑，仍要把
    // 'completed' / 'failed' 写到主进程任务表。要求 updateTask 能走 IPC 兜底，
    // 而不是静默 return null 让任务卡在 running 直到主进程 30 分钟超时。
    const TASK_ID = 'orphan-task-1';
    store.set(TASK_ID, makeRecord({
      id: TASK_ID,
      status: 'running',
      progress: 50,
      payload: {
        id: TASK_ID,
        projectId: PROJECT_ID,
        type: 'script-analysis',
        category: 'script',
        subType: 'script-analysis',
        targetType: 'episode',
        targetId: 'episode-1',
        status: 'running',
        progress: 50,
        createdAt: 1,
        updatedAt: 2,
        lastHeartbeat: 2,
      },
    }));

    // 切到别的项目时 dispose 清空了本地 cache —— 模拟这一状态
    TaskManager.dispose();

    // 此时本地 cache 没有任务；service 仍把 completed 写下来
    const result = TaskManager.updateTask(TASK_ID, {
      status: 'completed',
      progress: 100,
      result: { charactersCount: 3 },
    });
    expect(result).toBeNull(); // 同步返回兼容旧约定

    // 兜底持久化是 async；等微任务跑完
    await new Promise(resolve => setTimeout(resolve, 0));

    const persisted = upsertSpy.mock.calls.map(c => c[0] as TaskRecord);
    const final = persisted.findLast(r => r.id === TASK_ID);
    expect(final?.status).toBe('completed');
    expect(final?.progress).toBe(100);
    const payload = (final?.payload || {}) as { result?: { charactersCount?: number } };
    expect(payload.result?.charactersCount).toBe(3);
  });

  it('IPC fallback does not overwrite a task already in terminal state', async () => {
    // 用户取消了任务 → DB 状态 'cancelled'。其后 service 跑完仍调 updateTask({ status: completed })
    // 期间本地 cache 已被 dispose 清掉，走 IPC fallback。fallback 应当尊重终态，不再把
    // 'cancelled' 盖回 'completed'。
    const TASK_ID = 'cancelled-task';
    store.set(TASK_ID, makeRecord({
      id: TASK_ID,
      status: 'cancelled',
      payload: {
        id: TASK_ID,
        projectId: PROJECT_ID,
        type: 'script-analysis',
        category: 'script',
        subType: 'script-analysis',
        targetType: 'episode',
        targetId: 'episode-1',
        status: 'cancelled',
        progress: 50,
        createdAt: 1,
        updatedAt: 2,
        lastHeartbeat: 2,
      },
    }));

    TaskManager.dispose();

    upsertSpy.mockClear();
    TaskManager.updateTask(TASK_ID, { status: 'completed', progress: 100 });
    await new Promise(resolve => setTimeout(resolve, 0));

    // 终态保护：不应再有针对该任务的 upsert
    const writes = upsertSpy.mock.calls.map(c => c[0] as TaskRecord).filter(r => r.id === TASK_ID);
    expect(writes).toHaveLength(0);
  });

  it('keeps unfinished tasks created in the current renderer session when re-initializing', async () => {
    const created = TaskManager.createTask({
      projectId: PROJECT_ID,
      type: 'script-analysis',
      targetType: 'episode',
      targetId: 'episode-1',
      targetName: '第 1 集',
    });
    const sessionId = TaskManager.getTask(created.id)?.sessionId;
    expect(sessionId).toBeTruthy();
    await new Promise(resolve => setTimeout(resolve, 0));

    // 模拟一次 running 落盘
    store.set(created.id, makeRecord({
      id: created.id,
      status: 'running',
      progress: 42,
      payload: {
        id: created.id,
        projectId: PROJECT_ID,
        sessionId,
        type: 'script-analysis',
        category: 'script',
        subType: 'script-analysis',
        targetType: 'episode',
        targetId: 'episode-1',
        targetName: '第 1 集',
        status: 'running',
        progress: 42,
        createdAt: 1,
        updatedAt: 2,
        lastHeartbeat: 2,
      },
    }));

    TaskManager.dispose();

    await TaskManager.initialize(PROJECT_ID);

    const reloaded = TaskManager.getTask(created.id);
    expect(reloaded?.sessionId).toBe(sessionId);
    expect(reloaded?.status).toBe('running');
    expect(reloaded?.progress).toBe(42);
  });
});
