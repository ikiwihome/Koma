/**
 * 角色资产生成工作流
 * 生成角色定妆照（内置三视图）、预览视频，以及调用角色提取API
 */
import {
  getMediaAssetDisplaySource,
  getMediaAssetSource,
  type Character,
  type MediaAssetSource,
  type ProviderAssetInput,
  type StoredMediaAsset,
  type VideoGenerationCapability,
} from '../types';
import { getProjectITVProvider } from '../providers';
import { serializeMediaSelection } from '../providers/channel/resolver';
import {
  saveCharacters,
  loadCharacters,
} from '../store/projectStore';
import { getThemeStylePrefix, getThemeStylePrefixAsync } from '../config/themePresets';
import { createLogger } from '../store/logger';
import { logTTICall, logITVCall } from '../store/aiCallLogger';
import { resolvePromptTemplate } from '../store/promptTemplates';
import { getActiveITVConfig } from '../store/settings/mediaConfig';
import { mediaGenerationService } from '../services/MediaGenerationService';
import { runWithTask } from '../services/taskRunner';
import { buildCharacterCostumeTemplateVariables } from './promptVariableBuilders';
import { compileCharacterPreviewVideoRequest } from './videoGenerationRequests';
import type { StyleSnapshotLike } from '../utils/promptNormalize';
import { normalizeVideoDurationSeconds } from '../utils/videoDuration';
import {
  appendStyleAnchorGuard,
  resolveActiveStyleReferenceAsset,
} from '../services/styleReferenceResolver';
import type { ProjectStyleSnapshot } from '../types';

const logger = createLogger('CharacterAsset');

const ADULT_AGE_THRESHOLD = 18;
const YEARS_OLD_AGE_PATTERN = /\b(\d{1,3})\s+years old\b/i;
const STRUCTURED_GENDER_AGE_LOCK_LABEL = 'Structured gender and age lock (MANDATORY)';
const GENDER_AGE_OVERRIDE_TEXT = 'Structured gender/age fields override conflicting free-text details, role notes, appearance notes, and candidate variation wording.';
const AGE_CLASS_LOCK_TEXT = 'Do not age up, age down, or switch age class.';
const COSTUME_VARIATION_ROLE_LOCK = 'Keep the same role brief, occupation, costume direction, three-view model-sheet structure and project style; do not turn this into a different character role or asset type.';

const BINARY_GENDER_LOCK_TEXT = {
  male: {
    adult: 'adult male / adult man',
    nonAdultOrUnknownAge: 'male character',
    readableAs: 'male',
    negativeLock: 'Negative gender lock: not female, not woman, not girl, not female-coded, not feminine body, not female clothing.',
  },
  female: {
    adult: 'adult female / adult woman',
    nonAdultOrUnknownAge: 'female character',
    readableAs: 'female',
    negativeLock: 'Negative gender lock: not male, not man, not boy, not male-coded, not masculine body, not male clothing.',
  },
} as const;

const FACE_CANDIDATE_VARIATION_LOCK_LINES = [
  'Treat this variation as the required identity blueprint for this one candidate, not as a loose accessory, color/style tag, expression change, or optional mood note.',
  'Apply this direction as the core identity of this one candidate: face shape, eye shape, eyebrows, nose, mouth/lips, cheekbones, jawline/chin, age impression, temperament/personality, hairline and hair silhouette should reflect it.',
  'Keep the same role brief, occupation/profession, story setting, costume category, gender, age range and project style; this is not a new role; do not change this into another profession, species, character setting, outfit concept, or asset type.',
  'If the variation uses soft, delicate, gentle, refined, elegant, smooth, flowing hair, or similar aesthetic words, interpret them only inside the structured gender and age lock, never as permission to change gender or age class.',
  'This is only one selectable face candidate; do not create a three-view turnaround, full-body character sheet, final costume model sheet, multiple poses, or a generic variation of the same face.',
];

const SELECTED_FACE_REFERENCE_LINES = [
  'Selected face reference / identity anchor instructions:',
  'Use the provided selected face reference as the binding identity anchor from the face-candidate stage, not as a generic style reference or inspiration board. Generate the official full-body front/side/back three-view costume sheet using this selected face, preserving the same person across all views.',
  'Preserve selected face identity: same face shape, eye shape, eyebrow shape, nose bridge/tip, mouth/lip shape, cheekbones, jawline/chin, age impression, temperament/personality, hairline and hair silhouette; preserve distinctive facial marks if present.',
  'Do not re-randomize the face, redesign the face, beautify it into a different person, re-sample identity for each view, or drift toward a generic face. Only adapt lighting, angle, and costume-sheet presentation while keeping identity unchanged.',
  'If the image reference is ambiguous or unstable, resolve it by following these textual identity constraints instead of inventing a new face. The side and back views may show less face, but they must keep the same head shape, hairline/hair silhouette, hairstyle cues and overall identity continuity.',
];

