import type { Clip, Track, Transition } from '../../../types/editor';
import { DEFAULT_TRANSITION_DURATION, MIN_VISIBLE_DURATION, SUPPORTED_TRANSITION_TYPES, TIME_EPSILON, TRANSITION_TYPE_FADE } from './constants';
import type { NormalizedTransitionPlan, ResolvedClipWindow, ResolvedTrackTimeline } from './types';

const clipOrder = (a: Clip, b: Clip) => {
  if (a.start !== b.start) {
    return a.start - b.start;
  }
  return a.id.localeCompare(b.id);
};

export function getSortedTrackClips(track: Track): Clip[] {
  return [...track.clips].sort(clipOrder);
}

export function findTransitionByClipPair(
  track: Track,
  fromClipId: string,
  toClipId: string
): Transition | undefined {
  return track.transitions?.find(
    (transition) => transition.fromClipId === fromClipId && transition.toClipId === toClipId
  );
}

export function getAddableTransitionDuration(
  track: Track,
  fromClipId: string,
  toClipId: string,
): number {
  const candidateTrack: Track = {
    ...track,
    transitions: [
      ...(track.transitions ?? []),
      {
        id: '__candidate-transition__',
        fromClipId,
        toClipId,
        type: TRANSITION_TYPE_FADE,
        duration: DEFAULT_TRANSITION_DURATION,
      },
    ],
  };

  return normalizeTrackTransitions(candidateTrack)
    .transitions
    ?.find((transition) => transition.id === '__candidate-transition__')
    ?.duration ?? 0;
}

export function getMaxTransitionDuration(
  track: Track,
  fromClipId: string,
  toClipId: string
): number {
  if (track.type !== 'video') {
    return 0;
  }

  const sortedClips = getSortedTrackClips(track);
  const fromIndex = sortedClips.findIndex((clip) => clip.id === fromClipId);
  const toIndex = sortedClips.findIndex((clip) => clip.id === toClipId);

  if (fromIndex < 0 || toIndex !== fromIndex + 1) {
    return 0;
  }

  const fromClip = sortedClips[fromIndex];
  const toClip = sortedClips[toIndex];
  const sameCutPoint = Math.abs(toClip.start - (fromClip.start + fromClip.duration)) < TIME_EPSILON;
  if (!sameCutPoint) {
    return 0;
  }
  return Math.max(0, Math.min(fromClip.duration, toClip.duration));
}

/**
 * 计算单个 transition 的链感知最大时长。
 * 接受原始（未归一化）Track，内部会自动归一化。
 * 适用于编辑器中对单个 transition 的交互操作。
 */
export function getChainAwareMaxDuration(
  track: Track,
  transitionId: string,
): number {
  const normalizedTrack = normalizeTrackTransitions(track);
  return computeChainAwareMaxDuration(normalizedTrack, transitionId);
}

/**
 * 批量计算已归一化轨道上所有 transition 的链感知最大时长。
 * 避免重复调用 normalizeTrackTransitions，将 O(n²) 降为 O(n)。
 *
 * 注意：传入的 track 必须是已归一化的（由 normalizeTrackTransitions 处理过）。
 * 如果传入未归一化的 track，结果可能不正确。
 * 适用于 UI 渲染等需要一次性计算所有值的场景。
 */
export function batchChainAwareMaxDurations(normalizedTrack: Track): Map<string, number> {
  const result = new Map<string, number>();
  const transitions = normalizedTrack.transitions ?? [];
  if (transitions.length === 0) return result;

  const sortedClips = getSortedTrackClips(normalizedTrack);
  const clipById = new Map(sortedClips.map(c => [c.id, c]));
  const incomingDurationByClip = new Map<string, number>();
  const outgoingDurationByClip = new Map<string, number>();

  for (const t of transitions) {
    incomingDurationByClip.set(t.toClipId, t.duration);
    outgoingDurationByClip.set(t.fromClipId, t.duration);
  }

  for (const t of transitions) {
    const baseMax = getMaxTransitionDuration(normalizedTrack, t.fromClipId, t.toClipId);
    if (baseMax <= 0) {
      result.set(t.id, 0);
      continue;
    }

    const fromClip = clipById.get(t.fromClipId);
    const toClip = clipById.get(t.toClipId);
    if (!fromClip || !toClip) {
      result.set(t.id, 0);
      continue;
    }

    const incomingOnFrom = incomingDurationByClip.get(t.fromClipId);
    const fromClipBudget = incomingOnFrom !== undefined
      ? fromClip.duration - incomingOnFrom
      : fromClip.duration;

    const outgoingOnTo = outgoingDurationByClip.get(t.toClipId);
    const toClipBudget = outgoingOnTo !== undefined
      ? toClip.duration - outgoingOnTo
      : toClip.duration;

    result.set(t.id, Math.max(0, Math.min(baseMax, fromClipBudget, toClipBudget) - MIN_VISIBLE_DURATION));
  }

  return result;
}

