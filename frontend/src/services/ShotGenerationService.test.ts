import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shot, StoredMediaAsset } from '../types';

vi.mock('../store/projectStore', () => ({
  loadEpisodeShots: vi.fn(),
}));

vi.mock('../workflow/shotImageWorkflow', () => ({
  shotImageWorkflow: vi.fn(),
}));

vi.mock('./taskRunner', () => ({
  runWithTask: vi.fn(async (spec: any) => ({
    taskId: 'task-batch-image',
    result: await spec.execute({
      progress: vi.fn(),
      setRemoteTaskId: vi.fn(),
      setMetadata: vi.fn(),
      taskId: 'task-batch-image',
      task: {},
    }),
    persisted: undefined,
  })),
}));

function createShot(id: string): Shot {
  return {
    id,
    scriptLines: [{ id: `${id}-line-1`, text: `分镜 ${id}` }],
    shotType: 'medium',
    cameraMovement: 'static',
    duration: 6,
    imagePrompt: `画面 ${id}`,
    videoPrompt: '',
    characters: [],
    scenes: [],
    props: [],
    media: {},
  };
}

function createImageAsset(id: string): StoredMediaAsset {
  return {
    kind: 'image',
    localPath: `/tmp/${id}.png`,
    createdAt: 1,
  };
}

describe('batchGenerateShotImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('单分镜生图优先使用调用方传入的最新 shot 快照，避免读取旧存储提示词', async () => {
    const { generateShotImage } = await import('./ShotGenerationService');
    const { loadEpisodeShots } = await import('../store/projectStore');
    const { shotImageWorkflow } = await import('../workflow/shotImageWorkflow');

    vi.mocked(loadEpisodeShots).mockResolvedValue([
      { ...createShot('shot-1'), imagePrompt: '旧提示词' },
    ]);
    vi.mocked(shotImageWorkflow).mockResolvedValueOnce(createImageAsset('shot-1'));

    const latestShot = { ...createShot('shot-1'), imagePrompt: '输入框最新提示词 @storyboard_anchor' };
    await generateShotImage(
      'project-1',
      'episode-1',
      'shot-1',
      [],
      [],
      'tti-main::model',
      { shotSnapshot: latestShot },
    );

    expect(shotImageWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      shot: latestShot,
    }));
    expect(loadEpisodeShots).not.toHaveBeenCalled();
  });

  it('单个分镜生图失败时继续其它分镜，并逐项触发完成回调', async () => {
    const { batchGenerateShotImages } = await import('./ShotGenerationService');
    const { loadEpisodeShots } = await import('../store/projectStore');
    const { shotImageWorkflow } = await import('../workflow/shotImageWorkflow');

    vi.mocked(loadEpisodeShots).mockResolvedValue([
      createShot('shot-1'),
      createShot('shot-2'),
    ]);
    vi.mocked(shotImageWorkflow)
      .mockRejectedValueOnce(new Error('第一张失败'))
      .mockResolvedValueOnce(createImageAsset('shot-2'));

    const onItemComplete = vi.fn();
    const result = await batchGenerateShotImages(
      'project-1',
      'episode-1',
      ['shot-1', 'shot-2'],
      [],
      [],
      'tti-main::model',
      { onItemComplete },
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ shotId: 'shot-1', success: false, error: '第一张失败' });
    expect(result[1]).toMatchObject({ shotId: 'shot-2', success: true });
    expect(result[1].asset?.localPath).toBe('/tmp/shot-2.png');
    expect(shotImageWorkflow).toHaveBeenCalledTimes(2);
    expect(onItemComplete).toHaveBeenCalledTimes(2);
    expect(onItemComplete.mock.calls.map(call => call[0].shotId).sort()).toEqual(['shot-1', 'shot-2']);
    expect(onItemComplete.mock.calls.map(call => call[0].success).sort()).toEqual([false, true]);
  });
});
