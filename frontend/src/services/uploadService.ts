/**
 * 素材上传服务
 * 处理文件上传、复制、缩略图生成等
 */
import { isElectron } from './electronService';
import type { AssetItem, AssetSource } from '../types/editor';
import { ffmpegManager } from './ffmpegManager';
import { DEFAULT_VIDEO_RESOLUTION } from '../constants/dimensions';
import { createLogger } from '../store/logger';

const logger = createLogger('UploadService');

// 生成唯一 ID
const generateId = () => `upload-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

// 获取文件类型
function getFileType(filename: string): 'video' | 'image' | 'audio' | null {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
  const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'aac'];

  if (videoExts.includes(ext)) return 'video';
  if (imageExts.includes(ext)) return 'image';
  if (audioExts.includes(ext)) return 'audio';
  return null;
}

// Electron API 接口
const getAssetAPI = (): any => {
  if (isElectron() && window.electronAPI?.assets) {
    return window.electronAPI.assets;
  }
  return null;
};

export interface UploadResult {
  success: boolean;
  asset?: AssetItem;
  error?: string;
}

/**
 * 上传单个文件
 */
export async function uploadFile(
  file: File,
  projectId: string,
  episodeId?: string
): Promise<UploadResult> {
  try {
    const type = getFileType(file.name);
    if (!type) {
      return { success: false, error: `不支持的文件类型: ${file.name}` };
    }

    const api = getAssetAPI();

    // 在 Electron 环境中使用原生 API
    if (api) {
      // 读取文件为 ArrayBuffer
      const buffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);

      // 调用 Electron API 保存文件
      const result = await api.saveUploadedFile({
        filename: file.name,
        data: uint8Array,
        projectId,
        episodeId,
        type,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // 获取媒体信息
      let duration = type === 'image' ? 3 : 0; // 图片默认 3 秒
      let thumbnailSrc = result.path;
      let width: number | undefined;
      let height: number | undefined;

      if (type === 'video' || type === 'audio') {
        try {
          const mediaInfo = await ffmpegManager.getMediaInfo(result.path);
          duration = mediaInfo.duration / 1000; // 转换为秒
          width = mediaInfo.width;
          height = mediaInfo.height;

          // 视频生成缩略图
          if (type === 'video' && mediaInfo.hasVideo) {
            const frames = await ffmpegManager.extractFrames({
              input: result.path,
              outputDir: result.cacheDir || '/tmp',
              fps: 1,
              endTime: 1,
              width: 320,
            });
            if (frames.length > 0) {
              thumbnailSrc = frames[0];
            }
          }
        } catch (err) {
          logger.warn('Failed to get media info', err);
          duration = 10; // 默认 10 秒
        }
      } else if (type === 'image') {
        // 获取图片尺寸
        try {
          const dims = await getImageDimensions(result.path);
          width = dims.width;
          height = dims.height;
        } catch (err) {
          logger.warn('Failed to get image dimensions', err);
        }
      }

      const asset: AssetItem = {
        id: generateId(),
        name: file.name,
        type,
        src: result.path,
        thumbnailSrc,
        duration,
        width,
        height,
        source: 'upload' as AssetSource,
      };

      return { success: true, asset };
    }

    // 浏览器环境（开发模式）- 使用 Blob URL
    const blobUrl = URL.createObjectURL(file);
    let duration = type === 'image' ? 3 : 0;
    let width: number | undefined;
    let height: number | undefined;

    if (type === 'video') {
      const info = await getVideoDurationAndSize(blobUrl);
      duration = info.duration;
      width = info.width;
      height = info.height;
    } else if (type === 'audio') {
      duration = await getAudioDuration(blobUrl);
    } else if (type === 'image') {
      const dims = await getImageDimensionsFromUrl(blobUrl);
      width = dims.width;
      height = dims.height;
    }

    const asset: AssetItem = {
      id: generateId(),
      name: file.name,
      type,
      src: blobUrl,
      thumbnailSrc: type === 'video' || type === 'image' ? blobUrl : undefined,
      duration,
      width,
      height,
      source: 'upload' as AssetSource,
    };

    return { success: true, asset };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * 批量上传文件
 */
export async function uploadFiles(
  files: File[],
  projectId: string,
  episodeId?: string,
  onProgress?: (current: number, total: number) => void
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const result = await uploadFile(files[i], projectId, episodeId);
    results.push(result);
    onProgress?.(i + 1, files.length);
  }

  return results;
}

// 获取视频时长和尺寸
function getVideoDurationAndSize(src: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({
        duration: video.duration || 10,
        width: video.videoWidth || DEFAULT_VIDEO_RESOLUTION.width,
        height: video.videoHeight || DEFAULT_VIDEO_RESOLUTION.height,
      });
    };
    video.onerror = () => {
      resolve({ duration: 10, width: DEFAULT_VIDEO_RESOLUTION.width, height: DEFAULT_VIDEO_RESOLUTION.height });
    };
    video.src = src;
  });
}

// 获取图片尺寸（从 URL）
function getImageDimensionsFromUrl(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || DEFAULT_VIDEO_RESOLUTION.width, height: img.naturalHeight || DEFAULT_VIDEO_RESOLUTION.height });
    };
    img.onerror = () => {
      resolve({ width: DEFAULT_VIDEO_RESOLUTION.width, height: DEFAULT_VIDEO_RESOLUTION.height });
    };
    img.src = src;
  });
}

// 获取图片尺寸（Electron 环境，使用 koma-local 协议）
function getImageDimensions(path: string): Promise<{ width: number; height: number }> {
  // 转换为可加载的 URL
  const url = path.startsWith('koma-local://') ? path : `koma-local://${path.replace(/\\/g, '/')}`;
  return getImageDimensionsFromUrl(url);
}

// 获取音频时长
function getAudioDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      resolve(audio.duration || 10);
    };
    audio.onerror = () => {
      resolve(10);
    };
    audio.src = src;
  });
}

export default {
  uploadFile,
  uploadFiles,
};