function computeChainAwareMaxDuration(normalizedTrack: Track, transitionId: string): number {
  const transitions = normalizedTrack.transitions ?? [];
  const target = transitions.find(t => t.id === transitionId);
  if (!target) return 0;

  const baseMax = getMaxTransitionDuration(normalizedTrack, target.fromClipId, target.toClipId);
  if (baseMax <= 0) return 0;

  const sortedClips = getSortedTrackClips(normalizedTrack);
  const fromClip = sortedClips.find(c => c.id === target.fromClipId);
  const toClip = sortedClips.find(c => c.id === target.toClipId);
  if (!fromClip || !toClip) return 0;

  const incomingOnFrom = transitions.find(
    t => t.id !== transitionId && t.toClipId === target.fromClipId
  );
  const fromClipBudget = incomingOnFrom
    ? fromClip.duration - incomingOnFrom.duration
    : fromClip.duration;

  const outgoingOnTo = transitions.find(
    t => t.id !== transitionId && t.fromClipId === target.toClipId
  );
  const toClipBudget = outgoingOnTo
    ? toClip.duration - outgoingOnTo.duration
    : toClip.duration;

  return Math.max(0, Math.min(baseMax, fromClipBudget, toClipBudget) - MIN_VISIBLE_DURATION);
}

// 阶段 2-B 清理：原 deriveLegacyTransitions 从已删除的 Clip.transition 字段
// 派生 Transition[]。Clip.transition 在生产代码中无写入路径（仅 0 个消费者），
// 且产品未上线无存量数据，整个 legacy 兼容路径删除。

function validateTransitions(track: Track, transitions: Transition[]): {
  valid: Transition[];
  invalid: Transition[];
  clampedIds: Set<string>;
} {
  if (track.type !== 'video') {
    return { valid: [], invalid: [...transitions], clampedIds: new Set<string>() };
  }

  const sortedClips = getSortedTrackClips(track);
  const clipIndexMap = new Map(sortedClips.map((clip, index) => [clip.id, index]));
  const usedAsFrom = new Set<string>();
  const usedAsTo = new Set<string>();
  const incomingDuration = new Map<string, number>();
  const outgoingDuration = new Map<string, number>();
  const valid: Transition[] = [];
  const invalid: Transition[] = [];
  const clampedIds = new Set<string>();

  const sortedTransitions = [...transitions].sort((a, b) => {
    const aIdx = clipIndexMap.get(a.fromClipId) ?? Infinity;
    const bIdx = clipIndexMap.get(b.fromClipId) ?? Infinity;
    return aIdx - bIdx;
  });

  for (const transition of sortedTransitions) {
    const fromIdx = clipIndexMap.get(transition.fromClipId);
    const toIdx = clipIndexMap.get(transition.toClipId);
    const maxDuration = getMaxTransitionDuration(
      track, transition.fromClipId, transition.toClipId,
    );

    const isValidType = SUPPORTED_TRANSITION_TYPES.has(transition.type);
    const isAdjacent = fromIdx !== undefined
      && toIdx !== undefined && toIdx === fromIdx + 1;
    const isUnique = !usedAsFrom.has(transition.fromClipId)
      && !usedAsTo.has(transition.toClipId);

    if (!isValidType || !isAdjacent || !isUnique) {
      invalid.push(transition);
      continue;
    }

    const fromClip = sortedClips[fromIdx];
    const toClip = sortedClips[toIdx!];
    const existingIncoming = incomingDuration.get(transition.fromClipId) ?? 0;
    const existingOutgoing = outgoingDuration.get(transition.toClipId) ?? 0;
    const fromBudget = fromClip.duration - existingIncoming;
    const toBudget = toClip.duration - existingOutgoing;
    const effectiveMax = Math.min(maxDuration, fromBudget, toBudget);
    const clampMax = Math.max(0, effectiveMax - MIN_VISIBLE_DURATION);

    if (clampMax <= 0) {
      invalid.push(transition);
      continue;
    }

    let finalDuration = transition.duration;
    if (!Number.isFinite(finalDuration) || finalDuration <= 0) {
      invalid.push(transition);
      continue;
    }

    if (finalDuration > clampMax + TIME_EPSILON) {
      finalDuration = clampMax;
      clampedIds.add(transition.id);
    }

    usedAsFrom.add(transition.fromClipId);
    usedAsTo.add(transition.toClipId);
    outgoingDuration.set(transition.fromClipId, finalDuration);
    incomingDuration.set(transition.toClipId, finalDuration);
    valid.push(
      finalDuration !== transition.duration
        ? { ...transition, duration: finalDuration }
        : transition,
    );
  }

  return { valid, invalid, clampedIds };
}

