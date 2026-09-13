/**
 * tasksIPC.findActiveTask 用例：用于批量入口前置去重的核心助手。
 *
 * 之前的批量入口只靠组件内 Set 防重复点击，unmount 后丢失，用户切走再回来再点
 * 会触发第二次批量。findActiveTask 直接查 DB 中的 (scope, type, target) 活跃记录。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findActiveTask, type TaskRecord } from './tasksIPC';

const SCOPE = 'project:p1';

function record(partial: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    id: partial.id,
    scope: partial.scope ?? SCOPE,
    type: partial.type ?? 'shot-generation',
    status: partial.status ?? 'running',
    progress: partial.progress ?? 0,
    targetKind: partial.targetKind ?? 'episode',
    targetId: partial.targetId ?? 'ep-1',
    remoteTaskId: null,
    attempt: 0,
    maxRetries: 3,
    error: null,
    payload: {},
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
    heartbeatAt: null,
    completedAt: null,
  };
}

describe('findActiveTask', () => {
  let listSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listSpy = vi.fn();
    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      tasks: {
        list: listSpy,
        get: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        cancel: vi.fn(),
        removeByScope: vi.fn(),
        removeByTarget: vi.fn(),
        gc: vi.fn(),
        getRetention: vi.fn(),
        setRetention: vi.fn(),
        getWebContentsId: vi.fn(),
        onUpdated: vi.fn(() => () => undefined),
      },
    };
  });

  afterEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  });

  it('queries with active statuses and returns the first record', async () => {
    const r = record({ id: 't1' });
    listSpy.mockResolvedValueOnce([r]);
    const result = await findActiveTask({
      scope: SCOPE,
      type: 'shot-generation',
      targetKind: 'episode',
      targetId: 'ep-1',
    });
    expect(result?.id).toBe('t1');
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({
      scope: SCOPE,
      type: 'shot-generation',
      targetKind: 'episode',
      targetId: 'ep-1',
      status: ['pending', 'running', 'processing'],
    }));
  });

  it('returns null when no active task found', async () => {
    listSpy.mockResolvedValueOnce([]);
    const result = await findActiveTask({
      scope: SCOPE,
      type: 'shot-generation',
    });
    expect(result).toBeNull();
  });

  it('returns null when IPC unavailable (non-electron)', async () => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
    const result = await findActiveTask({ scope: SCOPE, type: 'shot-generation' });
    expect(result).toBeNull();
  });
});
