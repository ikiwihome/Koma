/**
 * AI 自动剧集服务
 * 单次调用 LLM 生成切分方案，再在本地落地切分结果
 */
import type { CreationContext } from './CreationContext';
import { parseLLMJSON } from '../utils/llmJsonParser';
import { detectExplicitEpisodeAnalysis, materializeEpisodeSplit } from './episodeSplitUtils';
import type { SplitAnalysis, SplitResult } from './episodeSplitUtils';

const FULL_SCRIPT_ANALYSIS_CHAR_LIMIT = 36_000;
const BOOKEND_SIZE = 3_000;
const MIDDLE_SEGMENT_MIN = 3_000;
const MIDDLE_SEGMENT_MAX = 6_000;
const MAX_MIDDLE_SEGMENTS = 12;
const OMISSION_MARKER = '\n\n[...省略...]\n\n';

/** Scene boundary regex (local copy from scriptAnalysisChunking) */
const SCENE_BOUNDARY_RE = /^\s*(第[零〇一二三四五六七八九十百千两\d０-９]+\s*[集回话章节卷部篇]|(?:episode|ep\.?|chapter|part|vol\.?)\s*\d+|s\s*\d+\s*e\s*\d+|\d{1,4}\s*[-—–]\s*\d{1,4}\b)/i;

export interface SplitOptions {
  targetEpisodeCount?: number;
  maxEpisodeDuration?: number;
  splitStrategy: 'auto' | 'scene' | 'chapter';
  onChunk?: (delta: string, accumulated: string) => void;
}

export type { EpisodeBlueprint, SplitAnalysis, SplitPoint, SplitResult } from './episodeSplitUtils';

/**
 * Find all scene boundary character positions within a substring of the script.
 * Returns positions relative to the full script (offset-adjusted).
 */
function findSceneBoundaries(script: string, from: number, to: number): number[] {
  const positions: number[] = [];
  const region = script.slice(from, to);
  const lines = region.split('\n');
  let cursor = 0;
  for (const line of lines) {
    if (SCENE_BOUNDARY_RE.test(line.trim())) {
      positions.push(from + cursor);
    }
    cursor += line.length + 1; // +1 for the '\n'
  }
  return positions;
}

function buildAnalysisScript(script: string): string {
  if (script.length <= FULL_SCRIPT_ANALYSIS_CHAR_LIMIT) {
    return script;
  }

  const totalLength = script.length;

  // 1. Bookend segments: opening and ending
  const openingEnd = Math.min(BOOKEND_SIZE, totalLength);
  const closingStart = Math.max(totalLength - BOOKEND_SIZE, openingEnd);

  const opening = script.slice(0, openingEnd);
  const closing = script.slice(closingStart);

  // 2. Middle section sampling
  const middleFrom = openingEnd;
  const middleTo = closingStart;
  const middleLength = middleTo - middleFrom;

  if (middleLength <= 0) {
    // Script is short enough that bookends cover everything
    return opening + (closingStart > openingEnd ? OMISSION_MARKER + closing : '');
  }

  const segmentCount = Math.min(MAX_MIDDLE_SEGMENTS, Math.ceil(totalLength / 6000));
  const boundaries = findSceneBoundaries(script, middleFrom, middleTo);

  const middleSegments: string[] = [];

  if (boundaries.length >= segmentCount) {
    // Enough scene boundaries — pick evenly distributed ones
    for (let i = 0; i < segmentCount; i++) {
      const idx = Math.floor((i / segmentCount) * boundaries.length);
      const segStart = boundaries[idx];
      const segEnd = Math.min(segStart + MIDDLE_SEGMENT_MAX, middleTo);
      middleSegments.push(script.slice(segStart, segEnd));
    }
  } else {
    // Not enough scene boundaries — fall back to evenly spaced positions,
    // snapping to the nearest scene boundary when one is close.
    const step = middleLength / segmentCount;
    for (let i = 0; i < segmentCount; i++) {
      let segStart = middleFrom + Math.floor(step * i);

      // Snap to nearest scene boundary within ±2000 chars
      let bestDist = Infinity;
      for (const b of boundaries) {
        const dist = Math.abs(b - segStart);
        if (dist < bestDist && dist <= 2000) {
          bestDist = dist;
          segStart = b;
        }
      }

      const segSize = Math.max(MIDDLE_SEGMENT_MIN, Math.min(MIDDLE_SEGMENT_MAX, Math.floor(step)));
      const segEnd = Math.min(segStart + segSize, middleTo);
      middleSegments.push(script.slice(segStart, segEnd));
    }
  }

  // 3. Assemble with position labels and omission markers
  const totalSegments = middleSegments.length + 2; // +2 for opening & closing
  const parts: string[] = [
    `【片段 1/${totalSegments}，原始位置 0-${openingEnd}】\n${opening}`,
  ];

  middleSegments.forEach((seg, i) => {
    const segIdx = i + 2;
    // Recover approximate position from the segment content
    const pos = script.indexOf(seg.slice(0, 80));
    const posLabel = pos >= 0 ? `${pos}-${pos + seg.length}` : '(中间采样)';
    parts.push(`【片段 ${segIdx}/${totalSegments}，原始位置 ${posLabel}】\n${seg}`);
  });

  parts.push(
    `【片段 ${totalSegments}/${totalSegments}，原始位置 ${closingStart}-${totalLength}】\n${closing}`,
  );

  return [
    '原始剧本较长，以下内容是按时间顺序抽样的完整剧本片段（含开头与结尾完整内容）。',
    '请基于这些片段判断整体节奏，所有 splitPoints.position 都必须使用完整原始剧本的字符位置。',
    ...parts,
  ].join(OMISSION_MARKER);
}

