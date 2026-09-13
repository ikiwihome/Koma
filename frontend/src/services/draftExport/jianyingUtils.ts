/**
 * 剪映格式转换工具函数
 * 参考 pyJianYingDraft 实现
 */

import type {
  Clip,
  Keyframe,
  ClipFilter,
  ClipAnimation,
  AudioFade,
  ClipMask,
  Transition,
} from '../../types/editor';
import { EasingType } from '../../types/editor';
import { generateHexId } from './coordinateTransform';

// ========== 时间/坐标转换 ==========

/**
 * 秒转换为微秒
 */
export function secondsToMicroseconds(seconds: number): number {
  return Math.round(seconds * 1_000_000);
}

/**
 * 像素坐标转换为半画布单位
 * 剪映使用"半画布"作为单位：值 = 像素 / (画布尺寸 / 2)
 */
export function pixelToHalfCanvas(pixel: number, canvasSize: number): number {
  return pixel / (canvasSize / 2);
}

// ========== 关键帧导出 ==========
//
// 阶段 2-B 改造：原从 Clip.jianyingKeyframeTracks（per-property timeline 表示）
// 直接构建。但该字段在生产代码中无 UI 写入路径，永远 undefined，导出关键帧
// 始终为空。改为从 Clip.keyframes（属性快照模型 [{time,x,y,scale,rotation,
// opacity,easing}]）派生 transform 类剪映关键帧。
//
// 派生规则：每个剪映 property 由对应快照属性切片而成。
//   x        → KFTypePositionX
//   y        → KFTypePositionY
//   scale    → UNIFORM_SCALE
//   rotation → KFTypeRotation
//   opacity  → KFTypeAlpha
//
// saturation / contrast / brightness / volume 等属性通用 Keyframe 不携带，
// UI 也无编辑入口，故剪映导出不再产生这些属性的关键帧。

interface JianyingKeyframeExport {
  id: string;
  curveType: string;
  graphID: string;
  left_control: { x: number; y: number };
  right_control: { x: number; y: number };
  time_offset: number;
  values: number[];
}

interface JianyingKeyframeListExport {
  id: string;
  keyframe_list: JianyingKeyframeExport[];
  material_id: string;
  property_type: string;
}

function easingToCurveType(easing: EasingType): 'Line' | 'Bezier' {
  return easing === EasingType.LINEAR ? 'Line' : 'Bezier';
}

function buildKeyframeFromSnapshot(time: number, value: number, easing: EasingType): JianyingKeyframeExport {
  return {
    id: generateHexId(),
    curveType: easingToCurveType(easing),
    graphID: '',
    left_control: { x: 0.0, y: 0.0 },
    right_control: { x: 0.0, y: 0.0 },
    time_offset: secondsToMicroseconds(time),
    values: [value],
  };
}

/**
 * 从 Clip 的属性快照关键帧派生剪映 per-property 关键帧列表。
 * 仅产生 transform 类属性（x/y/scale/rotation/opacity），其他属性需扩展 Keyframe 类型。
 */
export function buildKeyframeListsFromClip(clip: Clip): JianyingKeyframeListExport[] {
  const keyframes = clip.keyframes;
  if (!keyframes || keyframes.length === 0) return [];

  type Slice = { property: string; pick: (kf: Keyframe) => number };
  const slices: Slice[] = [
    { property: 'KFTypePositionX', pick: (kf) => kf.x },
    { property: 'KFTypePositionY', pick: (kf) => kf.y },
    { property: 'UNIFORM_SCALE',   pick: (kf) => kf.scale },
    { property: 'KFTypeRotation',  pick: (kf) => kf.rotation },
    { property: 'KFTypeAlpha',     pick: (kf) => kf.opacity },
  ];

  return slices.map((slice) => ({
    id: generateHexId(),
    keyframe_list: keyframes.map((kf) =>
      buildKeyframeFromSnapshot(kf.time, slice.pick(kf), kf.easing),
    ),
    material_id: '',
    property_type: slice.property,
  }));
}

// ========== 滤镜导出 ==========

interface JianyingFilterExport {
  id: string;
  type: string;
  name: string;
  effect_id: string;
  resource_id: string;
  value: number;
  platform: string;
  apply_target_type: number;
  adjust_params: any[];
  category_id: string;
  category_name: string;
  time_range: null;
}

/**
 * 构建滤镜素材
 */
export function buildFilter(filter: ClipFilter | undefined): JianyingFilterExport | null {
  if (!filter) return null;

  return {
    id: generateHexId(),
    type: 'filter',
    name: filter.name,
    effect_id: filter.id,
    resource_id: filter.resourceId || filter.id,
    value: filter.intensity / 100, // 转换为 0-1
    platform: 'all',
    apply_target_type: 0, // 0: 片段, 2: 全局
    adjust_params: [],
    category_id: '',
    category_name: '',
    time_range: null,
  };
}

// ========== 动画导出 ==========

