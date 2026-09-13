/**
 * 分镜生成服务
 * 使用 LLM 基于剧本和已确认的角色/场景/道具生成分镜列表
 * 独立于剧本解析，作为单独的步骤执行
 */
import type { Shot } from '../types';
import { createScriptLine } from '../types';
import { resolvePromptTemplate } from '../store/promptTemplates';
import { TaskManager, Task } from './TaskManager';
import { createTaskCancellationSignal } from './taskCancellationSignal';
import { parseLLMJSONWithMeta } from '../utils/llmJsonParser';
import { saveEpisodeShots } from '../store/projectStore';
import { createLogger } from '../store/logger';
import { extractErrorMessage } from '../utils/errorHandler';
import { appendStyleRequirement, type StyleSnapshotLike } from '../utils/promptNormalize';
import {
  DEFAULT_VIDEO_DURATION_SECONDS,
  normalizeVideoDurationSeconds,
  type AllowedVideoDurationSeconds,
} from '../utils/videoDuration';
import { clampDurationToSpec, formatSpecPromptHint } from '../providers/itv/durationSpec';
import {
  buildShotBreakdownDialogueModeDirective,
  formatProjectNarrativeMode,
} from './narrativeMode';

const logger = createLogger('ShotAnalysis');
const SHOT_ANALYSIS_LLM_TIMEOUT_MS = 300_000;
const DEFAULT_SHOT_DURATION_SECONDS: AllowedVideoDurationSeconds = DEFAULT_VIDEO_DURATION_SECONDS;
const SHOT_ANALYSIS_CHUNK_THRESHOLD_CHARS = 3500;
const SHOT_ANALYSIS_CHUNK_TARGET_CHARS = 2400;

interface ScriptAnalysisChunk {
  index: number;
  total: number;
  text: string;
}

export function normalizeShotDuration(duration: unknown): AllowedVideoDurationSeconds {
  return normalizeVideoDurationSeconds(duration, DEFAULT_SHOT_DURATION_SECONDS);
}

function normalizeForCoverage(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：“”‘’「」『』（）()《》<>\[\]【】\-—…,.!?;:'"`~]/g, '');
}

function splitCoverageUnits(script: string): string[] {
  return script
    .split(/[\n。！？!?；;]+/)
    .map(unit => normalizeForCoverage(unit))
    .filter(unit => unit.length >= 6);
}

export function buildShotCoverageReport(script: string, shots: Pick<Shot, 'scriptLines'>[]): {
  totalUnits: number;
  coveredUnits: number;
  coverageRatio: number;
  missingSamples: string[];
} {
  const units = splitCoverageUnits(script);
  if (!units.length) {
    return { totalUnits: 0, coveredUnits: 0, coverageRatio: 1, missingSamples: [] };
  }

  const shotText = normalizeForCoverage(
    shots.map(shot => (shot.scriptLines || []).map(line => line.text).join('\n')).join('\n')
  );
  const missing = units.filter(unit => !shotText.includes(unit));
  const coveredUnits = units.length - missing.length;
  return {
    totalUnits: units.length,
    coveredUnits,
    coverageRatio: coveredUnits / units.length,
    missingSamples: missing.slice(0, 8),
  };
}

