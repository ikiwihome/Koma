import { describe, expect, it } from 'vitest';
import { getBuiltInChannelDefinition, listBuiltInChannelDefinitions } from './catalog';

describe('channel catalog (itv)', () => {
  it('does not hardcode upstream model lists for built-in ITV channels (models live in settings)', () => {
    const itvChannels = listBuiltInChannelDefinitions('itv');
    expect(itvChannels.length).toBeGreaterThan(0);
    expect(itvChannels.every(channel => channel.models.length === 0)).toBe(true);
  });

  it('declares provider template metadata for grok2api-imagine-itv channel', () => {
    const channel = getBuiltInChannelDefinition('grok2api-imagine-itv');
    expect(channel).toBeTruthy();
    expect(channel?.category).toBe('itv');
    expect(channel?.id).toBe('grok2api-imagine-itv');
    expect(channel?.models.length).toBe(0);
  });

  it('declares provider template metadata for koma-suihe-itv channel', () => {
    const channel = getBuiltInChannelDefinition('koma-suihe-itv');
    expect(channel).toBeTruthy();
    expect(channel?.category).toBe('itv');
    expect(channel?.id).toBe('koma-suihe-itv');
    expect(channel?.models.length).toBe(0);
  });

  it('exposes the two Koma 官方 ITV providers + openai-video（runway / kling / pika / sora2 / seedance / vidu / comfyui-animatediff / custom 已下线）', () => {
    const itvChannels = listBuiltInChannelDefinitions('itv');
    const ids = itvChannels.map((c) => c.id).sort();
    expect(ids).toEqual(['grok2api-imagine-itv', 'koma-suihe-itv', 'openai-video']);
  });

  it('declares provider template metadata for openai-video channel', () => {
    const channel = getBuiltInChannelDefinition('openai-video');
    expect(channel).toBeTruthy();
    expect(channel?.category).toBe('itv');
    expect(channel?.id).toBe('openai-video');
    expect(channel?.models.length).toBe(0);
    // baseUrl 必填，因为没有官方默认上游
    expect((channel?.configSchema as { required?: string[] } | undefined)?.required).toContain('baseUrl');
    expect((channel?.configSchema as { required?: string[] } | undefined)?.required).toContain('apiKey');
  });
});
