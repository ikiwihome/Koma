/**
 * 视频和图像尺寸常量
 * 统一管理项目中的硬编码尺寸值
 */

// 视频分辨率预设
export const VIDEO_RESOLUTIONS = {
  '4K': { width: 3840, height: 2160, label: '4K' },
  '1080p': { width: 1920, height: 1080, label: '1080p' },
  '720p': { width: 1280, height: 720, label: '720p' },
  '480p': { width: 854, height: 480, label: '480p' },
  // 竖屏分辨率
  '1080p_portrait': { width: 1080, height: 1920, label: '1080p (竖屏)' },
} as const;

// 默认视频分辨率
export const DEFAULT_VIDEO_RESOLUTION = VIDEO_RESOLUTIONS['1080p'];

// 缩略图尺寸
export const THUMBNAIL_SIZE = {
  width: 600,
  height: 338,
} as const;

// 图像生成尺寸
export const IMAGE_GENERATION_SIZES = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1536, height: 1024 },
  portrait: { width: 1024, height: 1536 },
  video_frame: { width: 1920, height: 1080 },
  comfyui_default: { width: 512, height: 512 },
} as const;

// Provider 默认尺寸
export const PROVIDER_DEFAULT_SIZES = {
  runway: { width: 1280, height: 720 },
  kling: { width: 1280, height: 720 },
  comfyui: { width: 512, height: 512 },
} as const;

// 默认播放配置
export const DEFAULT_PLAYBACK_CONFIG = {
  fps: 30,
  width: 1920,
  height: 1080,
} as const;

// 生成占位缩略图 URL
export function getThumbnailUrl(seed: string): string {
  return `https://picsum.photos/seed/${seed}/${THUMBNAIL_SIZE.width}/${THUMBNAIL_SIZE.height}`;
}
