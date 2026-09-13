/**
 * 坐标转换基类和工具函数
 */

import type { CoordinateTransformer } from './types';

// 基础坐标转换器 - 直接透传（用于不需要转换的场景）
export class IdentityTransformer implements CoordinateTransformer {
  transformPosition(
    editorX: number,
    editorY: number,
    _canvasWidth: number,
    _canvasHeight: number
  ): { x: number; y: number } {
    return { x: editorX, y: editorY };
  }

  transformScale(editorScale: number): { scaleX: number; scaleY: number } {
    return { scaleX: editorScale, scaleY: editorScale };
  }

  transformRotation(editorRotation: number): number {
    return editorRotation;
  }

  transformOpacity(editorOpacity: number): number {
    return editorOpacity;
  }

  transformTime(seconds: number): number {
    return seconds;
  }

  transformTimeReverse(targetTime: number): number {
    return targetTime;
  }
}

// 工具函数：生成 UUID (与剪映兼容的格式)
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }).toUpperCase();
}

// 工具函数：生成不带连字符的 UUID (剪映部分字段使用)
export function generateHexId(): string {
  return generateUUID().replace(/-/g, '');
}

// 工具函数：获取文件扩展名
export function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.substring(lastDot + 1).toLowerCase();
}

// 工具函数：判断是否为视频文件
export function isVideoFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'm4v'].includes(ext);
}

// 工具函数：判断是否为图片文件
export function isImageFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(ext);
}

// 工具函数：判断是否为音频文件
export function isAudioFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'wma'].includes(ext);
}
