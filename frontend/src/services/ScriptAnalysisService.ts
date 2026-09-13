/**
 * 剧本解析服务
 * 使用 LLM 分析剧本，提取角色、场景、道具
 * 分镜生成由 ShotAnalysisService 单独处理
 */
import type { Character, Scene, Prop, Shot, ScriptAnalysisResult } from '../types';
import { scriptLinesFromText } from '../types';
import { resolvePromptTemplate } from '../store/promptTemplates';
import type { ResolvedPromptTemplate } from '../store/promptTemplates';
import { logLLMCall } from '../store/aiCallLogger';
import { createLogger } from '../store/logger';
import { TaskManager, Task } from './TaskManager';
import { createTaskCancellationSignal } from './taskCancellationSignal';
import { parseLLMJSON } from '../utils/llmJsonParser';
import { runWithConcurrency } from '../utils/concurrency';
import { cleanText, sanitizeCharacterAppearance } from '../utils/textUtils';
import { INJECTION_GUARD, wrapUserContent, appendStyleRequirement, type StyleSnapshotLike } from '../utils/promptNormalize';
import {
  buildScriptAnalysisOverallProgress,
  buildScriptAnalysisStatusLine,
  createInitialScriptAnalysisStageStates,
  getPrimaryScriptAnalysisStage,
  type ScriptAnalysisProgressStage,
} from './scriptAnalysisProgress';
import {
  buildScriptAnalysisChunkFailureMessage,
  formatScriptAnalysisChunkError,
  type ScriptAnalysisChunkFailure,
} from './scriptAnalysisErrorSummary';
import { normalizeVideoDurationSeconds } from '../utils/videoDuration';
import { formatSpecPromptHint } from '../providers/itv/durationSpec';
import {
  buildShotBreakdownDialogueModeDirective,
  formatProjectNarrativeMode,
} from './narrativeMode';

const logger = createLogger('ScriptAnalysisService');

const CHUNK_MAX_ATTEMPTS = 2;
const CHUNK_RETRY_BASE_DELAY_MS = 1200;
// 单 stage 内并行处理的 chunk 数。4 是经验值：
// - 太小（1）→ 大剧本解析串行很慢
// - 太大（>8）→ 容易触发 LLM provider 的速率限制（429）
// 三个 stage（characters/scenes/props）已在外层全并行，所以同时进行的 LLM 调用 = 4 × 3 = 12
const CHUNK_CONCURRENCY = 4;
const SCRIPT_ANALYSIS_TIMEOUT_MS = 180_000;
const PLAN_MIN_SCRIPT_LENGTH = 6_000;
const PLAN_MIN_CHUNK_COUNT = 4;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
import { buildChunkContextPrompt, splitScriptIntoChunks } from './scriptAnalysisChunking';
import type { CreationPlan } from './CreationPlan';
import { generateCreationPlan, planToStylePrefix, planToRelationshipContext } from './CreationPlan';

import {
  saveCharacters,
  saveScenes,
  saveProps,
  saveEpisodeAnalysis,
  loadEpisodeAnalysis,
} from '../store/projectStore';
import {
  addCharacterEpisodeRef,
  addSceneEpisodeRef,
  addPropEpisodeRef,
} from '../store/projectStore';

function serviceShouldGeneratePlan(
  script: string,
  completedStages: Set<'characters' | 'scenes' | 'props'>,
): boolean {
  if (completedStages.has('characters') && completedStages.has('scenes') && completedStages.has('props')) {
    return false;
  }
  const chunks = splitScriptIntoChunks(script);
  return script.length >= PLAN_MIN_SCRIPT_LENGTH || chunks.length >= PLAN_MIN_CHUNK_COUNT;
}

// 解析阶段
export type AnalysisStage = 'characters' | 'scenes' | 'props' | 'shots';

// 剧集上下文
export interface EpisodeContext {
  episodeId: string;
  episodeName?: string;
  episodeScript: string;
}

// 解析进度回调
export interface AnalysisProgress {
  stage: AnalysisStage;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
  stageProgress?: number;
  chunkIndex?: number;
  chunkTotal?: number;
  retryAttempt?: number;
  retryMax?: number;
  retryDelayMs?: number;
}

// 分步解析结果
export interface StageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  episodeId?: string; // 如果是剧集模式，标记所属剧集
}

// JSON Schema 定义
const CHARACTERS_SCHEMA = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '角色名称' },
          age: {
            type: 'string',
            description: '年龄。须根据剧本线索（职业/身份/家庭/对白/年代等）尽量推断具体年龄或区间，例如 "28岁"、"40岁出头"、"约30岁"、"60岁以上的老人"；只有完全无任何线索时才允许填 "未知"。',
          },
          gender: { type: 'string', enum: ['male', 'female', 'neutral', 'unknown'], description: '角色性别' },
          role: { type: 'string', enum: ['protagonist', 'antagonist', 'supporting'], description: '角色定位' },
          description: {
            type: 'string',
            description: '≤ 20 字的极简身份/职业标签，仅供 LLM 上下文识别；禁止剧情、性格、心理、过往经历。',
          },
          appearance: {
            type: 'string',
            description: 'AI 文生图用的纯客观可见外观描述（中文，建议 ≥ 60 字）。必须覆盖：脸部（脸型/眉/眼/瞳色/鼻/嘴/肤色）、头发、体态、上下装与鞋履（每件给【颜色】+【款式】+【材质】）、配饰、衣物外可见的疤痕/纹身/胎记/穿孔。禁止性格情绪、被衣物遮挡的隐藏部位特征、职业身份叙述、模糊词。',
          },
        },
        required: ['name', 'age', 'gender', 'role', 'description', 'appearance'],
      },
    },
  },
  required: ['characters'],
};

