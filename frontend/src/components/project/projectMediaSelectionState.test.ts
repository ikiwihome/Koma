import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../../types';
import { buildProjectMediaCategoryState, PROJECT_MEDIA_BASE_REQUIREMENTS } from './projectMediaSelectionState';

// 使用现役 providerType（'koma-suihe-itv' / 'grok2api-imagine-itv' / 'gemini'）。
// 旧的 'runway' / 'vidu' 已下线，这里映射：
//  - runway 仅图生视频 → koma-suihe-itv (image-to-video only)
//  - vidu 全能力 → grok2api-imagine-itv (text/image/ref/start-end-to-video)
function createSettings(): AppSettings {
  return {
    channelConfigs: [
      {
        id: 'suihe-main',
        name: 'Koma 即梦',
        category: 'itv',
        providerType: 'koma-suihe-itv',
        providerConfig: { apiKey: 'suihe-key', baseUrl: 'https://komaapi.com' },
        defaultModelId: 'seedance-i2v-only',
        models: [
          {
            id: 'seedance-i2v-only',
            label: 'Seedance I2V',
            providerModelName: 'seedance-2.5-r',
            capabilities: ['video.image-to-video'],
          },
        ],
        enabled: true,
        source: 'builtin',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'grok-main',
        name: 'Koma 官方 Grok',
        category: 'itv',
        providerType: 'grok2api-imagine-itv',
        providerConfig: { apiKey: 'grok-key', baseUrl: 'https://komaapi.com' },
        defaultModelId: 'grok-imagine-video',
        models: [
          {
            id: 'grok-imagine-video',
            label: 'grok-imagine-video',
            providerModelName: 'grok-imagine-video',
            capabilities: [
              'video.text-to-video',
              'video.image-to-video',
              'video.reference-to-video',
              'video.start-end-to-video',
            ],
          },
        ],
        enabled: true,
        source: 'builtin',
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'gemini-main',
        name: 'Gemini',
        category: 'llm',
        providerType: 'gemini',
        providerConfig: { apiKey: 'gemini-key' },
        defaultModelId: 'llm-model-a',
        models: [
          {
            id: 'llm-model-a',
            label: 'llm-a',
            providerModelName: 'llm-a',
            capabilities: ['llm.chat'],
          },
        ],
        enabled: true,
        source: 'builtin',
        createdAt: 3,
        updatedAt: 3,
      },
    ],
    mediaDefaults: {
      itv: {
        channelId: 'suihe-main',
        modelId: 'seedance-i2v-only',
      },
      llm: {
        channelId: 'gemini-main',
        modelId: 'llm-model-a',
      },
    },
    promptTemplates: {},
  };
}

describe('projectMediaSelectionState', () => {
  it('按能力过滤项目候选模型', () => {
    const state = buildProjectMediaCategoryState({
      settings: createSettings(),
      category: 'itv',
      requirement: {
        capability: 'video.reference-to-video',
        label: '参考生视频',
      },
    });

    expect(state.options.length).toBeGreaterThan(0);
    expect(state.options.every(option => option.channelId === 'grok-main')).toBe(true);
    expect(state.fallbackLabel).toBe('Koma官方 Grok / grok-imagine-video');
    expect(state.usingFallback).toBe(true);
  });

  it('显式选择失效时会提示并回退到全局默认', () => {
    const state = buildProjectMediaCategoryState({
      settings: createSettings(),
      category: 'itv',
      explicitSelection: {
        channelId: 'suihe-main',
        modelId: 'seedance-i2v-only',
      },
      requirement: {
        capability: 'video.reference-to-video',
        label: '参考生视频',
      },
    });

    expect(state.explicitSupported).toBe(false);
    expect(state.usingFallback).toBe(true);
    expect(state.warning).toBe('当前项目选择的模型不支持参考生视频，已回退到全局默认');
    expect(state.fallbackLabel).toBe('Koma官方 Grok / grok-imagine-video');
  });

  it('基础项目能力要求会过滤到对应类别的真实模型', () => {
    const state = buildProjectMediaCategoryState({
      settings: createSettings(),
      category: 'llm',
      requirement: PROJECT_MEDIA_BASE_REQUIREMENTS.llm,
    });

    expect(state.options.length).toBeGreaterThan(0);
    expect(state.options.every(option => option.channelId === 'gemini-main')).toBe(true);
    expect(state.options.every(option => option.capabilities.includes('llm.chat'))).toBe(true);
    expect(state.fallbackLabel).toBe('Gemini / llm-a');
  });
});
