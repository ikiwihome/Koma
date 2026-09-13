/**
 * 场景/道具资产生成工作流
 */
import {
  getMediaAssetDisplaySource,
  getMediaAssetSource,
  type Scene,
  type Prop,
  type StoredMediaAsset,
  type VideoGenerationCapability,
} from '../types';
import { getProjectITVProvider } from '../providers';
import { serializeMediaSelection } from '../providers/channel/resolver';
import {
  saveProps,
  loadProps,
} from '../store/projectStore';
import { getThemeStylePrefix, getThemeStylePrefixAsync } from '../config/themePresets';
import { createLogger } from '../store/logger';
import { logTTICall, logITVCall } from '../store/aiCallLogger';
import { resolvePromptTemplate } from '../store/promptTemplates';
import { getActiveITVConfig } from '../store/settings/mediaConfig';
import { mediaGenerationService } from '../services/MediaGenerationService';
import { runWithTask } from '../services/taskRunner';
import {
  buildPropReferenceTemplateVariables,
  buildScenePreviewTemplateVariables,
} from './promptVariableBuilders';
import { compilePropPreviewVideoRequest } from './videoGenerationRequests';
import type { StyleSnapshotLike } from '../utils/promptNormalize';
import { normalizeVideoDurationSeconds } from '../utils/videoDuration';
import {
  appendStyleAnchorGuard,
  resolveActiveStyleReferenceAsset,
} from '../services/styleReferenceResolver';
import type { ProjectStyleSnapshot } from '../types';
import { runBatchWithConcurrency } from '../utils/batchRunner';

const BATCH_CONCURRENCY = 3;
const BATCH_MAX_RETRIES = 2;
const BATCH_RETRY_BASE_DELAY_MS = 800;

const logger = createLogger('ScenePropAsset');

function appendCandidateVariationPrompt(prompt: string, variationPrompt?: string): string {
  const trimmedVariation = variationPrompt?.trim();
  if (!trimmedVariation) {
    return prompt;
  }
  return `${prompt}\n\nCandidate variation instructions:\n${trimmedVariation}\nKeep the same asset identity and do not change the character/person/object/scene identity.`;
}

// ========== 提示词获取（供外部组件使用）==========

/**
 * 获取场景的自动生成提示词（用于预览显示）
 */
export function getScenePrompt(
  scene: Scene,
  theme?: string,
  stylePrompt?: string,
  styleSnapshot?: StyleSnapshotLike,
  project?: { styleSnapshot?: StyleSnapshotLike }
): string {
  const stylePrefix = resolveTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
  return buildScenePromptInternal(scene, stylePrefix);
}

/**
 * 获取道具的自动生成提示词（用于预览显示）
 */
export function getPropPrompt(
  prop: Prop,
  theme?: string,
  stylePrompt?: string,
  styleSnapshot?: StyleSnapshotLike,
  project?: { styleSnapshot?: StyleSnapshotLike }
): string {
  const stylePrefix = resolveTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
  return buildPropPromptInternal(prop, stylePrefix);
}

// 内部构建函数（同步版本）
function buildScenePromptInternal(scene: Scene, stylePrefix: string): string {
  const variables = buildScenePreviewTemplateVariables(scene, stylePrefix);
  const parts = [
    variables.stylePrefix,
    'environment concept art',
    'wide shot',
    'establishing shot',
    variables.description,
    variables.location,
    variables.time,
    variables.mood,
    'detailed background',
    'cinematic composition',
  ];
  return parts.filter(Boolean).join(', ');
}

function buildPropPromptInternal(prop: Prop, stylePrefix: string): string {
  const variables = buildPropReferenceTemplateVariables(prop, stylePrefix);
  const parts = [
    variables.stylePrefix,
    'prop design',
    'item illustration',
    'centered composition',
    'white background',
    'studio lighting',
    variables.description,
    variables.type ? `${variables.type} item` : '',
    'detailed rendering',
    'clean presentation',
  ];
  return parts.filter(Boolean).join(', ');
}

