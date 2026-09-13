/**
 * Regex 预筛选 + 单行解析器
 *
 * 从 episodeBoundaryDetector.ts 复用 regex 检测逻辑，
 * 增加置信度分级，供管线 Stage 0 快路径判断。
 * 抽出 parseEpisodeMarkerLine() 供 Validate 阶段复用。
 */

import {
  detectExplicitEpisodeBoundaries,
  type EpisodeBoundary,
} from '../episodeBoundaryDetector';
import type { RegexBoundaryScreeningResult, EpisodeMarkerFormat } from './types';

// ─── 单行解析器 ─────────────────────────────────────────

const CHINESE_DIGIT_MAP: Record<string, number> = {
  '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2,
  '三': 3, '四': 4, '五': 5, '六': 6, '七': 7,
  '八': 8, '九': 9,
};
const CHINESE_UNIT_MAP: Record<string, number> = {
  '十': 10, '百': 100, '千': 1000,
};

function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
}

function cleanLineForParse(text: string): string {
  let cleaned = normalizeDigits(text).trim();
  const outerBracketMatch = cleaned.match(/^[【\[<（《](.+?)[】\]>）》](.*)$/);
  if (outerBracketMatch) {
    cleaned = (outerBracketMatch[1] + ' ' + outerBracketMatch[2]).trim();
  }
  return cleaned;
}

function toArabicNumber(raw: string): number | null {
  const normalized = normalizeDigits(raw).replace(/\s+/g, '');
  if (/^\d+$/.test(normalized)) return Number(normalized);

  let section = 0;
  let current = 0;
  for (const char of normalized) {
    if (char in CHINESE_DIGIT_MAP) { current = CHINESE_DIGIT_MAP[char]; continue; }
    if (char in CHINESE_UNIT_MAP) { section += (current || 1) * CHINESE_UNIT_MAP[char]; current = 0; continue; }
    return null;
  }
  const total = section + current;
  return total > 0 ? total : null;
}

// 复用 episodeBoundaryDetector.ts 中的 pattern（保持同步）
const TITLE_PATTERNS = [
  /^(?:第\s*([零〇一二三四五六七八九十百千两\d０-９]+)\s*[集回话章节卷部篇])(?:\s*[)）】\]>》])?(?:\s*[（(].+?[)）])?(?:\s*[:：\-—–|｜、,，]\s*.+|\s+.+)?$/i,
  /^(?:第\s*([零〇一二三四五六七八九十百千两\d０-９]+)\s*季\s*)?(?:第\s*([零〇一二三四五六七八九十百千两\d０-９]+)\s*[集回话章节卷部篇])(?:\s*[)）】\]>》])?(?:\s*[（(].+?[)）])?(?:\s*[:：\-—–|｜、,，]\s*.+|\s+.+)?$/i,
  /^(?:episode|ep\.?|chapter|part|vol\.?)\s*([0-9０-９]+)(?:\s*[:：\-—–|｜]\s*.+|\s+.+)?$/i,
  /^s\s*([0-9０-９]+)\s*e\s*([0-9０-９]+)(?:\s*[:：\-—–|｜]\s*.+|\s+.+)?$/i,
];
const SCENE_PATTERN = /^([0-9０-９]{1,4})\s*[-—–]\s*([0-9０-９]{1,4})(?:\s+.+)?$/;

export interface ParsedEpisodeMarkerLine {
  kind: 'title' | 'scene';
  title: string;
  marker: string;
  episodeNumber: number | null;
  markerFormat: EpisodeMarkerFormat;
}

/**
 * 对单行文本做确定性解析，返回解析结果或 null。
 * 供 Validate 阶段验证 LLM 候选行是否为真实边界。
 */
