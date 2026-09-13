/**
 * 任务恢复服务
 *
 * OpenSpec: 恢复流程必须走统一 Provider task-snapshot 语义，并通过统一落盘与绑定路径回写。
 */
import type { AsyncTask, StoredMediaAsset } from '../types';
import { listPendingMediaTasks } from '../services/mediaTaskClient';
import { createLogger } from './logger';
import { mediaGenerationService } from '../services/MediaGenerationService';

const logger = createLogger('TaskRecovery');

export type TaskCompletedCallback = (task: AsyncTask, asset: StoredMediaAsset) => Promise<void>;
export type TaskFailedCallback = (task: AsyncTask, error: string) => void;
export type TaskProgressCallback = (task: AsyncTask, progress: number, step?: string) => void;

interface RecoveryCallbacks {
  onTaskCompleted?: TaskCompletedCallback;
  onTaskFailed?: TaskFailedCallback;
  onTaskProgress?: TaskProgressCallback;
}

export async function recoverPendingTasks(
  projectId: string,
  params?: {
    selections?: {
      ttiSelection?: string;
      itvSelection?: string;
      ttsSelection?: string;
    };
    callbacks?: RecoveryCallbacks;
  }
): Promise<{ recovered: number; failed: number }> {
  const pendingTasks = await listPendingMediaTasks(projectId);

  if (pendingTasks.length === 0) {
    logger.info('没有需要恢复的任务');
    return { recovered: 0, failed: 0 };
  }

  logger.info(`发现 ${pendingTasks.length} 个未完成任务，开始恢复`);

  const callbacks = params?.callbacks;
  const selections = params?.selections;

  let recovered = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    pendingTasks.map(async task => {
      try {
        const asset = await mediaGenerationService.recoverTask({
          projectId,
          task,
          ttiSelection: selections?.ttiSelection,
          itvSelection: selections?.itvSelection,
          ttsSelection: selections?.ttsSelection,
          onProgress: (t, progress) => callbacks?.onTaskProgress?.(t, progress),
        });

        if (!asset) {
          return false;
        }

        await callbacks?.onTaskCompleted?.({ ...task, resultAsset: asset }, asset);
        return true;
      } catch (err: any) {
        callbacks?.onTaskFailed?.(task, err?.message || String(err));
        return false;
      }
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) recovered++;
    else failed++;
  }

  logger.info(`任务恢复完成: ${recovered} 成功, ${failed} 失败`);
  return { recovered, failed };
}
