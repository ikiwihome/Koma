import { describe, expect, it } from 'vitest';
import { partitionScriptByEpisodeBoundaries } from './episodeBoundarySplit';
import type { EpisodeBoundary } from './episodeBoundaryDetector';

describe('partitionScriptByEpisodeBoundaries', () => {
  it('splits script into multiple episode segments', () => {
    const script = [
      '第一集',
      '第1集内容',
      '第二集',
      '第2集内容',
      '第三集',
      '第3集内容',
    ].join('\n');

    const boundaries: EpisodeBoundary[] = [
      { title: '第一集', marker: '第一集', start: 0, contentStart: 4, episodeNumber: 1 },
      { title: '第二集', marker: '第二集', start: 10, contentStart: 14, episodeNumber: 2 },
      { title: '第三集', marker: '第三集', start: 20, contentStart: 24, episodeNumber: 3 },
    ];

    const result = partitionScriptByEpisodeBoundaries(script, boundaries);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ episodeNumber: 1, title: '第一集' });
    expect(result[0]?.scriptText).toContain('第1集内容');
    expect(result[1]).toMatchObject({ episodeNumber: 2, title: '第二集' });
    expect(result[1]?.scriptText).toContain('第2集内容');
    expect(result[2]).toMatchObject({ episodeNumber: 3, title: '第三集' });
    expect(result[2]?.scriptText).toContain('第3集内容');
  });

  it('keeps leading preface content with the first episode', () => {
    const script = [
      '作品简介',
      '人物表',
      '第一集',
      '开场',
      '第二集',
      '转折',
    ].join('\n');

    const firstMarker = script.indexOf('第一集');
    const secondMarker = script.indexOf('第二集');

    const boundaries: EpisodeBoundary[] = [
      { title: '第一集', marker: '第一集', start: firstMarker, contentStart: firstMarker + 3, episodeNumber: 1 },
      { title: '第二集', marker: '第二集', start: secondMarker, contentStart: secondMarker + 3, episodeNumber: 2 },
    ];

    const result = partitionScriptByEpisodeBoundaries(script, boundaries);

    expect(result).toHaveLength(2);
    expect(result[0]?.scriptText.startsWith('作品简介')).toBe(true);
    expect(result[0]?.scriptText).toContain('第一集');
    expect(result[1]?.scriptText.startsWith('第二集')).toBe(true);
  });
});
