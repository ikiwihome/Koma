/**
 * 七牛云图床 Provider - Backend Module
 * 固定经由 Koma 官方上传接口（https://komaapi.com）上传图片，
 * API Key 由用户在插件配置中填写。
 */

import type { ElectronPluginAPI } from '@komastudio/plugin-sdk';

interface QiniuConfig {
  apiKey?: string;
  enabled: boolean;
}

const UPLOAD_ENDPOINT = 'https://komaapi.com/v1/uploads/images';

const DEFAULT_CONFIG: QiniuConfig = {
  enabled: true,
};

interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
  data?: {
    filename?: string;
    key?: string;
    hash?: string;
    size?: number;
  };
}

interface UploadResponseBody {
  success?: boolean;
  message?: string;
  error?: string | { message?: string };
  msg?: string;
  url?: string;
  data?: {
    url?: string;
    filename?: string;
    key?: string;
    hash?: string;
    size?: number;
  };
}

async function parseUploadResponse(resp: Response): Promise<UploadResponseBody | null> {
  let text = '';
  try {
    text = await resp.text();
  } catch {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as UploadResponseBody;
  } catch {
    return { message: trimmed };
  }
}

function extractUploadMessage(result: UploadResponseBody | null): string {
  const candidates = [
    result?.message,
    typeof result?.error === 'string' ? result.error : result?.error?.message,
    result?.msg,
  ];
  const message = candidates.find((item) => typeof item === 'string' && item.trim());
  return typeof message === 'string' ? message.trim() : '';
}

function formatUploadError(resp: Response, result: UploadResponseBody | null): string {
  if (resp.status === 401 || resp.status === 403) {
    return `图床 API Key 无效或无上传权限，请到设置 → 插件 → 图床检查配置 (HTTP ${resp.status})`;
  }

  if (resp.status === 404) {
    return `上传接口不存在/端点配置错误: ${UPLOAD_ENDPOINT} (HTTP ${resp.status})`;
  }

  const message = extractUploadMessage(result);
  return message ? `${message} (HTTP ${resp.status})` : `上传失败 (HTTP ${resp.status})`;
}

class QiniuImageHostingProvider {
  private config: QiniuConfig;

  constructor(config: Record<string, unknown>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as QiniuConfig;
  }

  validate(): boolean {
    return Boolean(this.config.enabled);
  }

  private resolveApiKey(): string | null {
    return this.config.apiKey?.trim() || null;
  }

  async uploadImage(
    imageData: Buffer | ArrayBuffer | Uint8Array,
    options?: { filename?: string; mimeType?: string }
  ): Promise<UploadResult> {
    if (!this.validate()) {
      return { success: false, error: '图床未启用' };
    }

    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      return { success: false, error: '未配置图床 API Key，请到设置 → 插件 → 图床填写 API Key' };
    }

    try {
      const filename = options?.filename || `image_${Date.now()}.png`;
      const mimeType = options?.mimeType || this.guessMime(filename);

      const bytes = this.toUint8Array(imageData);
      const blob = new Blob([bytes], { type: mimeType });

      const formData = new FormData();
      formData.append('file', blob, filename);

      const resp = await fetch(UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      const result = await parseUploadResponse(resp);
      const uploadedUrl = result?.data?.url || result?.url;

      if (result?.success && uploadedUrl) {
        return {
          success: true,
          url: uploadedUrl,
          data: {
            filename: result.data?.filename,
            key: result.data?.key,
            hash: result.data?.hash,
            size: result.data?.size,
          },
        };
      }

      return {
        success: false,
        error: formatUploadError(resp, result),
      };
    } catch (err: any) {
      return { success: false, error: err?.message || '网络请求失败' };
    }
  }

  async uploadWithRetry(
    imageData: Buffer | ArrayBuffer | Uint8Array,
    options?: { filename?: string; mimeType?: string },
    maxRetries: number = 3
  ): Promise<UploadResult> {
    let lastError = '';
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const r = await this.uploadImage(imageData, options);
      if (r.success) return r;
      lastError = r.error || '未知错误';
      if (attempt < maxRetries) {
        await new Promise((rs) => setTimeout(rs, 1000 * Math.pow(2, attempt - 1)));
      }
    }
    return { success: false, error: `上传失败，已重试 ${maxRetries} 次: ${lastError}` };
  }

  async testConnection(): Promise<boolean> {
    if (!this.validate()) return false;
    const apiKey = this.resolveApiKey();
    if (!apiKey) return false;
    try {
      const testBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const buf = Buffer.from(testBase64, 'base64');
      const r = await this.uploadImage(buf, { filename: 'koma-qiniu-test.png' });
      return r.success;
    } catch {
      return false;
    }
  }

  private toUint8Array(data: Buffer | ArrayBuffer | Uint8Array): Uint8Array {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(Buffer.from(data as any));
  }

  private guessMime(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      heic: 'image/heic',
      ico: 'image/x-icon',
    };
    return map[ext] || 'image/png';
  }
}

export async function onActivate(api: ElectronPluginAPI): Promise<void> {
  api.log.info('[Qiniu Image Hosting] backend activated');

  const providerDef = {
    type: 'qiniu-image-hosting',
    kind: 'image-hosting' as const,
    name: '七牛云图床（内置）',
    description: '调用 Koma 官方上传接口（komaapi.com），返回七牛云 Kodo 外链并支持时间戳防盗链',
    capabilities: ['image-hosting'],
    defaultConfig: DEFAULT_CONFIG,
    factory: async (config: Record<string, unknown>) => {
      const saved = await api.channels.getProviderConfig('qiniu-image-hosting');
      const merged = { ...DEFAULT_CONFIG, ...saved, ...config };
      api.log.info('[Qiniu] create provider', { enabled: merged.enabled });
      return new QiniuImageHostingProvider(merged);
    },
  };

  await api.channels.registerProvider(providerDef as any);
}

export async function onDeactivate(): Promise<void> {
  // 无后台资源需要释放
}

export function createProvider(config: Record<string, unknown>): QiniuImageHostingProvider {
  return new QiniuImageHostingProvider(config);
}
