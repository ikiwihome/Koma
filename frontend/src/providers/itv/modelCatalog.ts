import type { ChannelModelDefinition } from '../channel/types';

export interface ITVModelRule {
  durations: number[];
  resolutions: string[];
}

function cloneDefaults(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) };
}

function cloneModel(model: ChannelModelDefinition): ChannelModelDefinition {
  return {
    ...model,
    capabilities: [...model.capabilities],
    defaults: cloneDefaults(model.defaults),
  };
}

export const VIDU_MODEL_RULES: Record<string, ITVModelRule> = {
  'viduq2-pro': {
    durations: [1, 2, 3, 4, 5, 6, 7, 8],
    resolutions: ['540p', '720p', '1080p'],
  },
  'viduq2-turbo': {
    durations: [1, 2, 3, 4, 5, 6, 7, 8],
    resolutions: ['540p', '720p', '1080p'],
  },
  viduq1: {
    durations: [1, 2, 3, 4, 5, 6, 7, 8],
    resolutions: ['1080p'],
  },
  'viduq1-classic': {
    durations: [1, 2, 3, 4, 5, 6, 7, 8],
    resolutions: ['1080p'],
  },
  'vidu2.0': {
    durations: [4, 8],
    resolutions: ['360p', '720p', '1080p'],
  },
  'vidu1.5': {
    durations: [4, 8],
    resolutions: ['360p', '720p', '1080p'],
  },
};

