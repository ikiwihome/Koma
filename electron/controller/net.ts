import { net as electronNet } from 'electron';
import { BaseController } from './base';
import { validateUrl } from '../service/url-validator';
import { getDecryptedApiKey } from '../service/settings/ChannelConfigService';

// 每个 chunk 之间的最大空闲时间（5 分钟，兼容慢模型的首 token 等待）
const CHUNK_IDLE_TIMEOUT_MS = 300_000;
// 最大重试次数（应对代理断连 UND_ERR_SOCKET）
const MAX_RETRIES = 2;
// 可重试的错误码
const RETRYABLE_CODES = new Set([
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_TIMED_OUT',
]);

function getHeaderValue(headers: Record<string, string> | undefined, key: string): string | undefined {
  if (!headers) return undefined;
  const target = key.toLowerCase();
  const foundKey = Object.keys(headers).find(k => k.toLowerCase() === target);
  return foundKey ? headers[foundKey] : undefined;
}

function summarizeBody(body?: string): Record<string, any> {
  if (!body) {
    return {};
  }

  try {
    const parsed = JSON.parse(body);
    return {
      bodyLength: body.length,
      model: parsed?.model,
      messageCount: Array.isArray(parsed?.messages) ? parsed.messages.length : undefined,
      hasSystem: typeof parsed?.system === 'string' && parsed.system.length > 0,
    };
  } catch {
    return {
      bodyLength: body.length,
    };
  }
}

type MultipartField =
  | { kind: 'text'; name: string; value: string }
  | { kind: 'file'; name: string; filename: string; contentType?: string; base64: string; size: number };

type MultipartPayload = { fields: MultipartField[] };

function summarizeMultipart(multipart?: MultipartPayload): Record<string, any> {
  if (!multipart?.fields?.length) return {};
  let files = 0;
  let bytes = 0;
  for (const f of multipart.fields) {
    if (f.kind === 'file') {
      files += 1;
      bytes += Number(f.size || 0) || 0;
    }
  }
  return { multipartFieldCount: multipart.fields.length, multipartFileCount: files, multipartBytes: bytes };
}

function stripContentType(headers: Record<string, string>): void {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'content-type') delete headers[k];
  }
}

function stripContentLength(headers: Record<string, string>): void {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'content-length') delete headers[k];
  }
}

