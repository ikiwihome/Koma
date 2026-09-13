import { describe, expect, it } from 'vitest';
import { resolveEpisodeEditorEntry } from './episodeEditorEntry';
import type { EpisodeStepProgress } from '../types';

describe('resolveEpisodeEditorEntry', () => {
  it('start-production always lands on the first registered step (script)', () => {
    const stepProgress: EpisodeStepProgress = {
      assets: 'completed',
      storyboard: 'pending',
      video: 'pending',
    };

    const entry = resolveEpisodeEditorEntry(stepProgress, { mode: 'start-production' });

    // 4 步流程下首步是 'script'；start-production 模式无脑跳到首步
    expect(entry.initialStep).toBe('script');
    expect(entry.stepProgress).toEqual(stepProgress);
  });

  it('resume-progress: jumps to first pending step when script is already written', () => {
    const stepProgress: EpisodeStepProgress = {
      assets: 'completed',
      storyboard: 'pending',
      video: 'pending',
    };

    // 剧本非空 → 'script' 视为已完成；assets 已完成 → 第一个未完成是 'storyboard'
    expect(
      resolveEpisodeEditorEntry(stepProgress, { scriptText: '剧本内容' }).initialStep,
    ).toBe('storyboard');
  });

  it('resume-progress: lands on script step when script is empty', () => {
    const stepProgress: EpisodeStepProgress = {
      assets: 'completed',
      storyboard: 'pending',
      video: 'pending',
    };

    // 剧本为空 → 'script' 派生为未完成 → 即使 assets 已完成也先回到剧本步
    expect(resolveEpisodeEditorEntry(stepProgress).initialStep).toBe('script');
    expect(resolveEpisodeEditorEntry(stepProgress, { scriptText: '' }).initialStep).toBe('script');
    expect(resolveEpisodeEditorEntry(stepProgress, { scriptText: '   ' }).initialStep).toBe('script');
  });

  it('resume-progress: empty progress + empty script → script step', () => {
    expect(resolveEpisodeEditorEntry().initialStep).toBe('script');
  });
});