const SCENES_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '场景名称' },
          location: { type: 'string', description: '地点' },
          time: { type: 'string', enum: ['day', 'night', 'twilight'], description: '时间' },
          mood: { type: 'string', description: '氛围情绪' },
          description: { type: 'string', description: 'AI绘图用的场景描述，中文' },
        },
        required: ['name', 'location', 'time', 'mood', 'description'],
      },
    },
  },
  required: ['scenes'],
};

const PROPS_SCHEMA = {
  type: 'object',
  properties: {
    props: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '道具名称' },
          type: { type: 'string', description: '道具类型' },
          description: { type: 'string', description: 'AI绘图用的道具描述，中文' },
        },
        required: ['name', 'type', 'description'],
      },
    },
  },
  required: ['props'],
};

const SHOTS_SCHEMA = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scriptContent: { type: 'string', description: '对应的剧本原文片段' },
          shotType: { type: 'string', enum: ['close-up', 'medium', 'wide', 'extreme-wide'] },
          cameraMovement: { type: 'string', enum: ['static', 'pan', 'zoom-in', 'tracking'] },
          duration: { type: 'number', description: '建议时长秒数' },
          description: { type: 'string', description: '画面描述，用于生成图片的prompt，中文' },
          characters: { type: 'array', items: { type: 'string' }, description: '出场角色名称列表' },
          dialogue: { type: 'string', description: '台词' },
          emotion: { type: 'string', description: '情绪标签' },
          props: { type: 'array', items: { type: 'string' }, description: '出现的道具名称' },
        },
        required: ['scriptContent', 'shotType', 'duration', 'description'],
      },
    },
  },
  required: ['shots'],
};

export class ScriptAnalysisService {
  private ctx: import('./CreationContext').CreationContext;
  private onProgress?: (progress: AnalysisProgress) => void;
  private episodeContext?: EpisodeContext;
  private styleSnapshot?: StyleSnapshotLike;
  private creationPlan?: CreationPlan;
  private systemPromptPromise?: Promise<ResolvedPromptTemplate>;
  /** 整集推文旁白；用于注入到 character/scene/prop 提取模板的 {{tweetScript}} 占位符 */
  private tweetScript?: string;
  /** 剧情主线摘要；用于注入到提取模板的 {{plotSummary}} 占位符 */
  private plotSummary?: string;

  constructor(
    ctx: import('./CreationContext').CreationContext,
    options?: {
      onProgress?: (progress: AnalysisProgress) => void;
      episodeContext?: EpisodeContext;
      tweetScript?: string;
      plotSummary?: string;
    },
  ) {
    this.ctx = ctx;
    this.onProgress = options?.onProgress;
    this.episodeContext = options?.episodeContext;
    this.styleSnapshot = ctx.styleSnapshot;
    this.tweetScript = options?.tweetScript;
    this.plotSummary = options?.plotSummary;
  }

  // 设置剧集上下文
  setEpisodeContext(context?: EpisodeContext) {
    this.episodeContext = context;
  }

  setStyleSnapshot(styleSnapshot?: StyleSnapshotLike) {
    this.styleSnapshot = styleSnapshot;
  }

  setCreationPlan(plan: CreationPlan) {
    this.creationPlan = plan;
  }

  setTweetScript(tweetScript?: string) {
    this.tweetScript = tweetScript;
  }

  setPlotSummary(plotSummary?: string) {
    this.plotSummary = plotSummary;
  }

  // 获取当前使用的剧本（优先剧集剧本）
  private getScript(script: string): string {
    return this.episodeContext?.episodeScript || script;
  }

  // 报告进度
  private reportProgress(
    stage: AnalysisStage,
    status: AnalysisProgress['status'],
    message?: string,
    details?: Omit<AnalysisProgress, 'stage' | 'status' | 'message'>,
  ) {
    this.onProgress?.({ stage, status, message, ...details });
  }

  private getSystemPromptTemplate(): Promise<ResolvedPromptTemplate> {
    if (!this.systemPromptPromise) {
      this.systemPromptPromise = resolvePromptTemplate('script_analysis_system', {});
    }
    return this.systemPromptPromise;
  }

  private stringifySchema(schema: unknown): string {
    return JSON.stringify(schema);
  }