function escapeHeaderValue(value: string): string {
  // Keep it minimal: prevent breaking out of quotes in Content-Disposition.
  return value.replace(/"/g, '_');
}

function buildMultipartFormData(multipart?: MultipartPayload): FormData {
  const formData = new FormData();
  for (const f of multipart?.fields || []) {
    if (!f?.name) continue;
    if (f.kind === 'text') {
      formData.append(f.name, String(f.value ?? ''));
      continue;
    }
    if (f.kind === 'file') {
      const filename = escapeHeaderValue(String(f.filename || 'file'));
      const contentType = f.contentType ? String(f.contentType) : 'application/octet-stream';
      const bytes = Buffer.from(String(f.base64 ?? ''), 'base64');
      formData.append(f.name, new Blob([bytes], { type: contentType }), filename);
    }
  }
  return formData;
}

function isRetryable(err: any): boolean {
  const codes = [err?.cause?.code, err?.code, err?.errno].filter(Boolean);
  if (codes.some(code => RETRYABLE_CODES.has(code))) {
    return true;
  }
  const message = [err?.message, err?.cause?.message].filter(Boolean).join(' ');
  return /UND_ERR_CONNECT_TIMEOUT|ERR_CONNECTION_(?:TIMED_OUT|RESET|REFUSED)|timed out|ECONNRESET|ECONNREFUSED/i.test(message);
}

// 上游瞬态错误关键字：HTTP/2 stream reset / curl 92 / 上游 LLM 网关 5xx 包装、
// rate limit、上游网关与真正模型服务之间的瞬时连接抖动等。命中即按"瞬态故障"重试。
const UPSTREAM_TRANSIENT_PATTERNS: RegExp[] = [
  /upstream_error/i,
  /server_error/i,
  /HTTP\/2 stream\s+\d+\s+was not closed cleanly/i,
  /INTERNAL_ERROR/,
  /Failed to perform/i,
  /curl:\s*\(\d+\)/i,
  /Bad Gateway/i,
  /Service (?:Temporarily )?Unavailable/i,
  /Gateway Timeout/i,
  /rate.?limit/i,
];

/**
 * 响应级重试判定：HTTP 5xx / 429 或响应体包含上游瞬态故障关键字 → 重试。
 * POST /v1/images/edits、/v1/chat/completions 等"创建任务"端点在尚未真正提交给上游模型前的失败，
 * 本身没有副作用，重试是安全的；上游已开始处理才失败的 5xx 重试也最多多生成一份图，可接受。
 */
function isRetryableResponse(status: number, bodyBytes: Uint8Array): boolean {
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const text = decodeBodyPreview(bodyBytes, 1200);
  return UPSTREAM_TRANSIENT_PATTERNS.some(re => re.test(text));
}

function decodeBodyPreview(bodyBytes: Uint8Array, maxBytes: number): string {
  if (!bodyBytes || bodyBytes.length === 0) return '';
  // best-effort：响应体很可能是 JSON 文本；非 UTF-8 字节不影响关键字判定（ascii 子集足够）
  const slice = bodyBytes.length > maxBytes ? bodyBytes.subarray(0, maxBytes) : bodyBytes;
  try {
    return Buffer.from(slice).toString('utf-8');
  } catch {
    return '';
  }
}

function getFetchTransport(): {
  transport: 'electron-net' | 'global-fetch';
  request: typeof fetch;
} {
  if (typeof electronNet?.fetch === 'function') {
    return {
      transport: 'electron-net',
      request: electronNet.fetch.bind(electronNet) as typeof fetch,
    };
  }
  return {
    transport: 'global-fetch',
    request: fetch.bind(globalThis),
  };
}

function getMultipartFetchTransport(): {
  transport: 'electron-net' | 'global-fetch';
  request: typeof fetch;
} {
  if (typeof electronNet?.fetch === 'function') {
    return {
      transport: 'electron-net',
      request: electronNet.fetch.bind(electronNet) as typeof fetch,
    };
  }
  return {
    transport: 'global-fetch',
    request: fetch.bind(globalThis),
  };
}

/**
 * 用 ReadableStream reader 逐块读取响应体到 Uint8Array。
 * 不再用 TextDecoder——之前对二进制响应（PNG/JPG）会把非 UTF-8 字节替换为 U+FFFD，
 * arrayBuffer() 拿到的是乱码 string 的 UTF-8 编码、跟原始字节完全不同。
 * 这里返回原始字节，IPC 层再统一 base64 透传给 renderer。
 */
async function readBodyChunked(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const ab = await response.arrayBuffer();
    return new Uint8Array(ab);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const timer = setTimeout(() => reader.cancel('chunk idle timeout'), CHUNK_IDLE_TIMEOUT_MS);
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } catch (err: any) {
      clearTimeout(timer);
      if (String(err).includes('chunk idle timeout')) {
        throw new Error(`响应数据中断，${CHUNK_IDLE_TIMEOUT_MS / 1000} 秒未收到新数据`);
      }
      throw err;
    }
    clearTimeout(timer);

    if (result.done) break;
    if (result.value && result.value.length > 0) {
      chunks.push(result.value);
      total += result.value.length;
    }
  }

  if (chunks.length === 1) return chunks[0];
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/** 主进程产出的错误响应也通过同一个 base64 通道，避免 renderer 端再分支。 */
function textToBase64(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64');
}

function jsonErrorBase64(payload: unknown): string {
  return textToBase64(JSON.stringify(payload));
}