const FACE_CANDIDATE_BASE_CLAUSES = [
  'P0 face-candidate stage: one single character face exploration image only',
  'single head-and-shoulders or bust portrait, close enough to read the face clearly',
  'not a three-view sheet, not a full-body image, not the final costume/model sheet',
  'face concept sheet with exactly one clear selectable face identity candidate',
  'clear face, readable facial features, front-facing or slight three-quarter view, neutral expression acceptable',
  'candidate-to-candidate diversity is mandatory: make this face visibly different from the other eight candidates through explicit facial structure choices, not the same face with only a different seed, expression, hairstyle, color palette, or outfit',
  'do not rely on random seed variation as the identity mechanism; identity must be deliberately specified in the prompt',
  'explicitly design identity dimensions: face shape, eye shape/eyes, eyebrow shape/eyebrows, nose bridge/tip, mouth/lip shape, cheekbones, jawline/chin, age impression, temperament/personality, hairline/hair silhouette, and distinctive facial marks if appropriate',
  'consistent with the same role brief, occupation/profession, story setting, costume category, gender, age range and project style',
];

const FACE_CANDIDATE_ROLE_LOCK_CLAUSES = [
  'explore a clearly different selectable identity candidate for this same character role, not a new role or different character setting',
  'costume collar and shoulder details may appear only as category cues, not as full outfit design',
];

const FACE_CANDIDATE_NOISE_NEGATIVE_CONSTRAINTS = 'no visual noise, no TV static, no glitch, no corrupted image, no abstract texture-only output, no random pixel pattern';

const FACE_CANDIDATE_CLOSING_CLAUSES = [
  'plain neutral background, studio concept art, high readability',
  `negative constraints: no three-view turnaround, no front/side/back layout, no full body, no full-body model sheet, no final costume sheet, no character turnaround sheet, no multiple poses, no group shot, ${FACE_CANDIDATE_NOISE_NEGATIVE_CONSTRAINTS}`,
];

function appendCandidateVariationPrompt(prompt: string, variationPrompt?: string): string {
  const trimmedVariation = variationPrompt?.trim();
  if (!trimmedVariation) {
    return prompt;
  }
  return [
    prompt,
    '',
    'Candidate variation instructions:',
    trimmedVariation,
    COSTUME_VARIATION_ROLE_LOCK,
  ].join('\n');
}

export function appendFaceCandidateVariationPrompt(
  prompt: string,
  variationPrompt?: string,
  genderAgeGuardrail?: string,
): string {
  const trimmedVariation = variationPrompt?.trim();
  const trimmedGuardrail = genderAgeGuardrail?.trim();
  if (!trimmedVariation) {
    return prompt;
  }
  const promptSections = [
    prompt,
    '',
    'Candidate-specific face identity direction (MANDATORY, not optional decoration):',
    trimmedVariation,
    ...FACE_CANDIDATE_VARIATION_LOCK_LINES,
  ];

  if (trimmedGuardrail) {
    promptSections.push('', trimmedGuardrail);
  }

  return promptSections.join('\n');
}

export function appendSelectedFaceReferencePrompt(prompt: string): string {
  return [prompt, '', ...SELECTED_FACE_REFERENCE_LINES].join('\n');
}

function normalizePromptClause(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}

function stripTrailingComma(value?: string): string {
  return normalizePromptClause(value).replace(/,+$/, '').trim();
}

function getNumericAge(ageClause: string): number | undefined {
  const match = ageClause.match(YEARS_OLD_AGE_PATTERN);
  if (!match) {
    return undefined;
  }

  return Number(match[1]);
}

function isAdultAgeClause(ageClause: string): boolean {
  const numericAge = getNumericAge(ageClause);
  return numericAge !== undefined && numericAge >= ADULT_AGE_THRESHOLD;
}

function getAgeDescriptor(ageClause: string): string {
  if (!ageClause) {
    return '';
  }

  return isAdultAgeClause(ageClause)
    ? `adult age lock: ${ageClause}`
    : `age lock: ${ageClause}`;
}

