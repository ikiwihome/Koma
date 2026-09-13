/**
 * 集边界检测管线 — 类型定义
 *
 * 管线流程: Regex 预筛选 → LLM 全文提取 → 确定性校验
 */

import type { EpisodeBoundary } from '../episodeBoundaryDetector';
import type { LLMProvider, LLMCallOptions } from '../../providers/llm/types';

// ─── 行号索引 ────────────────────────────────────────────

export interface ScriptLineRecord {
  /** 1-based 行号 */
  lineNumber: number;
  /** 去掉行尾换行后的可见文本（不改写原 script） */
  text: string;
  /** 原始 script offset start */
  start: number;
  /** 原始 script offset end (exclusive, 不含换行符) */
  end: number;
}

export interface ScriptLineIndex {
  scriptLength: number;
  totalLines: number;
  lines: ScriptLineRecord[];
  getLine(lineNumber: number): ScriptLineRecord | undefined;
  getStartOffset(lineNumber: number): number | null;
  /** 渲染指定行范围的带行号文本（供 LLM 输入） */
  renderNumberedText(startLine?: number, endLine?: number): string;
}

// ─── 格式分类 ────────────────────────────────────────────

export type EpisodeMarkerFormat =
  | 'cn_episode_title'   // 第12集、第12话：重逢
  | 'en_episode_title'   // Episode 12, EP 12
  | 'season_episode'     // S1E3, 第1季第3集
  | 'scene_heading'      // 2-1 客厅 日内
  | 'mixed'              // 多种格式混合
  | 'unknown';

// ─── Regex 预筛选 ────────────────────────────────────────

export interface RegexBoundaryScreeningResult {
  boundaries: EpisodeBoundary[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  markerFormat: EpisodeMarkerFormat;
  reasons: string[];
}

// ─── LLM Extract 候选 ───────────────────────────────────

export interface EpisodeBoundaryCandidate {
  lineNumber: number;
  rawLine: string;
  title: string;
  episodeNumber: number | null;
  confidence: number;
}

// ─── Validate 校验 ──────────────────────────────────────

export type BoundaryValidationCode =
  | 'LINE_OUT_OF_RANGE'
  | 'RAW_LINE_MISMATCH'
  | 'UNPARSABLE_SOURCE_LINE'
  | 'DUPLICATE_LINE'
  | 'DUPLICATE_EPISODE'
  | 'NON_MONOTONIC_EPISODE'
  | 'GAP_TOO_SMALL'
  | 'TOO_MANY_DROPPED';

export interface BoundaryValidationIssue {
  code: BoundaryValidationCode;
  severity: 'warning' | 'error' | 'fatal';
  message: string;
  candidateLineNumber?: number;
}

export interface EpisodeBoundaryValidationResult {
  valid: boolean;
  issues: BoundaryValidationIssue[];
  boundaries: EpisodeBoundary[];
  droppedCount: number;
  totalCandidates: number;
}

// ─── Pipeline 配置与结果 ─────────────────────────────────

export interface EpisodeBoundaryPipelineConfig {
  /** Extract 单块超时 (ms) */
  extractTimeoutMs: number;
  /** 触发分块的字符阈值（仅因上下文窗口限制） */
  extractChunkThresholdChars: number;
  /** 单块目标字符数 */
  extractTargetChars: number;
  /** 分块重叠行数 */
  extractOverlapLines: number;
  /** 分块并发数 */
  extractConcurrency: number;
  /** 最小边界行间距 */
  minBoundaryLineGap: number;
  /** 最小边界字符间距 */
  minBoundaryCharGap: number;
  /** 幻觉丢弃率上限 */
  maxHallucinationDropRatio: number;
}

export const DEFAULT_PIPELINE_CONFIG: EpisodeBoundaryPipelineConfig = {
  extractTimeoutMs: 60_000,
  extractChunkThresholdChars: 60_000,
  extractTargetChars: 30_000,
  extractOverlapLines: 50,
  extractConcurrency: 3,
  minBoundaryLineGap: 3,
  minBoundaryCharGap: 120,
  maxHallucinationDropRatio: 0.3,
};

export type PipelineSource =
  | 'regex'
  | 'llm'
  | 'llm-repaired'
  | 'regex-fallback'
  | 'none';

export interface EpisodeBoundaryPipelineResult {
  boundaries: EpisodeBoundary[];
  source: PipelineSource;
  regexScreening: RegexBoundaryScreeningResult;
  validation?: EpisodeBoundaryValidationResult;
}

export interface DetectEpisodeBoundariesOptions {
  provider: LLMProvider;
  callOptions?: LLMCallOptions;
  config?: Partial<EpisodeBoundaryPipelineConfig>;
  signal?: AbortSignal;
}

// Re-export for convenience
export type { EpisodeBoundary, LLMProvider, LLMCallOptions };
