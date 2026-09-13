import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character, Scene, Shot, StoredMediaAsset } from '../types';

vi.mock('../store/projectStore', () => ({
  getProjectPath: vi.fn(async () => '/tmp/koma/projects/project-1'),
  loadEpisodeShots: vi.fn(async () => []),
  loadProps: vi.fn(async () => []),
}));

vi.mock('../store/promptTemplates', () => ({
  resolvePromptTemplate: vi.fn(async (templateId: string, variables: Record<string, string>) => ({
    prompt: variables?.storyboardPrompt || variables?.gridPrompt || variables?.shotDescription || 'compiled image prompt',
    source: 'default',
    template: { id: templateId },
  })),
}));

vi.mock('../config/themePresets', () => ({
  getThemeStylePrefix: vi.fn(() => 'project-style'),
}));

vi.mock('../store/aiCallLogger', () => ({
  logTTICall: vi.fn(),
}));

vi.mock('../services/MediaGenerationService', () => ({
  mediaGenerationService: {
    generateImage: vi.fn(async ({ destPath }: { destPath: string }): Promise<StoredMediaAsset> => ({
      kind: 'image',
      localPath: destPath,
      createdAt: Date.now(),
    })),
  },
}));

function createShot(partial?: Partial<Shot>): Shot {
  return {
    id: 'shot-1',
    scriptLines: [{ id: 'line-1', text: '叶赎抬头看向窗外' }],
    shotType: 'medium',
    cameraMovement: 'static',
    duration: 6,
    imagePrompt: '叶赎抬头看向窗外',
    videoPrompt: '',
    characters: [],
    scenes: [],
    props: [],
    media: {},
    ...partial,
  };
}

describe('shotImageWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T10:00:00.000Z'));
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.111111)
      .mockReturnValueOnce(0.222222);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('多次生成同一分镜图片时使用唯一落盘路径，避免旧版本被覆盖成同一张图', async () => {
    const { shotImageWorkflow } = await import('./shotImageWorkflow');
    const { mediaGenerationService } = await import('../services/MediaGenerationService');
    const params = {
      projectId: 'project-1',
      episodeId: 'episode-1',
      shot: createShot(),
      characters: [] as Character[],
      scenes: [] as Scene[],
    };

    const first = await shotImageWorkflow(params);
    const second = await shotImageWorkflow(params);

    expect(first.localPath).toMatch(/\/assets\/shots\/shot-1\/images\/\d+_[a-z0-9]+\.png$/);
    expect(second.localPath).toMatch(/\/assets\/shots\/shot-1\/images\/\d+_[a-z0-9]+\.png$/);
    expect(first.localPath).not.toBe(second.localPath);
    expect(first.localPath).not.toContain('/assets/shots/shot-1/image.png');
    expect(mediaGenerationService.generateImage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(mediaGenerationService.generateImage).mock.calls[0][0].destPath)
      .toBe(first.localPath);
    expect(vi.mocked(mediaGenerationService.generateImage).mock.calls[1][0].destPath)
      .toBe(second.localPath);
  });
});
