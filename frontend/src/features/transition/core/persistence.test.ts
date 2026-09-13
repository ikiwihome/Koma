import { describe, expect, it } from 'vitest';
import { MediaType } from '../../../types/editor';
import { CURRENT_TIMELINE_VERSION, migrateTimelineData, prepareTimelineForSave } from './migration';

function makeClip(id: string, start: number, duration: number, extra?: Record<string, unknown>) {
  return {
    id,
    assetId: `asset-${id}`,
    trackId: 'track-1',
    start,
    duration,
    offset: 0,
    name: id,
    type: MediaType.VIDEO,
    src: `${id}.mp4`,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 1,
    ...extra,
  };
}

describe('timeline persistence boundary', () => {
  it('prepareTimelineForSave stamps current version and preserves createdAt', () => {
    const prepared = prepareTimelineForSave({
      tracks: [{
        id: 'track-1',
        type: 'video',
        order: 0,
        clips: [makeClip('clip-a', 0, 5)],
        transitions: [],
      }],
      createdAt: 123,
    });

    expect(prepared.version).toBe(CURRENT_TIMELINE_VERSION);
    expect(prepared.createdAt).toBe(123);
    expect(prepared.updatedAt).toBeGreaterThan(0);
  });

  // 阶段 2-B 清理：legacy clip.transition 字段已移除，对应 test 删除。

  it('save boundary and load boundary are idempotent for normalized timelines', () => {
    const once = prepareTimelineForSave({
      version: CURRENT_TIMELINE_VERSION,
      createdAt: 100,
      updatedAt: 200,
      tracks: [{
        id: 'track-1',
        type: 'video',
        order: 0,
        clips: [makeClip('clip-a', 0, 5), makeClip('clip-b', 5, 5)],
        transitions: [
          { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
        ],
      }],
    });

    const twice = migrateTimelineData(once as unknown as Record<string, unknown>);
    expect(twice).toEqual({
      ...once,
      version: CURRENT_TIMELINE_VERSION,
    });
  });
});
