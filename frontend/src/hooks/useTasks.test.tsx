import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveTask, useTaskById, useTasks } from './useTasks';
import { __resetTasksStoreForTesting } from '../store/tasksStore';
import { __resetWebContentsIdForTesting } from '../services/tasksIPC';
import type { TaskRecord, TaskUpdatedEnvelope } from '../services/tasksIPC';

const SCOPE = 'project:project-1';

function record(partial: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    id: partial.id,
    scope: partial.scope ?? SCOPE,
    type: partial.type ?? 'shot-analysis',
    status: partial.status ?? 'pending',
    progress: partial.progress ?? 0,
    targetKind: partial.targetKind ?? 'shot',
    targetId: partial.targetId ?? 'shot-1',
    remoteTaskId: null,
    attempt: 0,
    maxRetries: 3,
    error: partial.error ?? null,
    payload: {},
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
    heartbeatAt: null,
    completedAt: null,
  };
}

describe('useTasks hooks', () => {
  const store = new Map<string, TaskRecord>();
  let updatedListener:
    | ((event: unknown, data: TaskUpdatedEnvelope) => void)
    | null = null;

  function emit(record: TaskRecord, kind: 'upsert' | 'delete', sourceWebContentsId?: number): void {
    if (kind === 'delete') store.delete(record.id);
    else store.set(record.id, record);
    if (updatedListener) updatedListener({}, { record, kind, sourceWebContentsId });
  }

  beforeEach(() => {
    store.clear();
    updatedListener = null;
    __resetTasksStoreForTesting();
    __resetWebContentsIdForTesting();

    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      tasks: {
        list: vi.fn(async () => Array.from(store.values())),
        get: vi.fn(async (id: string) => store.get(id) ?? null),
        upsert: vi.fn(async (record: TaskRecord) => {
          store.set(record.id, record);
          return record;
        }),
        delete: vi.fn(async (id: string) => store.delete(id)),
        cancel: vi.fn(async () => true),
        removeByScope: vi.fn(async () => 0),
        removeByTarget: vi.fn(async () => 0),
        gc: vi.fn(async () => ({ purgedByAge: 0, purgedByLimit: 0 })),
        getRetention: vi.fn(async () => ({ retentionDays: 7, perScopeLimit: 200 })),
        setRetention: vi.fn(async () => ({ retentionDays: 7, perScopeLimit: 200 })),
        getWebContentsId: vi.fn(async () => 42),
        onUpdated: vi.fn((cb: typeof updatedListener) => {
          updatedListener = cb;
          return () => {
            updatedListener = null;
          };
        }),
      },
    };
  });

  afterEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
    __resetTasksStoreForTesting();
    __resetWebContentsIdForTesting();
  });

  it('hydrates from IPC and reflects existing tasks on mount', async () => {
    store.set('t1', record({ id: 't1', status: 'running', progress: 30 }));
    store.set('t2', record({ id: 't2', status: 'completed', progress: 100 }));

    const { result } = renderHook(() => useTasks({ scope: SCOPE }));

    // 初次渲染 hydrate 异步执行；等微任务跑完
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.map(t => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('does not regress newer broadcast state with older list snapshot during hydrate', async () => {
    // hydrate 阶段：list 期间到达的"running → completed"广播必须不被 list 旧快照盖住。
    const oldSnapshot = record({
      id: 'race', status: 'running', progress: 40, updatedAt: 100,
    });
    const newerBroadcast = record({
      id: 'race', status: 'completed', progress: 100, updatedAt: 500,
    });
    // list 端只能拿到旧快照（模拟 list 在 broadcast 之前已生成响应）
    store.set('race', oldSnapshot);

    const { result } = renderHook(() => useTasks({ scope: SCOPE }));

    // 让 subscribe 挂上、list 还在飞行途中：先注入广播
    await act(async () => {
      // 等到 subscribe 已挂上（hydrate 内部同步设置 subscribe）
      await new Promise(r => setTimeout(r, 0));
      // 模拟广播比 list 先到
      emit(newerBroadcast, 'upsert');
    });
    // list 也已 resolve（mock 是 sync 数据库），cache 应保留更新的 completed。
    expect(result.current.find(t => t.id === 'race')?.status).toBe('completed');
    expect(result.current.find(t => t.id === 'race')?.progress).toBe(100);
  });

  it('does not resurrect deleted tasks via stale list snapshot during hydrate', async () => {
    // hydrate 阶段：list 期间到达的删除广播必须不被 list 重新插回。
    const old = record({ id: 'gone', status: 'running', updatedAt: 50 });
    store.set('gone', old);

    const { result } = renderHook(() => useTasks({ scope: SCOPE }));

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
      // 主进程在 list 期间删除了任务，广播 delete
      emit(old, 'delete');
    });

    expect(result.current.find(t => t.id === 'gone')).toBeUndefined();
  });

  it('useActiveTask returns only non-terminal task for the target', async () => {
    store.set('done', record({ id: 'done', status: 'completed', targetId: 'shot-1' }));
    store.set('live', record({
      id: 'live',
      status: 'running',
      progress: 60,
      targetId: 'shot-1',
      createdAt: 100,
    }));

    const { result } = renderHook(() =>
      useActiveTask({ scope: SCOPE, targetKind: 'shot', targetId: 'shot-1' })
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current?.id).toBe('live');
    expect(result.current?.progress).toBe(60);
  });

  it('updates when broadcast pushes new task state', async () => {
    const { result } = renderHook(() =>
      useActiveTask({ scope: SCOPE, targetKind: 'shot', targetId: 'shot-1' })
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current).toBeNull();

    await act(async () => {
      emit(record({ id: 'live', status: 'running', progress: 20, targetId: 'shot-1' }), 'upsert');
    });

    expect(result.current?.id).toBe('live');
    expect(result.current?.progress).toBe(20);

    await act(async () => {
      emit(record({ id: 'live', status: 'completed', progress: 100, targetId: 'shot-1' }), 'upsert');
    });

    // 完成后变成终态，useActiveTask 应该返回 null（activeOnly 过滤）
    expect(result.current).toBeNull();
  });

  it('applies self-originated broadcasts to cache', async () => {
    // 之前实现做了"自写抑制"，但 tasksStore 没有本地 mutator —— cache 唯一更新路径
    // 就是这条广播。抑制掉=丢数据（runWithTask → TaskManager.createTask 写入永远
    // 看不到）。所以自写也必须 apply，跟他写同等对待。
    const { result } = renderHook(() => useTasks({ scope: SCOPE }));
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    await act(async () => {
      emit(record({ id: 'self', status: 'running' }), 'upsert', 42);
    });
    expect(result.current.find(t => t.id === 'self')?.status).toBe('running');

    await act(async () => {
      emit(record({ id: 'self', status: 'running' }), 'upsert', 99);
    });
    expect(result.current.find(t => t.id === 'self')?.status).toBe('running');
  });

  it('useTaskById returns null after deletion', async () => {
    store.set('x', record({ id: 'x', status: 'running' }));
    const { result } = renderHook(() => useTaskById('x'));
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    expect(result.current?.id).toBe('x');

    await act(async () => {
      emit(record({ id: 'x' }), 'delete');
    });
    expect(result.current).toBeNull();
  });
});
