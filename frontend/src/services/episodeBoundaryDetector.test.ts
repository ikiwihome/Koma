import { describe, expect, it } from 'vitest';
import { detectExplicitEpisodeBoundaries } from './episodeBoundaryDetector';

describe('detectExplicitEpisodeBoundaries', () => {
  it('detects Arabic numeral episodes (第1集 ~ 第103集)', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 103; i++) {
      lines.push(`第${i}集`);
      lines.push(`第${i}集的正文内容。`);
      lines.push('');
    }
    const script = lines.join('\n');
    const result = detectExplicitEpisodeBoundaries(script);
    expect(result).toHaveLength(103);
    expect(result[0].episodeNumber).toBe(1);
    expect(result[102].episodeNumber).toBe(103);
  });

  it('detects Chinese numeral episodes', () => {
    const script = [
      '第一集', '内容。', '',
      '第二集', '内容。', '',
      '第十集', '内容。', '',
      '第四十一集', '内容。', '',
      '第一百零三集', '内容。',
    ].join('\n');
    const result = detectExplicitEpisodeBoundaries(script);
    expect(result).toHaveLength(5);
    expect(result.map(r => r.episodeNumber)).toEqual([1, 2, 10, 41, 103]);
  });

  it('detects episodes with space-separated titles', () => {
    const script = [
      '第1集 初次见面', '内容。', '',
      '第2集 重逢', '内容。', '',
      '第3集 冲突爆发', '内容。',
    ].join('\n');
    const result = detectExplicitEpisodeBoundaries(script);
    expect(result).toHaveLength(3);
    expect(result[0].episodeNumber).toBe(1);
    expect(result[0].title).toBe('第1集 初次见面');
  });

  it('detects episodes with colon/dash separated titles', () => {
    const script = [
      '第1集：命运之始', '内容。', '',
      '第2集—风云再起', '内容。', '',
      '第3集-谜底揭晓', '内容。',
    ].join('\n');
    const result = detectExplicitEpisodeBoundaries(script);
    expect(result).toHaveLength(3);
  });

  it('detects episodes with bracket wrappers', () => {
    const script = [
      '【第1集】', '内容。', '',
      '【第2集】重逢', '内容。', '',
      '【第3集】', '内容。',
    ].join('\n');
    const result = detectExplicitEpisodeBoundaries(script);
    expect(result).toHaveLength(3);
    expect(result[0].episodeNumber).toBe(1);
  });

  it('detects episodes with parenthetical suffixes', () => {
    const script = [
      '第1集（上）', '内容。', '',
      '第2集（下）', '内容。',
    ].join('\n');
    const result = detectExplicitEpisodeBoundaries(script);
    expect(result).toHaveLength(2);
    expect(result[0].episodeNumber).toBe(1);
  });

  it('does not match content lines that start with episode-like text', () => {
    const script = [
      '第一集', '第一集场景介绍开始。', '',
      '第二集', '第二集正文开始。',
    ].join('\n');
    const result = detectExplicitEpisodeBoundaries(script);
    // Should only detect 2 episodes, not 4
    expect(result).toHaveLength(2);
    expect(result[0].episodeNumber).toBe(1);
    expect(result[1].episodeNumber).toBe(2);
  });

  it('detects episodes with Chinese comma separator', () => {
    const script = [
      '第1集、初识', '内容。', '',
      '第2集、重逢', '内容。',
    ].join('\n');
    const result = detectExplicitEpisodeBoundaries(script);
    expect(result).toHaveLength(2);
  });
});
