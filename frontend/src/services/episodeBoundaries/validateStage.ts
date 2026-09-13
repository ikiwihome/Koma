/**
 * Validate 阶段 — 确定性校验
 *
 * 这是整个管线的最终信任边界，不使用 LLM。
 * 所有 LLM 候选必须通过此阶段才能成为 EpisodeBoundary。
 */

import type {
  EpisodeBoundary,
  EpisodeBoundaryCandidate,
  EpisodeBoundaryPipelineConfig,
  ScriptLineIndex,
  BoundaryValidationIssue,
  EpisodeBoundaryValidationResult,
} from './types';
import { parseEpisodeMarkerLine } from './regexScreening';

// ─── 校验 ────────────────────────────────────────────────

interface ValidatedCandidate {
  candidate: EpisodeBoundaryCandidate;
  parsedTitle: string;
  parsedMarker: string;
  parsedEpisodeNumber: number | null;
  lineStart: number;
  contentStart: number;
}

export function validateCandidates(
  candidates: EpisodeBoundaryCandidate[],
  lineIndex: ScriptLineIndex,
  config: EpisodeBoundaryPipelineConfig,
): EpisodeBoundaryValidationResult {
  const issues: BoundaryValidationIssue[] = [];
  const totalCandidates = candidates.length;
  const validated: ValidatedCandidate[] = [];

  // ── Pass 1: 逐条校验 ──────────────────────────────────

  for (const candidate of candidates) {
    const { lineNumber, rawLine } = candidate;

    // 1. 行号范围
    if (lineNumber < 1 || lineNumber > lineIndex.totalLines) {
      issues.push({
        code: 'LINE_OUT_OF_RANGE',
        severity: 'warning',
        message: `Line ${lineNumber} out of range [1, ${lineIndex.totalLines}]`,
        candidateLineNumber: lineNumber,
      });
      continue;
    }

    // 2. 原文反查
    const sourceLine = lineIndex.getLine(lineNumber);
    if (!sourceLine) {
      issues.push({
        code: 'LINE_OUT_OF_RANGE',
        severity: 'warning',
        message: `Line ${lineNumber} not found in index`,
        candidateLineNumber: lineNumber,
      });
      continue;
    }

    // rawLine 匹配（容忍两端空白差异）
    if (rawLine.trim() !== sourceLine.text.trim()) {
      issues.push({
        code: 'RAW_LINE_MISMATCH',
        severity: 'warning',
        message: `Line ${lineNumber}: LLM rawLine "${rawLine.slice(0, 40)}..." ≠ source "${sourceLine.text.slice(0, 40)}..."`,
        candidateLineNumber: lineNumber,
      });
      // 不立即丢弃 — 尝试用源行重新解析
    }

    // 3. 确定性单行解析（用原文行，不信任 LLM rawLine）
    const parsed = parseEpisodeMarkerLine(sourceLine.text);
    if (!parsed) {
      issues.push({
        code: 'UNPARSABLE_SOURCE_LINE',
        severity: 'warning',
        message: `Line ${lineNumber}: source text not parsable as episode marker`,
        candidateLineNumber: lineNumber,
      });
      continue;
    }

    // 4. offset 回算
    const nextLine = lineIndex.getLine(lineNumber + 1);
    const contentStart = nextLine ? nextLine.start : sourceLine.end;

    validated.push({
      candidate,
      parsedTitle: parsed.title,
      parsedMarker: parsed.marker,
      parsedEpisodeNumber: parsed.episodeNumber,
      lineStart: sourceLine.start,
      contentStart,
    });
  }

  // ── Pass 2: 重复行去重 ─────────────────────────────────

  const byLine = new Map<number, ValidatedCandidate>();
  for (const v of validated) {
    const existing = byLine.get(v.candidate.lineNumber);
    if (existing) {
      issues.push({
        code: 'DUPLICATE_LINE',
        severity: 'warning',
        message: `Duplicate line ${v.candidate.lineNumber}`,
        candidateLineNumber: v.candidate.lineNumber,
      });
      // 保留 confidence 更高的
      if (v.candidate.confidence > existing.candidate.confidence) {
        byLine.set(v.candidate.lineNumber, v);
      }
    } else {
      byLine.set(v.candidate.lineNumber, v);
    }
  }

  let deduped = Array.from(byLine.values()).sort((a, b) => a.candidate.lineNumber - b.candidate.lineNumber);

  // ── Pass 3: 重复集号去重（保留最早行） ─────────────────

  const byEpNum = new Map<number, ValidatedCandidate>();
  const afterEpDedup: ValidatedCandidate[] = [];
  for (const v of deduped) {
    if (v.parsedEpisodeNumber !== null) {
      const existing = byEpNum.get(v.parsedEpisodeNumber);
      if (existing) {
        issues.push({
          code: 'DUPLICATE_EPISODE',
          severity: 'warning',
          message: `Duplicate episodeNumber ${v.parsedEpisodeNumber} at lines ${existing.candidate.lineNumber} and ${v.candidate.lineNumber}`,
          candidateLineNumber: v.candidate.lineNumber,
        });
        continue; // 跳过后来的
      }
      byEpNum.set(v.parsedEpisodeNumber, v);
    }
    afterEpDedup.push(v);
  }
  deduped = afterEpDedup;

  // ── Pass 4: 单调递增校验 ───────────────────────────────

  const epNums = deduped
    .map(v => v.parsedEpisodeNumber)
    .filter((n): n is number => n !== null);

  let hasNonMonotonic = false;
  for (let i = 1; i < epNums.length; i++) {
    if (epNums[i] <= epNums[i - 1]) {
      hasNonMonotonic = true;
      issues.push({
        code: 'NON_MONOTONIC_EPISODE',
        severity: 'error',
        message: `Episode numbers not strictly increasing: ${epNums[i - 1]} → ${epNums[i]}`,
      });
      break;
    }
  }

  // ── Pass 5: 最小间距校验 ───────────────────────────────

  const afterGapFilter: ValidatedCandidate[] = [];
  for (let i = 0; i < deduped.length; i++) {
    if (i === 0) {
      afterGapFilter.push(deduped[i]);
      continue;
    }
    const prev = afterGapFilter[afterGapFilter.length - 1];
    const curr = deduped[i];
    const lineGap = curr.candidate.lineNumber - prev.candidate.lineNumber;
    const charGap = curr.lineStart - prev.lineStart;

    if (lineGap < config.minBoundaryLineGap || charGap < config.minBoundaryCharGap) {
      issues.push({
        code: 'GAP_TOO_SMALL',
        severity: 'warning',
        message: `Gap too small between lines ${prev.candidate.lineNumber} and ${curr.candidate.lineNumber} (lineGap=${lineGap}, charGap=${charGap})`,
        candidateLineNumber: curr.candidate.lineNumber,
      });
      // 保留 confidence 更高的
      if (curr.candidate.confidence > prev.candidate.confidence) {
        afterGapFilter[afterGapFilter.length - 1] = curr;
      }
      continue;
    }
    afterGapFilter.push(curr);
  }

  // ── 最终输出 ───────────────────────────────────────────

  const boundaries: EpisodeBoundary[] = afterGapFilter.map(v => ({
    title: v.parsedTitle,
    marker: v.parsedMarker,
    start: v.lineStart,
    contentStart: v.contentStart,
    episodeNumber: v.parsedEpisodeNumber,
  }));

  const droppedCount = totalCandidates - boundaries.length;

  // 判断是否 valid
  const dropRatio = totalCandidates > 0 ? droppedCount / totalCandidates : 0;
  const tooManyDropped = dropRatio > config.maxHallucinationDropRatio;
  if (tooManyDropped) {
    issues.push({
      code: 'TOO_MANY_DROPPED',
      severity: 'fatal',
      message: `Dropped ${droppedCount}/${totalCandidates} candidates (${(dropRatio * 100).toFixed(0)}% > ${(config.maxHallucinationDropRatio * 100).toFixed(0)}%)`,
    });
  }

  const hasFatal = issues.some(i => i.severity === 'fatal') || hasNonMonotonic;
  const valid = !hasFatal && boundaries.length >= 2;

  return {
    valid,
    issues,
    boundaries,
    droppedCount,
    totalCandidates,
  };
}