function getBinaryGenderLockTerms(gender: keyof typeof BINARY_GENDER_LOCK_TEXT, ageClause: string): string {
  const lockText = BINARY_GENDER_LOCK_TEXT[gender];
  return isAdultAgeClause(ageClause) ? lockText.adult : lockText.nonAdultOrUnknownAge;
}

function buildCharacterCandidateGenderAgeGuardrail(character: Character, ageClause: string): string {
  const gender = character.gender || 'unknown';
  const ageDescriptor = getAgeDescriptor(ageClause);
  const ageText = ageDescriptor ? `, ${ageDescriptor}` : '';

  switch (gender) {
    case 'male':
    case 'female': {
      const lockText = BINARY_GENDER_LOCK_TEXT[gender];
      return [
        `${STRUCTURED_GENDER_AGE_LOCK_LABEL}: ${getBinaryGenderLockTerms(gender, ageClause)}${ageText}; the face must clearly read as ${lockText.readableAs}.`,
        lockText.negativeLock,
        AGE_CLASS_LOCK_TEXT,
        GENDER_AGE_OVERRIDE_TEXT,
      ].join(' ');
    }
    case 'neutral':
      return `${STRUCTURED_GENDER_AGE_LOCK_LABEL}: gender-neutral / androgynous presentation${ageText}; keep the face within this structured neutral gender presentation. ${AGE_CLASS_LOCK_TEXT} ${GENDER_AGE_OVERRIDE_TEXT}`;
    case 'unknown':
    default:
      return `${STRUCTURED_GENDER_AGE_LOCK_LABEL}: gender unspecified${ageText}; do not infer, rewrite, or change gender from candidate variation aesthetics, softness, elegance, hairstyle, costume, or free-text appearance words. ${AGE_CLASS_LOCK_TEXT} ${GENDER_AGE_OVERRIDE_TEXT}`;
  }
}

function buildFaceCandidateRoleBrief(
  character: Character,
  variables: ReturnType<typeof buildCharacterCostumeTemplateVariables>,
  ageClause: string,
): string {
  const genderClause = stripTrailingComma(variables.gender);
  return [
    character.name ? `character name: ${character.name}` : undefined,
    character.role ? `story role: ${formatCharacterRole(character.role)}` : undefined,
    genderClause ? `gender: ${genderClause}` : undefined,
    ageClause ? `age: ${ageClause}` : undefined,
    character.description ? `brief: ${normalizePromptClause(character.description)}` : undefined,
    character.appearance ? `appearance note: ${normalizePromptClause(character.appearance)}` : undefined,
    variables.appearance ? `visual brief: ${variables.appearance}` : undefined,
  ].filter(Boolean).join('; ');
}

function formatCharacterRole(role?: Character['role']): string {
  switch (role) {
    case 'protagonist':
      return 'protagonist';
    case 'antagonist':
      return 'antagonist';
    case 'supporting':
      return 'supporting character';
    default:
      return '';
  }
}

export function buildCharacterFaceCandidatePrompt(character: Character, stylePrefix: string, variationPrompt?: string): string {
  const variables = buildCharacterCostumeTemplateVariables(character, stylePrefix || '');
  const ageClause = stripTrailingComma(variables.age);
  const genderAgeGuardrail = buildCharacterCandidateGenderAgeGuardrail(character, ageClause);
  const roleBrief = buildFaceCandidateRoleBrief(character, variables, ageClause);

  const prompt = [
    normalizePromptClause(variables.stylePrefix),
    ...FACE_CANDIDATE_BASE_CLAUSES,
    genderAgeGuardrail,
    ...FACE_CANDIDATE_ROLE_LOCK_CLAUSES,
    roleBrief,
    ...FACE_CANDIDATE_CLOSING_CLAUSES,
  ].filter(Boolean).join(', ');

  return appendFaceCandidateVariationPrompt(prompt, variationPrompt, genderAgeGuardrail);
}

interface CharacterFaceBatchVariation {
  label?: string;
  prompt?: string;
}

