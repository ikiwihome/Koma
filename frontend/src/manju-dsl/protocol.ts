/**
 * Manju-DSL 协议定义
 * 用于视频编辑项目的导入导出格式
 */

// ========== 协议版本 ==========
export const MANJU_DSL_VERSION = '1.0.0';

// ========== 核心类型 ==========

export interface ManjuProject {
  version: string;
  meta: ManjuMeta;
  characters: ManjuCharacter[];
  scenes: ManjuScene[];
  shots: ManjuShot[];
  timeline?: ManjuTimeline;
}

export interface ManjuMeta {
  id: string;
  title: string;
  genre: string;
  mode: 'drama' | 'narration';
  createdAt: string;
  updatedAt: string;
  description?: string;
  author?: string;
}

export interface ManjuCharacter {
  id: string;
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting';
  age?: string;
  gender?: 'male' | 'female' | 'neutral' | 'unknown';
  description: string;
  appearance: string;
  voiceId?: string;
  avatar?: string;  // base64 或 URL
}

export interface ManjuScene {
  id: string;
  name: string;
  location: string;
  time: 'day' | 'night' | 'twilight';
  mood: string;
  description: string;
}

export interface ManjuShot {
  id: string;
  sceneId?: string;
  scriptContent: string;
  shotType: 'close-up' | 'medium' | 'wide' | 'extreme-wide';
  cameraMovement: 'static' | 'pan' | 'zoom-in' | 'tracking' | 'handheld';
  duration: number;
  prompt: string;
  characterIds: string[];
  dialogue?: string;
  emotion?: string;
  seed?: number;
  assets?: {
    image?: string;  // 相对路径或 base64
    video?: string;
    audio?: string;
  };
}

export interface ManjuTimeline {
  fps: number;
  resolution: {
    width: number;
    height: number;
  };
  tracks: ManjuTrack[];
}

export interface ManjuTrack {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'subtitle';
  clips: ManjuClip[];
}

export interface ManjuClip {
  id: string;
  shotId?: string;  // 关联分镜
  startTime: number;
  duration: number;
  source?: string;  // 相对路径
  transform?: {
    x?: number;
    y?: number;
    scale?: number;
    rotation?: number;
    opacity?: number;
  };
  keyframes?: ManjuKeyframe[];
  text?: string;  // 字幕
}

export interface ManjuKeyframe {
  time: number;
  property: string;
  value: number;
  easing?: string;
}

// ========== 导出格式 ==========

export interface ManjuExportOptions {
  includeAssets: boolean;  // 是否打包资源文件
  format: 'json' | 'zip';  // 导出格式
  compress: boolean;       // 是否压缩
}

// ========== 验证 ==========

export function validateManjuProject(data: any): data is ManjuProject {
  if (!data || typeof data !== 'object') return false;
  if (!data.version || !data.meta) return false;
  if (!data.meta.id || !data.meta.title) return false;
  return true;
}

// ========== 导入导出 ==========
//
// 注意：ManjuTimeline / ManjuTrack / ManjuClip / ManjuKeyframe 等接口保留为协议定义
// （未来恢复 timeline round-trip 时使用），但当前 export/import 路径不处理 timeline。
// 应用内 timeline 实际数据模型见 types/editor.ts。

import type {
  ProjectMeta,
  Character,
  Scene,
  Shot,
} from '../types';
import { getShotScriptText, scriptLinesFromText } from '../types';
import {
  getCharacterCostumePhotoSource,
  getShotCurrentImageSource,
  getShotCurrentVideoSource,
} from '../utils/mediaSelectors';
import { createStoredMediaAsset } from '../utils/mediaAssets';

/**
 * 将内部项目数据转换为 Manju-DSL 格式
 */
export function exportToManjuDSL(
  project: ProjectMeta,
  characters: Character[],
  scenes: Scene[],
  shots: Shot[]
): ManjuProject {
  // 转换元数据
  const meta: ManjuMeta = {
    id: project.id,
    title: project.title,
    genre: project.genre,
    mode: project.mode,
    createdAt: new Date(project.createdAt).toISOString(),
    updatedAt: new Date(project.updatedAt).toISOString(),
  };

  // 转换角色
  const manjuCharacters: ManjuCharacter[] = characters.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    age: c.age,
    gender: c.gender,
    description: c.description || '',
    appearance: c.appearance || '',
    voiceId: c.voiceId,
    avatar: getCharacterCostumePhotoSource(c),
  }));

  // 转换场景
  const manjuScenes: ManjuScene[] = scenes.map((s) => ({
    id: s.id,
    name: s.name,
    location: s.location ?? '',
    time: s.time ?? 'day',
    mood: s.mood ?? '',
    description: s.description || '',
  }));

  // 转换分镜
  const manjuShots: ManjuShot[] = shots.map((s) => {
    const imageSource = getShotCurrentImageSource(s);
    const videoSource = getShotCurrentVideoSource(s);
    return {
      id: s.id,
      scriptContent: getShotScriptText(s),
      shotType: s.shotType,
      cameraMovement: s.cameraMovement,
      duration: s.duration,
      prompt: s.imagePrompt || '',
      characterIds: s.characters,
      dialogue: s.dialogue,
      emotion: s.emotion,
      seed: s.seed,
      assets: imageSource || videoSource
        ? {
            image: imageSource,
            video: videoSource,
          }
        : undefined,
    };
  });

  return {
    version: MANJU_DSL_VERSION,
    meta,
    characters: manjuCharacters,
    scenes: manjuScenes,
    shots: manjuShots,
    // timeline: 暂不支持 round-trip，保持 undefined
  };
}

