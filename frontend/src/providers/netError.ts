/**
 * ChannelNetError — 主进程 NetController 结构化错误的前端归一化
 *
 * 契约：`electron/controller/net.ts` 在代理/校验失败时返回
 *   `{ error: { code, message, type } }`（body 是 JSON 字符串）
 * 前端识别 code 后翻译为 i18n / 可操作 toast。
 */

/** 已知的后端错误码（与 net.ts / ChannelConfigService.ts 对齐） */
export type ChannelNetErrorCode =
  | 'channel_api_key_missing'
  | 'conflict_auth_mode'
  | 'duplicate_sensitive_header'
  | 'missing_channel_id_for_query_key'
  | 'missing_channel_id_for_raw_authorization'
  | 'invalid_query_key_name'
  | 'channel_api_key_decrypt_failed'
  | 'invalid_url'
  | 'unknown_error';

export interface ChannelNetError extends Error {
  code: ChannelNetErrorCode | string;
  status: number;
  channelId?: string;
  /** 'settings.error.<code>' — i18n key，调用方 t() 即可 */
  i18nKey: string;
  /** 是否适合提供"去配置"按钮（api-key/解密失败类 = true） */
  actionable: boolean;
  /** 原始响应体（已截断） */
  raw?: string;
}

export class ChannelApiKeyMissingError extends Error implements ChannelNetError {
  code = 'channel_api_key_missing' as const;
  status: number;
  channelId?: string;
  i18nKey = 'settings.error.channel_api_key_missing';
  actionable = true;
  raw?: string;

  constructor(status: number, channelId?: string, raw?: string) {
    super('该渠道未配置 API Key');
    this.name = 'ChannelApiKeyMissingError';
    this.status = status;
    this.channelId = channelId;
    this.raw = raw;
  }
}

const ACTIONABLE_CODES = new Set<string>([
  'channel_api_key_missing',
  'channel_api_key_decrypt_failed',
]);

/**
 * 解析主进程返回的结构化错误；非结构化响应降级为 unknown_error。
 */
export async function parseNetError(res: Response, channelId?: string): Promise<ChannelNetError> {
  let code: string = 'unknown_error';
  let message = res.statusText || `HTTP ${res.status}`;
  let raw: string | undefined;
  try {
    raw = await res.text();
    if (raw) {
      try {
        const body = JSON.parse(raw);
        const errorCode = body?.error?.code;
        const errorMsg = body?.error?.message;
        if (typeof errorCode === 'string' && errorCode.length > 0) {
          code = errorCode;
        }
        if (typeof errorMsg === 'string' && errorMsg.length > 0) {
          message = errorMsg;
        }
      } catch {
        // 非 JSON 响应：保留 raw 文本，code 维持 unknown_error
      }
    }
  } catch {
    // 读 body 失败也不阻塞抛错
  }

  if (code === 'channel_api_key_missing') {
    return new ChannelApiKeyMissingError(res.status, channelId, raw);
  }

  const err = new Error(message) as ChannelNetError;
  err.name = 'ChannelNetError';
  err.code = code;
  err.status = res.status;
  err.channelId = channelId;
  err.i18nKey = `settings.error.${code}`;
  err.actionable = ACTIONABLE_CODES.has(code);
  err.raw = raw?.slice(0, 1200);
  return err;
}

/** Antd notification / message 友好入口生成 */
export interface ToastDescriptor {
  message: string;
  description?: string;
  /** actionable 为 true 时，调用方可据此渲染"去配置"按钮 */
  channelId?: string;
  actionable: boolean;
}

export function translateToToast(
  err: unknown,
  t: (key: string) => string,
): ToastDescriptor {
  if (isChannelNetError(err)) {
    return {
      message: t(err.i18nKey) || err.message,
      description: err.message,
      channelId: err.channelId,
      actionable: err.actionable,
    };
  }
  const fallback = err instanceof Error ? err.message : String(err);
  return {
    message: t('settings.error.unknown_error') || fallback,
    description: fallback,
    actionable: false,
  };
}

export function isChannelNetError(err: unknown): err is ChannelNetError {
  return (
    !!err
    && typeof err === 'object'
    && 'code' in err
    && 'i18nKey' in err
    && 'status' in err
  );
}
