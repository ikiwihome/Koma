import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character, Prop, StoredMediaAsset } from '../types';

vi.mock('../store/settings/mediaConfig', () => ({
  getActiveITVConfig: vi.fn(),
}));

vi.mock('../providers', () => ({
  getProjectITVProvider: vi.fn(),
}));

vi.mock('../services/MediaGenerationService', () => ({
  mediaGenerationService: {
    generateImage: vi.fn(),
    generateVideo: vi.fn(),
  },
}));

vi.mock('../store/promptTemplates', () => ({
  resolvePromptTemplate: vi.fn(),
}));

vi.mock('../config/themePresets', () => ({
  getThemeStylePrefix: vi.fn(() => 'theme-style'),
  getThemeStylePrefixAsync: vi.fn(async () => 'theme-style'),
}));

function createImageAsset(remoteUrl: string): StoredMediaAsset {
  return {
    kind: 'image',
    remoteUrl,
    createdAt: 1,
  };
}

function createCharacter(partial?: Partial<Character>): Character {
  return {
    id: 'char-1',
    name: '主角A',
    role: 'protagonist',
    prompt: '坚定的女战士',
    media: {},
    ...partial,
  };
}

function createProp(partial?: Partial<Prop>): Prop {
  return {
    id: 'prop-1',
    name: '神秘盒子',
    prompt: '古老金属盒',
    media: {},
    ...partial,
  };
}

describe('asset preview video workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('角色预览视频会编译图生视频标准请求并归一渠道配置时长', async () => {
    const { generateCharacterPreviewVideo } = await import('./characterAssetWorkflow');
    const { resolvePromptTemplate } = await import('../store/promptTemplates');
    const { mediaGenerationService } = await import('../services/MediaGenerationService');
    const { getActiveITVConfig } = await import('../store/settings/mediaConfig');

    vi.mocked(getActiveITVConfig).mockResolvedValue({
      defaultDuration: 15,
    } as any);

    vi.mocked(resolvePromptTemplate).mockImplementation(async (_templateId, variables: any) => ({
      prompt: `[${variables.stylePrefix}] ${variables.characterName}: ${variables.action}`,
      source: 'custom',
      template: { id: 'itv_character_motion' },
    } as any));
    vi.mocked(mediaGenerationService.generateVideo).mockResolvedValue({
      kind: 'video',
      localPath: '/tmp/character-preview.mp4',
      providerTaskId: 'task-char-1',
      createdAt: 1,
    } as any);

    const character = createCharacter({
      media: {
        costumePhoto: createImageAsset('https://cdn.example.com/char.png'),
      },
    });

    const result = await generateCharacterPreviewVideo({
      projectId: 'project-1',
      character,
      styleSnapshot: { ttiStylePrefix: '电影风格' },
      itvSelection: 'vidu-main::vidu-model-a',
    });

    expect(result.success).toBe(true);
    expect(getActiveITVConfig).toHaveBeenCalledWith('vidu-main::vidu-model-a');
    expect(resolvePromptTemplate).toHaveBeenCalledWith(
      'itv_character_motion',
      expect.objectContaining({
        stylePrefix: '电影风格',
        characterName: '主角A',
      }),
    );
    expect(mediaGenerationService.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerRef: expect.objectContaining({
          ownerType: 'character',
          ownerId: 'char-1',
          slot: 'previewVideo',
        }),
        request: expect.objectContaining({
          capability: 'video.image-to-video',
          primaryImage: 'https://cdn.example.com/char.png',
          options: expect.objectContaining({
            duration: 16,
            aspectRatio: '9:16',
          }),
        }),
        itvSelection: 'vidu-main::vidu-model-a',
      }),
    );
  });

  it('道具预览视频从渠道配置读取时长并透传', async () => {
    const { generatePropPreviewVideo } = await import('./scenePropAssetWorkflow');
    const { resolvePromptTemplate } = await import('../store/promptTemplates');
    const { mediaGenerationService } = await import('../services/MediaGenerationService');
    const { getActiveITVConfig } = await import('../store/settings/mediaConfig');

    vi.mocked(getActiveITVConfig).mockResolvedValue({
      defaultDuration: 12,
    } as any);

    vi.mocked(resolvePromptTemplate).mockResolvedValue({
      prompt: '道具展示视频提示词',
      source: 'custom',
      template: { id: 'itv_prop_motion' },
    } as any);
    vi.mocked(mediaGenerationService.generateVideo).mockResolvedValue({
      kind: 'video',
      localPath: '/tmp/prop-preview.mp4',
      providerTaskId: 'task-prop-1',
      createdAt: 1,
    } as any);

    const result = await generatePropPreviewVideo({
      projectId: 'project-1',
      prop: createProp({
        media: {
          previewImage: createImageAsset('https://cdn.example.com/prop.png'),
        },
      }),
      styleSnapshot: { ttiStylePrefix: '写实工业风' },
      itvSelection: 'runway-main::runway-model-a',
    });

    expect(result.success).toBe(true);
    expect(getActiveITVConfig).toHaveBeenCalledWith('runway-main::runway-model-a');
    expect(mediaGenerationService.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerRef: expect.objectContaining({
          ownerType: 'prop',
          ownerId: 'prop-1',
          slot: 'previewVideo',
        }),
        request: expect.objectContaining({
          capability: 'video.image-to-video',
          primaryImage: 'https://cdn.example.com/prop.png',
          options: expect.objectContaining({
            duration: 12,
            aspectRatio: '1:1',
          }),
        }),
        itvSelection: 'runway-main::runway-model-a',
      }),
    );
  });

  it('当 getActiveITVConfig 抛错或返回无效值时，应兜底使用 10 秒时长', async () => {
    const { generateCharacterPreviewVideo } = await import('./characterAssetWorkflow');
    const { resolvePromptTemplate } = await import('../store/promptTemplates');
    const { mediaGenerationService } = await import('../services/MediaGenerationService');
    const { getActiveITVConfig } = await import('../store/settings/mediaConfig');

    // 情况 1: getActiveITVConfig 抛错
    vi.mocked(getActiveITVConfig).mockRejectedValueOnce(new Error('Config error'));
    vi.mocked(resolvePromptTemplate).mockResolvedValue({
      prompt: 'fallback test prompt',
      source: 'custom',
      template: { id: 'itv_character_motion' },
    } as any);
    vi.mocked(mediaGenerationService.generateVideo).mockResolvedValue({
      kind: 'video',
      localPath: '/tmp/fallback-1.mp4',
    } as any);

    const character = createCharacter({
      media: { costumePhoto: createImageAsset('https://cdn.example.com/char.png') },
    });

    const result1 = await generateCharacterPreviewVideo({
      projectId: 'project-1',
      character,
      itvSelection: 'error-channel',
    });

    expect(result1.success).toBe(true);
    expect(mediaGenerationService.generateVideo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          options: expect.objectContaining({ duration: 10 }),
        }),
      }),
    );

    // 情况 2: getActiveITVConfig 返回无效值 (NaN)
    vi.mocked(getActiveITVConfig).mockResolvedValueOnce({
      defaultDuration: NaN,
    } as any);

    const result2 = await generateCharacterPreviewVideo({
      projectId: 'project-1',
      character,
      itvSelection: 'nan-channel',
    });

    expect(result2.success).toBe(true);
    expect(mediaGenerationService.generateVideo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          options: expect.objectContaining({ duration: 10 }),
        }),
      }),
    );
  });
});
