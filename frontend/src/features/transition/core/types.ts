import type { Track, Transition, TransitionType } from '../../../types/editor';

export interface ResolvedClipWindow {
  clipId: string;
  trackId: string;
  resolvedStart: number;
  resolvedEnd: number;
}

export interface NormalizedTransitionPlan {
  transitionId: string;
  trackId: string;
  fromClipId: string;
  toClipId: string;
  type: TransitionType;
  duration: number;
  cutPointTime: number;
  activeStartTime: number;
  activeEndTime: number;
  exportVideoOffset: number;
  exportAudioOverlap: number;
  maxDuration: number;
}

export interface ResolvedTrackTimeline {
  track: Track;
  clipWindows: ResolvedClipWindow[];
  transitionPlans: NormalizedTransitionPlan[];
  duration: number;
  /** 验证阶段被过滤的无效 transition（类型/邻接/唯一性/预算不合法） */
  invalidTransitions: Transition[];
  /** 验证阶段被钳位的 transition ID 集合 */
  clampedIds: Set<string>;
  /** resolve 阶段因缺少 clip window 而被丢弃的 transition ID（状态异常指示器） */
  droppedTransitionIds: string[];
}
