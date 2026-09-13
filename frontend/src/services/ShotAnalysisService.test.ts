import { describe, expect, it } from 'vitest';
import { buildShotCoverageReport, normalizeShotDuration, splitScriptForShotAnalysis } from './ShotAnalysisService';

const ALLOWED_DURATIONS = [6, 10, 12, 16, 20];

describe('normalizeShotDuration', () => {
  it('保留已在白名单内的 duration', () => {
    for (const duration of ALLOWED_DURATIONS) {
      expect(normalizeShotDuration(duration)).toBe(duration);
    }
  });

  it('无效或缺失 duration 默认回落到 10 秒', () => {
    expect(normalizeShotDuration(undefined)).toBe(10);
    expect(normalizeShotDuration(null)).toBe(10);
    expect(normalizeShotDuration(0)).toBe(10);
    expect(normalizeShotDuration(-1)).toBe(10);
    expect(normalizeShotDuration(Number.NaN)).toBe(10);
    expect(normalizeShotDuration('abc')).toBe(10);
    expect(normalizeShotDuration('-1秒')).toBe(10);
  });

  it('支持模型返回的数字字符串和带单位字符串，并归一到白名单', () => {
    expect(normalizeShotDuration('10')).toBe(10);
    expect(normalizeShotDuration(' 12 秒 ')).toBe(12);
    expect(normalizeShotDuration('8秒')).toBe(10);
    expect(normalizeShotDuration('10s')).toBe(10);
    expect(normalizeShotDuration('约 18 秒')).toBe(20);
  });

  it('将近似值归一到最近合法时长，等距时取较大值', () => {
    expect(normalizeShotDuration(4)).toBe(6);
    expect(normalizeShotDuration(8)).toBe(10);
    expect(normalizeShotDuration(15)).toBe(16);
    expect(normalizeShotDuration(18)).toBe(20);
  });
});

describe('buildShotCoverageReport', () => {
  it('reports full coverage when shot scriptLines preserve all script units', () => {
    const report = buildShotCoverageReport(
      '沈鹿睁开眼。她看向窗帘缝隙。灰尘在光里浮动。',
      [
        { scriptLines: [{ id: 'a', text: '沈鹿睁开眼。她看向窗帘缝隙。' }] },
        { scriptLines: [{ id: 'b', text: '灰尘在光里浮动。' }] },
      ],
    );

    expect(report.coverageRatio).toBe(1);
    expect(report.missingSamples).toEqual([]);
  });

  it('samples missing script units when LLM drops middle details', () => {
    const report = buildShotCoverageReport(
      '沈鹿睁开眼。她看向窗帘缝隙。灰尘在光里浮动。',
      [{ scriptLines: [{ id: 'a', text: '沈鹿睁开眼。' }] }],
    );

    expect(report.coverageRatio).toBeLessThan(1);
    expect(report.missingSamples).toContain('她看向窗帘缝隙');
    expect(report.missingSamples).toContain('灰尘在光里浮动');
  });
});

describe('splitScriptForShotAnalysis', () => {
  it('keeps short scripts as one chunk', () => {
    expect(splitScriptForShotAnalysis('短剧本。')).toEqual(['短剧本。']);
  });

  it('splits long scripts into sentence-bound chunks', () => {
    const script = Array.from({ length: 400 }, (_, i) => `第${i}句发生了新的动作。`).join('');
    const chunks = splitScriptForShotAnalysis(script);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(script);
    expect(chunks.every(chunk => chunk.length <= 2600)).toBe(true);
  });
});
