import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AsyncTask } from '../types';
import {
  deletePendingMediaTasks,
  failPendingMediaTasks,
  inspectPendingMediaTasks,
  onProjectOpen,
  USER_INTERRUPTED_REASON,
} from './projectOpenService';
import { listProjectMediaTasks } from '../services/mediaTaskClient';
import { configureLogger } from './logger';
import type { TaskRecord } from '../services/tasksIPC';

const PROJECT_ID = 'project-1';
const SCOPE = `project:${PROJECT_ID}`;

function buildTask(overrides: Partial<AsyncTask> & Pick<AsyncTask, 'id' | 'type' | 'status'>): AsyncTask {
  return {
    projectId: PROJECT_ID,
    targetType: overrides.targetType || 'shot',
    targetId: overrides.targetId || `${overrides.id}-target`,
    targetName: overrides.targetName || overrides.id,
    remoteTaskId: overrides.remoteTaskId || `${overrides.id}-remote`,
    progress: overrides.progress ?? 0,
    retryCount: overrides.retryCount ?? 0,
    maxRetries: overrides.maxRetries ?? 3,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  };
}

function asyncTaskToRecord(task: AsyncTask): TaskRecord {
  return {
    id: task.id,
    scope: SCOPE,
    type: task.type,
    status: task.status,
    progress: task.progress,
    targetKind: task.targetType,
    targetId: task.targetId,
    remoteTaskId: task.remoteTaskId ?? null,
    attempt: task.retryCount,
    maxRetries: task.maxRetries,
    error: task.error ?? null,
    payload: { ...(task as unknown as Record<string, unknown>) },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    heartbeatAt: null,
    completedAt: task.status === 'completed' || task.status === 'failed' ? task.updatedAt : null,
  };
}

describe('projectOpenService pending media task handling', () => {
  const store = new Map<string, TaskRecord>();

  function seedTasks(tasks: AsyncTask[]): void {
    store.clear();
    for (const task of tasks) {
      store.set(task.id, asyncTaskToRecord(task));
    }
  }

  function readPersistedTasks(): AsyncTask[] {
    return Array.from(store.values()).map(record => ({
      ...(record.payload as unknown as AsyncTask),
      status: record.status as AsyncTask['status'],
      progress: record.progress,
      error: record.error ?? undefined,
      retryCount: record.attempt ?? 0,
    } as AsyncTask));
  }

  beforeEach(() => {
    configureLogger({ enableFile: false });
    store.clear();
    // 旧 cache 已不存在（taskQueueStore 已删除）

    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      tasks: {
        list: vi.fn(async (query?: { scope?: string; status?: string | string[]; type?: string }) => {
          let list = Array.from(store.values());
          if (query?.scope) list = list.filter(r => r.scope === query.scope);
          if (query?.status) {
            const statuses = Array.isArray(query.status) ? query.status : [query.status];
            list = list.filter(r => statuses.includes(r.status));
          }
          if (query?.type) list = list.filter(r => r.type === query.type);
          return list;
        }),
        get: vi.fn(async (id: string) => store.get(id) ?? null),
        upsert: vi.fn(async (record: TaskRecord) => {
          store.set(record.id, record);
          return record;
        }),
        delete: vi.fn(async (id: string) => store.delete(id)),
        removeByScope: vi.fn(async () => 0),
        removeByTarget: vi.fn(async () => 0),
        gc: vi.fn(async () => ({ purgedByAge: 0, purgedByLimit: 0 })),
        getRetention: vi.fn(async () => ({ retentionDays: 7, perScopeLimit: 200 })),
        setRetention: vi.fn(async () => ({ retentionDays: 7, perScopeLimit: 200 })),
        onUpdated: vi.fn(() => () => undefined),
      },
      project: {
        load: vi.fn(async () => ({ id: PROJECT_ID, mediaSelections: {} })),
      },
    };
  });

  afterEach(() => {
    configureLogger({ enableFile: true });
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  });

  it('inspects only pending and processing media tasks', async () => {
    seedTasks([
      buildTask({ id: 'pending-tti', type: 'tti', status: 'pending', createdAt: 4 }),
      buildTask({ id: 'processing-itv', type: 'itv', status: 'processing', createdAt: 3 }),
      buildTask({ id: 'completed-tts', type: 'tts', status: 'completed', createdAt: 2 }),
      buildTask({ id: 'failed-itv', type: 'itv', status: 'failed', createdAt: 1 }),
      buildTask({ id: 'legacy-non-media', type: 'script-analysis' as AsyncTask['type'], status: 'pending', createdAt: 5 }),
    ]);

    const pending = await inspectPendingMediaTasks(PROJECT_ID);

    expect(pending.map(task => task.id)).toEqual(['pending-tti', 'processing-itv']);
  });

  it('does not auto recover or mutate pending media tasks on project open', async () => {
    seedTasks([
      buildTask({ id: 'pending-tti', type: 'tti', status: 'pending' }),
      buildTask({ id: 'processing-itv', type: 'itv', status: 'processing' }),
    ]);

    await onProjectOpen(PROJECT_ID);

    const persisted = readPersistedTasks().sort((a, b) => a.id.localeCompare(b.id));
    expect(persisted.map(task => [task.id, task.status])).toEqual([
      ['pending-tti', 'pending'],
      ['processing-itv', 'processing'],
    ]);
  });

  it('marks inspected pending media tasks as failed with the user interruption reason', async () => {
    seedTasks([
      buildTask({ id: 'pending-tti', type: 'tti', status: 'pending', retryCount: 0 }),
      buildTask({ id: 'processing-itv', type: 'itv', status: 'processing', retryCount: 1 }),
      buildTask({ id: 'completed-tts', type: 'tts', status: 'completed' }),
    ]);

    const pending = await inspectPendingMediaTasks(PROJECT_ID);
    const failedCount = await failPendingMediaTasks(PROJECT_ID, pending, USER_INTERRUPTED_REASON);

    expect(failedCount).toBe(2);

    const tasks = await listProjectMediaTasks(PROJECT_ID);
    const failedById = new Map(tasks.map(task => [task.id, task]));
    expect(failedById.get('pending-tti')).toEqual(expect.objectContaining({
      status: 'failed',
      error: USER_INTERRUPTED_REASON,
      retryCount: 1,
    }));
    expect(failedById.get('processing-itv')).toEqual(expect.objectContaining({
      status: 'failed',
      error: USER_INTERRUPTED_REASON,
      retryCount: 2,
    }));
    expect(failedById.get('completed-tts')?.status).toBe('completed');
  });

  it('deletes only the selected local pending media task records', async () => {
    seedTasks([
      buildTask({ id: 'pending-tti', type: 'tti', status: 'pending' }),
      buildTask({ id: 'processing-itv', type: 'itv', status: 'processing' }),
      buildTask({ id: 'completed-tts', type: 'tts', status: 'completed' }),
    ]);

    const pending = await inspectPendingMediaTasks(PROJECT_ID);
    const deletedCount = await deletePendingMediaTasks(PROJECT_ID, pending);

    expect(deletedCount).toBe(2);
    expect(readPersistedTasks().map(task => task.id).sort()).toEqual(['completed-tts']);
  });
});
