import type { AppSettings, MediaModelSelection } from '../../types';
import type { ConfiguredModelSelectOption } from '../../providers/channel/resolver';
import {
  getDefaultMediaSelection,
  listConfiguredModelSelectOptions,
  resolveConfiguredChannelModel,
  serializeMediaSelection,
} from '../../providers/channel/resolver';
import type { ModelCapability } from '../../providers/channel/types';

export type ProjectMediaCategoryKey = 'llm' | 'tti' | 'itv' | 'tts';

export interface ProjectMediaRequirement {
  capability?: ModelCapability;
  label?: string;
  description?: string;
}

export interface ProjectMediaCategoryState {
  category: ProjectMediaCategoryKey;
  requirement?: ProjectMediaRequirement;
  options: ConfiguredModelSelectOption[];
  explicitSelection?: MediaModelSelection;
  explicitValue?: string;
  explicitSupported: boolean;
  fallbackValue?: string;
  fallbackLabel?: string;
  usingFallback: boolean;
  warning?: string;
}

export const PROJECT_MEDIA_CAPABILITY_LABELS: Partial<Record<ModelCapability, string>> = {
  'llm.chat': '对话',
  'image.text-to-image': '文生图',
  'image.image-to-image': '图生图',
  'video.text-to-video': '文生视频',
  'video.image-to-video': '图生视频',
  'video.reference-to-video': '参考生视频',
  'video.start-end-to-video': '首尾帧视频',
  'speech.text-to-speech': '语音合成',
};

export const PROJECT_MEDIA_BASE_REQUIREMENTS: Partial<Record<ProjectMediaCategoryKey, ProjectMediaRequirement>> = {
  llm: {
    capability: 'llm.chat',
    label: '对话',
    description: '仅显示支持对话能力的模型',
  },
  tti: {
    capability: 'image.text-to-image',
    label: '文生图',
    description: '仅显示支持文生图的模型',
  },
  itv: {
    capability: 'video.reference-to-video',
    label: '参考生视频',
    description: '仅显示支持参考生视频的模型',
  },
  tts: {
    capability: 'speech.text-to-speech',
    label: '语音合成',
    description: '仅显示支持语音合成的模型',
  },
};

function formatOptionLabel(option?: ConfiguredModelSelectOption): string | undefined {
  if (!option) {
    return undefined;
  }
  return `${option.channelLabel} / ${option.modelLabel}`;
}

export function buildProjectMediaCategoryState(params: {
  settings: AppSettings;
  category: ProjectMediaCategoryKey;
  explicitSelection?: MediaModelSelection;
  requirement?: ProjectMediaRequirement;
}): ProjectMediaCategoryState {
  const { settings, category, explicitSelection, requirement } = params;
  const capability = requirement?.capability;
  const options = listConfiguredModelSelectOptions(settings, category, capability);
  const explicitValue = serializeMediaSelection(explicitSelection);
  const explicitResolved = explicitSelection
    ? resolveConfiguredChannelModel(settings, category, explicitSelection, capability)
    : undefined;
  const explicitResolvedWithoutRequirement = explicitSelection
    ? resolveConfiguredChannelModel(settings, category, explicitSelection)
    : undefined;
  const fallbackSelection = getDefaultMediaSelection(settings, category, capability);
  const fallbackValue = serializeMediaSelection(fallbackSelection);
  const fallbackOption = fallbackValue
    ? options.find((item) => item.value === fallbackValue)
    : undefined;
  const requirementLabel = requirement?.label
    || (capability ? PROJECT_MEDIA_CAPABILITY_LABELS[capability] : undefined)
    || capability;

  let warning: string | undefined;
  if (explicitSelection && !explicitResolved) {
    warning = explicitResolvedWithoutRequirement && requirementLabel
      ? `当前项目选择的模型不支持${requirementLabel}，已回退到全局默认`
      : '当前项目选择的模型已不可用，已回退到全局默认';
  }

  return {
    category,
    requirement,
    options,
    explicitSelection,
    explicitValue,
    explicitSupported: Boolean(explicitResolved),
    fallbackValue,
    fallbackLabel: formatOptionLabel(fallbackOption),
    usingFallback: !explicitSelection || !explicitResolved,
    warning,
  };
}
