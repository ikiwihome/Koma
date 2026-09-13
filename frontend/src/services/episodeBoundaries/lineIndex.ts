/**
 * 行号 ↔ offset 映射索引
 *
 * 基于原始 script 构建，不改写换行符。
 * offset 与 EpisodeBoundary.start / contentStart 对齐。
 */

import type { ScriptLineRecord, ScriptLineIndex } from './types';

export function buildScriptLineIndex(script: string): ScriptLineIndex {
  const lines: ScriptLineRecord[] = [];
  let cursor = 0;
  let lineNumber = 1;

  for (const rawLine of script.split('\n')) {
    // 去掉 \r（处理 \r\n 换行）
    const text = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    lines.push({
      lineNumber,
      text,
      start: cursor,
      end: cursor + text.length,
    });
    // cursor 前进 rawLine 长度 + 1（\n 分隔符）
    cursor += rawLine.length + 1;
    lineNumber++;
  }

  const getLine = (ln: number): ScriptLineRecord | undefined => lines[ln - 1];

  const getStartOffset = (ln: number): number | null => {
    const line = getLine(ln);
    return line ? line.start : null;
  };

  const renderNumberedText = (startLine = 1, endLine = lines.length): string => {
    const start = Math.max(1, startLine);
    const end = Math.min(lines.length, endLine);
    const parts: string[] = [];
    for (let i = start; i <= end; i++) {
      parts.push(`${i}| ${lines[i - 1].text}`);
    }
    return parts.join('\n');
  };

  return {
    scriptLength: script.length,
    totalLines: lines.length,
    lines,
    getLine,
    getStartOffset,
    renderNumberedText,
  };
}
