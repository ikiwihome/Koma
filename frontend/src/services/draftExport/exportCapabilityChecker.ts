/**
 * 导出功能兼容性检测器
 * 检测项目中使用的高级特性，并报告哪些只能通过剪映草稿导出
 */

import type { Track, Clip } from '../../types/editor';
import { normalizeTrackTransitions } from '../../features/transition/core';

export type CapabilityOutcome = 'supported' | 'unsupported' | 'degraded' | 'preview-limited' | 'final-only';

export const CAPABILITY_BOUNDARIES: CapabilityOutcome[] = [
  'supported',
  'unsupported',
  'degraded',
  'preview-limited',
  'final-only',
];

// 高级特性类型
export type AdvancedFeature =
  | 'filter'              // 滤镜
  | 'animation'           // 动画
  | 'audioFade'           // 音频淡入淡出
  | 'mask'                // 蒙版
  | 'transition';         // 转场

// 特性显示名称
const FEATURE_NAMES: Record<AdvancedFeature, string> = {
  filter: '滤镜',
  animation: '动画效果',
  audioFade: '音频淡入淡出',
  mask: '蒙版',
  transition: '转场',
};

// 特性支持情况
export interface FeatureSupport {
  native: boolean;      // 原生导出是否支持
  jianying: boolean;    // 剪映草稿是否支持
}

function getNativeOutcome(support: FeatureSupport): CapabilityOutcome {
  if (support.native) {
    return 'supported';
  }

  if (support.jianying) {
    return 'final-only';
  }

  return 'unsupported';
}

const FEATURE_SUPPORT: Record<AdvancedFeature, FeatureSupport> = {
  filter: { native: false, jianying: true },
  animation: { native: false, jianying: true },
  audioFade: { native: false, jianying: true },
  mask: { native: false, jianying: true },
  transition: { native: true, jianying: true },
};

// 兼容性报告
export interface CompatibilityReport {
  hasAdvancedFeatures: boolean;          // 是否有高级特性
  outcome: CapabilityOutcome;            // 原生导出整体能力结果
  capabilityBoundaries: CapabilityOutcome[]; // 能力边界标签
  usedFeatures: AdvancedFeature[];       // 使用的高级特性列表
  featureDetails: {                      // 特性详情
    feature: AdvancedFeature;
    name: string;
    clipCount: number;                   // 使用该特性的片段数量
    support: FeatureSupport;
    nativeOutcome: CapabilityOutcome;
  }[];
  jianyingOnlyFeatures: AdvancedFeature[]; // 仅剪映支持的特性
  recommendations: string[];               // ��荐信息
}

/**
 * 检测片段中使用的高级特性
 */
function detectClipFeatures(clip: Clip): AdvancedFeature[] {
  const features: AdvancedFeature[] = [];

  if (clip.filter) {
    features.push('filter');
  }
  if (clip.animations && clip.animations.length > 0) {
    features.push('animation');
  }
  if (clip.audioFade && (clip.audioFade.fadeIn > 0 || clip.audioFade.fadeOut > 0)) {
    features.push('audioFade');
  }
  if (clip.mask) {
    features.push('mask');
  }
  return features;
}

/**
 * 检测轨道列表的功能兼容性
 */
export function checkExportCompatibility(tracks: Track[]): CompatibilityReport {
  const featureCounts = new Map<AdvancedFeature, number>();

  // 遍历所有片段检测特性
  for (const track of tracks) {
    const normalizedTrack = normalizeTrackTransitions(track);
    if ((normalizedTrack.transitions?.length ?? 0) > 0) {
      featureCounts.set(
        'transition',
        (featureCounts.get('transition') || 0) + normalizedTrack.transitions!.length
      );
    }

    for (const clip of track.clips) {
      const clipFeatures = detectClipFeatures(clip);
      for (const feature of clipFeatures) {
        featureCounts.set(feature, (featureCounts.get(feature) || 0) + 1);
      }
    }
  }

  // 构建使用的特性列表
  const usedFeatures = Array.from(featureCounts.keys());

  // 构建特性详情
  const featureDetails = usedFeatures.map((feature) => ({
    feature,
    name: FEATURE_NAMES[feature],
    clipCount: featureCounts.get(feature) || 0,
    support: FEATURE_SUPPORT[feature],
    nativeOutcome: getNativeOutcome(FEATURE_SUPPORT[feature]),
  }));

  // 找出仅剪映支持的特性
  const jianyingOnlyFeatures = usedFeatures.filter(
    (feature) => !FEATURE_SUPPORT[feature].native && FEATURE_SUPPORT[feature].jianying
  );

  // 生成推荐信息
  const recommendations: string[] = [];
  if (jianyingOnlyFeatures.length > 0) {
    const featureNames = jianyingOnlyFeatures.map((f) => FEATURE_NAMES[f]).join('、');
    recommendations.push(`项目使用了以下仅剪映支持的特性：${featureNames}`);
    recommendations.push('建议使用「草稿导出」以保留这些效果');
  }

  const hasSupportedFeatures = featureDetails.some((detail) => detail.nativeOutcome === 'supported');
  const hasFinalOnlyFeatures = featureDetails.some((detail) => detail.nativeOutcome === 'final-only');

  let outcome: CapabilityOutcome = 'supported';
  if (hasSupportedFeatures && hasFinalOnlyFeatures) {
    outcome = 'degraded';
  } else if (hasFinalOnlyFeatures) {
    outcome = 'final-only';
  }

  return {
    hasAdvancedFeatures: usedFeatures.length > 0,
    outcome,
    capabilityBoundaries: CAPABILITY_BOUNDARIES,
    usedFeatures,
    featureDetails,
    jianyingOnlyFeatures,
    recommendations,
  };
}

/**
 * 获取功能兼容性提示文本
 */
export function getCompatibilityWarning(tracks: Track[]): string | null {
  const report = checkExportCompatibility(tracks);

  if (report.jianyingOnlyFeatures.length === 0) {
    return null;
  }

  const featureNames = report.jianyingOnlyFeatures.map((f) => FEATURE_NAMES[f]).join('、');
  return `项目使用了 ${featureNames}，这些效果仅在剪映草稿导出中保留。`;
}