  // 调用 LLM
  private async callLLM(
    prompt: string,
    schema: any,
    templateMeta?: { templateId?: string; promptSource?: 'default' | 'custom' | 'finalized' }
  ): Promise<string> {
    // 获取系统提示词模板，追加注入防御指令
    const resolvedSystemPrompt = await this.getSystemPromptTemplate();
    const systemPrompt = resolvedSystemPrompt.prompt + INJECTION_GUARD;

    // 构建带 JSON Schema 约束的 prompt
    const fullPrompt = `${prompt}\n\n你必须只返回一个合法 JSON 对象，并严格满足这个 JSON Schema：\n${this.stringifySchema(schema)}`;

    // 打印 LLM 调用日志
    logLLMCall(
      this.ctx.llmConfig.name || 'LLM',
      fullPrompt,
      systemPrompt,
      {
        targetName: '剧本解析',
        templateId: templateMeta?.templateId || resolvedSystemPrompt.template.id,
        promptSource: templateMeta?.promptSource || resolvedSystemPrompt.source,
      }
    );

    const result = await this.ctx.llmProvider.generateText(fullPrompt, systemPrompt, {
      source: 'ScriptAnalysisService.callLLM',
      operation: 'script_analysis',
      taskKind: 'analyze',
      taskProfileId: 'script-analysis',
      targetName: this.episodeContext?.episodeName || '剧本解析',
      stream: false,
      disableChunking: true,
      timeoutMs: SCRIPT_ANALYSIS_TIMEOUT_MS,
      responseFormat: 'json_object',
    });
    return result;
  }

  // 解析 LLM 返回的 JSON（委托给 parseLLMJSON 工具函数）
  private parseJSON<T>(text: string): T {
    return parseLLMJSON<T>(text);
  }

  private async extractChunkedItems<T extends { name: string }>(
    stage: AnalysisStage,
    label: string,
    templateId: 'character_extraction' | 'scene_extraction' | 'prop_extraction',
    script: string,
    schema: any,
    parseItems: (text: string) => any[],
    mapItem: (item: any, index: number) => T
  ): Promise<T[]> {
    const chunks = splitScriptIntoChunks(script);
    const collected = new Map<string, T>();
    let completedChunks = 0;

    this.reportProgress(stage, 'running', `正在分析${label}...（共 ${chunks.length} 个分块，并发 ${CHUNK_CONCURRENCY}）`, {
      stageProgress: 0,
      chunkIndex: 0,
      chunkTotal: chunks.length,
    });

    // 预构建每个分块的 prompt（不依赖其他分块结果）
    // 如果有 CreationPlan，将全局规划信息注入每个 chunk 的 prompt
    const planPrefix = this.creationPlan
      ? `【全局创作规划】\n${planToStylePrefix(this.creationPlan)}\n${planToRelationshipContext(this.creationPlan)}\n\n`
      : '';

    // 提取阶段的辅助上下文：推文旁白 / 剧情摘要 / 项目视觉风格
    // 三者均为可选，未提供时占位符会被 resolvePromptTemplate 内部清理
    const extractionAuxVariables: Record<string, string> = {
      tweetScript: this.tweetScript ?? '',
      plotSummary: this.plotSummary ?? '',
      stylePrefix: this.styleSnapshot?.ttiStylePrefix ?? '',
    };

    const chunkPrompts = await Promise.all(
      chunks.map(async (chunk) => {
        const resolvedPrompt = await resolvePromptTemplate(templateId, {
          script: wrapUserContent(chunk.content),
          ...extractionAuxVariables,
        });
        const styledPrompt = this.appendStyleRequirement(resolvedPrompt.prompt);
        // 并行模式下无法实时共享已识别实体，去重由最终 Map 保证
        const chunkPrompt = buildChunkContextPrompt(
          planPrefix + styledPrompt, chunk.index, chunk.total, [],
        );
        return { chunk, chunkPrompt, resolvedPrompt };
      })
    );

    // chunks 内并行执行：runWithConcurrency 控制同时运行不超过 CHUNK_CONCURRENCY 个，
    // 每个 chunk 内部仍保留 retry。结果按原始 chunk 顺序返回。
    let failedChunks = 0;
    const chunkFailures: ScriptAnalysisChunkFailure[] = [];

    const chunkResults = await runWithConcurrency(
      chunkPrompts.map(({ chunk, chunkPrompt, resolvedPrompt }) => async () => {
        let items: any[] | null = null;
        let lastError: unknown;
        for (let attempt = 0; attempt < CHUNK_MAX_ATTEMPTS; attempt++) {
          try {
            const result = await this.callLLM(chunkPrompt, schema, {
              templateId: resolvedPrompt.template.id,
              promptSource: resolvedPrompt.source,
            });
            items = parseItems(result);
            break;
          } catch (err: unknown) {
            lastError = err;
            if (attempt < CHUNK_MAX_ATTEMPTS - 1) {
              const retryDelayMs = CHUNK_RETRY_BASE_DELAY_MS * (attempt + 1);
              this.reportProgress(stage, 'running', `正在重试${label}分块 ${chunk.index}/${chunk.total}...`, {
                stageProgress: completedChunks / chunks.length,
                chunkIndex: chunk.index,
                chunkTotal: chunk.total,
                retryAttempt: attempt + 2,
                retryMax: CHUNK_MAX_ATTEMPTS,
                retryDelayMs,
              });
              await delay(retryDelayMs);
            }
          }
        }
        // 单 chunk 完成后报告进度（并发场景下原子计数）
        if (items) {
          completedChunks++;
          this.reportProgress(stage, 'running', `正在分析${label}...（${completedChunks}/${chunk.total} 完成）`, {
            stageProgress: completedChunks / chunks.length,
            chunkIndex: completedChunks,
            chunkTotal: chunk.total,
          });
        }
        return { chunk, items, lastError };
      }),
      CHUNK_CONCURRENCY
    );

    // 汇总结果（按原顺序）
    for (const settled of chunkResults) {
      if (settled.status !== 'fulfilled') {
        // runWithConcurrency 内部 try 已捕获 task() 抛错；fulfilled 永远为真，
        // 但保险起见仍处理 rejected 分支
        failedChunks++;
        chunkFailures.push({
          chunkIndex: -1,
          chunkTotal: chunks.length,
          error: settled.reason,
        });
        continue;
      }
      const { chunk, items, lastError } = settled.value;
      if (!items) {
        failedChunks++;
        const chunkError = formatScriptAnalysisChunkError(lastError);
        chunkFailures.push({
          chunkIndex: chunk.index,
          chunkTotal: chunk.total,
          error: lastError,
        });
        logger.warn(`${label}分块解析失败（已重试 ${CHUNK_MAX_ATTEMPTS} 次）`, {
          chunkIndex: chunk.index,
          chunkTotal: chunk.total,
          error: chunkError,
        });
        continue;
      }
      for (const item of items) {
        if (!item?.name || collected.has(item.name)) continue;
        collected.set(item.name, mapItem(item, collected.size));
      }
    }

    if (collected.size === 0 && failedChunks > 0) {
      throw new Error(buildScriptAnalysisChunkFailureMessage(label, chunkFailures));
    }

    return Array.from(collected.values());
  }