function buildSplitPrompt(script: string, options: SplitOptions): string {
  const scriptForAnalysis = buildAnalysisScript(script);
  const targetCountInstruction = options.targetEpisodeCount
    ? `- 必须严格分成 ${options.targetEpisodeCount} 集`
    : '- 根据剧情自动判断合适的集数';
  const strategy = options.splitStrategy === 'scene'
    ? '按场景分割'
    : options.splitStrategy === 'chapter'
      ? '按章节分割'
      : '智能分析';

  return `请分析以下剧本结构，规划多集拆分方案。

剧本内容：
${scriptForAnalysis}

要求：
${targetCountInstruction}
- 分割策略: ${strategy}
- 若原文存在明确分集边界，必须严格遵守原文边界，不得重排集数
- splitPoints 必须按剧情顺序输出，数量必须等于 suggestedCount - 1
- marker 必须是靠近分割点的原文短语，便于在完整剧本中直接定位
- episodeBlueprints 必须按剧集顺序输出，数量必须等于 suggestedCount
- 只返回合法 JSON，不要附加说明文字

JSON 格式：
{
  "suggestedCount": 数字,
  "splitPoints": [
    { "position": 原始剧本字符位置, "marker": "分割点附近原文", "reason": "分割理由" }
  ],
  "episodeBlueprints": [
    { "title": "剧集标题", "summary": "本集摘要" }
  ],
  "reasoning": "整体分析说明"
}`;
}

export class EpisodeSplitService {
  private provider: CreationContext['llmProvider'];
  private aborted = false;

  constructor(ctx: CreationContext) {
    this.provider = ctx.llmProvider;
  }

  abort(): void {
    this.aborted = true;
  }

  private safeParseJSON<T>(text: string): T {
    return parseLLMJSON<T>(text);
  }

  private getExplicitAnalysis(script: string, options: SplitOptions): SplitAnalysis | null {
    const analysis = detectExplicitEpisodeAnalysis(script);
    if (!analysis) {
      return null;
    }

    if (
      options.targetEpisodeCount
      && options.targetEpisodeCount !== analysis.suggestedCount
    ) {
      return {
        ...analysis,
        reasoning: `${analysis.reasoning}。用户输入目标为 ${options.targetEpisodeCount} 集，但已优先按原文识别出的 ${analysis.suggestedCount} 集拆分。`,
      };
    }

    return analysis;
  }

  async analyzeScript(script: string, options: SplitOptions): Promise<SplitAnalysis> {
    this.aborted = false;
    const explicitAnalysis = this.getExplicitAnalysis(script, options);
    if (explicitAnalysis) {
      return explicitAnalysis;
    }

    const systemPrompt = `你是一个专业的影视编剧，擅长分析剧本结构和规划剧集。
分析时请考虑：
1. 故事弧线的完整性
2. 情节的自然过渡点
3. 每集的戏剧张力
4. 角色发展的节奏`;

    const response = await this.provider.generateText(
      buildSplitPrompt(script, options),
      systemPrompt,
      {
        source: 'EpisodeSplitService.analyzeScript',
        operation: 'episode_split_analysis',
        taskKind: 'analyze',
        stream: typeof options.onChunk === 'function',
        onChunk: options.onChunk,
      },
    );

    if (this.aborted) {
      throw new Error('剧集分析已取消');
    }

    return this.safeParseJSON<SplitAnalysis>(response);
  }

  splitScript(script: string, analysis: SplitAnalysis): SplitResult[] {
    if (this.aborted) {
      throw new Error('剧集切分已取消');
    }

    return materializeEpisodeSplit(script, analysis);
  }
}

export default EpisodeSplitService;