export function parseEpisodeMarkerLine(rawLine: string): ParsedEpisodeMarkerLine | null {
  const original = rawLine.trim();
  const cleaned = cleanLineForParse(original);
  if (!cleaned) return null;

  // Title patterns
  for (let i = 0; i < TITLE_PATTERNS.length; i++) {
    const match = cleaned.match(TITLE_PATTERNS[i]);
    if (!match) continue;
    const rawEpisode = match[2] || match[1];
    const episodeNumber = rawEpisode ? toArabicNumber(rawEpisode) : null;
    let format: EpisodeMarkerFormat = 'cn_episode_title';
    if (i === 2) format = 'en_episode_title';
    if (i === 3) format = 'season_episode';
    if (i === 1 && match[1]) format = 'season_episode';
    return { kind: 'title', title: original, marker: original, episodeNumber, markerFormat: format };
  }

  // Scene pattern
  const sceneMatch = cleaned.match(SCENE_PATTERN);
  if (sceneMatch) {
    const episodeNumber = toArabicNumber(sceneMatch[1]);
    if (episodeNumber) {
      return {
        kind: 'scene',
        title: `第${episodeNumber}集`,
        marker: original,
        episodeNumber,
        markerFormat: 'scene_heading',
      };
    }
  }

  return null;
}

// ─── 置信度分级 ──────────────────────────────────────────

function inferMarkerFormat(boundaries: EpisodeBoundary[]): EpisodeMarkerFormat {
  if (boundaries.length === 0) return 'unknown';

  // 用第一个边界的 marker 推断格式
  const sample = boundaries[0].marker;
  const parsed = parseEpisodeMarkerLine(sample);
  if (!parsed) return 'unknown';

  // 检查是否有混合格式
  const formats = new Set<EpisodeMarkerFormat>();
  for (const b of boundaries) {
    const p = parseEpisodeMarkerLine(b.marker);
    if (p) formats.add(p.markerFormat);
  }
  return formats.size > 1 ? 'mixed' : parsed.markerFormat;
}

function assessConfidence(
  boundaries: EpisodeBoundary[],
): { confidence: RegexBoundaryScreeningResult['confidence']; reasons: string[] } {
  if (boundaries.length < 2) {
    return { confidence: 'none', reasons: ['less than 2 boundaries detected'] };
  }

  const reasons: string[] = [];
  let score = 0;

  // Condition 1: at least 2 boundaries
  score += 1;

  // Condition 2: episodeNumber coverage >= 80%
  const withEpNum = boundaries.filter(b => b.episodeNumber !== null).length;
  const coverage = withEpNum / boundaries.length;
  if (coverage >= 0.8) {
    score += 1;
  } else {
    reasons.push(`episodeNumber coverage ${(coverage * 100).toFixed(0)}% < 80%`);
  }

  // Condition 3: strictly increasing episodeNumber
  const epNums = boundaries.map(b => b.episodeNumber).filter((n): n is number => n !== null);
  let monotonic = true;
  for (let i = 1; i < epNums.length; i++) {
    if (epNums[i] <= epNums[i - 1]) { monotonic = false; break; }
  }
  if (monotonic && epNums.length >= 2) {
    score += 1;
  } else if (!monotonic) {
    reasons.push('episodeNumber not strictly increasing');
  }

  // Condition 4: adjacent gap >= 120 chars
  let gapOk = true;
  for (let i = 1; i < boundaries.length; i++) {
    if (boundaries[i].start - boundaries[i - 1].start < 120) {
      gapOk = false;
      break;
    }
  }
  if (gapOk) {
    score += 1;
  } else {
    reasons.push('some adjacent boundaries < 120 chars apart');
  }

  // Condition 5: no duplicate titles/episode numbers
  const titles = new Set<string>();
  const nums = new Set<number>();
  let hasDup = false;
  for (const b of boundaries) {
    if (titles.has(b.title)) { hasDup = true; break; }
    titles.add(b.title);
    if (b.episodeNumber !== null) {
      if (nums.has(b.episodeNumber)) { hasDup = true; break; }
      nums.add(b.episodeNumber);
    }
  }
  if (!hasDup) {
    score += 1;
  } else {
    reasons.push('duplicate titles or episode numbers');
  }

  if (score >= 5) return { confidence: 'high', reasons: [] };
  if (score >= 3) return { confidence: 'medium', reasons };
  return { confidence: 'low', reasons };
}

/**
 * 对脚本做 regex 预筛选，返回带置信度分级的结果。
 * confidence='high' 时管线可直接返回，跳过 LLM。
 */
export function screenRegexBoundaries(script: string): RegexBoundaryScreeningResult {
  const boundaries = detectExplicitEpisodeBoundaries(script);
  const markerFormat = inferMarkerFormat(boundaries);
  const { confidence, reasons } = assessConfidence(boundaries);

  return { boundaries, confidence, markerFormat, reasons };
}
