/**
 * 日志格式化工具 —— 截断 / 脱敏 / 摘要
 */

/** 截断过长字符串，附带原始长度信息 */
export function truncateString(value: string, max = 600): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...(truncated, ${value.length} chars)`;
}

/**
 * 递归清理请求体中的大字符串（base64 / 超长文本），使日志可读。
 * 仅用于日志输出，不会修改原始对象。
 */
export function sanitizeBodyForLog(body: any): any {
  const walk = (v: any): any => {
    if (typeof v === 'string') {
      if (v.startsWith('data:')) return `${v.slice(0, 140)}...(data-url ${v.length} chars)`;
      return v.length > 2000 ? truncateString(v, 800) : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(body);
}