export function splitScriptForShotAnalysis(script: string): string[] {
  const normalized = script.trim();
  if (!normalized) return [];
  if (normalized.length <= SHOT_ANALYSIS_CHUNK_THRESHOLD_CHARS) return [normalized];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);
  const units = paragraphs.length > 1
    ? paragraphs
    : normalized
      .split(/(?<=[。！？!?；;])/)
      .map(p => p.trim())
      .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    if (current.length + unit.length + 2 <= SHOT_ANALYSIS_CHUNK_TARGET_CHARS) {
      current += `${paragraphs.length > 1 ? '\n\n' : ''}${unit}`;
    } else {
      chunks.push(current);
      current = unit;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// 预选资产类型
export interface PresetAssets {
  characterIds: string[];
  propIds: string[];
}

// TODO(strict-cleanup): _SHOTS_SCHEMA JSON Schema was defined but never referenced (LLM prompts are built manually).
// Preserved here as a comment in case structured-output mode is reintroduced.

export class ShotAnalysisService {
  private ctx: import('./CreationContext').CreationContext;
  private presetAssets: PresetAssets | null = null;

  constructor(ctx: import('./CreationContext').CreationContext) {
    this.ctx = ctx;
  }

  /** 让外部 fulfiller 在调用 runShotAnalysis 前注入 presetAssets */
  setPresetAssets(presetAssets?: PresetAssets): void {
    this.presetAssets = presetAssets || null;
  }

  /**
   * 启动分镜生成任务
   */
  async startShotAnalysis(
    episodeId: string,
    episodeName: string,
    script: string,
    presetAssets?: PresetAssets,
  ): Promise<Task> {
    this.presetAssets = presetAssets || null;

    const task = TaskManager.createTask({
      projectId: this.ctx.projectId,
      type: 'shot-analysis',
      targetType: 'episode',
      targetId: episodeId,
      targetName: episodeName,
    });

    TaskManager.updateTask(task.id, { status: 'running', progress: 0 });

    // 异步执行
    this.runShotAnalysis(task.id, episodeId, script);

    return task;
  }

  /**
   * 执行分镜生成
   * 公开后可被 main-side 'analysis:shot' handler 的 renderer fulfiller 直接调用，
   * 复用其状态机与 cancel 信号订阅，不必再创建一个新的 Task。
   */
  async runShotAnalysis(
    taskId: string,
    episodeId: string,
    script: string,
  ): Promise<void> {
    const traceId = `shot-analysis-${taskId}`;
    const cancellation = createTaskCancellationSignal(taskId);
    const checkCancel = () => {
      if (cancellation.signal.aborted) {
        throw cancellation.signal.reason instanceof Error
          ? cancellation.signal.reason
          : new Error('cancelled');
      }
    };
    try {
      checkCancel();
      TaskManager.updateTask(taskId, { progress: 10 });

      const { characters, scenes, props } = this.ctx;

      logger.info('开始分镜生成', {
        traceId,
        episodeId,
        scriptLength: script.length,
        charactersCount: characters.length,
        scenesCount: scenes.length,
        propsCount: props.length,
        hasPresetAssets: !!this.presetAssets,
      });

      TaskManager.updateTask(taskId, { progress: 20 });

      const chunks = splitScriptForShotAnalysis(script).map((text, index, arr): ScriptAnalysisChunk => ({
        index,
        total: arr.length,
        text,
      }));
      logger.info('分镜生成分块计划', {
        traceId,
        chunkCount: chunks.length,
        chunkLengths: chunks.map(chunk => chunk.text.length),
      });

      const parsedShotPayloads: any[] = [];
      for (const chunk of chunks) {
        checkCancel();
        const progressBase = 20 + Math.floor((chunk.index / Math.max(chunks.length, 1)) * 55);
        TaskManager.updateTask(taskId, { progress: progressBase });
        const chunkShots = await this.generateShotPayloadsForChunk(traceId, chunk);
        parsedShotPayloads.push(...chunkShots);
      }

      TaskManager.updateTask(taskId, { progress: 75 });

      // 将角色名/道具名映射到 ID
      // 优先使用预选资产的 Sora2 ID，其次使用已绑定的 Sora2 ID，最后使用自定义 ID
      const presetCharacterIds = new Set(this.presetAssets?.characterIds || []);
      const presetPropIds = new Set(this.presetAssets?.propIds || []);

      const getCharId = (c: typeof characters[0]) => {
        if (c.sora2CharacterId && presetCharacterIds.has(c.sora2CharacterId)) {
          return c.sora2CharacterId;
        }
        return c.sora2CharacterId || c.id;
      };

      const getPropId = (p: typeof props[0]) => {
        if (p.sora2PropId && presetPropIds.has(p.sora2PropId)) {
          return p.sora2PropId;
        }
        return p.sora2PropId || p.id;
      };

      // 模糊匹配：支持 LLM 返回的名称包含描述后缀（如 "宁卓（侠客）"）或微小差异
      const fuzzyMatchAsset = <T extends { name: string }>(
        name: string,
        assets: T[]
      ): T | undefined => {
        if (!name) return undefined;
        const trimmed = name.trim();
        // 1. 精确匹配
        const exact = assets.find(a => a.name === trimmed);
        if (exact) return exact;
        // 2. LLM 返回的名称包含资产名（如 "宁卓（侠客）" 包含 "宁卓"）
        const containsAsset = assets.find(a => trimmed.includes(a.name));
        if (containsAsset) return containsAsset;
        // 3. 资产名包含 LLM 返回的名称（如资产名 "宁卓·天机" 包含 "宁卓"）
        const assetContains = assets.find(a => a.name.includes(trimmed));
        if (assetContains) return assetContains;
        return undefined;
      };

      // 分镜拆解时 description 为 undefined，后续手动生成
      // 时长按当前项目选择的 ITV 渠道 spec 吸附（grok 渠道 → 6/10/12/16/20；seedance → 4-15 范围），
      // 之前一律走 normalizeShotDuration（grok 枚举）会把 seedance 渠道的有效值 5 强制吸到 6
      const shots: Shot[] = parsedShotPayloads.map((s, index) => ({
        id: `shot_${Date.now()}_${index}`,
        scriptLines: ((s.__resolvedLines as string[] | undefined) || []).map(text => createScriptLine(text)),
        shotType: s.shotType || 'medium',
        cameraMovement: s.cameraMovement || 'static',
        duration: clampDurationToSpec(s.duration, this.ctx.itvDurationSpec),
        description: undefined,  // 后续手动生成提示词
        characters: (s.characters || [])
          .map((name: string) => {
            const match = fuzzyMatchAsset(name, characters);
            return match ? getCharId(match) : undefined;
          })
          .filter((id: string | undefined): id is string => id !== undefined),
        dialogue: s.dialogue || '',
        emotion: s.emotion || '',
        props: (s.props || [])
          .map((name: string) => {
            const match = fuzzyMatchAsset(name, props);
            return match ? getPropId(match) : undefined;
          })
          .filter((id: string | undefined): id is string => id !== undefined),
        scenes: (s.scenes || [])
          .map((name: string) => {
            const match = fuzzyMatchAsset(name, scenes);
            return match ? match.id : undefined;
          })
          .filter((id: string | undefined): id is string => id !== undefined),
        confirmed: false,
        episodeId,
      })).filter(shot => shot.scriptLines.length > 0); // Phase 2 方案 A：彻底丢弃空分镜

      const coverage = buildShotCoverageReport(script, shots);
      logger.info('分镜覆盖率检查', {
        traceId,
        shotsCount: shots.length,
        totalUnits: coverage.totalUnits,
        coveredUnits: coverage.coveredUnits,
        coverageRatio: Number(coverage.coverageRatio.toFixed(3)),
        missingSamples: coverage.missingSamples,
      });
      if (coverage.totalUnits > 0 && coverage.coverageRatio < 0.85) {
        logger.warn('分镜可能漏掉剧本内容：覆盖率低于阈值，但仍保存结果供用户检查', {
          traceId,
          coverageRatio: Number(coverage.coverageRatio.toFixed(3)),
          missingSamples: coverage.missingSamples,
        });
      }

      checkCancel();
      TaskManager.updateTask(taskId, { progress: 85 });

      // 保存分镜到剧集
      await saveEpisodeShots(this.ctx.projectId, episodeId, shots);

      if (cancellation.signal.aborted) return;
      TaskManager.updateTask(taskId, {
        status: 'completed',
        progress: 100,
        result: { shotsCount: shots.length },
      });
    } catch (error: unknown) {
      // 已被 cancel：状态已是 cancelled，不要覆盖成 failed
      if (cancellation.signal.aborted) return;
      logger.error('生成失败', error);
      TaskManager.updateTask(taskId, {
        status: 'failed',
        error: extractErrorMessage(error) || '生成失败',
      });
    } finally {
      cancellation.dispose();
    }
  }

  private async generateShotPayloadsForChunk(
    traceId: string,
    chunk: ScriptAnalysisChunk,
  ): Promise<any[]> {
    const durationSpec = this.ctx.itvDurationSpec;
    const durationConstraint = formatSpecPromptHint(durationSpec);
    const durationDefault = String(durationSpec.default);
    const projectNarrativeMode = formatProjectNarrativeMode(this.ctx.projectMode);
    const dialogueModeDirective = buildShotBreakdownDialogueModeDirective(this.ctx.projectMode);
    const { characters, scenes, props } = this.ctx;
    const chunkLabel = chunk.total > 1 ? `（第 ${chunk.index + 1}/${chunk.total} 段）` : '';

    // Phase 2 方案 A：把 chunk 文本预先拆成"字幕行 + 行号"形式喂给 LLM；
    // LLM 只输出 scriptLineIndices（局部 1-based），下游用这些索引从 chunkLines 切片，
    // 文本绝不经 LLM 改写。
    const chunkLines = chunk.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const numberedScript = chunkLines.map((line, idx) => `[${idx + 1}] ${line}`).join('\n');
    const scriptForPrompt = chunk.total > 1
      ? [
        `【当前拆解范围${chunkLabel}】`,
        '只拆解下面这一段字幕行；不要补写其他分段内容。本段内必须连续不重不漏覆盖到末行。',
        numberedScript,
      ].join('\n')
      : numberedScript;

    const resolvedPrompt = await resolvePromptTemplate('shot_breakdown', {
      script: scriptForPrompt,
      characters: characters.length > 0
        ? characters.map(c => c.description ? `${c.name}（${c.description}）` : c.name).join('\n')
        : '无',
      scenes: scenes.length > 0
        ? scenes.map(s => s.description ? `${s.name}（${s.description}）` : s.name).join('\n')
        : '无',
      props: props.length > 0
        ? props.map(p => p.description ? `${p.name}（${p.description}）` : p.name).join('\n')
        : '无',
      durationConstraint,
      durationDefault,
      projectNarrativeMode,
      dialogueModeDirective,
    });
    const styledPrompt = this.appendStyleRequirement(resolvedPrompt.prompt);

    const resolvedSystemPrompt = await resolvePromptTemplate('shot_breakdown_system', {
      durationConstraint,
      durationDefault,
      projectNarrativeMode,
      dialogueModeDirective,
    });
    const systemPrompt = resolvedSystemPrompt.prompt;

    const chunkTraceId = chunk.total > 1 ? `${traceId}-chunk-${chunk.index + 1}` : traceId;
    logger.info('准备调用 LLM', {
      traceId: chunkTraceId,
      parentTraceId: traceId,
      chunkIndex: chunk.index + 1,
      chunkTotal: chunk.total,
      scriptLength: chunk.text.length,
      systemPromptLength: systemPrompt.length,
      userPromptLength: styledPrompt.length,
      userPromptHead: styledPrompt.slice(0, 200),
    });

    const llmStart = Date.now();
    const result = await this.ctx.llmProvider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: styledPrompt },
      ],
      {
        traceId: chunkTraceId,
        source: 'shot-analysis',
        operation: chunk.total > 1 ? 'breakdown-chunk' : 'breakdown',
        taskKind: 'structured',
        taskProfileId: 'shot-breakdown',
        stream: true,
        timeoutMs: SHOT_ANALYSIS_LLM_TIMEOUT_MS,
        responseFormat: 'json_object',
      },
    );

    logger.info('LLM 返回完成', {
      traceId: chunkTraceId,
      parentTraceId: traceId,
      durationMs: Date.now() - llmStart,
      responseLength: result.length,
      responseHead: result.slice(0, 200),
      responseTail: result.length > 200 ? result.slice(-200) : '',
    });

    // 主进程已会把 0 字节流转成 EMPTY_RESPONSE 错误抛上来；这里再补一道兜底，
    // 防止某些自定义 provider 路径绕过了主进程守卫
    if (result.trim().length === 0) {
      logger.error('LLM 返回内容为空（兜底）', { traceId: chunkTraceId, parentTraceId: traceId });
      throw new Error('LLM 返回内容为空，请检查所选 LLM 渠道的模型名 / 接口路径 / 配额是否可用');
    }

    try {
      const parseResult = parseLLMJSONWithMeta<{ shots: any[] }>(result);
      const parsed = parseResult.data;
      const shotsCount = parsed.shots?.length ?? 0;
      logger.info('JSON 解析成功', {
        traceId: chunkTraceId,
        parentTraceId: traceId,
        shotsCount,
        parseMethod: parseResult.method,
        rawLength: parseResult.rawLength,
        cleanedLength: parseResult.cleanedLength,
        repairedLength: parseResult.repairedLength,
      });
      if (parseResult.method !== 'direct') {
        logger.warn('分镜 JSON 经过修复后解析成功，结果可能是不完整的半截数组，请核对 shotsCount 与剧本覆盖率', {
          traceId: chunkTraceId,
          parentTraceId: traceId,
          parseMethod: parseResult.method,
          shotsCount,
          responseTail: result.slice(-300),
        });
      }
      const rawShots = Array.isArray(parsed.shots) ? parsed.shots : [];

      // Phase 2 方案 A：把 LLM 的 scriptLineIndices（1-based 局部行号）翻译成原文字幕行
      // 全程只做"切片 + 去重 + 越界过滤"，不做任何文本改写
      const usedIndices = new Set<number>();
      const resolvedShots = rawShots.map((s) => {
        const indicesRaw = Array.isArray(s.scriptLineIndices) ? s.scriptLineIndices : [];
        const lines: string[] = [];
        for (const idx of indicesRaw) {
          if (typeof idx !== 'number' || !Number.isInteger(idx)) continue;
          if (idx < 1 || idx > chunkLines.length) continue;
          if (usedIndices.has(idx)) continue;
          usedIndices.add(idx);
          lines.push(chunkLines[idx - 1]);
        }
        return { ...s, __resolvedLines: lines };
      });

      // 兜底：未被任何分镜认领的字幕行追加到末镜，避免丢字
      const missingIndices: number[] = [];
      for (let i = 1; i <= chunkLines.length; i += 1) {
        if (!usedIndices.has(i)) missingIndices.push(i);
      }
      if (missingIndices.length && resolvedShots.length) {
        const lastShot = resolvedShots[resolvedShots.length - 1];
        for (const i of missingIndices) lastShot.__resolvedLines.push(chunkLines[i - 1]);
        logger.warn('LLM 未覆盖全部字幕行，已追加到末镜', {
          traceId: chunkTraceId,
          parentTraceId: traceId,
          missingCount: missingIndices.length,
          missingPreview: missingIndices.slice(0, 5).map(i => chunkLines[i - 1]).join(' / '),
        });
      } else if (missingIndices.length && !resolvedShots.length) {
        // 极端情况：LLM 一镜都没切；造一个兜底镜把整段塞进去
        logger.warn('LLM 未输出任何分镜，构造兜底单镜承载全部字幕行', {
          traceId: chunkTraceId,
          parentTraceId: traceId,
          lineCount: chunkLines.length,
        });
        resolvedShots.push({ __resolvedLines: [...chunkLines] });
      }

      return resolvedShots;
    } catch (parseErr) {
      const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      logger.error('分镜 JSON 解析失败', { traceId: chunkTraceId, parentTraceId: traceId, error: errMsg, responseLength: result.length });
      const CHUNK = 1000;
      for (let i = 0; i < result.length; i += CHUNK) {
        logger.error('原始响应片段', {
          traceId: chunkTraceId,
          parentTraceId: traceId,
          range: `${i}-${Math.min(i + CHUNK, result.length)}`,
          content: result.slice(i, i + CHUNK),
        });
      }
      throw parseErr;
    }
  }

  private appendStyleRequirement(prompt: string): string {
    return appendStyleRequirement(prompt, this.ctx.styleSnapshot);
  }
}

/**
 * @deprecated 现役 UI 已切到 services/analysisTaskClient.submitShotAnalysisTask
 *   （走主进程 'shot-analysis' handler，含限流 + 取消 + 多窗口共享状态）。
 *   保留此 renderer-driven 入口作为应急 fallback；新代码不要再调。
 */
export async function startShotAnalysis(
  projectId: string,
  episodeId: string,
  episodeName: string,
  script: string,
  llmSelection?: string,
  presetAssets?: PresetAssets,
  styleSnapshot?: StyleSnapshotLike,
): Promise<Task> {
  const { createCreationContext } = await import('./CreationContext');
  const ctx = await createCreationContext(projectId, episodeId, {
    llmConfigId: llmSelection,
    styleSnapshot,
  });
  const service = new ShotAnalysisService(ctx);
  return service.startShotAnalysis(episodeId, episodeName, script, presetAssets);
}
