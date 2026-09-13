import { describe, expect, it } from 'vitest';
import {
  getSuggestedITVFieldDefaults,
  getSuggestedITVModels,
  hasConfiguredITVModels,
  normalizeITVModelsForProvider,
  shouldReplaceITVModelsOnProviderChange,
} from './itvProviderSuggestions';

describe('itvProviderSuggestions', () => {
  it('returns documented Kling model suggestions with capability matrix', () => {
    const models = getSuggestedITVModels('kling');

    expect(models.map((model) => model.providerModelName)).toEqual([
      'kling-v1',
      'kling-v1-5',
      'kling-v1-6',
    ]);

    expect(models[0]?.capabilities).toEqual([
      'video.text-to-video',
      'video.image-to-video',
      'video.start-end-to-video',
    ]);

    expect(models[2]?.capabilities).toContain('video.reference-to-video');
    expect(models[2]?.defaults).toEqual({
      defaultDuration: 5,
      defaultResolution: '1280x720',
    });
  });

  it('returns provider-level default form fields for Kling', () => {
    expect(getSuggestedITVFieldDefaults('kling')).toEqual({
      defaultDuration: 5,
      defaultResolution: '1280x720',
    });
  });

  it('returns Vidu model suggestions sourced from the shared provider catalog', () => {
    const models = getSuggestedITVModels('vidu');

    expect(models.map((model) => model.providerModelName)).toEqual([
      'viduq2-pro',
      'viduq2-turbo',
      'viduq1',
      'viduq1-classic',
      'vidu2.0',
      'vidu1.5',
    ]);

    expect(models.every((model) => model.capabilities.includes('video.text-to-video'))).toBe(true);
    expect(models.every((model) => model.capabilities.includes('video.reference-to-video'))).toBe(true);
    expect(models.find((model) => model.providerModelName === 'vidu2.0')?.defaults).toEqual({
      defaultDuration: 4,
      defaultResolution: '360p',
    });
  });

  it('returns provider-level default form fields for Vidu', () => {
    expect(getSuggestedITVFieldDefaults('vidu')).toEqual({
      defaultDuration: 5,
      defaultResolution: '720p',
    });
  });

  it('returns Seedance model suggestions sourced from the shared provider catalog', () => {
    const models = getSuggestedITVModels('seedance');

    expect(models.map((model) => model.providerModelName)).toEqual([
      'seedance-2.5',
    ]);

    expect(models.every((model) => model.capabilities.includes('video.text-to-video'))).toBe(true);
    expect(models.every((model) => model.capabilities.includes('video.image-to-video'))).toBe(true);
    expect(models.every((model) => model.capabilities.includes('video.reference-to-video'))).toBe(true);
    expect(models.every((model) => model.capabilities.includes('video.start-end-to-video'))).toBe(true);
    expect(models[0]?.defaults).toEqual({
      defaultDuration: 5,
      defaultResolution: '720p',
    });
  });

  it('returns provider-level default form fields for Seedance', () => {
    expect(getSuggestedITVFieldDefaults('seedance')).toEqual({
      defaultDuration: 5,
      defaultResolution: '720p',
    });
  });

  it('detects whether the current form already contains configured model names', () => {
    expect(hasConfiguredITVModels([
      { providerModelName: '' },
    ])).toBe(false);

    expect(hasConfiguredITVModels([
      { providerModelName: 'kling-v1-6' },
    ])).toBe(true);
  });

  it('resets suggested models when the provider switches to a different ITV backend', () => {
    expect(shouldReplaceITVModelsOnProviderChange([
      { providerModelName: 'vidu1.5' },
    ], 'kling', 'vidu')).toBe(true);

    expect(shouldReplaceITVModelsOnProviderChange([
      { providerModelName: 'kling-v1-6' },
    ], 'kling', 'kling')).toBe(false);
  });

  it('canonicalizes stale model ids to the selected provider suggestions before save', () => {
    expect(normalizeITVModelsForProvider([
      {
        id: 'vidu1.5',
        label: 'seedance-2.5',
        providerModelName: 'seedance-2.5',
        capabilities: ['video.reference-to-video'],
      },
    ] as any, 'seedance')).toEqual([
      expect.objectContaining({
        id: 'seedance-2.5',
        providerModelName: 'seedance-2.5',
        label: 'seedance-2.5',
      }),
    ]);
  });
});
