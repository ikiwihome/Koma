import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../../types';
import {
  buildITVProviderConfigFromContext,
  getDefaultMediaSelection,
  listCapabilityFallbackCandidates,
  listConfiguredModelSelectOptions,
  resolveConfiguredChannelModel,
  resolveConfiguredChannelModelWithCapabilityFallback,
} from './resolver';

function createSettings(): AppSettings {
  return {
    channelConfigs: [
      {
        id: 'runway-main',
        name: 'Runway',
        category: 'itv',
        providerType: 'grok2api-imagine-itv',
        providerConfig: { apiKey: 'runway-key' },
        defaultModelId: 'runway-model-a',
        models: [
          {
            id: 'runway-model-a',
            label: 'runway-a',
            providerModelName: 'runway-a',
            capabilities: ['video.image-to-video'],
          },
        ],
        enabled: true,
        source: 'builtin',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'vidu-main',
        name: 'Vidu',
        category: 'itv',
        providerType: 'koma-suihe-itv',
        providerConfig: {
          apiKey: 'vidu-key',
          baseUrl: 'https://vidu.example.com',
          defaultDuration: 5,
          defaultResolution: '720p',
        },
        defaultModelId: 'vidu-model-a',
        models: [
          {
            id: 'vidu-model-a',
            label: 'vidu-a',
            providerModelName: 'vidu-a',
            capabilities: [
              'video.text-to-video',
              'video.image-to-video',
              'video.reference-to-video',
              'video.start-end-to-video',
            ],
            defaults: {
              defaultDuration: 4,
              defaultResolution: '360p',
            },
          },
        ],
        enabled: true,
        source: 'builtin',
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'plugin-tti',
        name: 'Plugin TTI',
        category: 'tti',
        providerType: 'plugin-tti-provider',
        providerConfig: { apiKey: 'plugin-key' },
        defaultModelId: 'plugin-image-pro',
        models: [
          {
            id: 'plugin-image-pro',
            label: 'Plugin Image Pro',
            providerModelName: 'plugin-image-pro',
            capabilities: ['image.text-to-image', 'image.image-to-image'],
          },
        ],
        enabled: true,
        source: 'plugin',
        pluginId: 'com.example.plugin',
        createdAt: 3,
        updatedAt: 3,
      },
    ],
    mediaDefaults: {
      itv: {
        channelId: 'runway-main',
        modelId: 'runway-model-a',
      },
    },
    promptTemplates: {},
  };
}

