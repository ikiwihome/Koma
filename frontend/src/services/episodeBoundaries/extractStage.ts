/**
 * LLM Extract 阶段
 *
 * 把完整脚本（带行号）发给 LLM，做"抄录式提取"。
 * 超长脚本自动分块（仅因上下文窗口限制）。
 */

import type {
  EpisodeBoundaryCandidate,
  EpisodeBoundaryPipelineConfig,
  ScriptLineIndex,
  LLMProvider,
  LLMCallOptions,
  EpisodeMarkerFormat,
} from './types';
import { EXTRACT_SYSTEM_PROMPT, buildExtractUserPrompt, EXTRACT_RETRY_SUFFIX } from './prompts';

interface ExtractChunkPlan {
  chunkId: string;
  primaryStartLine: number;
  primaryEndLine: number;
  contextStartLine: number;
  contextEndLine: number;
}

export interface ExtractResult {
  candidates: EpisodeBoundaryCandidate[];
  failedChunks: string[];
}

// ─── 分块规划 ────────────────────────────────────────────

function planChunks(
  lineIndex: ScriptLineIndex,
  config: EpisodeBoundaryPipelineConfig,
): ExtractChunkPlan[] {
  if (lineIndex.scriptLength <= config.extractChunkThresholdChars) {
    return [{
      chunkId: 'single',
      primaryStartLine: 1,
      primaryEndLine: lineIndex.totalLines,
      contextStartLine: 1,
      contextEndLine: lineIndex.totalLines,
    }];
  }

  const plans: ExtractChunkPlan[] = [];
  let currentLine = 1;
  let chunkIdx = 0;

  while (currentLine <= lineIndex.totalLines) {
    // 找到目标字符数对应的结束行
    const startOffset = lineIndex.getStartOffset(currentLine) ?? 0;
    let endLine = currentLine;
    for (let ln = currentLine; ln <= lineIndex.totalLines; ln++) {
      const line = lineIndex.getLine(ln);
      if (!line) break;
      if (line.end - startOffset >= config.extractTargetChars) {
        endLine = ln;
        break;
      }
      endLine = ln;
    }

    const contextStart = Math.max(1, currentLine - config.extractOverlapLines);
    const contextEnd = Math.min(lineIndex.totalLines, endLine + config.extractOverlapLines);

    plans.push({
      chunkId: `chunk-${chunkIdx}`,
      primaryStartLine: currentLine,
      primaryEndLine: endLine,
      contextStartLine: contextStart,
      contextEndLine: contextEnd,
    });

    currentLine = endLine + 1;
    chunkIdx++;
  }

  return plans;
}

// ─── 单块提取 ────────────────────────────────────────────

function parseCandidatesFromJSON(text: string): EpisodeBoundaryCandidate[] | null {
  try {
    // 尝试直接解析
    const parsed = JSON.parse(text);
    if (parsed?.candidates && Array.isArray(parsed.candidates)) {
      return parsed.candidates;
    }
    return null;
  } catch {
    // 尝试从 markdown code block 中提取
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1]);
        if (parsed?.candidates && Array.isArray(parsed.candidates)) {
          return parsed.candidates;
        }
      } catch { /* fall through */ }
    }
    // 尝试找到第一个 { 到最后一个 }
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        const parsed = JSON.parse(braceMatch[0]);
        if (parsed?.candidates && Array.isArray(parsed.candidates)) {
          return parsed.candidates;
        }
      } catch { /* fall through */ }
    }
    return null;
  }
}

