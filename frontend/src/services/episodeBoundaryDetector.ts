/**
 * 剧集边界识别器
 * 优先匹配高置信的标题行和场次编号，再交由上层决定是否采用。
 */

const CHINESE_DIGIT_MAP: Record<string, number> = {
  '零': 0,
  '〇': 0,
  '一': 1,
  '二': 2,
  '两': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9,
};
const CHINESE_UNIT_MAP: Record<string, number> = {
  '十': 10,
  '百': 100,
  '千': 1000,
};
const TITLE_PATTERNS = [
  // 第N集, 第N集：标题, 第N集 标题, 第N集（上）, etc.
  // Trailing title requires a separator or whitespace — prevents matching "第一集场景。" as a title
  /^(?:第\s*([零〇一二三四五六七八九十百千两\d０-９]+)\s*[集回话章节卷部篇])(?:\s*[)）】\]>》])?(?:\s*[（(].+?[)）])?(?:\s*[:：\-—–|｜、,，]\s*.+|\s+.+)?$/i,
  // 第N季第N集 with optional title
  /^(?:第\s*([零〇一二三四五六七八九十百千两\d０-９]+)\s*季\s*)?(?:第\s*([零〇一二三四五六七八九十百千两\d０-９]+)\s*[集回话章节卷部篇])(?:\s*[)）】\]>》])?(?:\s*[（(].+?[)）])?(?:\s*[:：\-—–|｜、,，]\s*.+|\s+.+)?$/i,
  // Episode 1, EP.2, Chapter 3, etc.
  /^(?:episode|ep\.?|chapter|part|vol\.?)\s*([0-9０-９]+)(?:\s*[:：\-—–|｜]\s*.+|\s+.+)?$/i,
  // S1E3, s01e03, etc.
  /^s\s*([0-9０-９]+)\s*e\s*([0-9０-９]+)(?:\s*[:：\-—–|｜]\s*.+|\s+.+)?$/i,
];
const SCENE_PATTERN = /^([0-9０-９]{1,4})\s*[-—–]\s*([0-9０-９]{1,4})(?:\s+.+)?$/;

interface ScriptLine {
  text: string;
  start: number;
}

export interface EpisodeBoundary {
  title: string;
  marker: string;
  start: number;
  contentStart: number;
  episodeNumber: number | null;
}

function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
}

function cleanLine(text: string): string {
  let cleaned = normalizeDigits(text).trim();
  // Strip matching outer brackets: 【第40集】 → 第40集, 【第40集】冲破重围 → 第40集 冲破重围
  const outerBracketMatch = cleaned.match(/^[【\[<（《](.+?)[】\]>）》](.*)$/);
  if (outerBracketMatch) {
    cleaned = (outerBracketMatch[1] + ' ' + outerBracketMatch[2]).trim();
  }
  return cleaned;
}

function toArabicNumber(raw: string): number | null {
  const normalized = normalizeDigits(raw).replace(/\s+/g, '');
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  let total = 0;
  let section = 0;
  let current = 0;

  for (const char of normalized) {
    if (char in CHINESE_DIGIT_MAP) {
      current = CHINESE_DIGIT_MAP[char];
      continue;
    }
    if (char in CHINESE_UNIT_MAP) {
      section += (current || 1) * CHINESE_UNIT_MAP[char];
      current = 0;
      continue;
    }
    return null;
  }

  total += section + current;
  return total > 0 ? total : null;
}

function getScriptLines(script: string): ScriptLine[] {
  const lines: ScriptLine[] = [];
  let cursor = 0;

  for (const line of script.split('\n')) {
    lines.push({ text: line, start: cursor });
    cursor += line.length + 1;
  }

  return lines;
}

function getContentStart(lines: ScriptLine[], index: number): number {
  const next = lines[index + 1];
  return next ? next.start : lines[index].start + lines[index].text.length;
}

function buildBoundary(
  lines: ScriptLine[],
  index: number,
  title: string,
  marker: string,
  episodeNumber: number | null
): EpisodeBoundary {
  return {
    title,
    marker,
    start: lines[index].start,
    contentStart: getContentStart(lines, index),
    episodeNumber,
  };
}

function detectTitleBoundary(lines: ScriptLine[], index: number): EpisodeBoundary | null {
  const original = lines[index].text.trim();
  const line = cleanLine(original);
  if (!line) return null;

  for (const pattern of TITLE_PATTERNS) {
    const match = line.match(pattern);
    if (!match) continue;

    const rawEpisode = match[2] || match[1];
    const episodeNumber = rawEpisode ? toArabicNumber(rawEpisode) : null;
    return buildBoundary(lines, index, original, original, episodeNumber);
  }

  return null;
}

function detectSceneBoundary(lines: ScriptLine[], index: number): EpisodeBoundary | null {
  const original = lines[index].text.trim();
  const line = cleanLine(original);
  const match = line.match(SCENE_PATTERN);
  if (!match) return null;

  const episodeNumber = toArabicNumber(match[1]);
  if (!episodeNumber) return null;

  return buildBoundary(lines, index, `第${episodeNumber}集`, original, episodeNumber);
}

function dedupeBoundaries(boundaries: EpisodeBoundary[]): EpisodeBoundary[] {
  const results: EpisodeBoundary[] = [];
  let previousTitle = '';
  let previousEpisodeNumber: number | null = null;

  for (const boundary of boundaries) {
    const sameEpisode = boundary.episodeNumber !== null && boundary.episodeNumber === previousEpisodeNumber;
    const sameTitle = boundary.title === previousTitle;
    if (sameEpisode || sameTitle) {
      continue;
    }
    results.push(boundary);
    previousTitle = boundary.title;
    previousEpisodeNumber = boundary.episodeNumber;
  }

  return results;
}

export function detectExplicitEpisodeBoundaries(script: string): EpisodeBoundary[] {
  const lines = getScriptLines(script);
  const titleBoundaries = lines
    .map((_, index) => detectTitleBoundary(lines, index))
    .filter((boundary): boundary is EpisodeBoundary => boundary !== null);

  if (titleBoundaries.length > 0) {
    return dedupeBoundaries(titleBoundaries);
  }

  const sceneBoundaries = lines
    .map((_, index) => detectSceneBoundary(lines, index))
    .filter((boundary): boundary is EpisodeBoundary => boundary !== null);

  if (sceneBoundaries.length < 2) {
    return [];
  }

  return dedupeBoundaries(sceneBoundaries);
}
