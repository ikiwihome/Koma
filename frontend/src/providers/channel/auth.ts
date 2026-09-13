/**
 * ChannelAuth Strategy — 渠道凭据代理的前端统一抽象
 *
 * 底层逻辑：HTTP 媒体 provider 不再各自拼 `x-koma-channel-id` header，
 * 改走本模块；行为与 `electron/controller/net.ts` 的代理模式对齐。
 *
 * 三种策略：
 *  - bearer-header:     `x-koma-channel-id: <channelId>`
 *                       → 主进程注入 `Authorization: Bearer <apiKey>`
 *  - query-key:         `x-koma-channel-id` + `x-koma-channel-query-key-name: <name>`
 *                       → 主进程把 apiKey 注入到 URL query
 *  - raw-authorization: `x-koma-channel-id` + `x-koma-channel-raw-authorization: true`
 *                       → 主进程注入 `Authorization: <apiKey>`（不加 Bearer 前缀）
 *                       仅在上游不接受 Bearer 时启用（需后端 B4b 落地）
 *
 * 回退：channelId 缺失时使用 apiKey（明文），用于未保存到 SQLite 的临时配置。
 * 防御：拦截 '$ENC$' 占位符，视为"无可用凭据"（Secret Intent 迁移后可清理）。
 */
import { safeFetch } from '../../utils/safeFetch';
import { parseNetError } from '../netError';

export type ChannelAuthMode = 'bearer-header' | 'query-key' | 'raw-authorization';

export interface ChannelAuthOptions {
  /** 已保存渠道的 channelId（profileId）。有则走主进程代理；无则回退明文 apiKey。 */
  channelId?: string;
  /** 前端持有的明文 apiKey（回退用，或未保存场景）。禁止传 '$ENC$'。 */
  apiKey?: string;
  /** 代理模式 */
  mode: ChannelAuthMode;
  /** mode='query-key' 时必填；主进程据此把 apiKey 注入 URL。 */
  queryKeyName?: string;
  /** 业务自定义 header（不应包含 Authorization / x-koma-channel-* 内部 marker） */
  headers?: Record<string, string>;
}

export interface BuiltChannelAuthRequest {
  /** 最终请求 URL（query-key 回退模式会在此拼 query；代理模式主进程拼） */
  url: (base: string) => string;
  /** 最终请求 header */
  headers: Record<string, string>;
}

const ENC_PLACEHOLDER = '$ENC$';

function isUsableApiKey(key?: string): key is string {
  return typeof key === 'string' && key.length > 0 && key !== ENC_PLACEHOLDER;
}

/**
 * 构造请求的 header + URL-build 函数；不发请求。
 * Provider 如果要自己调 safeFetch / multipart，用此 API；
 * 否则优先用 {@link fetchWithChannelAuth}。
 */
export function buildChannelAuthRequest(opts: ChannelAuthOptions): BuiltChannelAuthRequest {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };

  if (opts.channelId) {
    headers['x-koma-channel-id'] = opts.channelId;
    if (opts.mode === 'query-key') {
      if (!opts.queryKeyName) {
        throw new Error('ChannelAuth: queryKeyName required for mode=query-key');
      }
      headers['x-koma-channel-query-key-name'] = opts.queryKeyName;
    } else if (opts.mode === 'raw-authorization') {
      headers['x-koma-channel-raw-authorization'] = 'true';
    }
    // bearer-header 模式：主进程默认注入 `Authorization: Bearer <apiKey>`，无须额外 header
    return {
      url: (base) => base,
      headers,
    };
  }

  // 回退：channelId 缺失 → 用前端明文 apiKey
  if (!isUsableApiKey(opts.apiKey)) {
    throw Object.assign(new Error('channel_api_key_missing'), { code: 'channel_api_key_missing' });
  }
  const apiKey = opts.apiKey;

  if (opts.mode === 'query-key') {
    if (!opts.queryKeyName) {
      throw new Error('ChannelAuth: queryKeyName required for mode=query-key');
    }
    const qname = opts.queryKeyName;
    return {
      url: (base) => {
        const u = new URL(base);
        u.searchParams.set(qname, apiKey);
        return u.toString();
      },
      headers,
    };
  }

  if (opts.mode === 'raw-authorization') {
    headers['Authorization'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return {
    url: (base) => base,
    headers,
  };
}

export interface FetchWithChannelAuthInit extends ChannelAuthOptions {
  fetchOptions?: RequestInit;
}

/**
 * 高阶封装：内部调 safeFetch，非 2xx 自动 parseNetError 并抛 ChannelNetError。
 * 适合绝大多数 JSON API 调用。
 */
export async function fetchWithChannelAuth(
  url: string,
  init: FetchWithChannelAuthInit,
): Promise<Response> {
  const built = buildChannelAuthRequest(init);
  const finalUrl = built.url(url);
  const baseHeaders = { ...(init.fetchOptions?.headers as Record<string, string> | undefined ?? {}) };
  const mergedHeaders = { ...baseHeaders, ...built.headers };

  const response = await safeFetch(finalUrl, {
    ...init.fetchOptions,
    headers: mergedHeaders,
  });
  if (!response.ok) {
    throw await parseNetError(response, init.channelId);
  }
  return response;
}
