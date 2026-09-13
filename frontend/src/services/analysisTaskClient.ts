/**
 * analysisTaskClient —— 入口让分析（剧本/分镜）走 main-side 父任务。
 *
 * 收益：
 *  - 主进程 concurrency=1 限流（防止双击触发）
 *  - 主进程 AbortController 取消信号
 *  - 多窗口共享父任务状态
 *
 * 跟旧的 startBackgroundAnalysis / startShotAnalysis 行为一致：
 *  - 同 episode + 同 type 已有未完成任务 → 直接返回 deduped=true，不重复提交
 *  - 否则提交新任务，main TaskRunner 通过 'shot-analysis' / 'script-analysis' handler 派发
 */
import { listTaskRecords, submitTask, type TaskRecord } from './tasksIPC';
import type { PresetAssets } from './ShotAnalysisService';
import type { StyleSnapshotLike } from '../utils/promptNormalize';

export interface SubmitShotAnalysisInput {
  projectId: string;
  episodeId: string;
  episodeName: string;
  script: string;
  llmSelection?: string;
  presetAssets?: PresetAssets;
  styleSnapshot?: StyleSnapshotLike;
}

export interface SubmitScriptAnalysisInput {
  projectId: string;
  episodeId: string;
  episodeName: string;
  script: string;
  llmSelection?: string;
  styleSnapshot?: StyleSnapshotLike;
}

export interface SubmitAnalysisResult {
  task: TaskRecord;
  /** true 表示该 episode 已有同类未完成任务，没有提交新任务 */
  deduped: boolean;
}

const ACTIVE_STATUSES = ['pending', 'running', 'processing'] as const;

async function findActiveAnalysis(
  projectId: string,
  type: 'shot-analysis' | 'script-analysis',
  episodeId: string,
): Promise<TaskRecord | null> {
  const records = await listTaskRecords({
    scope: `project:${projectId}`,
    type,
    targetKind: 'episode',
    targetId: episodeId,
    status: ACTIVE_STATUSES as unknown as string[],
  });
  return records[0] ?? null;
}

/** 提交分镜分析父任务（main-side，concurrency=1） */
export async function submitShotAnalysisTask(
  input: SubmitShotAnalysisInput,
): Promise<SubmitAnalysisResult> {
  const existing = await findActiveAnalysis(input.projectId, 'shot-analysis', input.episodeId);
  if (existing) return { task: existing, deduped: true };

  const task = await submitTask({
    type: 'shot-analysis',
    scope: `project:${input.projectId}`,
    targetKind: 'episode',
    targetId: input.episodeId,
    input,
    initialPayload: {
      targetName: input.episodeName,
      category: 'analysis',
      subType: 'shot-analysis',
      // service.runShotAnalysis 内部读 this.task.id 和 result.shotsCount 时
      // 需要任务记录里同时含这两个字段；初值就给好。
      result: { shotsCount: 0 },
    },
  });
  return { task, deduped: false };
}

/** 提交剧本分析父任务 */
export async function submitScriptAnalysisTask(
  input: SubmitScriptAnalysisInput,
): Promise<SubmitAnalysisResult> {
  const existing = await findActiveAnalysis(input.projectId, 'script-analysis', input.episodeId);
  if (existing) return { task: existing, deduped: true };

  const task = await submitTask({
    type: 'script-analysis',
    scope: `project:${input.projectId}`,
    targetKind: 'episode',
    targetId: input.episodeId,
    input,
    initialPayload: {
      targetName: input.episodeName,
      category: 'script',
      subType: 'script-analysis',
    },
  });
  return { task, deduped: false };
}
