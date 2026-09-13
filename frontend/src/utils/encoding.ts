/**
 * Base64 / data-url 编解码工具
 */

const BASE64_CHAR = /[A-Za-z0-9+/=]/;

/**
 * 把上游可能传入的"看起来像 base64 但不规范"的串归一化：
 * - 剥掉前置的 `data:*;base64,` 头
 * - 去掉空白字符（含换行）
 * - URL-safe → 标准（`-` → `+`，`_` → `/`）
 * - 补齐 `=` padding
 */
function normalizeBase64(input: string): string {
  if (!input) return '';
  let s = input;
  // 容错：传进来的就是完整 data url
  if (s.startsWith('data:')) {
    const commaIdx = s.indexOf(',');
    s = commaIdx >= 0 ? s.slice(commaIdx + 1) : '';
  }
  s = s.replace(/\s+/g, '');
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad === 2) s += '==';
  else if (pad === 3) s += '=';
  else if (pad === 1) {
    // 长度模 4 余 1 — 一定不是合法 base64，截掉最后一位再补齐
    s = s.slice(0, -1);
  }
  return s;
}

/** 将 base64 字符串解码为 Uint8Array */
export function base64ToBytes(base64: string): Uint8Array {
  const normalized = normalizeBase64(base64);
  let binary: string;
  try {
    binary = atob(normalized);
  } catch (err) {
    const preview = normalized.length > 32 ? `${normalized.slice(0, 32)}...(${normalized.length})` : normalized;
    const suspicious = Array.from(normalized).find(c => !BASE64_CHAR.test(c));
    throw new Error(
      `base64 解码失败: ${err instanceof Error ? err.message : String(err)}（` +
      `非法字符: ${suspicious ? JSON.stringify(suspicious) : '无'}; 预览: ${preview}）`,
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 将 Uint8Array 编码为 base64 字符串（分块避免栈溢出） */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    let part = '';
    for (let j = 0; j < chunk.length; j += 1) part += String.fromCharCode(chunk[j]);
    binary += part;
  }
  return btoa(binary);
}

/** 解析 data-url，返回 mimeType 和原始字节 */
export function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array } {
  const { mimeType, base64 } = stripDataHeader(dataUrl);
  if (!base64) {
    throw new Error('不支持的 data-url 格式（需要 base64）');
  }
  return { mimeType: mimeType || 'application/octet-stream', bytes: base64ToBytes(base64) };
}

/**
 * 从 data-url 中拆出 mimeType 和 base64 原始串。
 * 兼容多参数头（如 `data:image/png;name=foo;base64,xxx`）。
 */
export function stripDataHeader(dataUrl: string): { mimeType?: string; base64: string } {
  if (!dataUrl) return { base64: '' };
  if (!dataUrl.startsWith('data:')) {
    // 非 data url，原样返回（调用方一般已通过 isDataUri 等过滤）
    return { base64: dataUrl };
  }
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return { base64: '' };
  const header = dataUrl.slice(5, commaIdx); // 去掉 'data:' 前缀
  const payload = dataUrl.slice(commaIdx + 1);
  const parts = header.split(';');
  const mimeType = parts[0] || undefined;
  const isBase64 = parts.some(p => p.toLowerCase() === 'base64');
  if (!isBase64) {
    // 非 base64 编码（多半是 URL 编码），无法当作 base64 直接处理
    return { mimeType, base64: '' };
  }
  return { mimeType, base64: payload };
}