function normalizeTrackTransitionsWithInvalid(track: Track): {
  track: Track;
  invalidTransitions: Transition[];
  clampedIds: Set<string>;
} {
  const explicitTransitions = track.transitions ?? [];
  const { valid, invalid, clampedIds } = validateTransitions(track, explicitTransitions);

  return {
    track: {
      ...track,
      transitions: valid,
    },
    invalidTransitions: invalid,
    clampedIds,
  };
}

export function normalizeTrackTransitions(track: Track): Track {
  return normalizeTrackTransitionsWithInvalid(track).track;
}

export function normalizeTimelineTracks(tracks: Track[]): Track[] {
  return tracks.map(normalizeTrackTransitions);
}

export function resolveTrackTimeline(track: Track): ResolvedTrackTimeline {
  const normalized = normalizeTrackTransitionsWithInvalid(track);
  const normalizedTrack = normalized.track;
  const sortedClips = getSortedTrackClips(normalizedTrack);
  const outgoing = new Map(
    (normalizedTrack.transitions ?? []).map((transition) => [transition.fromClipId, transition])
  );
  const clipWindows: ResolvedClipWindow[] = [];
  const clipWindowsById = new Map<string, ResolvedClipWindow>();
  let cumulativeOverlap = 0;

  for (const clip of sortedClips) {
    const resolvedStart = clip.start - cumulativeOverlap;
    const resolvedEnd = resolvedStart + clip.duration;
    const window: ResolvedClipWindow = {
      clipId: clip.id,
      trackId: normalizedTrack.id,
      resolvedStart,
      resolvedEnd,
    };

    clipWindows.push(window);
    clipWindowsById.set(clip.id, window);

    const outgoingTransition = outgoing.get(clip.id);
    if (outgoingTransition) {
      cumulativeOverlap += outgoingTransition.duration;
    }
  }

  const transitionPlans: NormalizedTransitionPlan[] = [];
  const droppedTransitionIds: string[] = [];

  for (const transition of normalizedTrack.transitions ?? []) {
    const fromWindow = clipWindowsById.get(transition.fromClipId);
    const toWindow = clipWindowsById.get(transition.toClipId);

    if (!fromWindow || !toWindow) {
      droppedTransitionIds.push(transition.id);
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[TransitionResolver] Transition ${transition.id} dropped: missing clip window (from=${transition.fromClipId}, to=${transition.toClipId})`,
        );
      }
      continue;
    }

    transitionPlans.push({
      transitionId: transition.id,
      trackId: normalizedTrack.id,
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      type: transition.type,
      duration: transition.duration,
      cutPointTime: fromWindow.resolvedEnd,
      activeStartTime: toWindow.resolvedStart,
      activeEndTime: toWindow.resolvedStart + transition.duration,
      exportVideoOffset: fromWindow.resolvedEnd - fromWindow.resolvedStart - transition.duration,
      exportAudioOverlap: transition.duration,
      maxDuration: getMaxTransitionDuration(
        normalizedTrack,
        transition.fromClipId,
        transition.toClipId
      ),
    });
  }

  const duration = clipWindows.reduce(
    (maxDuration, window) => Math.max(maxDuration, window.resolvedEnd),
    0
  );

  return {
    track: normalizedTrack,
    clipWindows,
    transitionPlans,
    duration,
    invalidTransitions: normalized.invalidTransitions,
    clampedIds: normalized.clampedIds,
    droppedTransitionIds,
  };
}

export function resolveTimelineTracks(tracks: Track[]): ResolvedTrackTimeline[] {
  return tracks.map(resolveTrackTimeline);
}

export function getTimelineDuration(tracks: Track[]): number {
  return resolveTimelineTracks(tracks).reduce(
    (maxDuration, track) => Math.max(maxDuration, track.duration),
    0
  );
}

export function getClipResolvedWindow(
  tracks: Track[],
  clipId: string
): ResolvedClipWindow | undefined {
  for (const track of resolveTimelineTracks(tracks)) {
    const window = track.clipWindows.find((clipWindow) => clipWindow.clipId === clipId);
    if (window) {
      return window;
    }
  }
  return undefined;
}

export function getMainVideoTrack(tracks: Track[]): Track | undefined {
  return tracks.find((track) => track.isMainTrack && track.type === 'video')
    ?? tracks.find((track) => track.type === 'video');
}

export function getExistingTransitionCount(track: Track): number {
  const normalized = normalizeTrackTransitions(track);
  return normalized.transitions?.length ?? 0;
}

export function getAddableTransitionCount(track: Track): number {
  if (track.type !== 'video') return 0;
  const normalized = normalizeTrackTransitions(track);
  const sortedClips = getSortedTrackClips(normalized);
  const existingPairs = new Set(
    (normalized.transitions ?? []).map(t => `${t.fromClipId}:${t.toClipId}`),
  );
  let count = 0;
  for (let i = 0; i < sortedClips.length - 1; i++) {
    const from = sortedClips[i];
    const to = sortedClips[i + 1];
    const maxDur = getMaxTransitionDuration(normalized, from.id, to.id);
    if (maxDur > 0 && !existingPairs.has(`${from.id}:${to.id}`)) {
      count++;
    }
  }
  return count;
}

/** Clamp progress to [0, 1] with division-by-zero guard */
function safeProgress(currentTime: number, startTime: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, (currentTime - startTime) / duration));
}

export function getClipOpacityFromPlans(
  transitionPlans: NormalizedTransitionPlan[],
  clipId: string,
  currentTime: number
): number {
  const activeTransition = transitionPlans.find(
    (transition) =>
      currentTime >= transition.activeStartTime && currentTime < transition.activeEndTime
  );

  if (!activeTransition) {
    return 1;
  }

  const progress = safeProgress(currentTime, activeTransition.activeStartTime, activeTransition.duration);

  if (activeTransition.fromClipId === clipId) {
    return 1 - progress;
  }

  if (activeTransition.toClipId === clipId) {
    return progress;
  }

  return 1;
}

export function getClipOpacityMultiplier(
  track: Track,
  clipId: string,
  currentTime: number
): number {
  const { transitionPlans } = resolveTrackTimeline(track);
  return getClipOpacityFromPlans(transitionPlans, clipId, currentTime);
}

export function getClipAudioFade(
  transitionPlans: NormalizedTransitionPlan[],
  clipId: string,
  currentTime: number
): number {
  const activeTransition = transitionPlans.find(
    (transition) =>
      currentTime >= transition.activeStartTime && currentTime < transition.activeEndTime
  );

  if (!activeTransition) {
    return 1;
  }

  const progress = safeProgress(currentTime, activeTransition.activeStartTime, activeTransition.duration);

  if (activeTransition.fromClipId === clipId) {
    return Math.cos(progress * Math.PI / 2);
  }

  if (activeTransition.toClipId === clipId) {
    return Math.sin(progress * Math.PI / 2);
  }

  return 1;
}
