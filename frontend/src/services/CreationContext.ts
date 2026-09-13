/**
 * CreationContext — 共享运行时上下文
 *
 * 解决各 workflow 服务重复加载数据、上下文断裂的问题。
 * 一次性加载所有实体数据和 LLM 配置，全链路共享。
 */
import type { Character, Scene, Prop, ProjectStyleSnapshot, LLMModelConfig } from '../types';
import type { LLMProvider } from '../providers/llm/types';
import { createLLMProvider } from '../providers';
import { wrapTaskBackedLLM } from '../providers/llm/TaskBackedLLMProvider';
import { getActiveLLMConfig, getChannelsByCategory } from '../store/globalStore';
import { loadCharacters, loadScenes, loadProps } from '../store/projectStore';
import { electronService } from './electronService';
import {
  DEFAULT_VIDEO_DURATION_SPEC,
  getDurationSpecForITVSelection,
  type VideoDurationSpec,
} from '../providers/itv/durationSpec';
import { serializeMediaSelection } from '../providers/channel/resolver';
import { normalizeProjectNarrativeMode, type ProjectNarrativeMode } from './narrativeMode';

/** 实体摘要（用于 chunk 间上下文传递） */
export interface EntitySummary {
  name: string;
  type: 'character' | 'scene' | 'prop';
  brief: string;  // 最多 30 字的简短描述
}

/** 剧本洞察（由 ScriptAnalysisService 填充，下游消费） */
export interface ScriptInsights {
  themes: string[];
  tone: string;
  narrativeArc: string;
  entityRelationships: Array<{ from: string; to: string; relation: string }>;
}

export interface CreationContext {
  projectId: string;
  episodeId: string;

  /** 预加载的实体数据（一次加载，全链路共享） */
  characters: Character[];
  scenes: Scene[];
  props: Prop[];

  /** 风格配置 */
  styleSnapshot?: Partial<ProjectStyleSnapshot>;

  /** 项目叙事模式：剧情模式会把推文解说剧情化，解说模式保留旁白主导 */
  projectMode: ProjectNarrativeMode;

  /** 项目标题与题材类型，供分镜故事板等提示词模板直接使用。 */
  projectTitle?: string;
  projectGenre?: string;

  /** LLM 配置（避免每个服务各自 setLLMConfig） */
  llmConfig: LLMModelConfig;
  llmProvider: LLMProvider;

  /** 剧本洞察（由 ScriptAnalysisService 填充，下游消费） */
  scriptInsights?: ScriptInsights;

  /**
   * 当前项目选择的 ITV 视频渠道支持的时长规格。
   * 用于分镜推理 prompt 注入"时长允许值"动态约束 + 分镜编辑 UI 控件渲染。
   * 解析失败/未配置时使用 DEFAULT_VIDEO_DURATION_SPEC（保留 grok 风格枚举兜底）。
   */
  itvDurationSpec: VideoDurationSpec;

  /**
   * 项目级视频推理模板档位勾选（mode × 时长矩阵）。
   * 见 ProjectMeta.videoPromptDurationSelections；ShotPromptService.selectVideoTemplateKey
   * 在勾选档位里找跟 shot.duration 最近的档位匹配模板。
   */
  videoPromptDurationSelections?: {
    multiRef?: number[];
    firstFrame?: number[];
  };

  /** 进度回调 */
  onProgress?: (phase: string, progress: number, detail?: string) => void;
}

export interface CreateContextOptions {
  llmConfigId?: string;
  styleSnapshot?: Partial<ProjectStyleSnapshot>;
  onProgress?: (phase: string, progress: number, detail?: string) => void;
}

/**
 * 工厂函数：一次性加载所有共享数据，创建 CreationContext
 */
export async function createCreationContext(
  projectId: string,
  episodeId: string,
  options?: CreateContextOptions,
): Promise<CreationContext> {
  // 并行加载所有实体数据 + ITV 渠道列表（用于解析时长规格）
  const [characters, scenes, props, llmConfig, itvChannels, projectMeta] = await Promise.all([
    loadCharacters(projectId),
    loadScenes(projectId),
    loadProps(projectId),
    getActiveLLMConfig(options?.llmConfigId),
    getChannelsByCategory('itv').catch(() => []),
    electronService.project.load(projectId).catch(() => null),
  ]);

  if (!llmConfig) {
    throw new Error('未配置 LLM 模型，请先在设置中添加');
  }

  const baseLLMProvider = createLLMProvider({
    provider: llmConfig.provider as any,
    profileId: llmConfig.profileId,
    hasStoredCredential: llmConfig.hasStoredCredential,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    modelName: llmConfig.modelName,
  });
  // 把 LLM 调用包成主进程任务：关窗口期间分析仍在跑、reopen 后能从 SQLite 取回结果。
  // 流式调用透传原 provider；ScriptAnalysis/ShotAnalysis 当前都走 non-streaming，全部受益。
  const llmProvider = wrapTaskBackedLLM(baseLLMProvider, {
    scope: () => `project:${projectId}`,
    taskName: (opts) => opts?.operation || opts?.source || 'LLM 调用',
  });

  const itvSelectionKey = serializeMediaSelection(projectMeta?.mediaSelections?.itv);
  const itvDurationSpec = itvSelectionKey
    ? getDurationSpecForITVSelection(itvSelectionKey, itvChannels)
    : DEFAULT_VIDEO_DURATION_SPEC;

  return {
    projectId,
    episodeId,
    characters,
    scenes,
    props,
    styleSnapshot: options?.styleSnapshot,
    projectMode: normalizeProjectNarrativeMode(projectMeta?.mode),
    projectTitle: projectMeta?.title,
    projectGenre: projectMeta?.genre,
    llmConfig,
    llmProvider,
    itvDurationSpec,
    videoPromptDurationSelections: (projectMeta as { videoPromptDurationSelections?: { multiRef?: number[]; firstFrame?: number[] } } | null)?.videoPromptDurationSelections,
    onProgress: options?.onProgress,
  };
}

/**
 * 更新 scriptInsights（由 ScriptAnalysisService 在分析完成后调用）
 */
export function updateScriptInsights(ctx: CreationContext, insights: ScriptInsights): void {
  ctx.scriptInsights = insights;
}

/**
 * 从实体列表生成 EntitySummary（用于 chunk 上下文传递）
 */
export function buildEntitySummaries(ctx: CreationContext): EntitySummary[] {
  const summaries: EntitySummary[] = [];

  for (const c of ctx.characters) {
    summaries.push({
      name: c.name,
      type: 'character',
      brief: truncate(c.description || c.appearance || c.role || '', 30),
    });
  }
  for (const s of ctx.scenes) {
    summaries.push({
      name: s.name,
      type: 'scene',
      brief: truncate(s.description || s.mood || '', 30),
    });
  }
  for (const p of ctx.props) {
    summaries.push({
      name: p.name,
      type: 'prop',
      brief: truncate(p.description || '', 30),
    });
  }

  return summaries;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}