async function extractSingleChunk(
  provider: LLMProvider,
  lineIndex: ScriptLineIndex,
  chunk: ExtractChunkPlan,
  config: EpisodeBoundaryPipelineConfig,
  callOptions?: LLMCallOptions,
  markerFormatHint?: EpisodeMarkerFormat,
  signal?: AbortSignal,
): Promise<EpisodeBoundaryCandidate[]> {
  const numberedText = lineIndex.renderNumberedText(chunk.contextStartLine, chunk.contextEndLine);
  const isSingleChunk = chunk.chunkId === 'single';

  const userPrompt = buildExtractUserPrompt(numberedText, {
    markerFormatHint: markerFormatHint !== 'unknown' ? markerFormatHint : undefined,
    primaryStartLine: isSingleChunk ? undefined : chunk.primaryStartLine,
    primaryEndLine: isSingleChunk ? undefined : chunk.primaryEndLine,
  });

  const opts: LLMCallOptions = {
    ...callOptions,
    operation: 'episode-boundary-extract',
    taskKind: 'extract',
    taskProfileId: 'episode-boundary-extract',
    disableChunking: true,
    timeoutMs: config.extractTimeoutMs,
  };

  // First attempt
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let responseText = await provider.generateText(userPrompt, EXTRACT_SYSTEM_PROMPT, opts);
  let candidates = parseCandidatesFromJSON(responseText);

  // Retry once on parse failure
  if (!candidates) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    responseText = await provider.generateText(
      userPrompt + EXTRACT_RETRY_SUFFIX,
      EXTRACT_SYSTEM_PROMPT,
      opts,
    );
    candidates = parseCandidatesFromJSON(responseText);
  }

  if (!candidates) {
    throw new Error(`Failed to parse LLM response for ${chunk.chunkId}`);
  }

  // 标记 chunkId 并过滤主范围
  return candidates
    .filter(c => {
      if (isSingleChunk) return true;
      return c.lineNumber >= chunk.primaryStartLine && c.lineNumber <= chunk.primaryEndLine;
    })
    .map(c => ({
      lineNumber: c.lineNumber,
      rawLine: c.rawLine ?? '',
      title: c.title ?? '',
      episodeNumber: typeof c.episodeNumber === 'number' ? c.episodeNumber : null,
      confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
    }));
}

// ─── 合并去重 ────────────────────────────────────────────

function deduplicateCandidates(candidates: EpisodeBoundaryCandidate[]): EpisodeBoundaryCandidate[] {
  // 按 lineNumber 排序
  const sorted = [...candidates].sort((a, b) => a.lineNumber - b.lineNumber);

  // 同行号去重：保留 confidence 更高的
  const byLine = new Map<number, EpisodeBoundaryCandidate>();
  for (const c of sorted) {
    const existing = byLine.get(c.lineNumber);
    if (!existing || c.confidence > existing.confidence) {
      byLine.set(c.lineNumber, c);
    }
  }

  return Array.from(byLine.values()).sort((a, b) => a.lineNumber - b.lineNumber);
}

// ─── 主入口 ──────────────────────────────────────────────

export async function runExtractStage(
  provider: LLMProvider,
  lineIndex: ScriptLineIndex,
  config: EpisodeBoundaryPipelineConfig,
  callOptions?: LLMCallOptions,
  markerFormatHint?: EpisodeMarkerFormat,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  const chunks = planChunks(lineIndex, config);
  const failedChunks: string[] = [];
  let allCandidates: EpisodeBoundaryCandidate[] = [];

  if (chunks.length === 1) {
    // 单块直接提取
    try {
      allCandidates = await extractSingleChunk(
        provider, lineIndex, chunks[0], config, callOptions, markerFormatHint, signal,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      failedChunks.push(chunks[0].chunkId);
    }
  } else {
    // 分块并发提取
    const concurrency = config.extractConcurrency;
    for (let i = 0; i < chunks.length; i += concurrency) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const batch = chunks.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(chunk =>
          extractSingleChunk(provider, lineIndex, chunk, config, callOptions, markerFormatHint, signal),
        ),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          allCandidates.push(...result.value);
        } else {
          if (result.reason instanceof DOMException && result.reason.name === 'AbortError') throw result.reason;
          failedChunks.push(batch[j].chunkId);
        }
      }
    }
  }

  return {
    candidates: deduplicateCandidates(allCandidates),
    failedChunks,
  };
}

/**
 * 对缺失区间做局部重提取
 */
export async function runTargetedReExtract(
  provider: LLMProvider,
  lineIndex: ScriptLineIndex,
  config: EpisodeBoundaryPipelineConfig,
  gapStartLine: number,
  gapEndLine: number,
  callOptions?: LLMCallOptions,
  markerFormatHint?: EpisodeMarkerFormat,
  signal?: AbortSignal,
): Promise<EpisodeBoundaryCandidate[]> {
  const windowLines = 120;
  const chunk: ExtractChunkPlan = {
    chunkId: 'targeted-reextract',
    primaryStartLine: Math.max(1, gapStartLine - windowLines),
    primaryEndLine: Math.min(lineIndex.totalLines, gapEndLine + windowLines),
    contextStartLine: Math.max(1, gapStartLine - windowLines - 30),
    contextEndLine: Math.min(lineIndex.totalLines, gapEndLine + windowLines + 30),
  };

  try {
    return await extractSingleChunk(
      provider, lineIndex, chunk, config, callOptions, markerFormatHint, signal,
    );
  } catch {
    return [];
  }
}