describe('channel resolver', () => {
  it('能力不匹配时会从默认模型回退到可用模型', () => {
    const selection = getDefaultMediaSelection(
      createSettings(),
      'itv',
      'video.reference-to-video',
    );

    expect(selection).toEqual({
      channelId: 'vidu-main',
      modelId: 'vidu-model-a',
    });
  });

  it('按能力解析模型时会阻止不支持的模型', () => {
    const settings = createSettings();

    expect(resolveConfiguredChannelModel(
      settings,
      'itv',
      { channelId: 'runway-main', modelId: 'runway-model-a' },
      'video.reference-to-video',
    )).toBeUndefined();

    const resolved = resolveConfiguredChannelModel(
      settings,
      'itv',
      { channelId: 'vidu-main', modelId: 'vidu-model-a' },
      'video.reference-to-video',
    );

    expect(resolved?.definition.id).toBe('koma-suihe-itv');
    expect(resolved?.model.id).toBe('vidu-model-a');
    expect(resolved?.model.capabilities).toContain('video.reference-to-video');
  });

  it('能力回退解析会保留兼容模型的实际选择键', () => {
    const resolved = resolveConfiguredChannelModelWithCapabilityFallback(
      createSettings(),
      'itv',
      { channelId: 'runway-main', modelId: 'runway-model-a' },
      'video.reference-to-video',
    );

    expect(resolved.usedFallback).toBe(true);
    expect(resolved.effectiveSelectionKey).toBe('vidu-main::vidu-model-a');
    expect(resolved.context?.channelConfig.id).toBe('vidu-main');
    expect(resolved.context?.model.id).toBe('vidu-model-a');
  });

  it('当选择的模型 ID 已失效时，会优先回退到渠道默认模型而不是列表首项', () => {
    const settings = createSettings();
    settings.channelConfigs[1].defaultModelId = 'vidu-model-b';
    settings.channelConfigs[1].models = [
      {
        id: 'vidu-model-a',
        label: 'vidu-a',
        providerModelName: 'vidu-a',
        capabilities: ['video.image-to-video'],
      },
      {
        id: 'vidu-model-b',
        label: 'vidu-b',
        providerModelName: 'vidu-b',
        capabilities: ['video.image-to-video'],
      },
    ];

    const resolved = resolveConfiguredChannelModel(
      settings,
      'itv',
      { channelId: 'vidu-main', modelId: 'missing-model-id' },
      'video.image-to-video',
    );

    expect(resolved?.model.id).toBe('vidu-model-b');
  });

  it('按能力过滤模型选项时只暴露真实支持的模型', () => {
    const options = listConfiguredModelSelectOptions(
      createSettings(),
      'itv',
      'video.start-end-to-video',
    );

    expect(options.length).toBeGreaterThan(0);
    expect(options.every(option => option.channelId === 'vidu-main')).toBe(true);
    expect(options.every(option => option.capabilities.includes('video.start-end-to-video'))).toBe(true);
  });

  it('Provider fallback 候选会优先保留当前选择并过滤能力不匹配项', () => {
    const settings = createSettings();
    settings.channelConfigs.push({
      id: 'kling-main',
      name: 'Kling',
      category: 'itv',
      providerType: 'plugin-itv-mock',
      providerConfig: { apiKey: 'kling-key' },
      defaultModelId: 'kling-model-a',
      models: [
        {
          id: 'kling-model-a',
          label: 'kling-a',
          providerModelName: 'kling-a',
          capabilities: ['video.image-to-video'],
        },
      ],
      enabled: true,
      // 内置 ITV registry 收敛后只保留 grok2api-imagine-itv / koma-suihe-itv 两类，
      // 这里用 source: 'plugin' 让 getChannelDefinitionForConfig 走插件分支，避免
      // builtin 分支对未注册 providerType 返回 undefined。
      source: 'plugin',
      pluginId: 'com.example.itv.mock',
      createdAt: 4,
      updatedAt: 4,
    });

    const candidates = listCapabilityFallbackCandidates(
      settings,
      'itv',
      'video.image-to-video',
      'kling-main::kling-model-a',
    );

    expect(candidates.map(item => item.selectionKey)).toEqual([
      'kling-main::kling-model-a',
      'runway-main::runway-model-a',
      'vidu-main::vidu-model-a',
    ]);
    expect(candidates.every(item => item.capabilities.includes('video.image-to-video'))).toBe(true);
  });

  it('插件渠道也能走统一模型解析入口', () => {
    const resolved = resolveConfiguredChannelModel(
      createSettings(),
      'tti',
      { channelId: 'plugin-tti', modelId: 'plugin-image-pro' },
      'image.image-to-image',
    );

    expect(resolved?.channelConfig.source).toBe('plugin');
    expect(resolved?.definition.runtimeProviderType).toBe('plugin-tti-provider');
    expect(resolved?.model.id).toBe('plugin-image-pro');
    expect(resolved?.model.capabilities).toContain('image.image-to-image');
  });

  it('模型级默认值会覆盖到 ITV provider 运行时配置', () => {
    const resolved = resolveConfiguredChannelModel(
      createSettings(),
      'itv',
      { channelId: 'vidu-main', modelId: 'vidu-model-a' },
      'video.text-to-video',
    );

    expect(resolved).toBeTruthy();

    const config = buildITVProviderConfigFromContext(resolved!);
    expect(config.defaultDuration).toBe(4);
    expect(config.defaultResolution).toBe('360p');
    expect(config.modelName).toBe('vidu-a');
  });
});