  private appendStyleRequirement(prompt: string): string {
    let result = appendStyleRequirement(prompt, this.styleSnapshot);
    if (this.creationPlan) {
      const stylePrefix = planToStylePrefix(this.creationPlan);
      const relationshipCtx = planToRelationshipContext(this.creationPlan);
      const planContext = [stylePrefix, relationshipCtx].filter(Boolean).join('\n');
      if (planContext) {
        result = `${result}\n\n【创作规划】\n${planContext}`;
      }
    }
    return result;
  }

  // 提取角色
  async extractCharacters(script: string): Promise<StageResult<Character[]>> {
    const effectiveScript = this.getScript(script);
    const modeHint = this.episodeContext
      ? `（剧集模式：${this.episodeContext.episodeName || this.episodeContext.episodeId}）`
      : '';
    this.reportProgress('characters', 'running', `正在分析角色...${modeHint}`);

    try {
      const characters = await this.extractChunkedItems<Character>(
        'characters',
        '角色',
        'character_extraction',
        effectiveScript,
        CHARACTERS_SCHEMA,
        (text) => {
          const parsed = this.parseJSON<{ characters: any[] }>(text);
          if (!Array.isArray(parsed?.characters)) return [];
          return parsed.characters.filter((c: any) => c && typeof c.name === 'string' && c.name.trim());
        },
        (c, index) => ({
          // prompt 只承载纯视觉 appearance；description 保留为非视觉的人物小传
          // 即便 LLM 越线把剧情写进 appearance，也会在这里被过滤掉，避免污染后续生图链路。
          id: `char_${Date.now()}_${index}`,
          name: c.name,
          appearance: sanitizeCharacterAppearance(c.appearance, c.name),
          description: cleanText(c.description || ''),
          prompt: sanitizeCharacterAppearance(c.appearance, c.name) || c.name,
          age: c.age || '未知',
          gender: ['male', 'female', 'neutral', 'unknown'].includes(c.gender) ? c.gender : 'unknown',
          role: c.role || 'supporting',
          aliases: typeof c.aliases === 'string' ? c.aliases.trim() : (Array.isArray(c.aliases) ? c.aliases.join(',') : ''),
          episodeId: this.episodeContext?.episodeId,
        })
      );

      this.reportProgress('characters', 'completed', `识别到 ${characters.length} 个角色`, { stageProgress: 1 });
      return { success: true, data: characters, episodeId: this.episodeContext?.episodeId };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.reportProgress('characters', 'failed', errorMessage, { stageProgress: 1 });
      return { success: false, error: errorMessage };
    }
  }

