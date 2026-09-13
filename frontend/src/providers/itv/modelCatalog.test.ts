import { describe, expect, it } from 'vitest';
import type { ChannelModelDefinition } from '../channel/types';
import { getModelMaxReferenceImages } from './modelCatalog';

function model(defaults?: Record<string, unknown>): ChannelModelDefinition {
  return {
    id: 'test-model',
    label: 'Test Model',
    capabilities: ['video.image-to-video'],
    defaults,
  };
}

describe('getModelMaxReferenceImages', () => {
  it('优先用 model.defaults.maxReferenceImages 覆盖', () => {
    expect(getModelMaxReferenceImages(model({ maxReferenceImages: 9 }), 'grok2api-imagine-itv')).toBe(9);
  });

  it('忽略非法 maxReferenceImages 值，回退到 providerType 默认', () => {
    expect(getModelMaxReferenceImages(model({ maxReferenceImages: 0 }), 'grok2api-imagine-itv')).toBe(7);
    expect(getModelMaxReferenceImages(model({ maxReferenceImages: -3 }), 'koma-suihe-itv')).toBe(4);
    expect(getModelMaxReferenceImages(model({ maxReferenceImages: 'many' }), 'koma-suihe-itv')).toBe(4);
  });

  it('按 providerType 命中默认表', () => {
    expect(getModelMaxReferenceImages(model(), 'grok2api-imagine-itv')).toBe(7);
    expect(getModelMaxReferenceImages(model(), 'koma-suihe-itv')).toBe(4);
    expect(getModelMaxReferenceImages(model(), 'runway')).toBe(1);
    expect(getModelMaxReferenceImages(model(), 'kling')).toBe(2);
    expect(getModelMaxReferenceImages(model(), 'openai-compatible-tti')).toBe(6);
    expect(getModelMaxReferenceImages(model(), 'gemini-native-tti')).toBe(6);
  });

  it('未知 providerType 回退到 4', () => {
    expect(getModelMaxReferenceImages(model(), 'unknown-provider')).toBe(4);
    expect(getModelMaxReferenceImages(model(), undefined)).toBe(4);
  });

  it('model 为 null/undefined 时只看 providerType', () => {
    expect(getModelMaxReferenceImages(null, 'grok2api-imagine-itv')).toBe(7);
    expect(getModelMaxReferenceImages(undefined, 'gemini-native-tti')).toBe(6);
  });
});
