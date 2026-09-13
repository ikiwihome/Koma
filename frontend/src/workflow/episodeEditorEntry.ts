import type { EditorStep, EpisodeStepProgress } from '../types';
import { listEditorStepIds } from './editorStepRegistry';

const defaultStepProgress: EpisodeStepProgress = {
  assets: 'pending',
  storyboard: 'pending',
  video: 'pending',
};

export type EpisodeEditorEntryMode = 'resume-progress' | 'start-production';

export interface EpisodeEditorEntryOptions {
  mode?: EpisodeEditorEntryMode;
  /**
   * 当前剧集的剧本内容；'script' 步骤的完成状态由它运行时派生，不持久化到
   * EpisodeStepProgress（避免破坏数据 schema 与旧数据兼容）。
   */
  scriptText?: string;
}

/**
 * 'script' 步骤不在 EpisodeStepProgress 字段集合里 — 这里把它的完成状态映射成
 * 派生值：剧本非空即视为完成。其他步骤照走 EpisodeStepProgress。
 */
function isStepDone(
  stepId: string,
  progress: EpisodeStepProgress,
  scriptText?: string,
): boolean {
  if (stepId === 'script') {
    return !!(scriptText && scriptText.trim().length > 0);
  }
  return progress[stepId as keyof EpisodeStepProgress] === 'completed';
}

export function resolveEpisodeEditorEntry(
  stepProgress?: EpisodeStepProgress,
  options: EpisodeEditorEntryOptions = {},
): { stepProgress: EpisodeStepProgress; initialStep: EditorStep } {
  const progress = stepProgress || { ...defaultStepProgress };
  const stepOrder = listEditorStepIds();
  const fallbackStep = (stepOrder[0] || 'script') as EditorStep;

  if (options.mode === 'start-production') {
    return { stepProgress: progress, initialStep: fallbackStep };
  }

  // 寻找第一个未完成的步骤；'script' 用剧本是否非空派生，其余走 stepProgress
  const pending = stepOrder.find(
    (step) => !isStepDone(step, progress, options.scriptText),
  );
  return { stepProgress: progress, initialStep: (pending ?? fallbackStep) as EditorStep };
}
