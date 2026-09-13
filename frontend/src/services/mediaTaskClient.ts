/**
 * mediaTaskClient —— 直接基于 tasksIPC 的媒体任务便捷查询/操作。
 *
 * 取代了之前的 store/taskQueueStore.ts middle layer。
 * 业务侧只需 5 个 helper：
 *   - listPendingMediaTasks(projectId)        恢复弹窗用
 *   - listProjectMediaTasks(projectId)        测试 / 状态栏批量
 *   - markMediaTaskFailed(projectId, id, reason)
 *   - deleteMediaTask(id)
 *   - clearCompletedMediaTasks(projectId, days?)
 *
 * 内部逻辑（项目 scope + 媒体类型过滤 + AsyncTask 形状还原）仍是必须的，
 * 但现在直接落在 tasksIPC 层之上，没有额外的 IPC 薄壳模块。
 */
import { electronService } from './electronService';
import {
  listTaskRecords,
  upsertTaskRecord,
  deleteTaskRecord,
  isTasksIpcAvailable,
  type TaskRecord,
} from './tasksIPC';
import type { AsyncTask } from '../types';

const MEDIA_TYPES: ReadonlyArray<AsyncTask['type']> = ['tti', 'itv', 'tts', 'character-extraction'];

function projectScope(projectId: string): string {
  return `project:${projectId}`;
}

function recordToAsyncTask(record: TaskRecord): AsyncTask | null {
  if (!record.scope.startsWith('project:')) return null;
  const projectId = record.scope.slice('project:'.length);
  const payload = (record.payload || {}) as Partial<AsyncTask>;
  return {
    ...payload,
    id: record.id,
    projectId,
    type: payload.type ?? (record.type as AsyncTask['type']),
    targetType: (payload.targetType ?? (record.targetKind as AsyncTask['targetType']))!,
    targetId: payload.targetId ?? (record.targetId ?? ''),
    remoteTaskId: payload.remoteTaskId ?? (record.remoteTaskId ?? ''),
    status: record.status as AsyncTask['status'],
    progress: record.progress,
    error: record.error ?? undefined,
    retryCount: payload.retryCount ?? record.attempt ?? 0,
    maxRetries: payload.maxRetries ?? record.maxRetries ?? 3,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  } as AsyncTask;
}

function asyncTaskToRecord(task: AsyncTask): TaskRecord {
  return {
    id: task.id,
    scope: projectScope(task.projectId),
    type: task.type,
    status: task.status,
    progress: typeof task.progress === 'number' ? task.progress : 0,
    targetKind: task.targetType,
    targetId: task.targetId,
    remoteTaskId: task.remoteTaskId ?? null,
    attempt: task.retryCount ?? 0,
    maxRetries: task.maxRetries ?? 3,
    error: task.error ?? null,
    payload: { ...(task as unknown as Record<string, unknown>) },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    heartbeatAt: null,
    completedAt: task.status === 'completed' || task.status === 'failed' ? task.updatedAt : null,
  };
}

/**
 * 列出指定项目的所有媒体任务（按创建时间倒序）。主要给状态栏 / 测试用。
 */
export async function listProjectMediaTasks(projectId: string): Promise<AsyncTask[]> {
  if (!electronService.isElectron() || !isTasksIpcAvailable()) return [];
  const records = await listTaskRecords({ scope: projectScope(projectId) });
  return records
    .filter(r => (MEDIA_TYPES as ReadonlyArray<string>).includes(r.type))
    .map(recordToAsyncTask)
    .filter((t): t is AsyncTask => !!t)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 列出待恢复的"未完成"媒体任务（pending / processing）。
 */
export async function listPendingMediaTasks(projectId: string): Promise<AsyncTask[]> {
  if (!electronService.isElectron() || !isTasksIpcAvailable()) return [];
  const records = await listTaskRecords({
    scope: projectScope(projectId),
    status: ['pending', 'processing'],
  });
  return records
    .filter(r => (MEDIA_TYPES as ReadonlyArray<string>).includes(r.type))
    .map(recordToAsyncTask)
    .filter((t): t is AsyncTask => !!t);
}

/**
 * 把一个媒体任务标记为失败。返回更新后的 AsyncTask（如果存在）。
 */
export async function markMediaTaskFailed(
  projectId: string,
  taskId: string,
  reason: string,
): Promise<AsyncTask | null> {
  if (!electronService.isElectron() || !isTasksIpcAvailable()) return null;
  const records = await listTaskRecords({ scope: projectScope(projectId) });
  const existing = records.find(r => r.id === taskId);
  if (!existing) return null;
  const current = recordToAsyncTask(existing);
  if (!current) return null;
  const updated: AsyncTask = {
    ...current,
    status: 'failed',
    error: reason,
    retryCount: current.retryCount + 1,
    updatedAt: Date.now(),
  };
  await upsertTaskRecord(asyncTaskToRecord(updated));
  return updated;
}

/**
 * 删除单条媒体任务记录。
 */
export async function deleteMediaTask(taskId: string): Promise<boolean> {
  if (!electronService.isElectron() || !isTasksIpcAvailable()) return false;
  return deleteTaskRecord(taskId);
}

/**
 * 清理指定项目下 N 天前完成/失败的媒体任务。返回删除条数。
 */
export async function clearCompletedMediaTasks(
  projectId: string,
  olderThanDays = 7,
): Promise<number> {
  if (!electronService.isElectron() || !isTasksIpcAvailable()) return 0;
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const records = await listTaskRecords({
    scope: projectScope(projectId),
    status: ['completed', 'failed'],
  });
  const stale = records.filter(r => (MEDIA_TYPES as ReadonlyArray<string>).includes(r.type) && r.updatedAt < cutoff);
  let deleted = 0;
  for (const record of stale) {
    if (await deleteTaskRecord(record.id)) deleted++;
  }
  return deleted;
}