  // 提取场景
  async extractScenes(script: string): Promise<StageResult<Scene[]>> {
    const effectiveScript = this.getScript(script);
    const modeHint = this.episodeContext
      ? `（剧集模式：${this.episodeContext.episodeName || this.episodeContext.episodeId}）`
      : '';
    this.reportProgress('scenes', 'running', `正在分析场景...${modeHint}`);

    try {
      const scenes = await this.extractChunkedItems<Scene>(
        'scenes',
        '场景',
        'scene_extraction',
        effectiveScript,
        SCENES_SCHEMA,
        (text) => {
          const parsed = this.parseJSON<{ scenes: any[] }>(text);
          if (!Array.isArray(parsed?.scenes)) return [];
          return parsed.scenes.filter((s: any) => s && typeof s.name === 'string' && s.name.trim());
        },
        (s, index) => ({
          id: `scene_${Date.now()}_${index}`,
          name: s.name,
          prompt: s.description || s.name,
          location: s.location,
          time: s.time || 'day',
          mood: s.mood,
          aliases: typeof s.aliases === 'string' ? s.aliases.trim() : (Array.isArray(s.aliases) ? s.aliases.join(',') : ''),
          episodeId: this.episodeContext?.episodeId,
        })
      );

      this.reportProgress('scenes', 'completed', `识别到 ${scenes.length} 个场景`, { stageProgress: 1 });
      return { success: true, data: scenes, episodeId: this.episodeContext?.episodeId };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.reportProgress('scenes', 'failed', errorMessage, { stageProgress: 1 });
      return { success: false, error: errorMessage };
    }
  }

  // 提取道具
  async extractProps(script: string): Promise<StageResult<Prop[]>> {
    const effectiveScript = this.getScript(script);
    const modeHint = this.episodeContext
      ? `（剧集模式：${this.episodeContext.episodeName || this.episodeContext.episodeId}）`
      : '';
    this.reportProgress('props', 'running', `正在分析道具...${modeHint}`);

    try {
      const props = await this.extractChunkedItems<Prop>(
        'props',
        '道具',
        'prop_extraction',
        effectiveScript,
        PROPS_SCHEMA,
        (text) => {
          const parsed = this.parseJSON<{ props: any[] }>(text);
          if (!Array.isArray(parsed?.props)) return [];
          return parsed.props.filter((p: any) => p && typeof p.name === 'string' && p.name.trim());
        },
        (p, index) => ({
          id: `prop_${Date.now()}_${index}`,
          name: p.name,
          prompt: p.description || p.name,
          type: p.type,
          description: p.description || '',
          aliases: typeof p.aliases === 'string' ? p.aliases.trim() : (Array.isArray(p.aliases) ? p.aliases.join(',') : ''),
          episodeId: this.episodeContext?.episodeId,
        })
      );

      this.reportProgress('props', 'completed', `识别到 ${props.length} 个道具`, { stageProgress: 1 });
      return { success: true, data: props, episodeId: this.episodeContext?.episodeId };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.reportProgress('props', 'failed', errorMessage, { stageProgress: 1 });
      return { success: false, error: errorMessage };
    }
  }

