/**
 * 项目打开服务
 * 处理项目打开时的初始化和任务恢复
 */
import type { AsyncTask } from '../types';
import {
  deleteMediaTask,
  listPendingMediaTasks,
  markMediaTaskFailed,
} from '../services/mediaTaskClient';
import { recoverPendingTasks } from './taskRecoveryService';
import { initSaveHooks, setGetCurrentProjectId } from './autoSaveService';
import { loadProject } from './projectStore';
import { createLogger } from './logger';
import { serializeMediaSelection } from '../providers/channel/resolver';

const logger = createLogger('ProjectOpen');

const RECOVERABLE_MEDIA_TASK_TYPES = new Set<AsyncTask['type']>([
  'tti',
  'itv',
  'tts',
  'character-extraction',
]);

const USER_INTERRUPTED_REASON = '用户选择不恢复，任务在应用重启后中断';

// 任务恢复结果监听器
type RecoveryListener = (result: { recovered: number; failed: number }) => void;
const recoveryListeners: Set<RecoveryListener> = new Set();

export function onTaskRecovery(listener: RecoveryListener): () => void {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}

// 当前项目 ID
let currentProjectId: string | null = null;

export function getCurrentProject(): string | null {
  return currentProjectId;
}

export function setCurrentProject(projectId: string | null): void {
  currentProjectId = projectId;
}

function isRecoverableMediaTask(task: AsyncTask): boolean {
  return RECOVERABLE_MEDIA_TASK_TYPES.has(task.type);
}

/**
 * 检查项目内需要用户决策的未完成媒体任务。
 */
export async function inspectPendingMediaTasks(projectId: string): Promise<AsyncTask[]> {
  const pendingTasks = await listPendingMediaTasks(projectId);
  return pendingTasks.filter(isRecoverableMediaTask);
}

/**
 * 将一批未完成媒体任务标记为失败。
 */
export async function failPendingMediaTasks(
  projectId: string,
  tasks: Pick<AsyncTask, 'id'>[],
  reason: string = USER_INTERRUPTED_REASON
): Promise<number> {
  let failedCount = 0;

  for (const task of tasks) {
    const updated = await markMediaTaskFailed(projectId, task.id, reason);
    if (updated) failedCount++;
  }

  logger.info(`用户选择不恢复，已标记 ${failedCount} 个任务为失败`, { projectId });
  return failedCount;
}

/**
 * 删除一批未完成媒体任务的本地记录。不会取消远端生成。
 */
export async function deletePendingMediaTasks(
  projectId: string,
  tasks: Pick<AsyncTask, 'id'>[]
): Promise<number> {
  let deletedCount = 0;

  for (const task of tasks) {
    const deleted = await deleteMediaTask(task.id);
    if (deleted) deletedCount++;
  }

  logger.info(`用户选择删除本地记录，已删除 ${deletedCount} 个任务记录`, { projectId });
  return deletedCount;
}

/**
 * 在用户确认后恢复项目内未完成媒体任务。
 */
export async function recoverProjectPendingMediaTasks(
  projectId: string,
  params?: {
    selections?: {
      ttiSelection?: string;
      itvSelection?: string;
      ttsSelection?: string;
    };
  }
): Promise<{ recovered: number; failed: number }> {
  try {
    const project = params?.selections ? null : await loadProject(projectId).catch(() => null);
    const selections = params?.selections ?? {
      ttiSelection: serializeMediaSelection(project?.mediaSelections?.tti),
      itvSelection: serializeMediaSelection(project?.mediaSelections?.itv),
      ttsSelection: serializeMediaSelection(project?.mediaSelections?.tts),
    };

    const result = await recoverPendingTasks(projectId, {
      selections,
      callbacks: {
        onTaskProgress: (task, progress) => {
          logger.info(`任务 ${task.targetName} 进度: ${progress}%`);
        },
        onTaskCompleted: async (_task, asset) => {
          logger.info(`任务完成: ${asset.localPath || asset.remoteUrl || ''}`);
        },
        onTaskFailed: (task, error) => {
          logger.warn(`任务 ${task.targetName} 失败: ${error}`);
        },
      },
    });

    recoveryListeners.forEach(listener => listener(result));

    if (result.recovered > 0 || result.failed > 0) {
      logger.info(`任务恢复完成: ${result.recovered} 成功, ${result.failed} 失败`);
    }

    return result;
  } catch (err: any) {
    logger.error('任务恢复失败', { error: err?.message || String(err) });
    throw err;
  }
}

/**
 * 初始化项目打开服务
 */
export async function initProjectOpenService(): Promise<void> {
  // 设置自动保存的当前项目 ID 获取函数
  setGetCurrentProjectId(() => currentProjectId);

  // 初始化保存钩子
  initSaveHooks();

  logger.info('项目打开服务初始化完成');
}

/**
 * 项目打开钩子
 * 在项目加载后调用。注意：这里不再自动恢复远程媒体任务，恢复必须由用户在弹窗中确认。
 */
export async function onProjectOpen(projectId: string): Promise<void> {
  logger.info(`项目打开: ${projectId}`);
  setCurrentProject(projectId);

  try {
    const pendingTasks = await inspectPendingMediaTasks(projectId);
    if (pendingTasks.length > 0) {
      logger.info(`发现 ${pendingTasks.length} 个未完成媒体任务，等待用户选择处理方式`);
    }
  } catch (err: any) {
    logger.error('检查未完成媒体任务失败', { error: err?.message || String(err) });
  }
}

/**
 * 项目关闭钩子
 */
export function onProjectClose(): void {
  const projectId = currentProjectId;
  if (projectId) {
    logger.info(`项目关闭: ${projectId}`);
  }
  setCurrentProject(null);
}

export { USER_INTERRUPTED_REASON };

export default {
  initProjectOpenService,
  onProjectOpen,
  onProjectClose,
  getCurrentProject,
  setCurrentProject,
  onTaskRecovery,
  inspectPendingMediaTasks,
  failPendingMediaTasks,
  deletePendingMediaTasks,
  recoverProjectPendingMediaTasks,
};
