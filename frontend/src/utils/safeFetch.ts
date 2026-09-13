/**
 * 安全的 fetch 封装
 * Electron 环境下通过 IPC 主进程代理（绕过 CORS），浏览器环境走原生 fetch
 */
import { createLogger } from '../store/logger';
import { truncateString } from './logFormatting';
import { bytesToBase64, base64ToBytes } from './encoding';

interface IpcFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  /** base64 编码的响应字节。主进程统一 base64 透传以保留二进制保真度（PNG/JPG 等）。 */
  body: string;
}

type IpcMultipartField =
  | { kind: 'text'; name: string; value: string }
  | { kind: 'file'; name: string; filename: string; contentType?: string; base64: string; size: number };

type IpcMultipartPayload = { fields: IpcMultipartField[] };

const electronAPI = window.electronAPI as
  | { net?: { fetch: (args: any) => Promise<IpcFetchResult> } }
  | undefined;

const logger = createLogger('SafeFetch');

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized = { ...headers };
  const secretKeys = ['authorization', 'x-api-key'];
  for (const key of Object.keys(sanitized)) {
    if (secretKeys.includes(key.toLowerCase())) {
      sanitized[key] = '***';
    }
  }
  return sanitized;
}

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

async function serializeFormDataForIpc(fd: FormData): Promise<IpcMultipartPayload> {
  const fields: IpcMultipartField[] = [];
  // entries() preserves append order, which is important for APIs that interpret repeated fields by order.
  for (const [name, value] of fd.entries()) {
    if (typeof value === 'string') {
      fields.push({ kind: 'text', name, value });
      continue;
    }
    // Blob / File
    const blob = value as Blob;
    const ab = await blob.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const filename = (value as any)?.name || 'file';
    fields.push({
      kind: 'file',
      name,
      filename,
      contentType: blob.type || undefined,
      base64: bytesToBase64(bytes),
      size: bytes.length,
    });
  }
  return { fields };
}

function summarizeMultipart(multipart?: IpcMultipartPayload): Record<string, any> {
  if (!multipart) return {};
  let bytes = 0;
  let files = 0;
  for (const f of multipart.fields) {
    if (f.kind === 'file') {
      files += 1;
      bytes += f.size;
    }
  }
  return { multipartFieldCount: multipart.fields.length, multipartFileCount: files, multipartBytes: bytes };
}

function summarizeMultipartPreview(multipart?: IpcMultipartPayload, enabled?: boolean): Record<string, any> {
  if (!enabled || !multipart) return {};
  const preview = multipart.fields.map(f => {
    if (f.kind === 'text') return { kind: 'text', name: f.name, value: truncateString(f.value, 200) };
    return { kind: 'file', name: f.name, filename: f.filename, contentType: f.contentType, size: f.size };
  });
  return { multipartPreview: preview };
}

function summarizeBodyPreview(body?: string, enabled?: boolean): Record<string, any> {
  if (!enabled || !body) return {};
  // Keep the structure debug-friendly but avoid dumping huge base64 payloads.
  const preview = body.startsWith('{') || body.startsWith('[')
    ? truncateString(body, 4000)
    : truncateString(body, 1200);
  return { bodyPreview: preview };
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

/**
 * 与原生 fetch 签名一致的包装函数
 * 在 Electron 环境中自动通过主进程发送请求
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (electronAPI?.net?.fetch) {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([k, v]) => { headers[k] = v; });
      } else {
        Object.assign(headers, init.headers);
      }
    }

    const traceId = headers['x-koma-trace-id'];
    const debugBody = headers['x-koma-debug-body'] === '1' || headers['x-koma-debug-body'] === 'true';
    const isMultipart = isFormDataBody(init?.body);
    const multipart = isMultipart ? await serializeFormDataForIpc(init!.body as FormData) : undefined;
    const payloadSummary = isMultipart
      ? summarizeMultipart(multipart)
      : summarizeBody(typeof init?.body === 'string' ? init.body : undefined);
    const payloadPreview = isMultipart
      ? summarizeMultipartPreview(multipart, debugBody)
      : summarizeBodyPreview(typeof init?.body === 'string' ? init.body : undefined, debugBody);

    let result: IpcFetchResult;
    try {
      result = await electronAPI.net.fetch({
        url,
        method: init?.method || 'GET',
        headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
        multipart,
      });
    } catch (error) {
      logger.error('IPC 代理网络请求失败', {
        traceId,
        url,
        method: init?.method || 'GET',
        headers: sanitizeHeaders(headers),
        ...payloadSummary,
        ...payloadPreview,
        error: error instanceof Error ? error.message : String(error),
        transport: 'ipc',
      });
      throw error;
    }

    logger.info('通过 IPC 代理网络请求', {
      traceId,
      url,
      method: init?.method || 'GET',
      headers: sanitizeHeaders(headers),
      ...payloadSummary,
      ...payloadPreview,
      status: result.status,
      ok: result.ok,
      transport: 'ipc',
    });

    // result.body 是 base64 字节；用 Uint8Array 构造 Response，让 .text()/.json()/.arrayBuffer()
    // 各自按需解码，避免之前 string-body 路径丢失二进制保真度的问题。
    let bodyBytes: Uint8Array;
    try {
      bodyBytes = base64ToBytes(result.body || '');
    } catch (err) {
      logger.error('IPC 响应 base64 解码失败', {
        traceId,
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      bodyBytes = new Uint8Array(0);
    }
    return new Response(bodyBytes, {
      status: result.status,
      statusText: result.statusText,
    });
  }

  const traceId = init?.headers && !(init.headers instanceof Headers) && !Array.isArray(init.headers)
    ? (init.headers as Record<string, string>)['x-koma-trace-id']
    : undefined;
  const debugBody = Boolean(init?.headers && !(init.headers instanceof Headers) && !Array.isArray(init.headers)
    ? ((init.headers as Record<string, string>)['x-koma-debug-body'] === '1' || (init.headers as Record<string, string>)['x-koma-debug-body'] === 'true')
    : false);
  logger.info('直接发送网络请求', {
    traceId,
    url,
    method: init?.method || 'GET',
    ...(summarizeBodyPreview(typeof init?.body === 'string' ? init.body : undefined, debugBody)),
    transport: 'direct',
  });
  return fetch(url, init);
}
