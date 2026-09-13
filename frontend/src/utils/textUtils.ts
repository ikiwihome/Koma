/**
 * 文本处理工具函数（中文版）
 * 供 entityExtractor.ts 和 ScriptAnalysisService.ts 共用
 */

export function cleanText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, '，').trim();
}

export function splitVisualClauses(value?: string): string[] {
  return (value || '')
    .split(/[，,。；;、\n]+/)
    .map(cleanText)
    .filter(Boolean);
}

export const CHARACTER_STORY_TOKENS = [
  '店主', '老板', '职业', '工作', '靠', '为生', '接私活',
  '能看见', '看见鬼', '鬼魂', '灵异',
  '养父', '养母', '继承', '去世', '身世', '成谜',
  '火场', '被救', '遇难', '全家',
];

export function sanitizeCharacterAppearance(value?: string, fallback?: string): string {
  const clauses = splitVisualClauses(value);
  const filtered = clauses.filter(clause => !CHARACTER_STORY_TOKENS.some(token => clause.includes(token)));
  return cleanText(filtered.join('，') || fallback || '');
}
