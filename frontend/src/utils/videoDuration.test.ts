import { describe, expect, it } from 'vitest';
import {
  ALLOWED_VIDEO_DURATIONS,
  normalizeVideoDurationSeconds,
} from './videoDuration';

describe('videoDuration', () => {
  it('只暴露 AI 视频允许的五档时长', () => {
    expect(ALLOWED_VIDEO_DURATIONS).toEqual([6, 10, 12, 16, 20]);
  });

  it('将缺失或非法输入归一到 fallback，并且 fallback 也会归一', () => {
    expect(normalizeVideoDurationSeconds(undefined)).toBe(10);
    expect(normalizeVideoDurationSeconds(null)).toBe(10);
    expect(normalizeVideoDurationSeconds('')).toBe(10);
    expect(normalizeVideoDurationSeconds('abc')).toBe(10);
    expect(normalizeVideoDurationSeconds(Number.NaN)).toBe(10);
    expect(normalizeVideoDurationSeconds(undefined, 18)).toBe(20);
    expect(normalizeVideoDurationSeconds('abc', '7')).toBe(6);
  });

  it('支持数字和字符串输入，并归一到最近允许值', () => {
    expect(normalizeVideoDurationSeconds(4)).toBe(6);
    expect(normalizeVideoDurationSeconds('6')).toBe(6);
    expect(normalizeVideoDurationSeconds('10.2')).toBe(10);
    expect(normalizeVideoDurationSeconds('12 秒')).toBe(12);
    expect(normalizeVideoDurationSeconds('8秒')).toBe(10);
    expect(normalizeVideoDurationSeconds(13)).toBe(12);
    expect(normalizeVideoDurationSeconds('17')).toBe(16);
  });

  it('边界外输入夹到最近档位，平局固定选择较大档位', () => {
    expect(normalizeVideoDurationSeconds(-1)).toBe(10);
    expect(normalizeVideoDurationSeconds(0)).toBe(10);
    expect(normalizeVideoDurationSeconds(1)).toBe(6);
    expect(normalizeVideoDurationSeconds(600)).toBe(20);
    expect(normalizeVideoDurationSeconds(8)).toBe(10);
    expect(normalizeVideoDurationSeconds(18)).toBe(20);
  });
});