function buildCharacterFaceCandidatesBatchPrompt(
  character: Character,
  stylePrefix: string,
  variations: Array<CharacterFaceBatchVariation | undefined>,
  batchCount: number,
): string {
  const variables = buildCharacterCostumeTemplateVariables(character, stylePrefix || '');
  const ageClause = stripTrailingComma(variables.age);
  const genderAgeGuardrail = buildCharacterCandidateGenderAgeGuardrail(character, ageClause);
  const roleBrief = buildFaceCandidateRoleBrief(character, variables, ageClause);
  const variationLines = variations
    .slice(0, batchCount)
    .map((variation, index) => {
      const direction = variation?.prompt?.trim()
        || 'Create one clearly different selectable face identity direction for this sampled output while keeping the same locked role brief and guardrails.';
      const labelPrefix = variation?.label ? `${variation.label}: ` : '';
      return `Variation option ${index + 1}: ${labelPrefix}${direction}`;
    });

  return [
    normalizePromptClause(variables.stylePrefix),
    'P0 face-candidate stage: write one single-image portrait prompt and rely on API count-based sampling for multiple candidates.',
    'This is a single-output prompt.',
    'Generate exactly one standalone single-character portrait per API output.',
    'The API request count creates multiple separate image files; never describe, request, or imply a grid, collage, contact sheet, montage, or multi-panel layout inside the prompt.',
    'Each generated output must contain exactly one person: a clear head-and-shoulders or bust portrait with readable facial features, front-facing or slight three-quarter view.',
    'Cross-output diversity is mandatory across the sampled results: use explicit facial structure choices, not seed-only drift, outfit-only swaps, expression-only changes, hairstyle-only changes, or lighting-only changes as the main difference.',
    'Do not rely on random seed variation as the identity mechanism; identity must be deliberately specified in the prompt.',
    'Explicitly design identity dimensions for each sampled output: face shape, eye shape/eyes, eyebrow shape/eyebrows, nose bridge/tip, mouth/lip shape, cheekbones, jawline/chin, age impression, temperament/personality, hairline/hair silhouette, and distinctive facial marks if appropriate.',
    genderAgeGuardrail,
    roleBrief ? `Locked character identity fields for every generated output: ${roleBrief}. Preserve name, gender, age, role, brief and appearance exactly; do not drift into another person, another gender presentation, or another age class.` : 'Locked character identity fields for every generated output: preserve the same character name, gender, age, role, brief and appearance from the structured inputs; do not drift into another person, another gender presentation, or another age class.',
    'Keep the same story role, occupation/profession, costume category cues, story setting and project style across every generated output.',
    'For each generated output, choose exactly one variation option as sampling guidance; never combine multiple options in one image.',
    'Never treat the variations list as a layout instruction inside a single image.',
    'Variation options:',
    ...variationLines,
    `Negative constraints for every generated output: no 3x3 grid, no nine-grid, no grid layout, no collage, no contact sheet, no montage, no puzzle, no tiled layout, no multi-panel, no split-screen, no multiple people, no group shot, no crowd, no duplicate same face, no repeated face identity across outputs, no extra character, no full body, no three-view turnaround, no turnaround layout, no lineup presentation, no mirrored duplicate person, ${FACE_CANDIDATE_NOISE_NEGATIVE_CONSTRAINTS}.`,
  ].filter(Boolean).join('\n');
}

interface GenerateOptions {
  projectId: string;
  character: Character;
  /**
   * 项目全局画面比例。角色定妆照/人脸候选作为分镜的参考图，必须与项目比例一致；
   * 否则下游分镜走 image-to-image 时输出比例会跟着参考图，不会跟项目走。
   */
  aspectRatio?: '16:9' | '9:16';
  theme?: string;
  stylePrompt?: string;
  styleSnapshot?: StyleSnapshotLike;
  project?: { styleSnapshot?: StyleSnapshotLike; aspectRatio?: '16:9' | '9:16' };
  ttiSelection?: string;
  itvSelection?: string;
  seed?: number;
  variationPrompt?: string;
  destPath?: string;
  bindOwner?: boolean;
  normalizeRemoteUrl?: boolean;
  faceReference?: MediaAssetSource | ProviderAssetInput;
  onProgress?: (progress: number, step: string) => void;
  /** 批量场景下父 task 已包装，子调用传 true 跳过单独的 task 创建 */
  disableTask?: boolean;
}

interface GenerateBatchOptions extends Omit<GenerateOptions, 'seed' | 'variationPrompt' | 'destPath'> {
  batchCount: number;
  seeds?: number[];
  destPaths?: string[];
  variations?: Array<CharacterFaceBatchVariation | undefined>;
}

/**
 * 生成角色定妆照
 * 提示词内置三视图规范，一次生成包含正面/侧面/背面的图片
 */
