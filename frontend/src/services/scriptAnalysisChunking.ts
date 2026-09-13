import type { EntitySummary } from './CreationContext';

const CHUNK_TARGET_CHARS = 1200;
const CHUNK_MAX_CHARS = 1600;
export const CHUNK_MAX_CHARS_DIALOGUE = 2800;
const CHUNK_ENTITY_LIMIT = 30;
export const SCENE_BOUNDARY_RE = /^\s*(第[零〇一二三四五六七八九十百千两\d０-９]+\s*[集回话章节卷部篇]|(?:episode|ep\.?|chapter|part|vol\.?)\s*\d+|s\s*\d+\s*e\s*\d+|\d{1,4}\s*[-—–]\s*\d{1,4}\b)/i;

export interface ScriptChunk {
  index: number;
  total: number;
  content: string;
}

const DIALOGUE_LINE_RE = /^[^\s：:「"]+[：:]|「[^」]*」|"[^"]*"/;

export function estimateChunkSize(block: string): number {
  const totalLines = block.split('\n').filter(l => l.trim()).length;
  if (totalLines === 0) return CHUNK_TARGET_CHARS;
  const dialogueLines = block.split('\n').filter(l => DIALOGUE_LINE_RE.test(l.trim())).length;
  const dialogueRatio = dialogueLines / totalLines;
  return Math.round(Math.max(800, Math.min(2400, 1500 * (0.6 + dialogueRatio * 0.8))));
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function splitLongBlock(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > CHUNK_MAX_CHARS) {
    const candidate = remaining.slice(0, CHUNK_MAX_CHARS);
    const breakpoints = [
      candidate.lastIndexOf('\n\n'),
      candidate.lastIndexOf('\n'),
      candidate.lastIndexOf('。'),
      candidate.lastIndexOf('！'),
      candidate.lastIndexOf('？'),
    ].filter(index => index >= Math.floor(CHUNK_TARGET_CHARS * 0.6));
    const splitIndex = breakpoints.length > 0 ? Math.max(...breakpoints) + 1 : CHUNK_MAX_CHARS;
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function buildBlocks(script: string): string[] {
  const lines = normalizeNewlines(script).split('\n');
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isBoundary = SCENE_BOUNDARY_RE.test(line.trim());
    if (isBoundary && current.length > 0) {
      blocks.push(current.join('\n').trim());
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current.join('\n').trim());
  }

  return blocks.flatMap(block => block.length > CHUNK_MAX_CHARS ? splitLongBlock(block) : [block]);
}

export function splitScriptIntoChunks(script: string): ScriptChunk[] {
  const blocks = buildBlocks(script).filter(Boolean);
  if (blocks.length === 0) {
    return [{ index: 1, total: 1, content: script.trim() }];
  }

  const merged: string[] = [];
  let current = '';

  for (const block of blocks) {
    const targetSize = estimateChunkSize(current ? `${current}\n\n${block}` : block);
    const maxSize = targetSize >= 1800 ? CHUNK_MAX_CHARS_DIALOGUE : CHUNK_MAX_CHARS;
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= maxSize && next.length <= targetSize + 400) {
      current = next;
      continue;
    }

    if (current) {
      merged.push(current.trim());
    }
    current = block;
  }

  if (current) {
    merged.push(current.trim());
  }

  return merged.map((content, index, array) => ({
    index: index + 1,
    total: array.length,
    content,
  }));
}

export function buildChunkContextPrompt(
  prompt: string,
  chunkIndex: number,
  totalChunks: number,
  existingEntities: string[] | EntitySummary[],
  previousChunkSummary?: string,
): string {
  const isEntitySummary =
    existingEntities.length > 0 &&
    typeof existingEntities[0] !== 'string' &&
    'type' in (existingEntities[0] as EntitySummary);

  const capped = Array.from(new Set(
    isEntitySummary
      ? (existingEntities as EntitySummary[]).map(e => `- ${e.name}（${e.type}）: ${e.brief}`)
      : (existingEntities as string[]),
  )).slice(0, CHUNK_ENTITY_LIMIT);

  const sections: string[] = [
    '【分块解析上下文】',
    `当前处理第 ${chunkIndex}/${totalChunks} 段剧本。`,
  ];

  if (previousChunkSummary) {
    sections.push(`【前一段摘要】\n${previousChunkSummary}`);
  }

  if (capped.length > 0) {
    sections.push(
      isEntitySummary
        ? `已识别实体：\n${capped.join('\n')}\n请不要重复返回这些名称。`
        : `已识别实体：${capped.join('、')}。请不要重复返回这些名称。`,
    );
  } else {
    sections.push('此前尚未识别到实体。');
  }

  sections.push('如果本段没有新的实体，请返回空数组。');

  return `${prompt}\n\n${sections.join('\n')}`;
}