function truncateString(value: string, max = 6000): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...(truncated, ${value.length} chars)`;
}

class NetController extends BaseController {
  async fetch(args: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    multipart?: MultipartPayload;
  }) {
    // SSRF 防护：校验协议 + 私有 IP 过滤
    await validateUrl(args.url);

    const traceId = getHeaderValue(args.headers, 'x-koma-trace-id');
    const traceSource = getHeaderValue(args.headers, 'x-koma-trace-source');
    const traceOperation = getHeaderValue(args.headers, 'x-koma-trace-operation');
    const traceTarget = getHeaderValue(args.headers, 'x-koma-trace-target');
    const debugBody = getHeaderValue(args.headers, 'x-koma-debug-body');

    // ---------- Sensitive header 校验（敏感头重复/冲突 → 400） ----------
    // 用于检测同一语义 header 的大小写变体重复
    const SENSITIVE_HEADER_NAMES = [
      'authorization',
      'x-koma-channel-id',
      'x-koma-channel-query-key-name',
      'x-koma-channel-raw-authorization',
    ];
    const rawHeaderKeys = Object.keys(args.headers || {});
    for (const sensitive of SENSITIVE_HEADER_NAMES) {
      const matches = rawHeaderKeys.filter(k => k.toLowerCase() === sensitive);
      if (matches.length > 1) {
        console.warn('[NetController] 敏感 header 重复键', { traceId, sensitive, matches });
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          body: jsonErrorBase64({
            error: {
              code: 'duplicate_sensitive_header',
              message: `sensitive header "${sensitive}" 不允许大小写变体重复出现`,
              type: 'koma_client_error',
            },
          }),
        };
      }
    }

    const channelId = getHeaderValue(args.headers, 'x-koma-channel-id');
    const queryKeyName = getHeaderValue(args.headers, 'x-koma-channel-query-key-name');
    const rawAuthMarker = getHeaderValue(args.headers, 'x-koma-channel-raw-authorization');
    const rawAuthorization = ['1', 'true', 'yes'].includes(
      String(rawAuthMarker ?? '').trim().toLowerCase(),
    );

    // 代理模式与明文 Authorization 互斥
    const hasExplicitAuth = rawHeaderKeys.some(k => k.toLowerCase() === 'authorization');
    if ((channelId || queryKeyName || rawAuthorization) && hasExplicitAuth) {
      console.warn('[NetController] 代理模式与 Authorization 冲突', { traceId, channelId, queryKeyName, rawAuthorization });
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        body: jsonErrorBase64({
          error: {
            code: 'conflict_auth_mode',
            message: 'x-koma-channel-* 代理模式与显式 Authorization 不允许同时出现',
            type: 'koma_client_error',
          },
        }),
      };
    }

    // query-key 代理也要求同时带 channelId（需知从哪个 channel 解密）
    if (queryKeyName && !channelId) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        body: jsonErrorBase64({
          error: {
            code: 'missing_channel_id_for_query_key',
            message: 'x-koma-channel-query-key-name 必须与 x-koma-channel-id 配对使用',
            type: 'koma_client_error',
          },
        }),
      };
    }

    // raw-authorization 代理同理需要 channelId；且与 query-key 互斥
    if (rawAuthorization && !channelId) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        body: jsonErrorBase64({
          error: {
            code: 'missing_channel_id_for_raw_authorization',
            message: 'x-koma-channel-raw-authorization 必须与 x-koma-channel-id 配对使用',
            type: 'koma_client_error',
          },
        }),
      };
    }
    if (rawAuthorization && queryKeyName) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        body: jsonErrorBase64({
          error: {
            code: 'conflict_auth_mode',
            message: 'x-koma-channel-query-key-name 与 x-koma-channel-raw-authorization 互斥',
            type: 'koma_client_error',
          },
        }),
      };
    }

    const headers = { ...(args.headers || {}) };
    delete headers['x-koma-trace-id'];
    delete headers['x-koma-trace-source'];
    delete headers['x-koma-trace-operation'];
    delete headers['x-koma-trace-target'];
    // Debug header is for host-side logging only; never forward to upstream.
    delete headers['x-koma-debug-body'];
    // Channel marker 系列：main-process only, 永远不得转发到上游
    for (const k of Object.keys(headers)) {
      const lk = k.toLowerCase();
      if (
        lk === 'x-koma-channel-id'
        || lk === 'x-koma-channel-query-key-name'
        || lk === 'x-koma-channel-raw-authorization'
      ) {
        delete headers[k];
      }
    }

    // apiKey 注入：只有通过代理 header 带入时才解密
    let injectedUrl = args.url;
    if (channelId) {
      let plainKey: string | null = null;
      try {
        plainKey = getDecryptedApiKey(channelId);
      } catch (err) {
        console.error('[NetController] apiKey 解密失败', {
          traceId,
          channelId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (!plainKey) {
        console.warn('[NetController] 渠道缺少 apiKey，拒绝发出请求', { traceId, channelId, url: args.url });
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          body: jsonErrorBase64({
            error: {
              code: 'channel_api_key_missing',
              message: `渠道 ${channelId} 未配置 apiKey，请在设置中补全`,
              type: 'koma_client_error',
            },
          }),
        };
      }

      if (queryKeyName) {
        // query-key 模式：把 apiKey 注入到 URL query（参数名由 header 指定）
        // 防御性：query 参数名必须是合法字符，不允许包含 & = ? # 空格
        if (!/^[A-Za-z0-9_\-]+$/.test(queryKeyName)) {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            body: jsonErrorBase64({
              error: {
                code: 'invalid_query_key_name',
                message: `x-koma-channel-query-key-name 非法字符：${queryKeyName}`,
                type: 'koma_client_error',
              },
            }),
          };
        }
        try {
          const urlObj = new URL(args.url);
          urlObj.searchParams.set(queryKeyName, plainKey);
          injectedUrl = urlObj.toString();
        } catch (err) {
          console.error('[NetController] 构造 query-key URL 失败', { traceId, channelId, url: args.url, err });
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            body: jsonErrorBase64({
              error: { code: 'invalid_url', message: 'URL 解析失败', type: 'koma_client_error' },
            }),
          };
        }
      } else if (rawAuthorization) {
        // raw-authorization 模式：直接把 apiKey 作为 Authorization 值（不加 Bearer）
        // 仅用于少数上游接受裸 key 的服务（如 NanoBanana）
        headers['Authorization'] = plainKey;
      } else {
        // 默认 Bearer 模式
        headers['Authorization'] = `Bearer ${plainKey}`;
      }
    }

    // 使用注入后的 URL 继续后续发送流程（query-key 模式会带上 ?key=xxx）
    const requestUrl = injectedUrl;

    const initialTransport = args.multipart
      ? getMultipartFetchTransport().transport
      : getFetchTransport().transport;
    const logCtx = {
      traceId,
      source: traceSource,
      operation: traceOperation,
      target: traceTarget,
      method: args.method || 'GET',
      url: args.url,
      transport: initialTransport,
      ...(args.multipart ? summarizeMultipart(args.multipart) : summarizeBody(args.body)),
      ...(debugBody ? { bodyPreview: truncateString(args.body || '', 12_000) } : undefined),
    };

    console.info('[NetController] IPC 网络请求开始', logCtx);

    const startedAt = Date.now();
    let lastError: any;
    // 用于响应体级别重试时，给上层抛错时附带最后一次的状态/响应（万一所有重试都失败）
    let lastResponse: { status: number; statusText: string; bodyBytes: Uint8Array; transport: string } | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = attempt * 1000;
        console.info(`[NetController] 第 ${attempt} 次重试 (等待 ${delay}ms)`, { traceId });
        await new Promise(r => setTimeout(r, delay));
      }

      try {
        let reqBody: any = args.body;
        let transport: 'electron-net' | 'global-fetch';
        let request: typeof fetch;
        if (args.multipart) {
          stripContentType(headers);
          stripContentLength(headers);
          reqBody = buildMultipartFormData(args.multipart);
          ({ transport, request } = getMultipartFetchTransport());
        } else {
          ({ transport, request } = getFetchTransport());
        }
        const response = await request(requestUrl, {
          method: args.method || 'GET',
          headers,
          body: reqBody,
        });

        const bodyBytes = await readBodyChunked(response);

        // 响应体级别重试：HTTP 5xx 或 429 / 上游错误关键字 → 重试
        // HTTP/2 stream reset / curl 92 / upstream_error / server_error 等瞬态故障，
        // 中转服务通常包装成 5xx + JSON 错误体返回，本身没有副作用 → 重试是安全的。
        const isRetryableResp = !response.ok && isRetryableResponse(response.status, bodyBytes);
        if (isRetryableResp && attempt < MAX_RETRIES) {
          const preview = decodeBodyPreview(bodyBytes, 240);
          console.warn('[NetController] 上游瞬态错误，准备重试', {
            traceId,
            transport,
            status: response.status,
            attempt: attempt + 1,
            preview,
          });
          lastResponse = { status: response.status, statusText: response.statusText, bodyBytes, transport };
          continue; // 进入下一轮重试
        }

        console.info('[NetController] IPC 网络请求完成', {
          traceId,
          transport,
          status: response.status,
          ok: response.ok,
          durationMs: Date.now() - startedAt,
          responseLength: bodyBytes.length,
          attempts: attempt + 1,
        });

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          body: Buffer.from(bodyBytes).toString('base64'),
        };
      } catch (err: any) {
        lastError = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        const causeCode = err?.cause?.code;

        console.error('[NetController] IPC 网络请求异常', {
          traceId,
          url: args.url,
          method: args.method || 'GET',
          transport: args.multipart ? getMultipartFetchTransport().transport : getFetchTransport().transport,
          durationMs: Date.now() - startedAt,
          error: errMsg,
          causeCode,
          attempt: attempt + 1,
        });

        if (!isRetryable(err) || attempt >= MAX_RETRIES) {
          break;
        }
      }
    }

    // 重试耗尽前最后保存的"瞬态错误响应"——还原给上层（透传上游 status + body）
    if (lastResponse && !lastError) {
      console.error('[NetController] IPC 网络请求耗尽响应级重试', {
        traceId,
        url: args.url,
        transport: lastResponse.transport,
        status: lastResponse.status,
        durationMs: Date.now() - startedAt,
      });
      return {
        ok: false,
        status: lastResponse.status,
        statusText: lastResponse.statusText,
        body: Buffer.from(lastResponse.bodyBytes).toString('base64'),
      };
    }

    // 所有重试耗尽，返回结构化错误
    const cause = lastError?.cause;
    const errorCode = cause?.code || lastError?.code || lastError?.errno;
    const detail = errorCode
      ? `${lastError.message} (${errorCode})`
      : lastError?.message || String(lastError);
    return {
      ok: false,
      status: 502,
      statusText: 'Network Error',
      body: textToBase64(`网络请求失败: ${detail}`),
    };
  }
}

export = NetController;
