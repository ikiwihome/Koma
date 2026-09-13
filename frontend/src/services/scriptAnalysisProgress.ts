import type { AnalysisStage } from './ScriptAnalysisService';

export type ScriptAnalysisProgressStage = 'plan' | Extract<AnalysisStage, 'characters' | 'scenes' | 'props'>;
export type ScriptAnalysisProgressStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ScriptAnalysisStageState {
  status: ScriptAnalysisProgressStatus;
  progress: number;
  chunkIndex?: number;
  chunkTotal?: number;
  retryAttempt?: number;
  retryMax?: number;
  retryDelayMs?: number;
  message?: string;
}

const BASE_STAGE_WEIGHTS: Record<ScriptAnalysisProgressStage, number> = {
  plan: 0.08,
  characters: 0.36,
  scenes: 0.28,
  props: 0.28,
};

const STAGE_ORDER: ScriptAnalysisProgressStage[] = ['plan', 'characters', 'scenes', 'props'];

const STAGE_LABELS: Record<ScriptAnalysisProgressStage, string> = {
  plan: '规划',
  characters: '角色',
  scenes: '场景',
  props: '道具',
};

function clampProgress(value?: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatRetryDelayMs(retryDelayMs?: number): string {
  if (!retryDelayMs || retryDelayMs <= 0) return '稍后';
  if (retryDelayMs < 1000) return `${retryDelayMs}ms`;
  const seconds = retryDelayMs / 1000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

function formatStageSummary(
  stage: ScriptAnalysisProgressStage,
  state: ScriptAnalysisStageState | undefined,
): string | null {
  if (!state) return null;
  const label = STAGE_LABELS[stage];

  if (state.status === 'completed') {
    return `${label}完成`;
  }

  if (state.status === 'failed') {
    return `${label}失败`;
  }

  if (state.status !== 'running') {
    return null;
  }

  if (state.retryDelayMs && state.retryDelayMs > 0) {
    if (state.chunkIndex && state.chunkTotal) {
      return `${label}重试 ${state.chunkIndex}/${state.chunkTotal}（${formatRetryDelayMs(state.retryDelayMs)}后）`;
    }
    return `${label}重试中（${formatRetryDelayMs(state.retryDelayMs)}后）`;
  }

  if (stage === 'plan') {
    return '生成全局规划';
  }

  if (state.chunkIndex && state.chunkTotal) {
    return `${label} ${state.chunkIndex}/${state.chunkTotal}`;
  }

  return `${label}处理中`;
}

export function createInitialScriptAnalysisStageStates(options?: {
  includePlan?: boolean;
  completedStages?: Array<'characters' | 'scenes' | 'props'>;
}): Record<ScriptAnalysisProgressStage, ScriptAnalysisStageState> {
  const includePlan = options?.includePlan ?? false;
  const completedStages = new Set(options?.completedStages || []);

  return {
    plan: {
      status: includePlan ? 'pending' : 'completed',
      progress: includePlan ? 0 : 1,
    },
    characters: {
      status: completedStages.has('characters') ? 'completed' : 'pending',
      progress: completedStages.has('characters') ? 1 : 0,
    },
    scenes: {
      status: completedStages.has('scenes') ? 'completed' : 'pending',
      progress: completedStages.has('scenes') ? 1 : 0,
    },
    props: {
      status: completedStages.has('props') ? 'completed' : 'pending',
      progress: completedStages.has('props') ? 1 : 0,
    },
  };
}

export function buildScriptAnalysisOverallProgress(
  stageStates: Partial<Record<ScriptAnalysisProgressStage, ScriptAnalysisStageState>>,
  options?: { includePlan?: boolean },
): number {
  const includePlan = options?.includePlan ?? false;
  const activeStages = STAGE_ORDER.filter(stage => includePlan || stage !== 'plan');
  const totalWeight = activeStages.reduce((sum, stage) => sum + BASE_STAGE_WEIGHTS[stage], 0);
  if (totalWeight <= 0) return 0;

  const progress = activeStages.reduce((sum, stage) => {
    const state = stageStates[stage];
    const weight = BASE_STAGE_WEIGHTS[stage] / totalWeight;
    return sum + clampProgress(state?.progress) * weight;
  }, 0);

  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

export function buildScriptAnalysisStatusLine(
  stageStates: Partial<Record<ScriptAnalysisProgressStage, ScriptAnalysisStageState>>,
  options?: { includePlan?: boolean },
): string {
  const includePlan = options?.includePlan ?? false;
  const activeStages = STAGE_ORDER.filter(stage => includePlan || stage !== 'plan');
  const activeSummaries = activeStages
    .filter(stage => {
      const status = stageStates[stage]?.status;
      return status === 'running' || status === 'failed';
    })
    .map(stage => formatStageSummary(stage, stageStates[stage]))
    .filter((value): value is string => Boolean(value));

  if (activeSummaries.length > 0) {
    return activeSummaries.join(' · ');
  }

  const completedCount = activeStages.filter(stage => stageStates[stage]?.status === 'completed').length;
  if (completedCount === activeStages.length) {
    return '解析完成';
  }

  if (completedCount > 0) {
    return `已完成 ${completedCount}/${activeStages.length} 阶段`;
  }

  return '准备解析';
}

export function getPrimaryScriptAnalysisStage(
  stageStates: Partial<Record<ScriptAnalysisProgressStage, ScriptAnalysisStageState>>,
  options?: { includePlan?: boolean },
): ScriptAnalysisProgressStage {
  const includePlan = options?.includePlan ?? false;
  const activeStages = STAGE_ORDER.filter(stage => includePlan || stage !== 'plan');

  for (const stage of activeStages) {
    if (stageStates[stage]?.status === 'failed') return stage;
  }

  for (const stage of activeStages) {
    if (stageStates[stage]?.status === 'running') return stage;
  }

  for (const stage of activeStages) {
    if (stageStates[stage]?.status === 'pending') return stage;
  }

  return includePlan ? 'plan' : 'characters';
}
