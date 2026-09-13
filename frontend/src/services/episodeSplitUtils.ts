/**
 * 自动剧集的本地切分工具
 */
import { detectExplicitEpisodeBoundaries } from './episodeBoundaryDetector';
import { detectEpisodeBoundaries } from './episodeBoundaries';
import type { LLMProvider, LLMCallOptions } from '../providers/llm/types';

const MIN_SPLIT_GAP_RATIO = 4;
const MARKER_SEARCH_WINDOW_CHARS = 2400;
const BOUNDARY_SEARCH_WINDOW_CHARS = 240;
const SINGLE_EPISODE_COUNT = 1;
const EXPLICIT_BOUNDARY_SUMMARY_LENGTH = 80;

export interface SplitPoint {
  position: number;
  marker: string;
  reason: string;
}

export interface EpisodeBlueprint {
  title: string;
  summary: string;
}

export interface SplitAnalysis {
  suggestedCount: number;
  splitPoints: SplitPoint[];
  reasoning: string;
  episodeBlueprints: EpisodeBlueprint[];
  source?: 'llm' | 'explicit';
}

export interface SplitResult {
  title: string;
  scriptText: string;
  summary: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createSummary(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '按原文分集结构拆分';
  }
  return normalized.slice(0, EXPLICIT_BOUNDARY_SUMMARY_LENGTH);
}

function buildExplicitAnalysis(
  script: string,
  boundaries: ReturnType<typeof detectExplicitEpisodeBoundaries>,
  reason: string
): SplitAnalysis {
  const episodeBlueprints = boundaries.map((boundary, index) => {
    const bodyStart = boundary.contentStart;
    const bodyEnd = index + 1 < boundaries.length ? boundaries[index + 1].start : script.length;
    return {
      title: boundary.title.trim(),
      summary: createSummary(script.slice(bodyStart, bodyEnd)),
    };
  });

  return {
    suggestedCount: boundaries.length,
    splitPoints: boundaries.slice(1).map(boundary => ({
      position: boundary.start,
      marker: boundary.marker.trim(),
      reason,
    })),
    reasoning: reason,
    episodeBlueprints,
    source: 'explicit',
  };
}

export function detectExplicitEpisodeAnalysis(script: string): SplitAnalysis | null {
  const boundaries = detectExplicitEpisodeBoundaries(script);
  if (boundaries.length >= SINGLE_EPISODE_COUNT) {
    const reason = boundaries[0]?.title.startsWith('第') && boundaries[0]?.marker.includes('-')
      ? `已根据原文场次编号识别出 ${boundaries.length} 个剧集边界，优先按原文结构拆分`
      : `已识别原文中的 ${boundaries.length} 个分集标题，优先按原文结构拆分`;
    return buildExplicitAnalysis(script, boundaries, reason);
  }

  return null;
}

/**
 * 异步版集检测分析 — 先走 regex 快路径，不够则调用 LLM 管线。
 */
export async function detectExplicitEpisodeAnalysisAsync(
  script: string,
  provider: LLMProvider,
  callOptions?: LLMCallOptions,
  signal?: AbortSignal,
): Promise<SplitAnalysis | null> {
  // 先走同步 regex
  const syncResult = detectExplicitEpisodeAnalysis(script);
  if (syncResult) return syncResult;

  // 调用 LLM 管线
  const pipelineResult = await detectEpisodeBoundaries(script, {
    provider,
    callOptions,
    signal,
  });

  if (pipelineResult.boundaries.length >= SINGLE_EPISODE_COUNT) {
    const reason = pipelineResult.source === 'regex' || pipelineResult.source === 'regex-fallback'
      ? `已根据正则识别出 ${pipelineResult.boundaries.length} 个剧集边界`
      : `AI 识别出 ${pipelineResult.boundaries.length} 个剧集边界（来源: ${pipelineResult.source}）`;
    return buildExplicitAnalysis(script, pipelineResult.boundaries, reason);
  }

  return null;
}

function collectBoundaryCandidates(script: string, start: number, end: number): number[] {
  const patterns = ['\n\n', '\n', '。', '！', '？'];
  const candidates: number[] = [];

  for (const pattern of patterns) {
    let cursor = start;
    while (cursor < end) {
      const found = script.indexOf(pattern, cursor);
      if (found < 0 || found >= end) break;
      candidates.push(found + pattern.length);
      cursor = found + pattern.length;
    }
  }

  return candidates;
}

