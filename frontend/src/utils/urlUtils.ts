/**
 * URL 工具函数
 */

/**
 * koma-local:// 协议归一化（唯一标准实现）
 * =================================================
 *
 * 全工程**只允许**通过 toKomaLocalUrl / fromKomaLocalUrl 这一对函数读写 koma-local URL。
 * 不要在其它地方手写 `koma-local://` 前缀或正则去 strip。
 *
 * **唯一**规范（无兼容形态）：`koma-local://files/<encoded path>`
 *   - 固定 host = `files`（不可改）。
 *   - path 始终以 `/` 起头，每段做 encodeURIComponent（空格/中文/`#?` 等都能安全过 URL 解析）。
 *   - macOS/Linux：`/Users/x` → `koma-local://files/Users/x`
 *   - Windows：    `C:\Users\x` → `koma-local://files/C:/Users/x`
 *   - 相对路径：    `images/x` → `koma-local://files/images/x`
 *
 * 为什么固定 host = files：
 *   `electron/main.ts` 用 `registerSchemesAsPrivileged({ standard: true })` 注册 koma-local，
 *   Chromium 走 GURL 解析 standard scheme，要求 authority 非空。如果给 `koma-local:///path`
 *   （空 authority），GURL 会把 path 第一段（如 `Users`）当作 host 并 lowercase，
 *   path 被吃掉一段 → protocol handler 收到残缺路径 → 403/404。
 *
 *   所以协议只接受形如 `koma-local://<非空 host>/<path>` 的 URL。
 *   我们用固定 `files` host，protocol handler 只读 `url.pathname`、不读 host。
 */

const KOMA_LOCAL_HOST = 'files';
const KOMA_LOCAL_PREFIX = `koma-local://${KOMA_LOCAL_HOST}`;

/**
 * 将本地路径或已有 URL 规范为 koma-local:// 协议 URL。
 * 已经是 http/https/koma-local/data/blob URL 的直接透传。
 */
export function toKomaLocalUrl(path: string): string {
  if (!path) return '';

  if (path.startsWith('http://') ||
      path.startsWith('https://') ||
      path.startsWith('koma-local://') ||
      path.startsWith('data:') ||
      path.startsWith('blob:')) {
    return path;
  }

  const normalized = path.replace(/\\/g, '/');
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  // 每段做 encodeURIComponent，保留 `/` 作为路径分隔。这样空格/中文/特殊符号都安全。
  const encoded = withSlash.split('/').map(seg => encodeURIComponent(seg)).join('/');
  return `${KOMA_LOCAL_PREFIX}${encoded}`;
}

/**
 * 从 koma-local:// URL 提取本地路径，并 decodeURIComponent。
 * 非 koma-local URL 原样返回。
 * 只接受规范形式 `koma-local://files/...`，其它形态视为非法（原样返回）。
 */
export function fromKomaLocalUrl(url: string): string {
  if (!url) return '';
  if (!url.startsWith(`${KOMA_LOCAL_PREFIX}/`)) return url;

  const tail = url.slice(KOMA_LOCAL_PREFIX.length); // '/Users/...' 或 '/C:/...'
  let decoded: string;
  try {
    decoded = decodeURIComponent(tail);
  } catch {
    decoded = tail;
  }
  // Windows drive：'/C:/Users/...' → 'C:/Users/...'
  if (/^\/[a-zA-Z]:\//.test(decoded)) {
    return decoded.slice(1);
  }
  return decoded;
}
