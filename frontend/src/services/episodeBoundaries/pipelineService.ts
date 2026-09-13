/**
 * 集边界检测管线 — 编排入口
 *
 * 流程: Regex 预筛选 → LLM 全文提取 → 确定性校验
 */

import type {
  EpisodeBoundaryPipelineResult,
  DetectEpisodeBoundariesOptions,
  EpisodeBoundaryPipelineConfig,
  EpisodeBoundaryCandidate,
  ScriptLineIndex,
  EpisodeBoundary,
} from './types';
import { DEFAULT_PIPELINE_CONFIG } from './types';
import { buildScriptLineIndex } from './lineIndex';
import { screenRegexBoundaries } from './regexScreening';
import { runExtractStage, runTargetedReExtract } from './extractStage';
import { validateCandidates } from './validateStage';

/**
 * 检测脚本中的集边界。
 *
 * 1. Regex 预筛选 — 高置信直接返回
 * 2. LLM 全文提取 — 带行号的抄录式提取
 * 3. 确定性校验 — 行号反查 + 原文匹配 + offset 回算
 *
 * 任何阶段失败都会 fallback 到 regex 结果或空数组。
 */
export async function detectEpisodeBoundaries(
  script: string,
  options: DetectEpisodeBoundariesOptions,
): Promise<EpisodeBoundaryPipelineResult> {
  const config: EpisodeBoundaryPipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    ...options.config,
  };
  const { provider, callOptions, signal } = options;

  // ── Stage 0: Regex 预筛选 ─────────────────────────────

  const regexScreening = screenRegexBoundaries(script);

  if (regexScreening.confidence === 'high') {
    return {
      boundaries: regexScreening.boundaries,
      source: 'regex',
      regexScreening,
    };
  }

  // ── Stage 1: LLM Extract ──────────────────────────────

  const lineIndex = buildScriptLineIndex(script);
  let extractResult;

  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    extractResult = await runExtractStage(
      provider,
      lineIndex,
      config,
      callOptions,
      regexScreening.markerFormat,
      signal,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Extract 全部失败 → 尝试 regex fallback
    return buildRegexFallback(regexScreening);
  }

  // 全部块失败
  if (extractResult.candidates.length === 0 && extractResult.failedChunks.length > 0) {
    return buildRegexFallback(regexScreening);
  }

  // ── Stage 2: Validate ─────────────────────────────────

  let validation = validateCandidates(extractResult.candidates, lineIndex, config);

  if (validation.valid) {
    return {
      boundaries: validation.boundaries,
      source: validation.droppedCount > 0 ? 'llm-repaired' : 'llm',
      regexScreening,
      validation,
    };
  }

  // ── Targeted Re-extract（缺失区间修补） ───────────────

  const gaps = findEpisodeGaps(validation.boundaries, lineIndex);
  if (gaps.length > 0 && gaps.length <= 3) {
    try {
      let supplementCandidates = [...extractResult.candidates];
      for (const gap of gaps) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const extra = await runTargetedReExtract(
          provider, lineIndex, config,
          gap.startLine, gap.endLine,
          callOptions, regexScreening.markerFormat, signal,
        );
        supplementCandidates.push(...extra);
      }
      // 去重后重新 validate
      const deduped = deduplicateByLine(supplementCandidates);
      const revalidation = validateCandidates(deduped, lineIndex, config);
      if (revalidation.valid) {
        return {
          boundaries: revalidation.boundaries,
          source: 'llm-repaired',
          regexScreening,
          validation: revalidation,
        };
      }
      validation = revalidation;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // Re-extract 失败，继续 fallback
    }
  }

  // ── Fallback ──────────────────────────────────────────

  // 如果 LLM 至少产出了 ≥2 边界（哪怕有些问题），仍然使用
  if (validation.boundaries.length >= 2) {
    return {
      boundaries: validation.boundaries,
      source: 'llm-repaired',
      regexScreening,
      validation,
    };
  }

  return buildRegexFallback(regexScreening);
}

// ─── Helper ──────────────────────────────────────────────

function buildRegexFallback(
  regexScreening: EpisodeBoundaryPipelineResult['regexScreening'],
): EpisodeBoundaryPipelineResult {
  if (regexScreening.boundaries.length >= 2) {
    return {
      boundaries: regexScreening.boundaries,
      source: 'regex-fallback',
      regexScreening,
    };
  }
  return {
    boundaries: [],
    source: 'none',
    regexScreening,
  };
}

interface EpisodeGap {
  startLine: number;
  endLine: number;
}

/**
 * 找到集号不连续的区间（如 ep3 → ep5 缺 ep4）
 * 用边界的 start offset 在 lineIndex 中查找对应行号范围
 */
function findEpisodeGaps(
  boundaries: EpisodeBoundary[],
  lineIndex: ScriptLineIndex,
): EpisodeGap[] {
  const gaps: EpisodeGap[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const prev = boundaries[i - 1];
    const curr = boundaries[i];
    if (prev.episodeNumber !== null && curr.episodeNumber !== null) {
      if (curr.episodeNumber - prev.episodeNumber > 1) {
        // 从 offset 查找对应的行号
        const prevLine = lineIndex.lines.find(l => l.start === prev.start);
        const currLine = lineIndex.lines.find(l => l.start === curr.start);
        if (prevLine && currLine) {
          gaps.push({
            startLine: prevLine.lineNumber,
            endLine: currLine.lineNumber,
          });
        }
      }
    }
  }
  return gaps;
}

function deduplicateByLine(candidates: EpisodeBoundaryCandidate[]): EpisodeBoundaryCandidate[] {
  const byLine = new Map<number, EpisodeBoundaryCandidate>();
  for (const c of candidates) {
    const existing = byLine.get(c.lineNumber);
    if (!existing || c.confidence > existing.confidence) {
      byLine.set(c.lineNumber, c);
    }
  }
  return Array.from(byLine.values()).sort((a, b) => a.lineNumber - b.lineNumber);
}
