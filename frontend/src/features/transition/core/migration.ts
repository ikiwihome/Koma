/**
 * 时间线数据版本迁移
 *
 * 采用 lazy migration 策略：打开项目文件时按 version 字段分发迁移路径。
 * v0（无 version 或 version=0）：Clip.transition 旧格式
 * v1：Track.transitions[] 新格式
 */
import type { Track } from '../../../types/editor';
import type { TimelineData } from '../../../types/editor';
import { normalizeTimelineTracks } from './transitionResolver';

export const CURRENT_TIMELINE_VERSION = 1;

function getRawVersion(raw: Record<string, unknown>): number {
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (!Number.isFinite(version) || version < 0) return 0;
  return Math.floor(version);
}

function getRawTracks(raw: Record<string, unknown>): Track[] {
  return Array.isArray(raw.tracks) ? (raw.tracks as Track[]) : [];
}

function normalizeSupportedTracks(version: number, tracks: Track[]): Track[] {
  if (version > CURRENT_TIMELINE_VERSION) {
    throw new Error(`Unsupported timeline version: ${version}`);
  }

  return normalizeTimelineTracks(tracks);
}

export function prepareTimelineForSave(
  raw: Partial<TimelineData> & Pick<TimelineData, 'tracks'>
): TimelineData {
  const now = Date.now();

  return {
    version: CURRENT_TIMELINE_VERSION,
    tracks: normalizeSupportedTracks(getRawVersion(raw as Record<string, unknown>), raw.tracks),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

/**
 * 将任意版本的时间线数据迁移到当前版本。
 * 在 loadTimeline / loadEpisodeTimeline 中调用。
 */
export function migrateTimelineData(raw: Record<string, unknown>): TimelineData {
  const version = getRawVersion(raw);
  const tracks = getRawTracks(raw);
  const migratedTracks = normalizeSupportedTracks(version, tracks);

  return {
    version: CURRENT_TIMELINE_VERSION,
    tracks: migratedTracks,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}