function findClosestMarkerMatch(script: string, marker: string, approxIndex: number): number {
  let closestIndex = -1;
  let cursor = script.indexOf(marker);

  while (cursor >= 0) {
    const shouldReplace = closestIndex < 0
      || Math.abs(cursor - approxIndex) < Math.abs(closestIndex - approxIndex);
    if (shouldReplace) {
      closestIndex = cursor;
    }
    cursor = script.indexOf(marker, cursor + marker.length);
  }

  return closestIndex;
}

function findMarkerIndex(script: string, marker: string, approxIndex: number): number {
  const normalizedMarker = marker.trim();
  if (!normalizedMarker) return -1;

  const safeIndex = clamp(Math.floor(approxIndex), 0, script.length);
  const windowStart = Math.max(0, safeIndex - MARKER_SEARCH_WINDOW_CHARS);
  const windowEnd = Math.min(script.length, safeIndex + MARKER_SEARCH_WINDOW_CHARS);
  const windowText = script.slice(windowStart, windowEnd);
  const localIndex = windowText.indexOf(normalizedMarker);

  if (localIndex >= 0) {
    return windowStart + localIndex;
  }

  return findClosestMarkerMatch(script, normalizedMarker, safeIndex);
}

function moveToBoundary(script: string, index: number, minIndex: number, maxIndex: number): number {
  const boundedIndex = clamp(index, minIndex, maxIndex);
  const windowStart = Math.max(minIndex, boundedIndex - BOUNDARY_SEARCH_WINDOW_CHARS);
  const windowEnd = Math.min(maxIndex, boundedIndex + BOUNDARY_SEARCH_WINDOW_CHARS);
  const candidates = collectBoundaryCandidates(script, windowStart, windowEnd);

  if (candidates.length === 0) {
    return boundedIndex;
  }

  return candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(best - boundedIndex);
    const candidateDistance = Math.abs(candidate - boundedIndex);
    return candidateDistance < bestDistance ? candidate : best;
  }, boundedIndex);
}

function getMinGap(scriptLength: number, episodeCount: number): number {
  return Math.max(
    Math.floor(scriptLength / Math.max(episodeCount * MIN_SPLIT_GAP_RATIO, SINGLE_EPISODE_COUNT)),
    SINGLE_EPISODE_COUNT
  );
}

function validateAnalysis(analysis: SplitAnalysis): void {
  if (!Number.isInteger(analysis.suggestedCount) || analysis.suggestedCount < SINGLE_EPISODE_COUNT) {
    throw new Error('AI 返回的建议集数无效');
  }

  if (analysis.episodeBlueprints.length !== analysis.suggestedCount) {
    throw new Error('AI 返回的剧集标题或摘要数量不完整');
  }

  if (
    analysis.suggestedCount > SINGLE_EPISODE_COUNT
    && analysis.splitPoints.length !== analysis.suggestedCount - SINGLE_EPISODE_COUNT
  ) {
    throw new Error('AI 返回的分割点数量不正确');
  }

  for (const blueprint of analysis.episodeBlueprints) {
    if (!blueprint.title.trim() || !blueprint.summary.trim()) {
      throw new Error('AI 返回了空的剧集标题或摘要');
    }
  }
}

function resolveSplitIndices(script: string, analysis: SplitAnalysis): number[] {
  const splitIndices: number[] = [];
  const minGap = getMinGap(script.length, analysis.suggestedCount);
  let previousIndex = 0;

  analysis.splitPoints.forEach((point, index) => {
    const remainingSplitCount = analysis.splitPoints.length - index;
    const minIndex = previousIndex + minGap;
    const maxIndex = script.length - remainingSplitCount * minGap;

    if (minIndex >= maxIndex) {
      throw new Error('剧本长度不足以按当前分割方案拆分');
    }

    const markerIndex = findMarkerIndex(script, point.marker, point.position);
    const approxIndex = markerIndex >= 0 ? markerIndex : point.position;
    const splitIndex = moveToBoundary(script, approxIndex, minIndex, maxIndex);

    if (splitIndex <= previousIndex) {
      throw new Error('AI 返回的分割点顺序无效');
    }

    splitIndices.push(splitIndex);
    previousIndex = splitIndex;
  });

  return splitIndices;
}

export function materializeEpisodeSplit(script: string, analysis: SplitAnalysis): SplitResult[] {
  validateAnalysis(analysis);

  const boundaries = [0, ...resolveSplitIndices(script, analysis), script.length];
  const results = analysis.episodeBlueprints.map((blueprint, index) => {
    const scriptText = script.slice(boundaries[index], boundaries[index + 1]);
    if (!scriptText) {
      throw new Error(`第 ${index + 1} 集切分结果为空`);
    }

    return {
      title: blueprint.title.trim(),
      summary: blueprint.summary.trim(),
      scriptText,
    };
  });

  return results;
}
