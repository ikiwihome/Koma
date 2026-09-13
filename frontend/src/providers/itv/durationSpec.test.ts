import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIDEO_DURATION_SPEC,
  clampDurationToSpec,
  formatSpecPromptHint,
  getDurationSpecForITVSelection,
  getDurationSpecForProviderType,
  isAllowedDurationForSpec,
  specToInputBounds,
  type VideoDurationSpec,
} from './durationSpec';

describe('clampDurationToSpec', () => {
  const enumSpec: VideoDurationSpec = { kind: 'enum', values: [6, 12, 16, 20], default: 10 };
  const rangeSpec: VideoDurationSpec = { kind: 'range', min: 4, max: 16, step: 1, default: 5 };

  it('enum: snaps to nearest value', () => {
    expect(clampDurationToSpec(7, enumSpec)).toBe(6);
    expect(clampDurationToSpec(11, enumSpec)).toBe(12);
    expect(clampDurationToSpec(15, enumSpec)).toBe(16);
  });

  it('enum: tie-breaks to larger value', () => {
    expect(clampDurationToSpec(9, enumSpec)).toBe(12); // 9 ↔ 6 dist=3, 9 ↔ 12 dist=3 → 12
  });

  it('enum: returns default for non-numeric input', () => {
    expect(clampDurationToSpec('abc', enumSpec)).toBe(enumSpec.default);
    expect(clampDurationToSpec(undefined, enumSpec)).toBe(enumSpec.default);
  });

  it('range: clamps to bounds', () => {
    expect(clampDurationToSpec(2, rangeSpec)).toBe(4);
    expect(rangeSpec.max).toBe(16);
    expect(clampDurationToSpec(20, rangeSpec)).toBe(rangeSpec.max);
  });

  it('range: aligns to step', () => {
    const halfStep: VideoDurationSpec = { kind: 'range', min: 0, max: 10, step: 2, default: 4 };
    // Math.round(2.5) = 3 → 0 + 3*2 = 6（JS round-half-away-from-zero）
    expect(clampDurationToSpec(5, halfStep)).toBe(6);
    expect(clampDurationToSpec(7, halfStep)).toBe(8);
    expect(clampDurationToSpec(4.4, halfStep)).toBe(4);
  });

  it('range: parses string numbers', () => {
    expect(clampDurationToSpec('7.4', rangeSpec)).toBe(7);
  });
});

describe('isAllowedDurationForSpec', () => {
  it('enum: only allows values in list', () => {
    const spec: VideoDurationSpec = { kind: 'enum', values: [6, 12], default: 6 };
    expect(isAllowedDurationForSpec(6, spec)).toBe(true);
    expect(isAllowedDurationForSpec(7, spec)).toBe(false);
  });

  it('range: allows step-aligned values within bounds', () => {
    const spec: VideoDurationSpec = { kind: 'range', min: 4, max: 16, step: 1, default: 5 };
    expect(isAllowedDurationForSpec(4, spec)).toBe(true);
    expect(isAllowedDurationForSpec(16, spec)).toBe(true);
    expect(isAllowedDurationForSpec(17, spec)).toBe(false);
    expect(isAllowedDurationForSpec(3, spec)).toBe(false);
  });
});

describe('formatSpecPromptHint', () => {
  it('enum: lists allowed values in Chinese', () => {
    expect(
      formatSpecPromptHint({ kind: 'enum', values: [6, 12, 16, 20], default: 10 }),
    ).toBe('只能填写 6、12、16、20 之一');
  });

  it('range: describes bounds', () => {
    expect(
      formatSpecPromptHint({ kind: 'range', min: 4, max: 16, step: 1, default: 5 }),
    ).toBe('必须在 4–16 秒范围内（整数）');
  });

  it('range: includes step when not 1', () => {
    expect(
      formatSpecPromptHint({ kind: 'range', min: 0, max: 30, step: 5, default: 10 }),
    ).toBe('必须在 0–30 秒范围内（步长 5）');
  });
});

describe('specToInputBounds', () => {
  it('enum: returns min/max of enum values', () => {
    expect(
      specToInputBounds({ kind: 'enum', values: [6, 12, 16, 20], default: 10 }),
    ).toEqual({ min: 6, max: 20, step: 1 });
  });

  it('range: passes through bounds', () => {
    expect(
      specToInputBounds({ kind: 'range', min: 4, max: 16, step: 1, default: 5 }),
    ).toEqual({ min: 4, max: 16, step: 1 });
  });
});

