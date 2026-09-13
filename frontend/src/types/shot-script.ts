/**
 * Shot.scriptLines 的统一读写工具。
 *
 * 分镜里的"剧本"是一组字幕行块（ShotScriptLine[]）；下游 image / video prompt
 * 推理常常只需要拼回一段纯文本，UI 编辑时则需要逐行操作。集中在这里以避免
 * 每个 callsite 重复 join / split / id 生成逻辑。
 */
import type { ShotScriptLine } from './scene-character';

let lineIdCounter = 0;

export function makeScriptLineId(): string {
  lineIdCounter += 1;
  return `line-${Date.now().toString(36)}-${lineIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 把整段文本按 \n 拆成 ShotScriptLine[]，过滤空行、自动分配 id */
export function scriptLinesFromText(text: string | null | undefined): ShotScriptLine[] {
  if (!text) return [];
  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(text => ({ id: makeScriptLineId(), text }));
}

/** 把 ShotScriptLine[] 拼成纯文本（一行一句，\n 分隔） */
export function scriptLinesToText(lines: ShotScriptLine[] | undefined): string {
  if (!lines || !lines.length) return '';
  return lines.map(line => line.text).join('\n');
}

/** 读取分镜的剧本字符串视图（下游 image/video prompt 推理常用） */
export function getShotScriptText(shot: { scriptLines?: ShotScriptLine[] }): string {
  return scriptLinesToText(shot.scriptLines);
}

/** 创建单行 */
export function createScriptLine(text: string): ShotScriptLine {
  return { id: makeScriptLineId(), text };
}