/**
 * 将 Manju-DSL 格式转换为内部项目数据
 */
export interface ImportedProjectData {
  project: ProjectMeta;
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
  /**
   * @deprecated importFromManjuDSL 不再生产 timeline；保留字段作为"manju 文件中
   * 包含 timeline 但当前不支持 round-trip"的信号位，让 importProjectFromManjuFile
   * 等消费方能 warn 用户。具体类型不限，存在即触发 warn。
   */
  timeline?: unknown;
}

export function importFromManjuDSL(manju: ManjuProject): ImportedProjectData {
  // 转换元数据
  const project: ProjectMeta = {
    id: manju.meta.id,
    title: manju.meta.title,
    genre: manju.meta.genre,
    mode: manju.meta.mode,
    createdAt: new Date(manju.meta.createdAt).getTime(),
    updatedAt: new Date(manju.meta.updatedAt).getTime(),
  };

  // 转换角色
  const characters: Character[] = manju.characters.map((c) => {
    const promptParts: string[] = [];
    if (c.appearance) promptParts.push(c.appearance);
    if (c.description) promptParts.push(c.description);
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    age: c.age || '未知',
    gender: c.gender || 'unknown',
    prompt: promptParts.join('\n') || '',
    voiceId: c.voiceId,
    media: c.avatar
        ? {
            costumePhoto: createStoredMediaAsset('image', { remoteUrl: c.avatar }),
          }
        : undefined,
      // 保留旧字段用于兼容
    description: c.description,
    appearance: c.appearance,
  };
  });

  // 转换场景
  const scenes: Scene[] = manju.scenes.map((s) => {
    const promptParts: string[] = [];
    if (s.location) promptParts.push(`Location: ${s.location}`);
    if (s.time) promptParts.push(`Time: ${s.time}`);
    if (s.mood) promptParts.push(`Mood: ${s.mood}`);
    if (s.description) promptParts.push(s.description);
    return {
      id: s.id,
      name: s.name,
      prompt: promptParts.join('\n') || '',
      // 保留旧字段用于兼容
      location: s.location,
      time: s.time,
      mood: s.mood,
      description: s.description,
    };
  });

  // 转换分镜
  const shots: Shot[] = manju.shots.map((s) => ({
    id: s.id,
    scriptLines: scriptLinesFromText(s.scriptContent),
    shotType: s.shotType,
    cameraMovement: s.cameraMovement,
    duration: s.duration,
    imagePrompt: s.prompt,
    characters: s.characterIds,
    dialogue: s.dialogue,
    emotion: s.emotion,
    seed: s.seed,
    media: s.assets?.image || s.assets?.video
      ? {
          images: s.assets?.image
            ? [createStoredMediaAsset('image', { remoteUrl: s.assets.image })]
            : undefined,
          videos: s.assets?.video
            ? [createStoredMediaAsset('video', { remoteUrl: s.assets.video })]
            : undefined,
          currentImageIndex: s.assets?.image ? 0 : undefined,
          currentVideoIndex: s.assets?.video ? 0 : undefined,
        }
      : undefined,
  }));

  // 当前不处理 manju.timeline；保留信号位让消费方知道 timeline 被丢弃。
  const result: ImportedProjectData = { project, characters, scenes, shots };
  if (manju.timeline) {
    result.timeline = manju.timeline;
  }
  return result;
}

// 历史 timeline 转换函数（convertTrackToManju / convertClipToManju /
// convertManjuToTrack / convertManjuToClip / calculateTimelineDuration /
// toEasingType）已删除：types.ts 旧 timeline 数据模型与 types/editor.ts
// 实际数据模型字段不一致，转换从未生效。如需恢复 round-trip，应基于
// types/editor.ts 的 Track/Clip 重写。