  // 生成分镜
  async generateShots(
    script: string,
    characters: Character[],
    scenes: Scene[],
    props: Prop[]
  ): Promise<StageResult<Shot[]>> {
    const effectiveScript = this.getScript(script);
    const modeHint = this.episodeContext
      ? `（剧集模式：${this.episodeContext.episodeName || this.episodeContext.episodeId}）`
      : '';
    this.reportProgress('shots', 'running', `正在生成分镜...${modeHint}`);

    try {
      const resolvedPrompt = await resolvePromptTemplate('shot_breakdown', {
        script: wrapUserContent(effectiveScript),
        characters: characters.map(c => c.name).join(', '),
        scenes: scenes.map(s => s.name).join(', '),
        props: props.map(p => p.name).join(', '),
        durationConstraint: formatSpecPromptHint(this.ctx.itvDurationSpec),
        durationDefault: String(this.ctx.itvDurationSpec.default),
        projectNarrativeMode: formatProjectNarrativeMode(this.ctx.projectMode),
        dialogueModeDirective: buildShotBreakdownDialogueModeDirective(this.ctx.projectMode),
      });

      const styledPrompt = this.appendStyleRequirement(resolvedPrompt.prompt);
      const result = await this.callLLM(styledPrompt, SHOTS_SCHEMA, {
        templateId: resolvedPrompt.template.id,
        promptSource: resolvedPrompt.source,
      });
      const parsed = this.parseJSON<{ shots: any[] }>(result);

      // 将角色名映射到 ID
      const charNameToId = new Map(characters.map(c => [c.name, c.id]));
      const propNameToId = new Map(props.map(p => [p.name, p.id]));

      const shots: Shot[] = parsed.shots.map((s, index) => ({
        id: `shot_${Date.now()}_${index}`,
        scriptLines: scriptLinesFromText(s.scriptContent || ''),
        shotType: s.shotType || 'medium',
        cameraMovement: s.cameraMovement || 'static',
        duration: normalizeVideoDurationSeconds(s.duration),
        characters: (s.characters || []).map((name: string) => charNameToId.get(name) || name),
        dialogue: s.dialogue || '',
        emotion: s.emotion || '',
        props: (s.props || []).map((name: string) => propNameToId.get(name) || name),
        confirmed: false,
        episodeId: this.episodeContext?.episodeId,
      }));

      this.reportProgress('shots', 'completed', `生成 ${shots.length} 个分镜`);
      return { success: true, data: shots, episodeId: this.episodeContext?.episodeId };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.reportProgress('shots', 'failed', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  // 完整解析流程
  async analyzeScript(script: string): Promise<ScriptAnalysisResult> {
    // 三个 stage（角色 / 场景 / 道具）相互独立，全部并行
    // 单 stage 内的 chunk 也并行（CHUNK_CONCURRENCY），整体并发 = 3 × CHUNK_CONCURRENCY
    const [charResult, sceneResult, propsResult] = await Promise.all([
      this.extractCharacters(script),
      this.extractScenes(script),
      this.extractProps(script),
    ]);

    const errors: string[] = [];
    if (!charResult.success || !charResult.data) {
      errors.push(charResult.error || '角色提取失败');
    }
    if (!sceneResult.success || !sceneResult.data) {
      errors.push(sceneResult.error || '场景提取失败');
    }
    if (!propsResult.success || !propsResult.data) {
      errors.push(propsResult.error || '道具提取失败');
    }
    if (errors.length > 0) {
      throw new Error(errors.join('；'));
    }

    return {
      characters: charResult.data!,
      scenes: sceneResult.data!,
      props: propsResult.data!,
      shots: [],
    };
  }
}

/**
 * 后台解析任务服务
 * 封装 ScriptAnalysisService，支持任务管理和持久化
 */
export class BackgroundAnalysisService {
  private projectId: string;
  private task: Task | null = null;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * 把已存在的 task 绑定到本服务实例，使后续 runAnalysis 直接复用 —— 不再
   * createTask 创新任务。给 main-side 'analysis:script' handler 的 renderer
   * fulfiller 用。
   */
  bindTask(taskId: string): void {
    const existing = TaskManager.getTask(taskId);
    if (!existing) {
      throw new Error(`bindTask: 找不到 taskId=${taskId}`);
    }
    this.task = existing;
  }

  /**
   * 启动后台解析任务
   */
  async startAnalysis(
    episodeId: string,
    episodeName: string,
    script: string,
    llmSelection?: string,
    styleSnapshot?: StyleSnapshotLike,
  ): Promise<Task> {
    const existingTask = TaskManager.getProjectTasks(this.projectId).find(task =>
      task.type === 'script-analysis'
      && task.targetId === episodeId
      && (task.status === 'pending' || task.status === 'running' || task.status === 'processing')
    );
    if (existingTask) {
      return {
        ...existingTask,
        metadata: {
          ...(existingTask.metadata || {}),
          deduped: true,
        },
      };
    }

    // 创建任务
    this.task = TaskManager.createTask({
      projectId: this.projectId,
      type: 'script-analysis',
      targetType: 'episode',
      targetId: episodeId,
      targetName: episodeName,
    });

    // 更新为运行中
    TaskManager.updateTask(this.task.id, { status: 'running', progress: 0 });

    // 异步执行解析
    this.runAnalysis(episodeId, episodeName, script, llmSelection, styleSnapshot);

    return this.task;
  }

  /**
   * 执行解析流程
   */
  private async persistStageResult(
    episodeId: string,
    episodeName: string,
    stage: AnalysisStage,
    payload: {
      mergedChars: Character[];
      mergedScenes: Scene[];
      mergedProps: Prop[];
      characterRefs: string[];
      sceneRefs: string[];
      propRefs: string[];
    }
  ): Promise<void> {
    const episodeRef = {
      episodeId,
      episodeName,
      firstAppearance: true,
    };

    if (stage === 'characters') {
      await saveCharacters(this.projectId, payload.mergedChars);
      for (const characterId of payload.characterRefs) {
        await addCharacterEpisodeRef(this.projectId, characterId, episodeRef);
      }
    }

    if (stage === 'scenes') {
      await saveScenes(this.projectId, payload.mergedScenes);
      for (const sceneId of payload.sceneRefs) {
        await addSceneEpisodeRef(this.projectId, sceneId, episodeRef);
      }
    }

    if (stage === 'props') {
      await saveProps(this.projectId, payload.mergedProps);
      for (const propId of payload.propRefs) {
        await addPropEpisodeRef(this.projectId, propId, episodeRef);
      }
    }

    await saveEpisodeAnalysis(this.projectId, episodeId, {
      characterRefs: stage === 'characters' ? payload.characterRefs : undefined,
      sceneRefs: stage === 'scenes' ? payload.sceneRefs : undefined,
      propRefs: stage === 'props' ? payload.propRefs : undefined,
      completedStages: [stage],
      shots: undefined,
    } as any);
  }

  /**
   * 主流程：完整执行剧本解析。可被 analysis:script 的 renderer fulfiller 直接调用。
   * 注意：调用方需先 set this.task（通过 startAnalysis）。
   */
  async runAnalysis(
    episodeId: string,
    episodeName: string,
    script: string,
    llmSelection?: string,
    styleSnapshot?: StyleSnapshotLike,
  ): Promise<void> {
    if (!this.task) return;

    const taskId = this.task.id;
    const cancellation = createTaskCancellationSignal(taskId);

    try {
      // 创建共享上下文
      const { createCreationContext } = await import('./CreationContext');
      const ctx = await createCreationContext(this.projectId, episodeId, {
        llmConfigId: llmSelection,
        styleSnapshot,
      });

      const existingAnalysis = await loadEpisodeAnalysis(this.projectId, episodeId);
      const completedStages = new Set(
        (existingAnalysis?.completedStages || []).filter(
          (stage): stage is 'characters' | 'scenes' | 'props' => stage === 'characters' || stage === 'scenes' || stage === 'props',
        ),
      );
      const includePlanStage = serviceShouldGeneratePlan(script, completedStages);
      const stageStates = createInitialScriptAnalysisStageStates({
        includePlan: includePlanStage,
        completedStages: Array.from(completedStages),
      });

      let mergedChars = ctx.characters;
      let mergedScenes = ctx.scenes;
      let mergedProps = ctx.props;
      let characterRefs: string[] = existingAnalysis?.characterRefs || [];
      let sceneRefs: string[] = existingAnalysis?.sceneRefs || [];
      let propRefs: string[] = existingAnalysis?.propRefs || [];

      const isTrackedStage = (stage: 'plan' | AnalysisStage): stage is ScriptAnalysisProgressStage =>
        stage === 'plan' || stage === 'characters' || stage === 'scenes' || stage === 'props';

      const syncTaskProgress = (override?: {
        stage?: 'plan' | AnalysisStage;
        status?: 'pending' | 'running' | 'completed' | 'failed';
        detailMessage?: string;
      }) => {
        const currentStage = override?.stage ?? getPrimaryScriptAnalysisStage(stageStates, { includePlan: includePlanStage });
        const statusLine = buildScriptAnalysisStatusLine(stageStates, { includePlan: includePlanStage });
        const detailMessage = override?.detailMessage || (isTrackedStage(currentStage) ? stageStates[currentStage]?.message : undefined);
        const stageMessage = detailMessage && detailMessage !== statusLine
          ? `${statusLine} · ${detailMessage}`
          : statusLine;

        TaskManager.updateTask(taskId, {
          progress: buildScriptAnalysisOverallProgress(stageStates, { includePlan: includePlanStage }),
          result: {
            currentStage,
            stageStatus: override?.status ?? (isTrackedStage(currentStage) ? stageStates[currentStage]?.status : undefined) ?? 'running',
            stageMessage,
            stageStates,
          },
        });
      };

      // 创建解析服务；自动注入已存在的推文旁白作为提取阶段的辅助上下文
      const service = new ScriptAnalysisService(ctx, {
        onProgress: (progress) => {
          if (isTrackedStage(progress.stage)) {
            const trackedStage = progress.stage;
            stageStates[trackedStage] = {
              ...stageStates[trackedStage],
              status: progress.status,
              progress: typeof progress.stageProgress === 'number'
                ? progress.stageProgress
                : stageStates[trackedStage]?.progress || 0,
              chunkIndex: progress.chunkIndex,
              chunkTotal: progress.chunkTotal,
              retryAttempt: progress.retryAttempt,
              retryMax: progress.retryMax,
              retryDelayMs: progress.retryDelayMs,
              message: progress.message,
            };
          }
          syncTaskProgress({
            stage: progress.stage,
            status: progress.status,
            detailMessage: progress.message,
          });
        },
        episodeContext: {
          episodeId,
          episodeName,
          episodeScript: script,
        },
        // tweetScript 字段已废弃（剧本本身就是字幕格式）；如需注入，调用方自行 setTweetScript
      });

      syncTaskProgress();

      // 在分块分析前生成全局创作规划，注入到后续所有 chunk prompt
      if (includePlanStage) {
        try {
          stageStates.plan = {
            status: 'running',
            progress: 0.15,
            message: '正在生成全局创作规划...',
          };
          syncTaskProgress({ stage: 'plan', status: 'running', detailMessage: '正在生成全局创作规划...' });
          const plan = await generateCreationPlan(ctx, script);
          service.setCreationPlan(plan);
          stageStates.plan = {
            status: 'completed',
            progress: 1,
            message: '全局规划完成',
          };
          syncTaskProgress({ stage: 'plan', status: 'completed', detailMessage: '全局规划完成' });
          logger.info('CreationPlan 生成完成', { planId: plan.id, style: plan.style.visualStyle });
        } catch (planError) {
          // 规划生成失败不阻断主流程，降级继续
          logger.warn('CreationPlan 生成失败，跳过规划注入', planError);
          stageStates.plan = {
            status: 'completed',
            progress: 1,
            message: '已跳过全局规划',
          };
          syncTaskProgress({ stage: 'plan', status: 'completed', detailMessage: '已跳过全局规划' });
        }
      }

      const stageTasks: Array<Promise<{ stage: 'characters' | 'scenes' | 'props'; success: boolean; error?: string }>> = [];

      if (!completedStages.has('characters')) {
        stageTasks.push((async () => {
          const charResult = await service.extractCharacters(script);
          if (!charResult.success || !charResult.data) {
            return { stage: 'characters' as const, success: false, error: charResult.error || '角色提取失败' };
          }
          mergedChars = this.mergeAssets(mergedChars, charResult.data, 'name');
          const charNameToId = new Map(mergedChars.map(c => [c.name, c.id]));
          characterRefs = charResult.data.map(c => charNameToId.get(c.name) || c.id);
          await this.persistStageResult(episodeId, episodeName, 'characters', {
            mergedChars,
            mergedScenes,
            mergedProps,
            characterRefs,
            sceneRefs,
            propRefs,
          });
          completedStages.add('characters');
          return { stage: 'characters' as const, success: true };
        })());
      }

      if (!completedStages.has('scenes')) {
        stageTasks.push((async () => {
          const sceneResult = await service.extractScenes(script);
          if (!sceneResult.success || !sceneResult.data) {
            return { stage: 'scenes' as const, success: false, error: sceneResult.error || '场景提取失败' };
          }
          mergedScenes = this.mergeAssets(mergedScenes, sceneResult.data, 'name');
          const sceneNameToId = new Map(mergedScenes.map(s => [s.name, s.id]));
          sceneRefs = sceneResult.data.map(s => sceneNameToId.get(s.name) || s.id);
          await this.persistStageResult(episodeId, episodeName, 'scenes', {
            mergedChars,
            mergedScenes,
            mergedProps,
            characterRefs,
            sceneRefs,
            propRefs,
          });
          completedStages.add('scenes');
          return { stage: 'scenes' as const, success: true };
        })());
      }

      if (!completedStages.has('props')) {
        stageTasks.push((async () => {
          const propsResult = await service.extractProps(script);
          if (!propsResult.success || !propsResult.data) {
            return { stage: 'props' as const, success: false, error: propsResult.error || '道具提取失败' };
          }
          mergedProps = this.mergeAssets(mergedProps, propsResult.data, 'name');
          const propNameToId = new Map(mergedProps.map(p => [p.name, p.id]));
          propRefs = propsResult.data.map(p => propNameToId.get(p.name) || p.id);
          await this.persistStageResult(episodeId, episodeName, 'props', {
            mergedChars,
            mergedScenes,
            mergedProps,
            characterRefs,
            sceneRefs,
            propRefs,
          });
          completedStages.add('props');
          return { stage: 'props' as const, success: true };
        })());
      }

      const stageResults = await Promise.all(stageTasks);

      // 任务在阶段执行期间被 cancel：不写完成态（main 已经把状态改成 cancelled）
      if (cancellation.signal.aborted) return;

      const errors = stageResults.filter(result => !result.success).map(result => result.error || `${result.stage} 提取失败`);
      if (errors.length > 0) {
        throw new Error(errors.join('；'));
      }

      // 更新任务完成
      syncTaskProgress({ status: 'completed', detailMessage: '解析完成' });
      TaskManager.updateTask(taskId, {
        status: 'completed',
        progress: 100,
        result: {
          currentStage: getPrimaryScriptAnalysisStage(stageStates, { includePlan: includePlanStage }),
          stageStatus: 'completed',
          stageMessage: '解析完成',
          stageStates,
          charactersCount: characterRefs.length,
          scenesCount: sceneRefs.length,
          propsCount: propRefs.length,
        },
      });
    } catch (error: unknown) {
      // 已被 cancel：状态已是 cancelled，不要覆盖成 failed
      if (cancellation.signal.aborted) return;
      const errorMessage = error instanceof Error ? error.message : String(error);
      TaskManager.updateTask(taskId, {
        status: 'failed',
        error: errorMessage || '解析失败',
      });
    } finally {
      cancellation.dispose();
    }
  }

  /**
   * 合并资产，按名称去重
   * 同名资产采取 upsert 语义：用新提取的描述字段覆盖旧记录，但保留旧的 id / createdAt / 已生成的 media
   * 以避免 entity_episode_refs 外键引用失效与媒体资产丢失
   */
  private mergeAssets<T extends { id: string; name: string }>(
    existing: T[],
    newItems: T[],
    key: keyof T
  ): T[] {
    const existingMap = new Map(existing.map(item => [item[key], item]));

    for (const item of newItems) {
      const prev = existingMap.get(item[key]);
      if (prev) {
        const prevAny = prev as any;
        existingMap.set(item[key], {
          ...prev,
          ...item,
          id: prevAny.id,
          createdAt: prevAny.createdAt ?? (item as any).createdAt,
          media: prevAny.media ?? (item as any).media,
        } as T);
      } else {
        existingMap.set(item[key], item);
      }
    }

    return Array.from(existingMap.values());
  }
}

/**
 * @deprecated 现役 UI 已切到 services/analysisTaskClient.submitScriptAnalysisTask
 *   （走主进程 'script-analysis' handler，含限流 + 取消 + 多窗口共享状态）。
 *   保留此 renderer-driven 入口作为应急 fallback；新代码不要再调。
 */
export async function startBackgroundAnalysis(
  projectId: string,
  episodeId: string,
  episodeName: string,
  script: string,
  llmSelection?: string,
  styleSnapshot?: StyleSnapshotLike,
): Promise<Task> {
  const service = new BackgroundAnalysisService(projectId);
  return service.startAnalysis(episodeId, episodeName, script, llmSelection, styleSnapshot);
}
