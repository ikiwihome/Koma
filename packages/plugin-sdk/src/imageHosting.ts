/**
 * 图床 Provider 类型定义
 * 用于上传图片到远程图床，获取可访问的 URL
 */

import type { PollingConfig } from './provider';

// 上传选项
export interface ImageHostingUploadOptions {
  // 输出格式
  outputFormat?: 'auto' | 'jpeg' | 'png' | 'webp' | 'gif' | 'webp_animated';
  // CDN 域名
  cdnDomain?: string;
  // 原始文件名（用于日志）
  filename?: string;
}

// 上传结果
export interface ImageHostingUploadResult {
  success: boolean;
  url?: string;
  error?: string;
  data?: {
    filename: string;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
  };
}

// 图床 Provider 接口
export interface ImageHostingProvider {
  /**
   * 上传图片
   * @param imageData 图片数据（Buffer 或 Blob）
   * @param options 上传选项
   * @returns 上传结果
   */
  uploadImage(
    imageData: Buffer | Blob | ArrayBuffer,
    options?: ImageHostingUploadOptions
  ): Promise<ImageHostingUploadResult>;
}

// 图床 Provider 定义（用于插件注册）
export interface ImageHostingProviderDefinition {
  type: string;
  kind: 'image-hosting';
  name: string;
  description?: string;
  factory: (config: Record<string, any>, ctx: any) => ImageHostingProvider;
  capabilities?: string[];
  pluginId?: string;
  configSchema?: Record<string, any>;
  defaultConfig?: Record<string, any>;
  polling?: PollingConfig;
}
