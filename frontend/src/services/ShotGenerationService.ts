/**
 * 分镜图片生成服务（收口版）
 *
 * OpenSpec: 分镜生图统一走 workflow + MediaGenerationService，不再走 TaskManager。
 */
import type { Character, Scene, Shot, StoredMediaAsset } from '../types';
import { loadEpisodeShots } from '../store/projectStore';
import { shotImageWorkflow } from '../workflow/shotImageWorkflow';
import { runWithConcurrency } from '../utils/concurrency';
import type { StyleSnapshotLike } from '../utils/promptNormalize';
import { runWithTask } from './taskRunner';
import { createLogger } from '../store/logger';

const logger = createLogger('ShotGenerationService');

export interface BatchGenerateShotImageResult {
  shotId: string;
  success: boolean;
  asset?: StoredMediaAsset;
  error?: string;
}

interface BatchGenerateShotImageOptions {
  aspectRatio?: '16:9' | '9:16';
  theme?: string;
  stylePrompt?: string;
  styleSnapshot?: StyleSnapshotLike;
  project?: { styleSnapshot?: StyleSnapshotLike; aspectRatio?: '16:9' | '9:16' };
  shotsSnapshot?: Shot[];
  onProgress?: (overall: number, current: { shotId: string; progress: number; step?: string }) => void;
  onItemComplete?: (result: BatchGenerateShotImageResult) => void | Promise<void>;
}

export async function generateShotImage(
  projectId: string,
  episodeId: string,
  shotId: string,
  characters: Character[],
  scenes: Scene[],
  ttiSelection?: string,
  styleOptions?: {
    aspectRatio?: '16:9' | '9:16';
    theme?: string;
    stylePrompt?: string;
    styleSnapshot?: StyleSnapshotLike;
    project?: { styleSnapshot?: StyleSnapshotLike; aspectRatio?: '16:9' | '9:16' };
    shotSnapshot?: Shot;
    shotsSnapshot?: Shot[];
    onProgress?: (progress: number, step?: string) => void;
  }
): Promise<StoredMediaAsset> {
  const shot = styleOptions?.shotSnapshot?.id === shotId
    ? styleOptions.shotSnapshot
    : (await loadEpisodeShots(projectId, episodeId)).find(s => s.id === shotId);
  if (!shot) {
    throw new Error('分镜不存在');
  }

  const userOnProgress = styleOptions?.onProgress;
  const { result } = await runWithTask({
    projectId,
    category: 'analysis',
    subType: 'shot-generation',
    targetType: 'shot',
    targetId: shot.id,
    targetName: `分镜 #${shotId.slice(-6)} 图片生成`,
    type: 'shot-generation',
    metadata: { shotId },
    execute: async (taskCtx) => {
      const workflowParams = {
        projectId,
        episodeId,
        shot,
        characters,
        scenes,
        ttiSelection,
        aspectRatio: styleOptions?.aspectRatio,
        theme: styleOptions?.theme,
        stylePrompt: styleOptions?.stylePrompt,
        styleSnapshot: styleOptions?.styleSnapshot,
        allShots: styleOptions?.shotsSnapshot,
        project: styleOptions?.project,
        onProgress: (p: number, step?: string) => {
          userOnProgress?.(p, step);
          taskCtx.progress(p, step);
        },
      };
      return shotImageWorkflow(workflowParams);
    },
  });
  return result;
}

export async function batchGenerateShotImages(
  projectId: string,
  episodeId: string,
  shotIds: string[],
  characters: Character[],
  scenes: Scene[],
  ttiSelection?: string,
  styleOptions?: BatchGenerateShotImageOptions
): Promise<BatchGenerateShotImageResult[]> {
  if (shotIds.length === 0) return [];

  const notifyItemComplete = async (item: BatchGenerateShotImageResult): Promise<void> => {
    if (!styleOptions?.onItemComplete) return;
    try {
      await styleOptions.onItemComplete(item);
    } catch (err) {
      logger.warn('批量分镜图片单项完成回调失败', {
        shotId: item.shotId,
        success: item.success,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const { result } = await runWithTask({
    projectId,
    category: 'analysis',
    subType: 'shot-generation',
    targetType: 'episode',
    targetId: episodeId,
    targetName: `批量图片生成（${shotIds.length} 个分镜）`,
    type: 'shot-generation',
    metadata: {
      shotCount: shotIds.length,
      // shotIds 让 UI 在切走再回来时仍能识别"哪些分镜在批量队列里"，恢复 per-shot loading
      shotIds,
      // batchKind 区分批量图片 vs 批量视频（type='shot-generation' 两边共用）
      batchKind: 'image' as const,
    },
    execute: async (taskCtx) => {
      // 优先使用调用方传入的最新内存快照，避免用户刚编辑完提示词就点击批量生成时读到旧存储。
      // 调用方未传时再预加载 DB shots，避免并发时 N 次重复 IO。
      const allShots = styleOptions?.shotsSnapshot
        ?? await loadEpisodeShots(projectId, episodeId);

      let completedCount = 0;
      const tasks = shotIds.map((shotId) => async () => {
        const shot = allShots.find(s => s.id === shotId);
        let item: BatchGenerateShotImageResult;
        if (!shot) {
          item = { shotId, success: false, error: '分镜不存在' };
        } else {
          try {
            const workflowParams = {
              projectId,
              episodeId,
              shot,
              characters,
              scenes,
              ttiSelection,
              aspectRatio: styleOptions?.aspectRatio,
              theme: styleOptions?.theme,
              stylePrompt: styleOptions?.stylePrompt,
              styleSnapshot: styleOptions?.styleSnapshot,
              allShots,
              project: styleOptions?.project,
              onProgress: (progress: number, step?: string) => {
                const overall = Math.round(((completedCount + progress / 100) / shotIds.length) * 100);
                styleOptions?.onProgress?.(overall, { shotId, progress, step });
                taskCtx.progress(overall, `${shotId.slice(-6)}: ${step || ''}`);
              },
            };

            const asset = await shotImageWorkflow(workflowParams);
            item = { shotId, success: true, asset };
          } catch (err) {
            item = {
              shotId,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
        completedCount++;
        const overall = Math.round((completedCount / shotIds.length) * 100);
        const step = item.success ? '完成' : '失败';
        styleOptions?.onProgress?.(overall, { shotId, progress: 100, step });
        taskCtx.progress(overall, `${shotId.slice(-6)}: ${step}`);
        await notifyItemComplete(item);
        return item;
      });

      const settled = await runWithConcurrency(tasks, 2);

      return settled.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { shotId: shotIds[i], success: false, error: (r.reason as Error)?.message || String(r.reason) }
      );
    },
  });
  return result;
}