interface JianyingAnimationExport {
  anim_in?: {
    id: string;
    name: string;
    duration: number;
    resource_id: string;
    type: string;
  };
  anim_out?: {
    id: string;
    name: string;
    duration: number;
    resource_id: string;
    type: string;
  };
  group_anim?: {
    id: string;
    name: string;
    duration: number;
    resource_id: string;
    type: string;
  };
  anim_id: string;
  type: string;
}

/**
 * 构建动画素材
 */
export function buildAnimations(
  animations: ClipAnimation[] | undefined
): JianyingAnimationExport | null {
  if (!animations || animations.length === 0) return null;

  const result: JianyingAnimationExport = {
    anim_id: generateHexId(),
    type: 'sticker_animation',
  };

  for (const anim of animations) {
    const animData = {
      id: generateHexId(),
      name: anim.name || anim.effectId,
      duration: secondsToMicroseconds(anim.duration),
      resource_id: anim.effectId,
      type: 'in',
    };

    if (anim.type === 'in') {
      result.anim_in = { ...animData, type: 'in' };
    } else if (anim.type === 'out') {
      result.anim_out = { ...animData, type: 'out' };
    } else if (anim.type === 'group') {
      result.group_anim = { ...animData, type: 'group' };
    }
  }

  return result;
}

// ========== 音频淡入淡出导出 ==========

interface JianyingAudioFadeExport {
  id: string;
  fade_in_duration: number;
  fade_out_duration: number;
  fade_type: number;
  type: string;
}

/**
 * 构建音频淡入淡出素材
 */
export function buildAudioFade(fade: AudioFade | undefined): JianyingAudioFadeExport | null {
  if (!fade || (fade.fadeIn === 0 && fade.fadeOut === 0)) return null;

  return {
    id: generateHexId(),
    fade_in_duration: secondsToMicroseconds(fade.fadeIn),
    fade_out_duration: secondsToMicroseconds(fade.fadeOut),
    fade_type: 0,
    type: 'audio_fade',
  };
}

// ========== 蒙版导出 ==========

// 蒙版类型元数据
const MASK_META: Record<string, { name: string; resourceType: string; resourceId: string; aspectRatio: number }> = {
  linear: { name: '线性', resourceType: 'mask', resourceId: 'mask_linear', aspectRatio: 1.0 },
  mirror: { name: '镜面', resourceType: 'mask', resourceId: 'mask_mirror', aspectRatio: 1.0 },
  circle: { name: '圆形', resourceType: 'mask', resourceId: 'mask_circle', aspectRatio: 1.0 },
  rectangle: { name: '矩形', resourceType: 'mask', resourceId: 'mask_rectangle', aspectRatio: 1.0 },
  heart: { name: '爱心', resourceType: 'mask', resourceId: 'mask_heart', aspectRatio: 0.9 },
  star: { name: '星形', resourceType: 'mask', resourceId: 'mask_star', aspectRatio: 1.05 },
};

interface JianyingMaskExport {
  id: string;
  type: string;
  name: string;
  resource_type: string;
  resource_id: string;
  platform: string;
  position_info: string;
  config: {
    aspectRatio: number;
    centerX: number;
    centerY: number;
    feather: number;
    height: number;
    invert: boolean;
    rotation: number;
    roundCorner: number;
    width: number;
  };
}

/**
 * 构建蒙版素材
 */
export function buildMask(mask: ClipMask | undefined): JianyingMaskExport | null {
  if (!mask) return null;

  const meta = MASK_META[mask.type];
  if (!meta) return null;

  const size = mask.size ?? 0.5;
  const width = mask.width ?? size;

  return {
    id: generateHexId(),
    type: 'mask',
    name: meta.name,
    resource_type: meta.resourceType,
    resource_id: meta.resourceId,
    platform: 'all',
    position_info: '',
    config: {
      aspectRatio: meta.aspectRatio,
      centerX: mask.centerX ?? 0,
      centerY: mask.centerY ?? 0,
      feather: (mask.feather ?? 0) / 100, // 转换为 0-1
      height: size,
      invert: mask.invert ?? false,
      rotation: mask.rotation ?? 0,
      roundCorner: (mask.roundCorner ?? 0) / 100, // 转换为 0-1
      width,
    },
  };
}

// ========== 转场导出 ==========

interface JianyingTransitionExport {
  id: string;
  type: string;
  name: string;
  effect_id: string;
  resource_id: string;
  duration: number;
  is_overlap: boolean;
  platform: string;
  category_id: string;
  category_name: string;
}

const JIANYING_TRANSITION_META: Record<Transition['type'], { effectId: string; name: string }> = {
  fade: {
    effectId: 'fade',
    name: '淡变',
  },
};

/**
 * 构建转场素材
 */
export function buildTransition(transition: Transition | undefined): JianyingTransitionExport | null {
  if (!transition) return null;

  const meta = JIANYING_TRANSITION_META[transition.type];
  if (!meta) return null;

  return {
    id: generateHexId(),
    type: 'transition',
    name: meta.name,
    effect_id: meta.effectId,
    resource_id: meta.effectId,
    duration: secondsToMicroseconds(transition.duration),
    is_overlap: true,
    platform: 'all',
    category_id: '',
    category_name: '',
  };
}
