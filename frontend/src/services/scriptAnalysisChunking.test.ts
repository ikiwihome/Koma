import { describe, expect, it } from 'vitest';
import { buildChunkContextPrompt, splitScriptIntoChunks } from './scriptAnalysisChunking';

const LONG_SCRIPT = [
  '第一集',
  '1-1 客厅 日内',
  '人物：宁卓 许杰',
  '宁卓：抓住你了。',
  '',
  '1-2 走廊 夜内',
  '人物：陈红梅',
  '陈红梅：放手！',
  '',
  '2-1 天台 傍晚',
  '人物：宁卓 黑衣人',
  '黑衣人：别多管闲事。',
].join('\n');

describe('scriptAnalysisChunking', () => {
  it('按场次边界切块', () => {
    const chunks = splitScriptIntoChunks(LONG_SCRIPT);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].index).toBe(1);
    expect(chunks[0].total).toBe(chunks.length);
  });

  it('生成分块上下文提示词', () => {
    const [chunk] = splitScriptIntoChunks(LONG_SCRIPT);
    const prompt = buildChunkContextPrompt('分析以下剧本', chunk.index, chunk.total, ['宁卓', '许杰']);

    expect(prompt).toContain('当前处理第 1/');
    expect(prompt).toContain('已识别实体：宁卓、许杰');
  });
});
