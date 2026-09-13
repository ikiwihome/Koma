import { describe, expect, it } from 'vitest';
import {
  detectExplicitEpisodeAnalysis,
  materializeEpisodeSplit,
  type SplitAnalysis,
} from './episodeSplitUtils';

const SAMPLE_SCRIPT = [
  '第一幕',
  '主角登场，交代任务，发现第一条线索，和同伴产生分歧。',
  '两人继续追查，来到新的地点，确认反派已经提前布局。',
  '他们决定暂时隐藏身份，准备下一步行动。',
  '',
  '第二幕',
  '冲突升级，线索出现，新的证人被卷入其中，局势开始失控。',
  '主角必须在时间压力下做出选择，并付出实际代价。',
  '第二轮调查揭开更深层的秘密，也让队伍内部关系更加紧张。',
  '',
  '第三幕',
  '真相揭晓，完成收束，主角和反派正面对峙。',
  '之前埋下的伏笔全部回收，关键人物完成转变。',
  '故事在高潮后收束，并留出下一阶段的发展空间。',
].join('\n');

const EXPLICIT_EPISODE_SCRIPT = [
  '第一集',
  '第一集正文开始。',
  '',
  '第二集',
  '第二集正文开始。',
  '',
  '第三集',
  '第三集正文开始。',
].join('\n');

const SCENE_NUMBER_SCRIPT = [
  '1-1 客厅 日内',
  '第一集场景。',
  '',
  '1-2 卧室 夜内',
  '第一集第二场。',
  '',
  '2-1 天台 日外',
  '第二集场景。',
  '',
  '3-1 医院 走廊',
  '第三集场景。',
].join('\n');

const ENGLISH_EPISODE_SCRIPT = [
  'Episode 1 - Arrival',
  '第一集英文标题格式。',
  '',
  'EP 2: Conflict',
  '第二集英文缩写格式。',
  '',
  'S1E3 Finale',
  '第三集季集格式。',
].join('\n');

const FULLWIDTH_EPISODE_SCRIPT = [
  '第１２集：迷雾重重',
  '第十二集正文。',
  '',
  '第１３集：真相初现',
  '第十三集正文。',
].join('\n');

describe('materializeEpisodeSplit', () => {
  it('根据 marker 和 position 切分剧本', () => {
    const analysis: SplitAnalysis = {
      suggestedCount: 3,
      splitPoints: [
        { position: SAMPLE_SCRIPT.indexOf('第二幕'), marker: '第二幕', reason: '第一集收束' },
        { position: SAMPLE_SCRIPT.indexOf('第三幕'), marker: '第三幕', reason: '第二集收束' },
      ],
      episodeBlueprints: [
        { title: '第1集', summary: '任务开始' },
        { title: '第2集', summary: '冲突升级' },
        { title: '第3集', summary: '真相揭晓' },
      ],
      reasoning: '按三幕结构拆分',
    };

    const results = materializeEpisodeSplit(SAMPLE_SCRIPT, analysis);

    expect(results).toHaveLength(3);
    expect(results[0].scriptText).toContain('第一幕');
    expect(results[0].scriptText).not.toContain('第二幕');
    expect(results[1].scriptText.startsWith('第二幕')).toBe(true);
    expect(results[2].scriptText.startsWith('第三幕')).toBe(true);
  });

  it('在剧集标题或摘要不完整时抛错', () => {
    const analysis: SplitAnalysis = {
      suggestedCount: 2,
      splitPoints: [
        { position: SAMPLE_SCRIPT.indexOf('第二幕'), marker: '第二幕', reason: '转折' },
      ],
      episodeBlueprints: [
        { title: '第1集', summary: '任务开始' },
      ],
      reasoning: '缺少第二集摘要',
    };

    expect(() => materializeEpisodeSplit(SAMPLE_SCRIPT, analysis)).toThrow('剧集标题或摘要数量不完整');
  });

  it('优先识别原文中的分集标题', () => {
    const analysis = detectExplicitEpisodeAnalysis(EXPLICIT_EPISODE_SCRIPT);

    expect(analysis?.source).toBe('explicit');
    expect(analysis?.suggestedCount).toBe(3);
    expect(analysis?.episodeBlueprints[1].title).toBe('第二集');

    const results = materializeEpisodeSplit(EXPLICIT_EPISODE_SCRIPT, analysis as SplitAnalysis);
    expect(results).toHaveLength(3);
    expect(results[1].scriptText.startsWith('第二集')).toBe(true);
  });

  it('在缺少标题行时按场次编号识别剧集', () => {
    const analysis = detectExplicitEpisodeAnalysis(SCENE_NUMBER_SCRIPT);

    expect(analysis?.source).toBe('explicit');
    expect(analysis?.suggestedCount).toBe(3);
    expect(analysis?.episodeBlueprints[0].title).toBe('第1集');
    expect(analysis?.episodeBlueprints[2].title).toBe('第3集');
  });

  it('支持英文 Episode 和季集标题格式', () => {
    const analysis = detectExplicitEpisodeAnalysis(ENGLISH_EPISODE_SCRIPT);

    expect(analysis?.source).toBe('explicit');
    expect(analysis?.suggestedCount).toBe(3);
    expect(analysis?.episodeBlueprints[0].title).toBe('Episode 1 - Arrival');
    expect(analysis?.episodeBlueprints[2].title).toBe('S1E3 Finale');
  });

  it('支持全角数字的集标题', () => {
    const analysis = detectExplicitEpisodeAnalysis(FULLWIDTH_EPISODE_SCRIPT);

    expect(analysis?.source).toBe('explicit');
    expect(analysis?.suggestedCount).toBe(2);
    expect(analysis?.episodeBlueprints[0].title).toBe('第１２集：迷雾重重');
  });
});
