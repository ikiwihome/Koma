/**
 * 应用类型 entry point
 *
 * P1#4 拆分 + 阶段 1 清理后：原 700 行上帝文件已物理拆分到 types/ 子目录，
 * 死代码（与 types/editor.ts 字段不兼容的旧 Clip/Track/Timeline/Keyframe/
 * MediaType/EasingType + 0 消费者的 CacheInfo/VideoResult）已删除。
 *
 * 本文件保留作为兼容的统一 import path（"import { X } from '../types'" 不变），
 * 主要做 re-export + 少量未拆分小类型（EditorStep / WorkflowProgress / AppPage /
 * Voice / TTSOptions / AudioResult / ITVOptions / ProgressInfo）。
 *
 * 已拆出主题：
 *   types/project.ts          Project / Episode / ThemePreset / ProjectMeta / SaveStatus 等
 *   types/scene-character.ts  Character / Scene / Prop / Shot / ShotVersion 等
 *   types/task.ts             AsyncTask 系列
 *   types/provider-config.ts  各 Config / AppSettings / *ProviderType 等
 *   types/asset-library.ts    Asset (项目级素材库；与 types/editor.ts 的 Asset 不同实体)
 *   types/media.ts            StoredMediaAsset / Provider*Request / MediaSlots 等
 *
 * 应用内 timeline 数据模型现住在 types/editor.ts (Clip/Track/Asset 剪映兼容形态)
 * 与 types/track.ts (TrackLine/TrackKeyframe 形态)，分别服务不同 UI 通路；
 * 它们的统一属于独立"数据模型重构"epic（阶段 2，待讨论）。
 */

// ========== Re-export from types/ subdirectory ==========

export type {
  MediaKind,
  MediaAssetSource,
  ProviderAssetInput,
  StoredMediaAsset,
  MediaOwnerRef,
  ProviderStartResult,
  ProviderTaskSnapshot,
  VideoGenerationCapability,
  TTIRequest,
  ITVRequest,
  TTSRequest,
  CharacterMediaSlots,
  SceneMediaSlots,
  PropMediaSlots,
  ShotMediaState,
  ShotVersionMediaState,
} from './types/media';
export type {
  ChannelConfig,
  MediaDefaults,
  MediaModelSelection,
} from './providers/channel/types';
export {
  getITVRequestReferenceAssets,
  getMediaAssetDisplaySource,
  getMediaAssetEditingSource,
  getMediaAssetSource,
  isImageToVideoRequest,
  isReferenceToVideoRequest,
  isStartEndToVideoRequest,
  isTextToVideoRequest,
  isBlobUri,
  isDataUri,
  isRemoteMediaUri,
} from './types/media';

export type {
  StylePresetSourceType,
  ProjectStyleSnapshot,
  Project,
  EpisodeStepProgress,
  Episode,
  EpisodeAnalysis,
  EpisodeRef,
  ThemePreset,
  StorageConfig,
  ProjectMeta,
  RecentProject,
  SaveStatus,
  ProjectSaveState,
} from './types/project';

export type {
  AssetTimestampRange,
  CharacterGender,
  Character,
  Scene,
  Prop,
  ShotVideo,
  Shot,
  ShotImageMode,
  ShotScriptLine,
  ShotVideoMode,
  ScriptAnalysisResult,
  ShotVersion,
  ShotMeta,
} from './types/scene-character';
export {
  makeScriptLineId,
  scriptLinesFromText,
  scriptLinesToText,
  getShotScriptText,
  createScriptLine,
} from './types/shot-script';

export type {
  AsyncTaskType,
  AsyncTaskStatus,
  AsyncTaskTargetType,
  AsyncTask,
} from './types/task';

export type {
  ModelProviderType,
  LLMProviderType,
  TTIProviderType,
  ITVProviderType,
  TTSProviderType,
  MediaProviderConfig,
  TTIModelConfig,
  ITVModelConfig,
  TTSModelConfig,
  ResolvedTTIConfig,
  ResolvedITVConfig,
  ResolvedTTSConfig,
  ProviderPreset,
  LLMModelConfig,
  LLMChannelPreset,
  ModelConfig,
  TTSConfig,
  ITVConfig,
  AppThemeId,
  AppSettings,
} from './types/provider-config';

// ========== 编辑器步骤（待 P0#3 续刀彻底数据驱动） ==========

// 编辑器当前的步骤状态 (3步流程)
export type EditorStep = 'script' | 'assets' | 'storyboard' | 'video';

// ========== 项目素材库 ==========

export type { Asset } from './types/asset-library';

// ========== 工作流类型 ==========

export type WorkflowType =
  | 'shot-render'         // 分镜渲染：图 → 音 → 视
  | 'batch-render'        // 批量渲染
  | 'script-analysis'     // 剧本分析
  | 'export';             // 导出

export interface WorkflowProgress {
  workflowId: string;
  type: WorkflowType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;       // 0-100
  currentStep?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

// ========== 页面路由 ==========

export type AppPage =
  | 'projects'            // 项目列表
  | 'editor'              // 编辑器
  | 'settings'            // 设置
  | 'export';             // 导出

// ========== TTS 类型 ==========

import type { TTSProviderType } from './types/provider-config';

export interface Voice {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral' | 'unknown';
  provider: TTSProviderType;
  previewUrl?: string;
}

export interface TTSOptions {
  rate?: number;          // 语速 0.5-2.0
  pitch?: number;         // 音调 0.5-2.0
  volume?: number;        // 音量 0-1
}

export interface AudioResult {
  path: string;
  duration: number;
  sampleRate?: number;
  format?: string;  // 音频格式，如 'mp3', 'wav'
}

// ========== ITV 类型 ==========

export interface ITVOptions {
  model?: string;
  duration?: number;      // 视频时长（秒）
  resolution?: string;    // 分辨率 "1280x720"
  fps?: number;           // 帧率
  motionStrength?: number;// 运动强度 0-1
  movementAmplitude?: 'auto' | 'small' | 'medium' | 'large';
  cameraMotion?: 'static' | 'pan-left' | 'pan-right' | 'zoom-in' | 'zoom-out';
  motionPrompt?: string;  // 运动描述
  startFrame?: string;    // 首帧图片路径
  endFrame?: string;      // 尾帧图片路径
  aspectRatio?: string;   // 宽高比 16:9, 9:16, 1:1
  offPeak?: boolean;
  isRecommendedPrompt?: boolean;
  bgm?: boolean;
  watermark?: boolean;
  watermarkPosition?: number;
  watermarkUrl?: string;
  payload?: string;
  metaData?: string;
  // ComfyUI AnimateDiff 扩展
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
}

export interface ProgressInfo {
  taskId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  estimatedTime?: number;
  resultUrl?: string;
  error?: string;
}
