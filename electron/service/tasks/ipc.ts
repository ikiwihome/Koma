/**
 * tasks:* IPC handlers — 通用后台任务存储 IPC
 *
 * Phase 2：加 tasks:cancel + 自写抑制（广播 envelope 带 sourceWebContentsId）
 *
 * 命名空间：tasks
 *   tasks:list           (args: TaskQueryInput)        => TaskRecord[]
 *   tasks:get            (args: { id })                => TaskRecord | null
 *   tasks:upsert         (args: TaskRecord)            => TaskRecord
 *   tasks:delete         (args: { id })                => boolean
 *   tasks:cancel         (args: { id, reason? })       => boolean
 *   tasks:removeByScope  (args: { scope })             => number
 *   tasks:removeByTarget (args: { scope, targetKind, targetId }) => number
 *   tasks:gc             ()                            => { purgedByAge, purgedByLimit }
 *   tasks:retention:get  ()                            => { retentionDays, perScopeLimit }
 *   tasks:retention:set  (args)                        => { retentionDays, perScopeLimit }
 *
 * 广播事件：
 *   tasks:updated  payload: { record: TaskRecord, kind: 'upsert'|'delete', sourceWebContentsId? }
 */
import { ipcMain, webContents, type IpcMainInvokeEvent } from 'electron';
import { logger } from 'ee-core/log';
import { ensureServicesReady } from '../index';
import { taskService } from './TaskService';
import type { TaskMutationContext, TaskQueryInput, TaskRecord } from './TaskService';
import { taskRunner } from './TaskRunner';
import type { SubmitInput } from './TaskRunner';
import {
  recordClaim,
  clearClaimsByWebContents,
  deliverReply,
} from './delegate';

let registered = false;

interface TasksUpdatedEnvelope {
  record: TaskRecord;
  kind: 'upsert' | 'delete';
  sourceWebContentsId?: number;
}

function broadcastTaskUpdated(
  record: TaskRecord,
  kind: 'upsert' | 'delete',
  context: TaskMutationContext
): void {
  try {
    const payload: TasksUpdatedEnvelope = {
      record,
      kind,
      ...(context.sourceWebContentsId !== undefined
        ? { sourceWebContentsId: context.sourceWebContentsId }
        : {}),
    };
    for (const wc of webContents.getAllWebContents()) {
      wc.send('tasks:updated', payload);
    }
  } catch (err) {
    logger.error('[tasks-ipc] broadcast failed', err);
  }
}

function ctx(event: IpcMainInvokeEvent): TaskMutationContext {
  return { sourceWebContentsId: event.sender.id };
}

export function registerTasksIpc(): void {
  if (registered) {
    logger.warn('[tasks-ipc] already registered, skip');
    return;
  }
  registered = true;

  taskService.addListener(broadcastTaskUpdated);

  // 让 renderer 知道自己的 webContents id，供 tasks:updated 广播自写抑制使用
  ipcMain.handle('tasks:webContentsId', async (e) => {
    return e.sender.id;
  });

  ipcMain.handle('tasks:list', async (_e, args: TaskQueryInput = {}) => {
    await ensureServicesReady();
    return taskService.list(args ?? {});
  });

  ipcMain.handle('tasks:get', async (_e, args: { id: string }) => {
    await ensureServicesReady();
    return taskService.get(args.id);
  });

  ipcMain.handle('tasks:upsert', async (e, args: TaskRecord) => {
    await ensureServicesReady();
    return taskService.upsert(args, ctx(e));
  });

  ipcMain.handle('tasks:delete', async (e, args: { id: string }) => {
    await ensureServicesReady();
    return taskService.delete(args.id, ctx(e));
  });

  ipcMain.handle('tasks:cancel', async (e, args: { id: string; reason?: string }) => {
    await ensureServicesReady();
    // 优先走 TaskRunner（能 abort in-flight handler）；不在 runner 里则直接翻状态
    const cancelled = taskRunner.cancel(args.id, args.reason, ctx(e));
    if (cancelled) return true;
    return taskService.cancel(args.id, args.reason, ctx(e));
  });

  ipcMain.handle(
    'tasks:submit',
    async (e, args: SubmitInput) => {
      await ensureServicesReady();
      return taskRunner.submit(args, ctx(e));
    }
  );

  // ========== Delegation：main → renderer 反向调用 ==========

  ipcMain.handle(
    'tasks:delegate:claim',
    (e, args: { types: string[] }) => {
      const id = e.sender.id;
      recordClaim(args?.types ?? [], id);
      // 窗口关闭/刷新时清理认领
      const wc = e.sender;
      const onDestroyed = () => clearClaimsByWebContents(id);
      wc.once('destroyed', onDestroyed);
      return { ok: true };
    }
  );

  ipcMain.handle(
    'tasks:delegate:reply',
    (_e, args: { requestId: string; result?: unknown; error?: string }) => {
      deliverReply(args.requestId, { result: args.result, error: args.error });
      return { ok: true };
    }
  );

  ipcMain.handle('tasks:removeByScope', async (e, args: { scope: string }) => {
    await ensureServicesReady();
    return taskService.removeByScope(args.scope, ctx(e));
  });

  ipcMain.handle(
    'tasks:removeByTarget',
    async (
      e,
      args: { scope: string; targetKind: string; targetId: string }
    ) => {
      await ensureServicesReady();
      return taskService.removeByTarget(args.scope, args.targetKind, args.targetId, ctx(e));
    }
  );

  ipcMain.handle('tasks:gc', async () => {
    await ensureServicesReady();
    return taskService.runGc();
  });

  ipcMain.handle('tasks:retention:get', async () => {
    await ensureServicesReady();
    return taskService.getRetentionConfig();
  });

  ipcMain.handle(
    'tasks:retention:set',
    async (_e, args: { retentionDays?: number; perScopeLimit?: number }) => {
      await ensureServicesReady();
      return taskService.setRetentionConfig(args ?? {});
    }
  );

  logger.info('[tasks-ipc] registered tasks:* handlers');
}