export const VIDU_MODEL_SUGGESTIONS: ChannelModelDefinition[] = [
  {
    id: 'viduq2-pro',
    label: 'Vidu Q2 Pro',
    providerModelName: 'viduq2-pro',
    capabilities: [
      'video.text-to-video',
      'video.image-to-video',
      'video.reference-to-video',
      'video.start-end-to-video',
    ],
    defaults: {
      defaultDuration: 5,
      defaultResolution: '720p',
    },
  },
  {
    id: 'viduq2-turbo',
    label: 'Vidu Q2 Turbo',
    providerModelName: 'viduq2-turbo',
    capabilities: [
      'video.text-to-video',
      'video.image-to-video',
      'video.reference-to-video',
      'video.start-end-to-video',
    ],
    defaults: {
      defaultDuration: 5,
      defaultResolution: '720p',
    },
  },
  {
    id: 'viduq1',
    label: 'Vidu Q1',
    providerModelName: 'viduq1',
    capabilities: [
      'video.text-to-video',
      'video.image-to-video',
      'video.reference-to-video',
      'video.start-end-to-video',
    ],
    defaults: {
      defaultDuration: 5,
      defaultResolution: '1080p',
    },
  },
  {
    id: 'viduq1-classic',
    label: 'Vidu Q1 Classic',
    providerModelName: 'viduq1-classic',
    capabilities: [
      'video.text-to-video',
      'video.image-to-video',
      'video.reference-to-video',
      'video.start-end-to-video',
    ],
    defaults: {
      defaultDuration: 5,
      defaultResolution: '1080p',
    },
  },
  {
    id: 'vidu2.0',
    label: 'Vidu 2.0',
    providerModelName: 'vidu2.0',
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
  {
    id: 'vidu1.5',
    label: 'Vidu 1.5',
    providerModelName: 'vidu1.5',
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
];

export const SEEDANCE_MODEL_SUGGESTIONS: ChannelModelDefinition[] = [
  {
    id: 'seedance-2.5',
    label: 'Seedance 2.0',
    providerModelName: 'seedance-2.5',
    capabilities: [
      'video.text-to-video',
      'video.image-to-video',
      'video.reference-to-video',
      'video.start-end-to-video',
    ],
    defaults: {
      defaultDuration: 5,
      defaultResolution: '720p',
    },
  },
];

export function getSuggestedViduModels(): ChannelModelDefinition[] {
  return VIDU_MODEL_SUGGESTIONS.map(cloneModel);
}

export function getSuggestedSeedanceModels(): ChannelModelDefinition[] {
  return SEEDANCE_MODEL_SUGGESTIONS.map(cloneModel);
}

/**
 * 从渠道模型读取支持的视频时长枚举。
 *
 * 优先级：
 *  1. model.defaults.durations: number[]（任何 provider 都可以填）
 *  2. VIDU_MODEL_RULES（按 model.id 命中）
 *  3. 兜底（[5, 8, 10]）
 */
export function getITVModelDurations(model: ChannelModelDefinition | undefined | null): number[] {
  if (!model) return [5, 8, 10];

  const fromDefaults = (model.defaults as { durations?: unknown } | undefined)?.durations;
  if (Array.isArray(fromDefaults) && fromDefaults.every(d => typeof d === 'number')) {
    return [...new Set(fromDefaults as number[])].sort((a, b) => a - b);
  }

  const idCandidates = [model.id, model.providerModelName].filter(Boolean) as string[];
  for (const id of idCandidates) {
    const rule = VIDU_MODEL_RULES[id];
    if (rule?.durations?.length) return [...rule.durations];
  }

  return [5, 8, 10];
}

/**
 * 各 ITV / TTI providerType 的引用图数量上限（保守值）。多数 provider 的多
 * 参考能力来自 multipart edit / chat-completions image_urls / inlineData，
 * 实际上限受制于上游 multipart 大小、请求体积、模型本身参数。这里给一个不
 * 触发上游 400 的安全值；模型若有特别声明可在 model.defaults.maxReferenceImages
 * 里覆盖。
 *
 * 本表对 ITV / TTI / 老遗留 provider 都覆盖；位于 itv/modelCatalog.ts 是因为
 * shotVideoPlan 主要消费方在 ITV 侧。
 */
const PROVIDER_DEFAULT_MAX_REFS: Record<string, number> = {
  // ITV 内置（komaapi 网关）
  'grok2api-imagine-itv': 7,
  'koma-suihe-itv': 4,
  // ITV 老遗留（仍可能在 SQLite 里）
  'runway': 1,
  'kling': 2,
  'pika': 2,
  'sora2': 1,
  'vidu': 4,
  'seedance': 4,
  'comfyui-animatediff': 2,
  'custom': 4,
  // TTI 内置（与 ShotPromptService / shotImageWorkflow 共用同一上限）
  'openai-compatible-tti': 6,
  'grok2api-imagine-tti': 4,
  'gemini-native-tti': 6,
};

const FALLBACK_MAX_REFS = 4;

/**
 * 读取模型的引用图数量上限。优先级：
 *   model.defaults.maxReferenceImages（显式覆盖）
 *   > PROVIDER_DEFAULT_MAX_REFS[providerType]（按 provider 兜底）
 *   > FALLBACK_MAX_REFS（4）
 *
 * 调用方一般是 buildShotReferenceBundle / shotVideoPlan，传入当前选中的
 * 渠道模型 + providerType（来自 ChannelDefinition.runtimeProviderType
 * 或 ChannelConfig.providerType）。
 */
export function getModelMaxReferenceImages(
  model: ChannelModelDefinition | undefined | null,
  providerType?: string,
): number {
  const fromDefaults = (model?.defaults as { maxReferenceImages?: unknown } | undefined)?.maxReferenceImages;
  if (typeof fromDefaults === 'number' && Number.isFinite(fromDefaults) && fromDefaults > 0) {
    return Math.floor(fromDefaults);
  }
  if (providerType && providerType in PROVIDER_DEFAULT_MAX_REFS) {
    return PROVIDER_DEFAULT_MAX_REFS[providerType];
  }
  return FALLBACK_MAX_REFS;
}

/**
 * 类似时长，从渠道模型读取支持的分辨率列表。
 */
export function getITVModelResolutions(model: ChannelModelDefinition | undefined | null): string[] | undefined {
  if (!model) return undefined;
  const fromDefaults = (model.defaults as { resolutions?: unknown } | undefined)?.resolutions;
  if (Array.isArray(fromDefaults) && fromDefaults.every(r => typeof r === 'string')) {
    return [...new Set(fromDefaults as string[])];
  }
  const idCandidates = [model.id, model.providerModelName].filter(Boolean) as string[];
  for (const id of idCandidates) {
    const rule = VIDU_MODEL_RULES[id];
    if (rule?.resolutions?.length) return [...rule.resolutions];
  }
  return undefined;
}