export async function generateCostumePhoto(
  options: GenerateOptions
): Promise<{ success: boolean; path?: string; url?: string; error?: string }> {
  const { projectId, character, aspectRatio, theme, stylePrompt, styleSnapshot, project, ttiSelection, seed, variationPrompt, destPath, bindOwner, normalizeRemoteUrl, faceReference, onProgress, disableTask } = options;
  const finalAspectRatio = aspectRatio || project?.aspectRatio || '16:9';

  logger.info(`开始生成角色定妆照: ${character.name}`, { aspectRatio: finalAspectRatio });
  onProgress?.(0, '准备生成定妆照...');

  try {
    // 构建提示词（从配置化模板读取）
    const stylePrefix = await getResolvedTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
    const resolvedPrompt = await resolvePromptTemplate(
      'tti_character_costume',
      buildCharacterCostumeTemplateVariables(character, stylePrefix || '')
    );
    const basePrompt = faceReference
      ? appendSelectedFaceReferencePrompt(appendCandidateVariationPrompt(resolvedPrompt.prompt, variationPrompt))
      : appendCandidateVariationPrompt(resolvedPrompt.prompt, variationPrompt);

    // 风格锚定参考图（references[0]）：让模型严格继承画风但不继承内容。
    // 项目级 styleSnapshot.styleReferenceImage 优先，回退到预设默认图。
    const styleAnchorAsset = await resolveActiveStyleReferenceAsset({
      project: { styleSnapshot: (styleSnapshot || project?.styleSnapshot) as ProjectStyleSnapshot | undefined },
      themeId: theme,
    });
    const prompt = appendStyleAnchorGuard(basePrompt, Boolean(styleAnchorAsset));
    const references = [
      ...(styleAnchorAsset ? [styleAnchorAsset] : []),
      ...(faceReference ? [faceReference] : []),
    ];

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
        targetId: character.id,
        targetName: `${character.name} 定妆照`,
        templateId: resolvedPrompt.template.id,
        promptSource: resolvedPrompt.source,
      }
    );

    // 用 runWithTask 包"用户级"生成动作：同步 provider 也能在任务面板可见。
    // 异步 provider 内部走 submitTask({type:'tti'/'itv'/...})，主进程 TaskRunner 主导轮询。
    const { result: asset } = await runWithTask({
      disabled: disableTask,
      projectId,
      category: 'asset',
      subType: 'asset-generation',
      targetType: 'character',
      targetId: character.id,
      targetName: `${character.name} 定妆照`,
      type: 'asset-generation',
      execute: async (ctx) => {
        ctx.progress(10, '调用 TTI 服务...');
        const a = await mediaGenerationService.generateImage({
          projectId,
          ownerRef: {
            projectId,
            ownerType: 'character',
            ownerId: character.id,
            slot: 'costumePhoto',
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
          taskName: `${character.name} 定妆照`,
        });
        ctx.progress(100, '完成');
        return a;
      },
    });

    onProgress?.(100, '完成');
    return { success: true, path: asset.localPath, url: asset.remoteUrl };
  } catch (err: any) {
    logger.error(`生成定妆照失败: ${character.name}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * 生成角色人脸候选方案
 * 候选阶段只探索单张头像/半身脸部方案，不使用三视图定妆照模板。
 */
export async function generateCharacterFaceCandidate(
  options: GenerateOptions
): Promise<{ success: boolean; path?: string; url?: string; error?: string }> {
  const { projectId, character, aspectRatio, theme, stylePrompt, styleSnapshot, project, ttiSelection, seed, variationPrompt, destPath, bindOwner, normalizeRemoteUrl, onProgress, disableTask } = options;
  const finalAspectRatio = aspectRatio || project?.aspectRatio || '16:9';

  logger.info(`开始生成角色人脸候选: ${character.name}`, { aspectRatio: finalAspectRatio });
  onProgress?.(0, '准备生成人脸方案...');

  try {
    const stylePrefix = await getResolvedTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
    const basePrompt = buildCharacterFaceCandidatePrompt(character, stylePrefix || '', variationPrompt);
    const styleAnchorAsset = await resolveActiveStyleReferenceAsset({
      project: { styleSnapshot: (styleSnapshot || project?.styleSnapshot) as ProjectStyleSnapshot | undefined },
      themeId: theme,
    });
    const prompt = appendStyleAnchorGuard(basePrompt, Boolean(styleAnchorAsset));
    const references = styleAnchorAsset ? [styleAnchorAsset] : [];

    onProgress?.(10, '调用 TTI 服务...');

    logTTICall(
      'TTI',
      prompt,
      {
        aspectRatio: finalAspectRatio,
        ...(seed !== undefined ? { seed } : undefined),
      },
      {
        projectId,
        targetId: character.id,
        targetName: `${character.name} 人脸候选`,
        promptSource: 'default',
      }
    );

    const { result: asset } = await runWithTask({
      disabled: disableTask,
      projectId,
      category: 'asset',
      subType: 'asset-generation',
      targetType: 'character',
      targetId: character.id,
      targetName: `${character.name} 人脸抽卡`,
      type: 'asset-generation',
      execute: async (ctx) => {
        ctx.progress(10, '调用 TTI 服务...');
        const a = await mediaGenerationService.generateImage({
          projectId,
          ownerRef: {
            projectId,
            ownerType: 'character',
            ownerId: character.id,
            slot: 'costumePhoto',
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
          taskName: `${character.name} 人脸方案`,
          // 把生成内部的真实进度（调用 provider/下载/持久化/绑定）桥接到任务面板。
          // 否则 task 只在 10% / 100% 两点跳，期间几十秒下载远端图都看起来"卡住"。
          onProgress: (percent, stage) => ctx.progress(percent, stage),
        });
        ctx.progress(100, '完成');
        return a;
      },
    });

    onProgress?.(100, '完成');
    return { success: true, path: asset.localPath, url: asset.remoteUrl };
  } catch (err: any) {
    logger.error(`生成人脸候选失败: ${character.name}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

export async function generateCharacterFaceCandidatesBatch(
  options: GenerateBatchOptions
): Promise<Array<{ success: boolean; path?: string; url?: string; error?: string; seed?: number }>> {
  const {
    projectId,
    character,
    aspectRatio,
    theme,
    stylePrompt,
    styleSnapshot,
    project,
    ttiSelection,
    bindOwner,
    normalizeRemoteUrl,
    onProgress,
    batchCount,
    seeds = [],
    destPaths = [],
    variations = [],
    disableTask,
  } = options;
  const finalAspectRatio = aspectRatio || project?.aspectRatio || '16:9';

  const resolvedBatchCount = Math.max(1, Math.floor(batchCount || 1));

  logger.info(`开始批量生成角色人脸候选: ${character.name}`, {
    batchCount: resolvedBatchCount,
    aspectRatio: finalAspectRatio,
  });
  onProgress?.(0, '准备批量生成人脸方案...');

  try {
    const stylePrefix = await getResolvedTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
    const basePrompt = buildCharacterFaceCandidatesBatchPrompt(
      character,
      stylePrefix || '',
      variations,
      resolvedBatchCount,
    );
    const styleAnchorAsset = await resolveActiveStyleReferenceAsset({
      project: { styleSnapshot: (styleSnapshot || project?.styleSnapshot) as ProjectStyleSnapshot | undefined },
      themeId: theme,
    });
    const prompt = appendStyleAnchorGuard(basePrompt, Boolean(styleAnchorAsset));
    const batchReferences = styleAnchorAsset ? [styleAnchorAsset] : [];

    onProgress?.(10, '调用 TTI 服务...');

    logTTICall(
      'TTI',
      prompt,
      {
        aspectRatio: finalAspectRatio,
        count: resolvedBatchCount,
      },
      {
        projectId,
        targetId: character.id,
        targetName: `${character.name} 人脸候选批量`,
        promptSource: 'default',
      }
    );

    const { result: assets } = await runWithTask({
      disabled: disableTask,
      projectId,
      category: 'asset',
      subType: 'asset-generation',
      targetType: 'character',
      targetId: character.id,
      targetName: `${character.name} 人脸抽卡 ×${resolvedBatchCount}`,
      type: 'asset-generation',
      metadata: { batchCount: resolvedBatchCount },
      execute: async (ctx) => {
        ctx.progress(10, '调用 TTI 服务...');
        const a = await mediaGenerationService.generateImages({
          projectId,
          ownerRef: {
            projectId,
            ownerType: 'character',
            ownerId: character.id,
            slot: 'costumePhoto',
          },
          request: {
            prompt,
            references: batchReferences,
            count: resolvedBatchCount,
            options: {
              aspectRatio: finalAspectRatio,
            },
          },
          ttiSelection,
          destPath: (index) => destPaths[index],
          bindOwner,
          normalizeRemoteUrl,
          taskName: `${character.name} 人脸方案批量`,
          // 桥接生成内部的细粒度进度，避免任务面板长时间停在 10%
          onProgress: (percent, stage) => ctx.progress(percent, stage),
        });
        ctx.progress(100, '完成');
        return a;
      },
    });

    onProgress?.(100, '完成');
    return assets.map((asset, index) => ({
      success: true,
      path: asset.localPath,
      url: asset.remoteUrl,
      seed: seeds[index],
    }));
  } catch (err: any) {
    logger.error(`批量生成人脸候选失败: ${character.name}`, { error: err.message, batchCount: resolvedBatchCount });
    throw err;
  }
}

/**
 * 生成角色预览视频
 * 优先使用远程 URL（Sora2 等需要远程可访问的图片）
 */
export async function generateCharacterPreviewVideo(
  options: GenerateOptions
): Promise<{ success: boolean; path?: string; taskId?: string; error?: string }> {
  const { projectId, character, theme, stylePrompt, styleSnapshot, project, itvSelection, onProgress, disableTask } = options;

  logger.info(`开始生成角色预览视频: ${character.name}`);
  onProgress?.(0, '准备生成预览视频...');

  // 优先使用远程 URL，其次使用本地路径
  const rawImageSource = getMediaAssetDisplaySource(character.media?.costumePhoto);
  if (!rawImageSource) {
    return { success: false, error: '请先生成定妆照' };
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

    const resolvedStylePrefix = await getResolvedTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
    const compiledRequest = await compileCharacterPreviewVideoRequest({
      character,
      primaryImage: rawImageSource,
      stylePrefix: resolvedStylePrefix,
      duration: previewDuration,
    });

    // 打印完整提示词日志
    logITVCall(
      'ITV',
      rawImageSource,
      compiledRequest.prompt,
      { duration: previewDuration, aspectRatio: '9:16' },
      {
        projectId,
        targetId: character.id,
        targetName: `${character.name} 预览视频`,
        templateId: compiledRequest.templateId,
        promptSource: compiledRequest.promptSource,
      }
    );

    const { result: asset } = await runWithTask({
      disabled: disableTask,
      projectId,
      category: 'asset',
      subType: 'asset-generation',
      targetType: 'character',
      targetId: character.id,
      targetName: `${character.name} 预览视频`,
      type: 'asset-generation',
      execute: async (ctx) => {
        ctx.progress(10, '调用 ITV 服务...');
        const a = await mediaGenerationService.generateVideo({
          projectId,
          ownerRef: {
            projectId,
            ownerType: 'character',
            ownerId: character.id,
            slot: 'previewVideo',
          },
          request: compiledRequest.request,
          itvSelection,
          taskName: `${character.name} 预览视频`,
        });
        ctx.progress(100, '完成');
        return a;
      },
    });

    onProgress?.(100, '完成');
    return { success: true, path: asset.localPath, taskId: asset.providerTaskId };
  } catch (err: any) {
    logger.error(`生成预览视频失败: ${character.name}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * 调用角色提取API绑定角色
 * 需要先生成预览视频并保存任务 ID
 * 支持异步轮询模式
 */
export async function extractAndBindCharacter(
  projectId: string,
  character: Character,
  itvSelection?: string,
  onProgress?: (progress: number, step: string) => void
): Promise<{ success: boolean; characterId?: string; error?: string }> {
  logger.info(`开始提取角色: ${character.name}`);
  onProgress?.(0, '准备角色提取...');

  // 检查是否有视频生成任务 ID（角色提取 API 需要使用 from_task 参数）
  const previewVideoTaskId = character.media?.previewVideo?.providerTaskId;
  const previewVideoPath = getMediaAssetSource(character.media?.previewVideo);
  const previewVideoAsset = character.media?.previewVideo;

  if (!previewVideoTaskId) {
    // 兼容旧数据：如果有视频路径但没有任务 ID，提示用户重新生成
    if (previewVideoPath) {
      return { success: false, error: '请重新生成预览视频（需要保存任务ID用于角色提取）' };
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

    // 检查是否支持角色提取
    if (!itvProvider.extractCharacter) {
      return { success: false, error: 'ITV Provider 不支持角色提取' };
    }

    onProgress?.(10, '调用角色提取 API...');

    // 获取用户设置的时间范围，默认 1-3 秒
    let timestamps = '1,3';
    if (character.timestampRange) {
      const { start, end } = character.timestampRange;
      // 验证时间范围不超过 3 秒
      if (end - start > 3) {
        return { success: false, error: '提取时间范围不能超过3秒' };
      }
      timestamps = `${start},${end}`;
    }

    // 使用任务 ID 调用角色提取 API
    const extractResult = await itvProvider.extractCharacter({
      fromTask: previewVideoTaskId,
      timestamps,
    });

    // Handle case where extractResult is CharacterProgressInfo (already completed)
    const extractTaskId = typeof extractResult === 'string' ? extractResult : '';

    // 检查是否支持角色提取状态轮询
    if (itvProvider.checkCharacterProgress && extractTaskId) {
      onProgress?.(20, '等待角色提取完成...');

      // 轮询等待完成
      let progress = await itvProvider.checkCharacterProgress(extractTaskId);
      let pollCount = 0;
      const maxPolls = 60; // 最大轮询 60 次（约 3 分钟）

      while ((progress.status === 'queued' || progress.status === 'processing') && pollCount < maxPolls) {
        await sleep(3000);
        progress = await itvProvider.checkCharacterProgress(extractTaskId);
        pollCount++;
        const progressPercent = 20 + Math.min(progress.progress, 100) * 0.7;
        onProgress?.(progressPercent, `提取中 ${progress.progress}%`);
      }

      if (progress.status === 'completed' && progress.characters && progress.characters.length > 0) {
        // 取第一个提取的角色
        const extractedChar = progress.characters[0];
        const sora2CharacterId = extractedChar.id;

        await updateCharacterAsset(projectId, character.id, { sora2CharacterId });
        onProgress?.(100, '角色提取完成');

        logger.info(`角色提取成功: ${character.name} -> ${sora2CharacterId}`);
        return { success: true, characterId: sora2CharacterId };
      }

      if (progress.status === 'failed') {
        return { success: false, error: progress.error || '角色提取失败' };
      }

      if (pollCount >= maxPolls) {
        return { success: false, error: '角色提取超时' };
      }

      return { success: false, error: '未能提取到角色' };
    } else {
      // 不支持轮询，直接返回任务 ID 作为角色 ID（兼容旧模式）
      await updateCharacterAsset(projectId, character.id, { sora2CharacterId: extractTaskId });
      onProgress?.(100, '完成');

      logger.info(`角色提取成功: ${character.name} -> ${extractTaskId}`);
      return { success: true, characterId: extractTaskId };
    }
  } catch (err: any) {
    logger.error(`角色提取失败: ${character.name}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

// ========== 提示词生成函数（导出供UI预览） ==========

/**
 * 构建定妆照提示词（硬编码默认模板）
 * 内置三视图规范：正面/侧面/背面排列在一张图中
 * 注意：实际生成时优先使用 promptTemplates 中的 tti_character_costume 模板
 */
export function buildCostumePhotoPrompt(character: Character, stylePrefix: string): string {
  // 固定模板部分（不可编辑）
  const templateParts = [
    stylePrefix,
    'character turnaround sheet',
    'white background',
    'front view | side view | back view',
    'three poses in one image',
    'character design reference sheet',
    'full body',
    'standing pose',
  ];
  // 可变部分：外貌描述
  const parts = [
    ...templateParts,
    buildCharacterCostumeTemplateVariables(character, stylePrefix).appearance,
  ];
  return parts.filter(Boolean).join(', ');
}

/**
 * 获取角色的完整提示词（便捷函数）
 */
export function getCharacterPrompt(
  character: Character,
  theme?: string,
  stylePrompt?: string,
  styleSnapshot?: StyleSnapshotLike,
  project?: { styleSnapshot?: StyleSnapshotLike }
): string {
  const stylePrefix = resolveTTIStylePrefix(styleSnapshot || project?.styleSnapshot, theme, stylePrompt);
  return buildCostumePhotoPrompt(character, stylePrefix);
}

// ========== 辅助函数 ==========

async function updateCharacterAsset(
  projectId: string,
  characterId: string,
  updates: Partial<Character>
): Promise<void> {
  const characters = await loadCharacters(projectId);
  const index = characters.findIndex(c => c.id === characterId);
  if (index !== -1) {
    const existing = characters[index];
    const mergedMedia = updates.media
      ? { ...(existing.media || {}), ...(updates.media || {}) }
      : existing.media;
    characters[index] = { ...existing, ...updates, media: mergedMedia };
    await saveCharacters(projectId, characters);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

// TODO(strict-cleanup): buildCharacterPreviewPrompt was defined but never called.
// Preserved here as a comment in case preview prompt building is reintroduced.
