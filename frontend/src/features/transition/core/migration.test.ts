import { describe, it, expect } from 'vitest';
import { migrateTimelineData, CURRENT_TIMELINE_VERSION } from './migration';

// ========== 测试工具 ==========

/** 将 fixture 对象转为 migrateTimelineData 接受的 Record<string, unknown> */
function asRaw(obj: Record<string, unknown>): Record<string, unknown> {
  return obj;
}

// ========== 最小 clip 工厂 ==========
function makeClip(id: string, start: number, duration: number, extra?: Record<string, unknown>) {
  return {
    id,
    assetId: `asset-${id}`,
    trackId: 'track-1',
    start,
    duration,
    offset: 0,
    name: id,
    type: 'VIDEO',
    src: `${id}.mp4`,
    x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
    ...extra,
  };
}

// ========== v0 fixtures ==========
// 阶段 2-B 后：v0 仅指"version 字段缺失或显式为 0 的旧文件"，迁移逻辑已删除
// （Clip.transition 字段已移除，无 legacy 转换）。fixture 仅用于测试 version 检测。
const v0WithLegacyTransition = asRaw({
  tracks: [
    { id: 'track-1', type: 'video', order: 0, isMainTrack: true,
      clips: [makeClip('clip-a', 0, 5), makeClip('clip-b', 5, 5)] },
  ],
  createdAt: 1000,
  updatedAt: 2000,
});

const v0Explicit = asRaw({
  version: 0,
  tracks: [
    { id: 'track-1', type: 'video', order: 0, isMainTrack: true,
      clips: [makeClip('clip-a', 0, 5), makeClip('clip-b', 5, 5)] },
  ],
  createdAt: 1000,
  updatedAt: 2000,
});

// ========== v1 fixtures ==========
const v1Normal = asRaw({
  version: 1,
  tracks: [
    {
      id: 'track-1',
      type: 'video',
      order: 0,
      isMainTrack: true,
      clips: [
        makeClip('clip-a', 0, 5),
        makeClip('clip-b', 5, 5),
      ],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
      ],
    },
  ],
  createdAt: 1000,
  updatedAt: 2000,
});

// ========== 损坏数据 fixtures ==========
const corruptedBadClipId = asRaw({
  version: 1,
  tracks: [
    {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [makeClip('clip-a', 0, 5), makeClip('clip-b', 5, 5)],
      transitions: [
        { id: 't1', fromClipId: 'nonexistent', toClipId: 'clip-b', type: 'fade', duration: 1 },
      ],
    },
  ],
  createdAt: 1000,
  updatedAt: 2000,
});

const corruptedZeroDuration = asRaw({
  version: 1,
  tracks: [
    {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [makeClip('clip-a', 0, 5), makeClip('clip-b', 5, 5)],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0 },
      ],
    },
  ],
  createdAt: 1000,
  updatedAt: 2000,
});

// 阶段 2-B 清理：corruptedNegativeDuration fixture 已删除（其测试用例
// 也已删除，迁移路径不再过滤 legacy clip.transition）。

// ========== Tests ==========
describe('migrateTimelineData', () => {
  describe('版本检测', () => {
    it('无 version 字段按 v0 处理', () => {
      const result = migrateTimelineData(v0WithLegacyTransition);
      expect(result.version).toBe(CURRENT_TIMELINE_VERSION);
    });

    it('version=0 按 v0 处理', () => {
      const result = migrateTimelineData(v0Explicit);
      expect(result.version).toBe(CURRENT_TIMELINE_VERSION);
    });

    it('version=1 原样通过', () => {
      const result = migrateTimelineData(v1Normal);
      expect(result.version).toBe(1);
    });

    it('保留 createdAt / updatedAt', () => {
      const result = migrateTimelineData(v0WithLegacyTransition);
      expect(result.createdAt).toBe(1000);
      expect(result.updatedAt).toBe(2000);
    });

    it('缺少 createdAt / updatedAt 时用 Date.now() 兜底', () => {
      const result = migrateTimelineData(asRaw({ tracks: [] }));
      expect(result.createdAt).toBeGreaterThan(0);
      expect(result.updatedAt).toBeGreaterThan(0);
    });

    it('未知未来版本会抛错，避免伪装成当前版本', () => {
      expect(() => migrateTimelineData(asRaw({ version: 99, tracks: [] }))).toThrow(
        'Unsupported timeline version: 99'
      );
    });

    it('非整数 version 被向下取整', () => {
      const result = migrateTimelineData(asRaw({ version: 0.9, tracks: [] }));
      expect(result.version).toBe(CURRENT_TIMELINE_VERSION);
    });

    it('负数 version 按 v0 处理', () => {
      const result = migrateTimelineData(asRaw({ version: -1, tracks: [] }));
      expect(result.version).toBe(CURRENT_TIMELINE_VERSION);
    });

    it('NaN version 按 v0 处理', () => {
      const result = migrateTimelineData(asRaw({ version: NaN, tracks: [] }));
      expect(result.version).toBe(CURRENT_TIMELINE_VERSION);
    });

    it('Infinity version 按 v0 处理', () => {
      const result = migrateTimelineData(asRaw({ version: Infinity, tracks: [] }));
      expect(result.version).toBe(CURRENT_TIMELINE_VERSION);
    });
  });

  // 阶段 2-B 清理：v0 → v1 迁移路径已删除（Clip.transition 字段在产品未上线时
  // 整体移除，无存量数据需要迁移）。原 v0 → v1 三组测试一并删除。

  describe('v1 数据校验', () => {
    it('v1 正常数据保持 transitions 不变', () => {
      const result = migrateTimelineData(v1Normal);
      const track = result.tracks[0];
      expect(track.transitions!.length).toBe(1);
      expect(track.transitions![0].duration).toBe(1);
    });
  });

  describe('损坏数据修复', () => {
    it('fromClipId 不存在的 transition 被过滤（v1 加载边界直接净化）', () => {
      const result = migrateTimelineData(corruptedBadClipId);
      expect(result.tracks[0].transitions?.length ?? 0).toBe(0);
    });

    it('duration=0 的 transition 在 v1 加载边界被过滤', () => {
      const result = migrateTimelineData(corruptedZeroDuration);
      expect(result.tracks[0].transitions?.length ?? 0).toBe(0);
    });
  });

  describe('边界情况', () => {
    it('空 tracks', () => {
      const result = migrateTimelineData(asRaw({ version: 0, tracks: [], createdAt: 1, updatedAt: 2 }));
      expect(result.tracks).toEqual([]);
      expect(result.version).toBe(CURRENT_TIMELINE_VERSION);
    });

    it('缺少 tracks 字段', () => {
      const result = migrateTimelineData(asRaw({ version: 0 }));
      expect(result.tracks).toEqual([]);
    });

    it('完全空对象', () => {
      const result = migrateTimelineData(asRaw({}));
      expect(result.version).toBe(CURRENT_TIMELINE_VERSION);
      expect(result.tracks).toEqual([]);
    });
  });
});
