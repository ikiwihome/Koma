/**
 * 轨道碰撞检测工具函数
 */
import type { Clip } from '../types/editor';

interface ClipLike {
  id: string;
  start: number;
  duration: number;
}

/**
 * 检测两个时间区间是否重叠
 */
function intervalsOverlap(
  start1: number, end1: number,
  start2: number, end2: number
): boolean {
  return start1 < end2 && end1 > start2;
}

/**
 * 检测 clip 是否与其他 clips 碰撞
 * @param clip - 需要检测的片段
 * @param otherClips - 其他片段列表
 * @returns 是否发生碰撞
 */
export function hasCollision(
  clip: ClipLike,
  otherClips: ClipLike[]
): boolean {
  const clipEnd = clip.start + clip.duration;
  return otherClips.some(other => {
    if (other.id === clip.id) return false;
    const otherEnd = other.start + other.duration;
    return intervalsOverlap(clip.start, clipEnd, other.start, otherEnd);
  });
}

/**
 * 找到指定时间点之后第一个可用位置
 * @param clips - 已有片段列表
 * @param duration - 片段时长
 * @param preferredStart - 期望起点
 * @returns 可用起点（>= 0）
 */
export function findNextAvailablePosition(
  clips: ClipLike[],
  duration: number,
  preferredStart: number
): number {
  if (clips.length === 0) return Math.max(0, preferredStart);

  // 按 start 排序
  const sorted = [...clips].sort((a, b) => a.start - b.start);

  // 检查 preferredStart 是否可用
  let candidateStart = Math.max(0, preferredStart);
  let candidateEnd = candidateStart + duration;

  for (const clip of sorted) {
    const clipEnd = clip.start + clip.duration;

    // 候选区间在当前 clip 之前，无需调整
    if (candidateEnd <= clip.start) {
      break;
    }

    // 候选区间在当前 clip 之后，继续检查下一个
    if (candidateStart >= clipEnd) {
      continue;
    }

    // 有冲突，将候选起点移到当前 clip 之后
    candidateStart = clipEnd;
    candidateEnd = candidateStart + duration;
  }

  return candidateStart;
}

/**
 * 解决碰撞：将被挤占的素材向后推移
 * 返回更新后的 clips 数组（不修改原数组）
 * @param clips - 轨道上的片段列表
 * @param movedClipId - 被移动的片段 ID
 * @returns 调整后的片段数组
 */
export function resolveCollisions(
  clips: Clip[],
  movedClipId: string
): Clip[] {
  if (clips.length <= 1) return clips;

  const result = clips.map(c => ({ ...c }));
  const movedClip = result.find(c => c.id === movedClipId);
  if (!movedClip) return clips;

  // 按 start 排序
  result.sort((a, b) => a.start - b.start);

  // 从移动的 clip 位置开始，检查后续 clip 是否需要推移
  const movedIndex = result.findIndex(c => c.id === movedClipId);
  let prevEnd = movedClip.start + movedClip.duration;

  for (let i = movedIndex + 1; i < result.length; i++) {
    const clip = result[i];
    if (clip.start < prevEnd) {
      // 需要推移
      clip.start = prevEnd;
    }
    prevEnd = clip.start + clip.duration;
  }

  return result;
}

/**
 * 获取轨道上的空闲区间
 * @param clips - 已有片段列表
 * @param maxTime - 区间上限（默认 Infinity）
 * @returns 空闲区间列表
 */
export function getFreeIntervals(
  clips: ClipLike[],
  maxTime: number = Infinity
): { start: number; end: number }[] {
  if (clips.length === 0) {
    return [{ start: 0, end: maxTime }];
  }

  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const intervals: { start: number; end: number }[] = [];

  // 开始到第一个 clip
  if (sorted[0].start > 0) {
    intervals.push({ start: 0, end: sorted[0].start });
  }

  // clip 之间的间隙
  for (let i = 0; i < sorted.length - 1; i++) {
    const currentEnd = sorted[i].start + sorted[i].duration;
    const nextStart = sorted[i + 1].start;
    if (nextStart > currentEnd) {
      intervals.push({ start: currentEnd, end: nextStart });
    }
  }

  // 最后一个 clip 到 maxTime
  const lastClip = sorted[sorted.length - 1];
  const lastEnd = lastClip.start + lastClip.duration;
  if (lastEnd < maxTime) {
    intervals.push({ start: lastEnd, end: maxTime });
  }

  return intervals;
}

/**
 * 检查是否可以在指定位置放置指定时长的 clip
 * @param clips - 已有片段列表
 * @param start - 目标起点
 * @param duration - 片段时长
 * @param excludeClipId - 可选，排除的片段 ID
 * @returns 是否可放置
 */
export function canPlaceClip(
  clips: ClipLike[],
  start: number,
  duration: number,
  excludeClipId?: string
): boolean {
  const filteredClips = excludeClipId
    ? clips.filter(c => c.id !== excludeClipId)
    : clips;

  const tempClip: ClipLike = { id: '__temp__', start, duration };
  return !hasCollision(tempClip, filteredClips);
}