describe('getDurationSpecForProviderType', () => {
  it('grok2api-imagine-itv -> enum 6/12/16/20 default 6', () => {
    const spec = getDurationSpecForProviderType('grok2api-imagine-itv');
    expect(spec.kind).toBe('enum');
    if (spec.kind === 'enum') {
      expect(spec.values).toEqual([6, 12, 16, 20]);
      expect(spec.default).toBe(6);
    }
  });

  it('seedance → range 4-16 default 5', () => {
    const spec = getDurationSpecForProviderType('seedance');
    expect(spec.kind).toBe('range');
    if (spec.kind === 'range') {
      expect(spec.min).toBe(4);
      expect(spec.max).toBe(15);
      expect(spec.step).toBe(1);
      expect(spec.default).toBe(5);
    }
  });

  it('unknown providerType → fallback to default spec', () => {
    expect(getDurationSpecForProviderType('runway')).toEqual(DEFAULT_VIDEO_DURATION_SPEC);
    expect(getDurationSpecForProviderType(undefined)).toEqual(DEFAULT_VIDEO_DURATION_SPEC);
  });
});

describe('getDurationSpecForITVSelection', () => {
  const channels = [
    { id: 'ch-grok', providerType: 'grok2api-imagine-itv' },
    { id: 'ch-seedance', providerType: 'seedance' },
    { id: 'ch-runway', providerType: 'runway' },
    // Koma 内置即梦：复用 grok2api runtime，但模型是 seedance-2.5
    { id: 'komaapi-default-itv-jimeng', providerType: 'grok2api-imagine-itv' },
  ];

  it('resolves through channelId from selection key', () => {
    const spec = getDurationSpecForITVSelection('ch-seedance::seedance-2.5', channels);
    expect(spec.kind).toBe('range');
  });

  it('modelId 前缀优先于 providerType（seedance-2.5 → 4-15）', () => {
    const spec = getDurationSpecForITVSelection(
      'komaapi-default-itv-jimeng::seedance-2.5',
      channels,
    );
    expect(spec.kind).toBe('range');
    if (spec.kind === 'range') {
      expect(spec.min).toBe(4);
      expect(spec.max).toBe(15);
    }
  });

  it('seedance-2.5-f / fast spec 保持 4-15', () => {
    const spec = getDurationSpecForITVSelection(
      'ch-seedance::seedance-2.5-f',
      channels,
    );
    expect(spec.kind).toBe('range');
    if (spec.kind === 'range') {
      expect(spec.min).toBe(4);
      expect(spec.max).toBe(15);
    }

    const legacyFastSpec = getDurationSpecForITVSelection(
      'ch-seedance::seedance-2.5',
      channels,
    );
    expect(legacyFastSpec.kind).toBe('range');
    if (legacyFastSpec.kind === 'range') {
      expect(legacyFastSpec.max).toBe(15);
    }
  });

  it('returns default when selection is empty', () => {
    expect(getDurationSpecForITVSelection(undefined, channels)).toEqual(DEFAULT_VIDEO_DURATION_SPEC);
    expect(getDurationSpecForITVSelection('', channels)).toEqual(DEFAULT_VIDEO_DURATION_SPEC);
  });

  it('returns default when channel not found', () => {
    expect(
      getDurationSpecForITVSelection('ch-missing::unknown-model', channels),
    ).toEqual(DEFAULT_VIDEO_DURATION_SPEC);
  });

  it('handles selection without separator (treats whole as channelId)', () => {
    const spec = getDurationSpecForITVSelection('ch-grok', channels);
    expect(spec.kind).toBe('enum');
  });

  it('model defaults durationMin/Max override provider fallback', () => {
    const customChannels = [
      {
        id: 'ch-openai',
        providerType: 'openai-video',
        models: [
          {
            id: 'sora-2',
            providerModelName: 'sora-2',
            defaults: { durationMin: 4, durationMax: 20, durationStep: 2, defaultDuration: 8 },
          },
        ],
      },
    ];
    const spec = getDurationSpecForITVSelection('ch-openai::sora-2', customChannels);
    expect(spec.kind).toBe('range');
    if (spec.kind === 'range') {
      expect(spec.min).toBe(4);
      expect(spec.max).toBe(20);
      expect(spec.step).toBe(2);
      expect(spec.default).toBe(8);
    }
  });

  it('model defaults durationValues falls back to enum spec', () => {
    const customChannels = [
      {
        id: 'ch-openai',
        providerType: 'openai-video',
        models: [
          {
            id: 'sora-2',
            providerModelName: 'sora-2',
            defaults: { durationValues: [4, 8, 12, 20], defaultDuration: 8 },
          },
        ],
      },
    ];
    const spec = getDurationSpecForITVSelection('ch-openai::sora-2', customChannels);
    expect(spec.kind).toBe('enum');
    if (spec.kind === 'enum') {
      expect(spec.values).toEqual([4, 8, 12, 20]);
      expect(spec.default).toBe(8);
    }
  });
});
