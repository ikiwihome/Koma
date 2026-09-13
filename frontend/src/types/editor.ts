/**
 * 编辑器核心类型定义
 * 迁移自 electron-egg
 */

export enum MediaType {
  VIDEO = 'VIDEO',
  IMAGE = 'IMAGE',
  TEXT = 'TEXT',
  AUDIO = 'AUDIO'
}

// 缓动类型
export enum EasingType {
  LINEAR = 'linear',
  EASE_IN = 'easeIn',
  EASE_OUT = 'easeOut',
  EASE_IN_OUT = 'easeInOut',
  EASE_IN_CUBIC = 'easeInCubic',
  EASE_OUT_CUBIC = 'easeOutCubic',
  EASE_IN_OUT_CUBIC = 'easeInOutCubic'
}

// 关键帧 - 存储完整属性快照
export interface Keyframe {
  id: string;
  time: number; // 相对于片段开始的时间（秒）
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  easing: EasingType;
}

// 可动画属性
export type AnimatableProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';

export interface Asset {
  id: string;
  type: MediaType;
  src: string;
  thumbnail?: string;
  name: string;
  duration: number; // in seconds
  width?: number;   // 素材宽度（像素）
  height?: number;  // 素材高度（像素）
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  start: number;    // 时间轴上的起始时间（秒）
  duration: number; // 片段时长（秒）
  offset: number;   // 媒体内部偏移（从源素材第几秒开始）
  sourceDuration?: number; // 源素材总时长（秒），用于限制 trim 范围
  sourceWidth?: number;    // 源素材宽度（像素）
  sourceHeight?: number;   // 源素材高度（像素）
  name: string;
  type: MediaType;
  src: string;
  // 基础属性
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  // 关键帧列表
  keyframes?: Keyframe[];
  // 字幕专有属性
  text?: string;            // 字幕文本内容
  fontSize?: number;        // 字号 (默认 48)
  fontFamily?: string;      // 字体 (默认 'Arial')
  fontColor?: string;       // 字体颜色（默认白色）
  backgroundColor?: string; // 背景色 (可选)
  textPosition?: 'top' | 'center' | 'bottom'; // 预设位置
  textAlign?: 'left' | 'center' | 'right';    // 文本对齐
  // ========== 编辑器扩展属性 ==========
  // 滤镜 / 动画 / 音频淡入淡出 / 蒙版：UI 在 SimplePropertiesPanel 中编辑，
  // 剪映导出器据此生成对应的剪映工程参数。
  filter?: ClipFilter;
  animations?: ClipAnimation[];
  audioFade?: AudioFade;          // 仅音频片段
  mask?: ClipMask;
}

export type TransitionType = 'fade';

export interface Transition {
  id: string;
  fromClipId: string;
  toClipId: string;
  type: TransitionType;
  duration: number; // overlap 时长（秒）
}

export interface Track {
  id: string;
  type: 'video' | 'audio' | 'text';
  clips: Clip[];
  transitions?: Transition[];
  isMainTrack?: boolean;
  order: number; // 轨道顺序，主轨道为 0，上方为正数，下方为负数
  name?: string;   // 轨道名称（可重命名）
  muted?: boolean; // 是否静音
  hidden?: boolean; // 是否隐藏（不渲染）
}

export interface ProjectState {
  tracks: Track[];
  currentTime: number;
  duration: number;
  selectedClipId: string | null;
  isPlaying: boolean;
}

// 插入位置信息
export interface InsertPosition {
  referenceOrder: number;
  position: 'above' | 'below';
}

// 时间线持久化数据
export interface TimelineData {
  version: number;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

// 素材来源类型
export type AssetSource = 'shot' | 'character' | 'scene' | 'prop' | 'upload';

// 素材面板用的素材项
export interface AssetItem {
  id: string;
  name: string;
  type: 'video' | 'image' | 'audio' | 'text';
  src: string;
  thumbnailSrc?: string;
  duration: number;
  width?: number;   // 素材宽度（像素）
  height?: number;  // 素材高度（像素）
  source: AssetSource;
  metadata?: {
    shotId?: string;
    characterId?: string;
    sceneId?: string;
    propId?: string;
  };
}

// 帧缓存元数据
export interface FrameCacheMeta {
  videoPath: string;
  videoHash: string;
  frameCount: number;
  framePaths: string[];
  createdAt: number;
}

// ========== 编辑器扩展属性类型 ==========
//
// 阶段 2-B 清理：JianyingKeyframe / JianyingKeyframeTrack / JianyingKeyframeProperty /
// ClipTransition 已删除，因 0 写入路径（无 UI 编辑入口、生产代码从未赋值；测试中
// 仅作为 mock 数据存在）。剪映导出器现从 Clip.keyframes 派生 transform 关键帧，
// 不再消费 jianyingKeyframeTracks 字段。
//
// 保留的字段（filter/animations/audioFade/mask）UI 在 SimplePropertiesPanel
// 真实编辑，其 ID/effectId/resourceId 虽然指向剪映资源系统，但作为编辑器内部
// 数据模型保留（语义为"用户在 UI 编辑的剪映导出参数"）。

// 滤镜定义
export interface ClipFilter {
  id: string;             // 滤镜效果 ID
  name: string;           // 显示名称
  resourceId?: string;    // 剪映资源 ID
  intensity: number;      // 强度 0-100
}

// 动画类型
export type ClipAnimationType = 'in' | 'out' | 'group';

// 动画定义
export interface ClipAnimation {
  type: ClipAnimationType;
  effectId: string;       // 动画效果 ID
  name?: string;          // 显示名称
  duration: number;       // 持续时间（秒）
}

// 音频淡入淡出
export interface AudioFade {
  fadeIn: number;         // 淡入时长（秒）
  fadeOut: number;        // 淡出时长（秒）
}

// 蒙版类型
export type MaskType = 'linear' | 'mirror' | 'circle' | 'rectangle' | 'heart' | 'star';

// 蒙版定义
export interface ClipMask {
  type: MaskType;
  centerX?: number;       // 中心 X（相对于素材，0 为中心）
  centerY?: number;       // 中心 Y（相对于素材，0 为中心）
  size?: number;          // 主要尺寸（0-1，相对于素材高度）
  width?: number;         // 宽度（仅矩形蒙版）
  rotation?: number;      // 旋转角度
  feather?: number;       // 羽化 0-100
  invert?: boolean;       // 是否反转
  roundCorner?: number;   // 圆角（仅矩形蒙版，0-100）
}