interface GenerateOptions {
  projectId: string;
  aspectRatio?: '16:9' | '9:16';
  theme?: string;
  stylePrompt?: string;
  styleSnapshot?: StyleSnapshotLike;
  project?: { styleSnapshot?: StyleSnapshotLike; aspectRatio?: '16:9' | '9:16' };
  ttiSelection?: string;
  seed?: number;
  variationPrompt?: string;
  destPath?: string;
  bindOwner?: boolean;
  normalizeRemoteUrl?: boolean;
  onProgress?: (progress: number, step: string) => void;
}

// ========== 场景图片生成 ==========

/**
 * 生成场景预览图
 */
export async function generateSceneImage(
  options: GenerateOptions & { scene: Scene; disableTask?: boolean }
): Promise<{ success: boolean; path?: string; url?: string; error?: string }> {
  const { projectId, scene, aspectRatio, theme, stylePrompt, styleSnapshot, project, ttiSelection, seed, variationPrompt, destPath, bindOwner, normalizeRemoteUrl, onProgress, disableTask } = options;
  const finalAspectRatio = aspectRatio || project?.aspectRatio || '16:9';

  logger.info(`开始生成场景预览图: ${scene.name}`);
  onProgress?.(0, '准备生成场景图...');

  try {
    // 构建提示词（从配置化模板读取）
    const stylePrefix = await getResolvedTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
    const resolvedPrompt = await resolvePromptTemplate(
      'tti_scene_preview',
      buildScenePreviewTemplateVariables(scene, stylePrefix || '')
    );
    const basePrompt = appendCandidateVariationPrompt(resolvedPrompt.prompt, variationPrompt);
    const styleAnchorAsset = await resolveActiveStyleReferenceAsset({
      project: { styleSnapshot: (styleSnapshot || project?.styleSnapshot) as ProjectStyleSnapshot | undefined },
      themeId: theme,
    });
    const prompt = appendStyleAnchorGuard(basePrompt, Boolean(styleAnchorAsset));
    const references = styleAnchorAsset ? [styleAnchorAsset] : [];

    onProgress?.(10, '调用 TTI 服务...');

    // 打印完整提示词日志
    logTTICall(
      'TTI',
      prompt,
      {
        aspectRatio: finalAspectRatio,
        ...(seed !== undefined ? { seed } : undefined),
      },
      {
        projectId,
        targetId: scene.id,
        targetName: `场景: ${scene.name}`,
        templateId: resolvedPrompt.template.id,
        promptSource: resolvedPrompt.source,
      }
    );

    const { result: asset } = await runWithTask({
      disabled: disableTask,
      projectId,
      category: 'asset',
      subType: 'asset-generation',
      targetType: 'scene',
      targetId: scene.id,
      targetName: `场景: ${scene.name}`,
      type: 'asset-generation',
      execute: async (ctx) => {
        ctx.progress(10, '调用 TTI 服务...');
        const a = await mediaGenerationService.generateImage({
          projectId,
          ownerRef: {
            projectId,
            ownerType: 'scene',
            ownerId: scene.id,
            slot: 'previewImage',
          },
          request: {
            prompt,
            references,
            options: {
              aspectRatio: finalAspectRatio,
              ...(seed !== undefined ? { seed } : undefined),
            },
          },
          ttiSelection,
          destPath,
          bindOwner,
          normalizeRemoteUrl,
          taskName: `场景: ${scene.name}`,
        });
        ctx.progress(100, '完成');
        return a;
      },
    });
    onProgress?.(100, '完成');
    return { success: true, path: asset.localPath, url: asset.remoteUrl };
  } catch (err: any) {
    logger.error(`生成场景图失败: ${scene.name}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * 批量生成场景预览图
 */
export async function generateAllSceneImages(
  options: GenerateOptions & { scenes: Scene[] }
): Promise<{ success: number; failed: number; results: Array<{ sceneId: string; success: boolean; path?: string; error?: string }> }> {
  const { projectId, scenes, aspectRatio, theme, stylePrompt, project, ttiSelection, onProgress } = options;

  if (scenes.length === 0) return { success: 0, failed: 0, results: [] };

  const { result } = await runWithTask({
    projectId,
    category: 'asset',
    subType: 'asset-generation',
    targetType: 'scene',
    targetId: scenes[0].id,
    targetName: `批量场景图（${scenes.length} 个）`,
    type: 'asset-generation',
    metadata: { batchCount: scenes.length },
    execute: async (taskCtx) => {
      const itemProgress = new Map<string, number>();
      const updateOverall = (sceneName: string, stage: string) => {
        let acc = 0;
        scenes.forEach(s => { acc += itemProgress.get(s.id) ?? 0; });
        const overall = acc / scenes.length;
        onProgress?.(overall, `${sceneName}: ${stage}`);
        taskCtx.progress(overall, `${sceneName}: ${stage}`);
      };

      const batchResults = await runBatchWithConcurrency<Scene, { success: boolean; path?: string; error?: string }>({
        items: scenes,
        concurrency: BATCH_CONCURRENCY,
        maxRetries: BATCH_MAX_RETRIES,
        retryBaseDelayMs: BATCH_RETRY_BASE_DELAY_MS,
        onAttemptStart: (scene, _idx, attempt) => {
          itemProgress.set(scene.id, 0);
          updateOverall(scene.name, attempt > 1 ? `重试 ${attempt}` : '开始');
        },
        worker: async (scene) => {
          const r = await generateSceneImage({
            projectId,
            scene,
            aspectRatio,
            theme,
            stylePrompt,
            project,
            ttiSelection,
            disableTask: true,
            onProgress: (p, step) => {
              itemProgress.set(scene.id, p);
              updateOverall(scene.name, step);
            },
          });
          if (!r.success) throw new Error(r.error || '生成失败');
          return r;
        },
      });

      const out: Array<{ sceneId: string; success: boolean; path?: string; error?: string }> = [];
      let success = 0;
      let failed = 0;
      batchResults.forEach(({ item, result, error, attempts }) => {
        const ok = Boolean(result?.success);
        if (ok) {
          success += 1;
          out.push({ sceneId: item.id, success: true, path: result?.path });
        } else {
          failed += 1;
          const errMsg = result?.error
            || (error instanceof Error ? error.message : String(error || ''))
            || `失败（已重试 ${attempts} 次）`;
          out.push({ sceneId: item.id, success: false, error: errMsg });
        }
      });
      return { success, failed, results: out };
    },
  });
  return result;
}

// ========== 道具图片生成 ==========

/**
 * 生成道具参考图
 */
export async function generatePropImage(
  options: GenerateOptions & { prop: Prop; disableTask?: boolean }
): Promise<{ success: boolean; path?: string; url?: string; error?: string }> {
  const { projectId, prop, aspectRatio, theme, stylePrompt, styleSnapshot, project, ttiSelection, seed, variationPrompt, destPath, bindOwner, normalizeRemoteUrl, onProgress, disableTask } = options;
  // 道具参考图必须与项目比例一致 — 否则下游分镜走 image-to-image 时输出比例会跟着参考图走，不会跟项目走。
  const finalAspectRatio = aspectRatio || project?.aspectRatio || '16:9';

  logger.info(`开始生成道具参考图: ${prop.name}`, { aspectRatio: finalAspectRatio });
  onProgress?.(0, '准备生成道具图...');

  try {
    // 构建提示词（从配置化模板读取）
    const stylePrefix = await getResolvedTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
    const resolvedPrompt = await resolvePromptTemplate(
      'tti_prop_reference',
      buildPropReferenceTemplateVariables(prop, stylePrefix || '')
    );
    const basePrompt = appendCandidateVariationPrompt(resolvedPrompt.prompt, variationPrompt);
    const styleAnchorAsset = await resolveActiveStyleReferenceAsset({
      project: { styleSnapshot: (styleSnapshot || project?.styleSnapshot) as ProjectStyleSnapshot | undefined },
      themeId: theme,
    });
    const prompt = appendStyleAnchorGuard(basePrompt, Boolean(styleAnchorAsset));
    const references = styleAnchorAsset ? [styleAnchorAsset] : [];

    onProgress?.(10, '调用 TTI 服务...');

    // 打印完整提示词日志
    logTTICall(
      'TTI',
      prompt,
      {
        aspectRatio: finalAspectRatio,
        ...(seed !== undefined ? { seed } : undefined),
      },
      {
        projectId,
        targetId: prop.id,
        targetName: `道具: ${prop.name}`,
        templateId: resolvedPrompt.template.id,
        promptSource: resolvedPrompt.source,
      }
    );

    const { result: asset } = await runWithTask({
      disabled: disableTask,
      projectId,
      category: 'asset',
      subType: 'asset-generation',
      targetType: 'prop',
      targetId: prop.id,
      targetName: `道具: ${prop.name}`,
      type: 'asset-generation',
      execute: async (ctx) => {
        ctx.progress(10, '调用 TTI 服务...');
        const a = await mediaGenerationService.generateImage({
          projectId,
          ownerRef: {
            projectId,
            ownerType: 'prop',
            ownerId: prop.id,
            slot: 'previewImage',
          },
          request: {
            prompt,
            references,
            options: {
              aspectRatio: finalAspectRatio,
              ...(seed !== undefined ? { seed } : undefined),
            },
          },
          ttiSelection,
          destPath,
          bindOwner,
          normalizeRemoteUrl,
          taskName: `道具: ${prop.name}`,
        });
        ctx.progress(100, '完成');
        return a;
      },
    });
    onProgress?.(100, '完成');
    return { success: true, path: asset.localPath, url: asset.remoteUrl };
  } catch (err: any) {
    logger.error(`生成道具图失败: ${prop.name}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * 批量生成道具参考图
 */
export async function generateAllPropImages(
  options: GenerateOptions & { props: Prop[] }
): Promise<{ success: number; failed: number; results: Array<{ propId: string; success: boolean; path?: string; error?: string }> }> {
  const { projectId, props, aspectRatio, theme, stylePrompt, project, ttiSelection, onProgress } = options;

  if (props.length === 0) return { success: 0, failed: 0, results: [] };

  const { result } = await runWithTask({
    projectId,
    category: 'asset',
    subType: 'asset-generation',
    targetType: 'prop',
    targetId: props[0].id,
    targetName: `批量道具图（${props.length} 个）`,
    type: 'asset-generation',
    metadata: { batchCount: props.length },
    execute: async (taskCtx) => {
      const itemProgress = new Map<string, number>();
      const updateOverall = (propName: string, stage: string) => {
        let acc = 0;
        props.forEach(p => { acc += itemProgress.get(p.id) ?? 0; });
        const overall = acc / props.length;
        onProgress?.(overall, `${propName}: ${stage}`);
        taskCtx.progress(overall, `${propName}: ${stage}`);
      };

      const batchResults = await runBatchWithConcurrency<Prop, { success: boolean; path?: string; error?: string }>({
        items: props,
        concurrency: BATCH_CONCURRENCY,
        maxRetries: BATCH_MAX_RETRIES,
        retryBaseDelayMs: BATCH_RETRY_BASE_DELAY_MS,
        onAttemptStart: (prop, _idx, attempt) => {
          itemProgress.set(prop.id, 0);
          updateOverall(prop.name, attempt > 1 ? `重试 ${attempt}` : '开始');
        },
        worker: async (prop) => {
          const r = await generatePropImage({
            projectId,
            prop,
            aspectRatio,
            theme,
            stylePrompt,
            project,
            ttiSelection,
            disableTask: true,
            onProgress: (p, step) => {
              itemProgress.set(prop.id, p);
              updateOverall(prop.name, step);
            },
          });
          if (!r.success) throw new Error(r.error || '生成失败');
          return r;
        },
      });

      const out: Array<{ propId: string; success: boolean; path?: string; error?: string }> = [];
      let success = 0;
      let failed = 0;
      batchResults.forEach(({ item, result, error, attempts }) => {
        const ok = Boolean(result?.success);
        if (ok) {
          success += 1;
          out.push({ propId: item.id, success: true, path: result?.path });
        } else {
          failed += 1;
          const errMsg = result?.error
            || (error instanceof Error ? error.message : String(error || ''))
            || `失败（已重试 ${attempts} 次）`;
          out.push({ propId: item.id, success: false, error: errMsg });
        }
      });
      return { success, failed, results: out };
    },
  });
  return result;
}

// ========== 道具预览视频生成 ==========

interface PropVideoOptions {
  projectId: string;
  prop: Prop;
  theme?: string;
  stylePrompt?: string;
  styleSnapshot?: StyleSnapshotLike;
  project?: { styleSnapshot?: StyleSnapshotLike };
  itvSelection?: string;
  onProgress?: (progress: number, step: string) => void;
  /** 批量场景下父 task 已包装，子调用传 true 跳过单独的 task 创建 */
  disableTask?: boolean;
}

/**
 * 生成道具预览视频
 * 使用道具图片 + ITV 服务生成短视频
 */
export async function generatePropPreviewVideo(
  options: PropVideoOptions
): Promise<{ success: boolean; path?: string; taskId?: string; error?: string }> {
  const { projectId, prop, theme, stylePrompt, styleSnapshot, project, itvSelection, onProgress, disableTask } = options;

  logger.info(`开始生成道具预览视频: ${prop.name}`);
  onProgress?.(0, '准备生成预览视频...');

  // 优先使用远程 URL
  const rawImageSource = getMediaAssetDisplaySource(prop.media?.previewImage);
  if (!rawImageSource) {
    return { success: false, error: '请先生成道具参考图' };
  }

  try {
    onProgress?.(10, '调用 ITV 服务...');

    // 获取渠道配置中的默认时长
    let previewDuration = 10;
    try {
      const itvConfig = await getActiveITVConfig(itvSelection);
      if (itvConfig && typeof itvConfig.defaultDuration === 'number' && Number.isFinite(itvConfig.defaultDuration) && itvConfig.defaultDuration > 0) {
        previewDuration = itvConfig.defaultDuration;
      }
    } catch (e) {
      logger.warn('获取 ITV 配置失败，使用默认时长 10s');
    }
    previewDuration = normalizeVideoDurationSeconds(previewDuration);

    // 构建道具视频提示词
    const resolvedStylePrefix = await getResolvedTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
    const compiledRequest = await compilePropPreviewVideoRequest({
      prop,
      primaryImage: rawImageSource,
      stylePrefix: resolvedStylePrefix,
      duration: previewDuration,
    });

    logITVCall(
      'ITV',
      rawImageSource,
      compiledRequest.prompt,
      { duration: previewDuration, aspectRatio: '1:1' },
      {
        projectId,
        targetId: prop.id,
        targetName: `${prop.name} 预览视频`,
        templateId: compiledRequest.templateId,
        promptSource: compiledRequest.promptSource,
      }
    );

    const { result: asset } = await runWithTask({
      disabled: disableTask,
      projectId,
      category: 'asset',
      subType: 'asset-generation',
      targetType: 'prop',
      targetId: prop.id,
      targetName: `${prop.name} 预览视频`,
      type: 'asset-generation',
      execute: async (ctx) => {
        ctx.progress(10, '调用 ITV 服务...');
        const a = await mediaGenerationService.generateVideo({
          projectId,
          ownerRef: {
            projectId,
            ownerType: 'prop',
            ownerId: prop.id,
            slot: 'previewVideo',
          },
          request: compiledRequest.request,
          itvSelection,
          taskName: `${prop.name} 预览视频`,
        });
        ctx.progress(100, '完成');
        return a;
      },
    });

    onProgress?.(100, '完成');
    return { success: true, path: asset.localPath, taskId: asset.providerTaskId };
  } catch (err: any) {
    logger.error(`生成道具预览视频失败: ${prop.name}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * 调用道具提取API绑定道具
 * 需要先生成预览视频并保存任务 ID
 */
export async function extractAndBindProp(
  projectId: string,
  prop: Prop,
  itvSelection?: string
): Promise<{ success: boolean; propId?: string; error?: string }> {
  logger.info(`开始提取道具: ${prop.name}`);

  // 检查是否有视频生成任务 ID
  const previewVideoTaskId = prop.media?.previewVideo?.providerTaskId;
  const previewVideoPath = getMediaAssetSource(prop.media?.previewVideo);
  const previewVideoAsset = prop.media?.previewVideo;

  if (!previewVideoTaskId) {
    if (previewVideoPath) {
      return { success: false, error: '请重新生成预览视频（需要保存任务ID用于道具提取）' };
    }
    return { success: false, error: '请先生成预览视频' };
  }

  try {
    const itvProvider = await getProjectITVProvider(
      getMediaAssetSelectionKey(previewVideoAsset) || itvSelection,
      getPreviewVideoCapability(previewVideoAsset),
    );
    if (!itvProvider) {
      throw new Error('未配置 ITV 服务');
    }

    // 检查是否支持道具提取
    if (!itvProvider.extractProp) {
      return { success: false, error: 'ITV Provider 不支持道具提取' };
    }

    // 使用任务 ID 调用道具提取 API
    const sora2PropId = await itvProvider.extractProp(previewVideoTaskId);
    await updatePropAsset(projectId, prop.id, { sora2PropId });

    logger.info(`道具提取成功: ${prop.name} -> ${sora2PropId}`);
    return { success: true, propId: sora2PropId };
  } catch (err: any) {
    logger.error(`道具提取失败: ${prop.name}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

// ========== 辅助函数（硬编码默认模板，作为 fallback）==========

async function updatePropAsset(
  projectId: string,
  propId: string,
  updates: Partial<Prop>
): Promise<void> {
  const props = await loadProps(projectId);
  const index = props.findIndex(p => p.id === propId);
  if (index !== -1) {
    const existing = props[index];
    const mergedMedia = updates.media
      ? { ...(existing.media || {}), ...(updates.media || {}) }
      : existing.media;
    props[index] = { ...existing, ...updates, media: mergedMedia };
    await saveProps(projectId, props);
  }
}

function getMediaAssetSelectionKey(asset?: StoredMediaAsset): string | undefined {
  if (!asset?.channelId || !asset?.modelId) {
    return undefined;
  }
  return serializeMediaSelection({
    channelId: asset.channelId,
    modelId: asset.modelId,
  });
}

function getPreviewVideoCapability(asset?: StoredMediaAsset): VideoGenerationCapability {
  switch (asset?.capability) {
    case 'video.text-to-video':
    case 'video.reference-to-video':
    case 'video.start-end-to-video':
    case 'video.image-to-video':
      return asset.capability;
    default:
      return 'video.image-to-video';
  }
}

function resolveTTIStylePrefix(
  styleSnapshot?: StyleSnapshotLike,
  theme?: string,
  stylePrompt?: string
): string {
  return styleSnapshot?.ttiStylePrefix || getThemeStylePrefix(theme, stylePrompt);
}

async function getResolvedTTIStylePrefix(
  styleSnapshot?: StyleSnapshotLike,
  theme?: string,
  stylePrompt?: string
): Promise<string> {
  if (styleSnapshot?.ttiStylePrefix) {
    return styleSnapshot.ttiStylePrefix;
  }
  return getThemeStylePrefixAsync(theme, stylePrompt);
}

