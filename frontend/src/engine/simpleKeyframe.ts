/**
 * Simple 编辑器关键帧工具
 * 适配 types/editor.ts 中的类型
 */
import { Keyframe, EasingType, Clip, AnimatableProperty } from '../types/editor';

// 缓动函数
const easingFunctions: Record<EasingType, (t: number) => number> = {
  [EasingType.LINEAR]: (t) => t,
  [EasingType.EASE_IN]: (t) => t * t,
  [EasingType.EASE_OUT]: (t) => t * (2 - t),
  [EasingType.EASE_IN_OUT]: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  [EasingType.EASE_IN_CUBIC]: (t) => t * t * t,
  [EasingType.EASE_OUT_CUBIC]: (t) => (--t) * t * t + 1,
  [EasingType.EASE_IN_OUT_CUBIC]: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1
};

function generateId(): string {
  return `kf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取片段在指定时间的动画属性
 */
export function getAnimatedProperties(
  clip: Clip,
  clipLocalTime: number
): { x: number; y: number; scale: number; rotation: number; opacity: number } {
  const defaults = { x: clip.x, y: clip.y, scale: clip.scale, rotation: clip.rotation, opacity: clip.opacity };

  if (!clip.keyframes || clip.keyframes.length < 2) {
    if (clip.keyframes?.length === 1) {
      const kf = clip.keyframes[0];
      return { x: kf.x, y: kf.y, scale: kf.scale, rotation: kf.rotation, opacity: kf.opacity };
    }
    return defaults;
  }

  const sorted = [...clip.keyframes].sort((a, b) => a.time - b.time);

  if (clipLocalTime <= sorted[0].time) {
    const kf = sorted[0];
    return { x: kf.x, y: kf.y, scale: kf.scale, rotation: kf.rotation, opacity: kf.opacity };
  }

  if (clipLocalTime >= sorted[sorted.length - 1].time) {
    const kf = sorted[sorted.length - 1];
    return { x: kf.x, y: kf.y, scale: kf.scale, rotation: kf.rotation, opacity: kf.opacity };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const kf1 = sorted[i];
    const kf2 = sorted[i + 1];

    if (clipLocalTime >= kf1.time && clipLocalTime <= kf2.time) {
      const duration = kf2.time - kf1.time;
      const progress = duration > 0 ? (clipLocalTime - kf1.time) / duration : 0;
      const easingFn = easingFunctions[kf1.easing];
      const t = easingFn(progress);

      return {
        x: kf1.x + (kf2.x - kf1.x) * t,
        y: kf1.y + (kf2.y - kf1.y) * t,
        scale: kf1.scale + (kf2.scale - kf1.scale) * t,
        rotation: kf1.rotation + (kf2.rotation - kf1.rotation) * t,
        opacity: kf1.opacity + (kf2.opacity - kf1.opacity) * t
      };
    }
  }

  return defaults;
}

/**
 * 添加关键帧
 */
export function addKeyframe(
  clip: Clip,
  clipLocalTime: number,
  properties?: Partial<{ x: number; y: number; scale: number; rotation: number; opacity: number }>,
  easing: EasingType = EasingType.EASE_IN_OUT
): Clip {
  const keyframes = clip.keyframes ? [...clip.keyframes] : [];
  const existingIndex = keyframes.findIndex(kf => Math.abs(kf.time - clipLocalTime) < 0.01);

  const newKeyframe: Keyframe = {
    id: existingIndex >= 0 ? keyframes[existingIndex].id : generateId(),
    time: clipLocalTime,
    x: properties?.x ?? clip.x,
    y: properties?.y ?? clip.y,
    scale: properties?.scale ?? clip.scale,
    rotation: properties?.rotation ?? clip.rotation,
    opacity: properties?.opacity ?? clip.opacity,
    easing
  };

  if (existingIndex >= 0) {
    keyframes[existingIndex] = newKeyframe;
  } else {
    keyframes.push(newKeyframe);
  }

  keyframes.sort((a, b) => a.time - b.time);
  return { ...clip, keyframes };
}

/**
 * 更新关键帧
 */
export function updateKeyframe(clip: Clip, keyframeId: string, updates: Partial<Keyframe>): Clip {
  if (!clip.keyframes) return clip;
  const keyframes = clip.keyframes.map(kf => kf.id !== keyframeId ? kf : { ...kf, ...updates });
  if (updates.time !== undefined) keyframes.sort((a, b) => a.time - b.time);
  return { ...clip, keyframes };
}

/**
 * 删除关键帧
 */
export function removeKeyframe(clip: Clip, keyframeId: string): Clip {
  if (!clip.keyframes) return clip;
  const keyframes = clip.keyframes.filter(kf => kf.id !== keyframeId);
  return { ...clip, keyframes: keyframes.length > 0 ? keyframes : undefined };
}

/**
 * 获取指定时间的关键帧
 */
export function getKeyframeAtTime(clip: Clip, clipLocalTime: number, tolerance = 0.05): Keyframe | null {
  if (!clip.keyframes) return null;
  return clip.keyframes.find(kf => Math.abs(kf.time - clipLocalTime) < tolerance) || null;
}

/**
 * 检查是否有有效关键帧动画
 */
export function hasValidKeyframes(clip: Clip): boolean {
  return !!clip.keyframes && clip.keyframes.length >= 2;
}

/**
 * 检查是否有任何关键帧
 */
export function hasKeyframes(clip: Clip): boolean {
  return !!clip.keyframes && clip.keyframes.length > 0;
}

/**
 * 获取所有关键帧时间
 */
export function getKeyframeTimes(clip: Clip): number[] {
  if (!clip.keyframes) return [];
  return clip.keyframes.map(kf => kf.time).sort((a, b) => a - b);
}

/**
 * 自动打帧
 */
export function autoKeyframe(
  clip: Clip,
  clipLocalTime: number,
  property: AnimatableProperty,
  value: number
): Clip {
  if (!clip.keyframes || clip.keyframes.length === 0) {
    return { ...clip, [property]: value };
  }

  const existingKf = getKeyframeAtTime(clip, clipLocalTime, 0.01);

  if (existingKf) {
    return updateKeyframe(clip, existingKf.id, { [property]: value });
  } else {
    const currentProps = getAnimatedProperties(clip, clipLocalTime);
    return addKeyframe(clip, clipLocalTime, { ...currentProps, [property]: value });
  }
}
