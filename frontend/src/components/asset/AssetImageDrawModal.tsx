import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Modal, Progress, Spin, Tag, Typography } from 'antd';
import { CheckCircleFilled, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { MediaOwnerRef } from '../../types';
import { electronService, fsRemove } from '../../services/electronService';
import './AssetImageDrawModal.scss';

const { Text } = Typography;

export const IMAGE_DRAW_CANDIDATE_COUNT = 9;

export type AssetImageDrawOwnerType = Extract<MediaOwnerRef['ownerType'], 'character' | 'scene' | 'prop'>;

export interface AssetImageDrawIdentitySpec {
  faceShape: string;
  eyes: string;
  browsNoseMouth: string;
  jawline: string;
  apparentAge: string;
  temperament: string;
  hairlineAndSilhouette: string;
}

export interface AssetImageDrawVariation {
  label: string;
  prompt: string;
  identityDirection?: string;
  identitySpec?: AssetImageDrawIdentitySpec;
  metadata?: Record<string, unknown>;
}

const CHARACTER_FACE_DIVERSITY_PROMPT = [
  'Character identity direction candidate: this image is one selectable identity direction for the same character brief, not the final costume sheet.',
  'Across the 9 candidates, intentionally explore clearly different human identity directions; candidates must not share the same face design or silhouette.',
  'Keep the exact same story role, occupation/profession, structured gender and age lock, costume category cues, world setting and project art style.',
  'Only vary identity-level facial design: face shape, eye shape, brow/nose/mouth proportions, jaw and chin, apparent-age nuance, personality temperament, hairline, hair mass and hairstyle silhouette; soft, delicate, gentle, refined, elegant, flowing-hair or similar aesthetic words must be interpreted only within the locked gender and age class.',
  'Do not change the profession, social function, outfit type, prop set, species, body type, or story identity category. Do not create a three-view turnaround, full-body model sheet, or front/side/back layout.',
].join(' ');

const CHARACTER_IDENTITY_VARIATION_ROLE_LOCK = [
  'Use the same character brief, occupation/profession, structured gender and age lock, costume category cues, story role and project art style.',
].join(' ');

const CHARACTER_IDENTITY_VARIATION_RENDER_LOCK = [
  'Make this a single clear head-and-shoulders or bust portrait identity pick with only collar/shoulder costume cues;',
  'soft, delicate, gentle, refined, elegant, smooth flowing hair, or similar aesthetic terms must stay inside the locked gender and age class and must not turn the character into another gender or age class;',
  'do not render a full-body design sheet or three-view layout.',
].join(' ');

function createCharacterIdentityVariation(
  label: string,
  identityDirection: string,
  identitySpec: AssetImageDrawIdentitySpec,
): AssetImageDrawVariation {
  const prompt = [
    `Character identity direction candidate — ${label}.`,
    CHARACTER_IDENTITY_VARIATION_ROLE_LOCK,
    `Face shape: ${identitySpec.faceShape}.`,
    `Eyes: ${identitySpec.eyes}.`,
    `Brows / nose / mouth: ${identitySpec.browsNoseMouth}.`,
    `Jaw and chin: ${identitySpec.jawline}.`,
    `Apparent age: ${identitySpec.apparentAge}.`,
    `Temperament: ${identitySpec.temperament}.`,
    `Hairline and hairstyle silhouette: ${identitySpec.hairlineAndSilhouette}.`,
    CHARACTER_IDENTITY_VARIATION_RENDER_LOCK,
  ].join(' ');

  return {
    label,
    prompt,
    identityDirection,
    identitySpec,
    metadata: {
      candidateKind: 'characterIdentityDirection',
      identityDirection,
      identitySpec,
      roleLock: true,
    },
  };
}

const CHARACTER_IMAGE_DRAW_VARIATIONS: AssetImageDrawVariation[] = [
  createCharacterIdentityVariation('Calm Oval Poise', 'calm_oval_poise', {
    faceShape: 'balanced oval face with soft cheek volume and a clean forehead-to-chin flow',
    eyes: 'medium almond eyes with a steady, observant gaze and moderate eyelids',
    browsNoseMouth: 'straight natural brows, a neat medium nose bridge, and a restrained mouth with subtle corners',
    jawline: 'smooth jawline with a lightly defined chin, neither sharp nor round',
    apparentAge: 'centered within the specified age range, composed rather than noticeably younger or older',
    temperament: 'calm, dependable, self-possessed, quietly intelligent',
    hairlineAndSilhouette: 'even natural hairline with tidy hair mass framing the temples and a controlled silhouette',
  }),
  createCharacterIdentityVariation('Angular Resolute Edge', 'angular_resolute_edge', {
    faceShape: 'longer angular face with higher cheekbones and a narrower facial plane',
    eyes: 'slightly narrow eyes with a focused forward stare and sharper outer corners',
    browsNoseMouth: 'stronger brows, a straighter nose line, and a firm compressed mouth',
    jawline: 'clear jaw angle with a decisive chin and visible cheek-to-jaw structure',
    apparentAge: 'slightly mature within the specified range, with a seasoned but not older impression',
    temperament: 'resolute, disciplined, guarded, hard to intimidate',
    hairlineAndSilhouette: 'cleaner exposed hairline or swept-back front, creating a lean angular head silhouette',
  }),
  createCharacterIdentityVariation('Round Warm Optimist', 'round_warm_optimist', {
    faceShape: 'rounder face with fuller cheeks and a softer forehead-to-cheek transition',
    eyes: 'larger rounded eyes with open lids and a friendly readable gaze',
    browsNoseMouth: 'gentle arched brows, a softer shorter nose, and a relaxed mouth with warmer corners',
    jawline: 'soft jaw with a rounded chin and minimal hard angles',
    apparentAge: 'slightly youthful within the specified range without becoming childlike',
    temperament: 'warm, approachable, sincere, emotionally open',
    hairlineAndSilhouette: 'soft hairline with rounded bangs, loose framing strands, or a compact fluffy silhouette',
  }),
  createCharacterIdentityVariation('Lean Mature Reserve', 'lean_mature_reserve', {
    faceShape: 'lean face with subtle cheek hollow, longer mid-face, and controlled facial planes',
    eyes: 'deep-set eyes with calm lids and a measured, unreadable gaze',
    browsNoseMouth: 'slightly heavier brows, a defined nose bridge, and a reserved neutral mouth',
    jawline: 'narrow but firm jaw with a composed chin and minimal softness',
    apparentAge: 'upper side of the specified age range with lived-in detail, never outside the range',
    temperament: 'reserved, experienced, analytical, quietly authoritative',
    hairlineAndSilhouette: 'slightly higher or cleaner hairline with orderly hair volume and a mature silhouette',
  }),
  createCharacterIdentityVariation('Bright Youthful Spark', 'bright_youthful_spark', {
    faceShape: 'shorter heart-oval face with fresh cheek fullness and a lighter chin area',
    eyes: 'bright alert eyes with lifted outer corners and lively catchlight-friendly proportions',
    browsNoseMouth: 'expressive brows, a compact nose, and an energetic mouth with subtle asymmetry',
    jawline: 'small defined chin with a light jawline, avoiding heavy or severe structure',
    apparentAge: 'lower side of the specified age range while still matching the brief',
    temperament: 'curious, energetic, brave, quick to react',
    hairlineAndSilhouette: 'lower natural hairline, dynamic fringe or lifted front pieces, and a buoyant silhouette',
  }),
  createCharacterIdentityVariation('Hawk-Eyed Intensity', 'hawk_eyed_intensity', {
    faceShape: 'taut face with sharper cheek planes and a compact, high-tension silhouette',
    eyes: 'piercing narrow almond or upturned eyes with a strong directional gaze',
    browsNoseMouth: 'angled brows, a precise nose, and a thin decisive mouth that reads intense',
    jawline: 'tight jawline with a pointed or blade-like chin emphasis',
    apparentAge: 'age-neutral within the specified range, sharpened by expression rather than age',
    temperament: 'intense, tactical, suspicious, dangerous when focused',
    hairlineAndSilhouette: 'sharper widow peak, swept fringe, or spiky controlled hair mass echoing the eye angles',
  }),
  createCharacterIdentityVariation('Gentle Wide-Eyed Grace', 'gentle_wide_eyed_grace', {
    faceShape: 'soft elongated oval with delicate cheek transitions and a graceful forehead',
    eyes: 'wide gentle eyes with lowered pressure, softer eyelids, and a compassionate gaze',
    browsNoseMouth: 'fine relaxed brows, a delicate nose, and a small calm mouth with softened corners',
    jawline: 'delicate jaw and softly tapered chin with no aggressive angles',
    apparentAge: 'middle-to-lower side of the specified range, serene rather than naive',
    temperament: 'gentle, empathetic, patient, quietly resilient',
    hairlineAndSilhouette: 'soft side part, wispy face-framing pieces, or smooth flowing hair outline',
  }),
  createCharacterIdentityVariation('Broad-Jawed Grounded Resolve', 'broad_jawed_grounded_resolve', {
    faceShape: 'broader rectangular or square-leaning face with solid cheek and temple mass',
    eyes: 'steady smaller eyes set under grounded brow weight, with a direct practical gaze',
    browsNoseMouth: 'thicker brows, a sturdier nose bridge, and a broad closed mouth with reliable expression',
    jawline: 'strong broad jaw, fuller chin, and clear lower-face weight',
    apparentAge: 'slightly mature within the specified range through structure rather than wrinkles',
    temperament: 'grounded, protective, stubborn, trustworthy under pressure',
    hairlineAndSilhouette: 'solid hairline and compact hair shape that reinforces a sturdy head silhouette',
  }),
  createCharacterIdentityVariation('Refined Enigmatic Symmetry', 'refined_enigmatic_symmetry', {
    faceShape: 'symmetrical refined face with elegant proportions and clean cheek-to-chin balance',
    eyes: 'balanced eyes with a controlled enigmatic gaze and precise spacing',
    browsNoseMouth: 'well-shaped brows, a refined nose line, and a subtle composed mouth',
    jawline: 'polished jaw contour with a neat chin and minimal roughness',
    apparentAge: 'exactly within the specified age range, polished and timeless rather than younger or older',
    temperament: 'elegant, mysterious, self-controlled, charismatic',
    hairlineAndSilhouette: 'intentional hairline with sleek framing, clean volume distribution, and a refined silhouette',
  }),
];

const SCENE_IMAGE_DRAW_VARIATIONS: AssetImageDrawVariation[] = [
  {
    label: 'Wide Angle',
    prompt: 'Scene candidate variation: keep the same scene identity, location, architecture, era, layout, key landmarks and story function. Vary only the camera into a wider establishing angle with balanced composition.',
  },
  {
    label: 'Low Angle',
    prompt: 'Scene candidate variation: keep all core setting elements and spatial layout unchanged. Vary only the camera to a lower angle with stronger perspective lines and foreground scale cues.',
  },
  {
    label: 'High Angle',
    prompt: 'Scene candidate variation: keep the same environment and landmarks. Vary only the viewpoint to an elevated or high-angle composition that reveals layout and depth.',
  },
  {
    label: 'Golden Hour',
    prompt: 'Scene candidate variation: keep the same scene design and object placement. Vary only lighting and time atmosphere toward warm golden-hour / morning or sunset tones.',
  },
  {
    label: 'Blue Hour',
    prompt: 'Scene candidate variation: keep the same scene identity and layout. Vary only lighting toward cool blue-hour or early-night ambience, preserving all core architecture and set dressing.',
  },
  {
    label: 'Atmosphere',
    prompt: 'Scene candidate variation: keep the same environment, era and function. Vary only atmospheric qualities such as haze, air depth, subtle dust, mist or softness; do not change the location.',
  },
  {
    label: 'Foreground',
    prompt: 'Scene candidate variation: keep the same scene setting and key props. Vary only composition with foreground framing, layered depth and slightly shallower depth of field.',
  },
  {
    label: 'Deep Focus',
    prompt: 'Scene candidate variation: keep the same environment identity and layout. Vary only depth of field toward deep-focus clarity, showing background and foreground details more evenly.',
  },
  {
    label: 'Detail Density',
    prompt: 'Scene candidate variation: keep the same scene, landmarks and spatial arrangement. Vary only environmental detail density and lived-in set dressing texture, without adding contradictory story elements.',
  },
];

const PROP_IMAGE_DRAW_VARIATIONS: AssetImageDrawVariation[] = [
  {
    label: '3/4 View',
    prompt: 'Prop candidate variation: keep the same object identity, silhouette, components, scale logic and core materials. Vary only to a clean three-quarter product view that reveals front and side form.',
  },
  {
    label: 'Side View',
    prompt: 'Prop candidate variation: keep the same prop design and all recognizable parts. Vary only the camera angle toward side / top-side presentation to clarify shape and construction.',
  },
  {
    label: 'Material',
    prompt: 'Prop candidate variation: keep the same object identity and design. Vary only material texture emphasis such as metal, leather, fabric, wood, plastic, glass, engraving or surface grain.',
  },
  {
    label: 'Patina',
    prompt: 'Prop candidate variation: keep the same prop and components. Vary only wear level, patina, scratches, edge damage, dust or polish; do not break, replace or redesign the object.',
  },
  {
    label: 'Hero Shot',
    prompt: 'Prop candidate variation: keep the same object design. Vary only display composition into a centered hero product shot with clear silhouette, strong readability and premium presentation.',
  },
  {
    label: 'Detail Focus',
    prompt: 'Prop candidate variation: keep the whole prop visible and recognizable. Vary only composition to emphasize one important detail area, mechanism, handle, emblem or texture without changing design.',
  },
  {
    label: 'High Key',
    prompt: 'Prop candidate variation: keep the same prop identity and shape. Vary only lighting toward high-key studio lighting, soft shadows and clean catalog presentation.',
  },
  {
    label: 'Rim Light',
    prompt: 'Prop candidate variation: keep the same object and materials. Vary only lighting with stronger rim light, contrast and edge highlights while preserving accurate color and silhouette.',
  },
  {
    label: 'Turntable',
    prompt: 'Prop candidate variation: keep the same prop design. Vary only display layout toward product turntable / concept design presentation with subtle scale cues and construction readability.',
  },
];

function withCharacterFaceDiversity(
  ownerType: AssetImageDrawOwnerType,
  variation: AssetImageDrawVariation,
): AssetImageDrawVariation {
  if (ownerType !== 'character') {
    return variation;
  }

  return {
    ...variation,
    prompt: `${variation.prompt}\n${CHARACTER_FACE_DIVERSITY_PROMPT}`,
  };
}

export function getImageDrawVariation(ownerType: AssetImageDrawOwnerType, index: number): AssetImageDrawVariation {
  const variations = ownerType === 'character'
    ? CHARACTER_IMAGE_DRAW_VARIATIONS
    : ownerType === 'scene'
      ? SCENE_IMAGE_DRAW_VARIATIONS
      : PROP_IMAGE_DRAW_VARIATIONS;
  return withCharacterFaceDiversity(ownerType, variations[index % variations.length]);
}

export interface AssetImageDrawOwner {
  projectId?: string;
  ownerType: AssetImageDrawOwnerType;
  ownerId: string;
  sessionId?: string | null;
}

export interface AssetImageDrawCandidate {
  id: string;
  sessionId: string;
  ownerType: AssetImageDrawOwnerType;
  ownerId: string;
  projectId?: string;
  localPath?: string;
  remoteUrl?: string;
  seed?: number;
  variationLabel?: string;
  variationPrompt?: string;
  identityDirection?: string;
  identitySpec?: AssetImageDrawIdentitySpec;
  metadata?: Record<string, unknown>;
}

interface AssetImageDrawResult {
  success: boolean;
  path?: string;
  url?: string;
  error?: string;
  index?: number;
  seed?: number;
}

export interface GenerateImageDrawBatchOptions {
  startIndex: number;
  batchSize: number;
  seeds: number[];
  destPaths: string[];
  variations: Array<AssetImageDrawVariation | undefined>;
}

export interface ValidateImageDrawCandidateResultOptions {
  candidate: AssetImageDrawCandidate;
  result: AssetImageDrawResult;
  index: number;
  seed: number;
  destPath: string;
  variation?: AssetImageDrawVariation;
  phase: 'batch' | 'single';
}

export interface GenerateImageDrawCandidatesOptions {
  count?: number;
  sessionId: string;
  ownerType: AssetImageDrawOwnerType;
  ownerId: string;
  projectId?: string;
  getCandidatePath: (seed: number, index: number) => Promise<string>;
  getVariation?: (index: number) => AssetImageDrawVariation | undefined;
  generate: (seed: number, index: number, destPath: string, variation?: AssetImageDrawVariation) => Promise<AssetImageDrawResult>;
  generateBatch?: (options: GenerateImageDrawBatchOptions) => Promise<AssetImageDrawResult[]>;
  validateCandidateResult?: (options: ValidateImageDrawCandidateResultOptions) => Promise<boolean | string> | boolean | string;
  shouldContinue?: () => boolean;
  onCandidateProgress?: (progress: number, index: number, step: string) => void;
}

export interface GenerateImageDrawCandidatesResult {
  candidates: AssetImageDrawCandidate[];
  failed: number;
  errors: string[];
}

function getVariationCandidateMetadata(
  variation?: AssetImageDrawVariation,
): Partial<Pick<
  AssetImageDrawCandidate,
  'variationLabel' | 'variationPrompt' | 'identityDirection' | 'identitySpec' | 'metadata'
>> {
  if (!variation) {
    return {};
  }

  return {
    ...(variation.label ? { variationLabel: variation.label } : {}),
    ...(variation.prompt ? { variationPrompt: variation.prompt } : {}),
    ...(variation.identityDirection ? { identityDirection: variation.identityDirection } : {}),
    ...(variation.identitySpec ? { identitySpec: variation.identitySpec } : {}),
    ...(variation.metadata ? { metadata: variation.metadata } : {}),
  };
}

interface AssetImageDrawModalProps {
  open: boolean;
  title?: string;
  hint?: React.ReactNode;
  useLabel?: React.ReactNode;
  redrawLabel?: React.ReactNode;
  applyingLabel?: React.ReactNode;
  progress?: number;
  progressStep?: React.ReactNode;
  candidates: AssetImageDrawCandidate[];
  ownerType?: AssetImageDrawOwnerType;
  generating?: boolean;
  applying?: boolean;
  onCancel: () => void;
  onRedraw: () => void;
  onUseSelected: (candidate: AssetImageDrawCandidate) => void;
}

function isDirectDisplaySource(value?: string): boolean {
  return Boolean(
    value && (
      /^https?:\/\//i.test(value) ||
      value.startsWith('data:') ||
      value.startsWith('blob:') ||
      value.startsWith('koma-local://')
    )
  );
}

function isRemovableLocalPath(value?: string): boolean {
  return Boolean(value && !isDirectDisplaySource(value));
}

export function createImageDrawSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647) + 1;
}

function sanitizeImageDrawSessionPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'asset';
}

export function createImageDrawSessionId(owner: Pick<AssetImageDrawOwner, 'ownerType' | 'ownerId'>): string {
  return [
    'draw',
    sanitizeImageDrawSessionPart(owner.ownerType),
    sanitizeImageDrawSessionPart(owner.ownerId),
    Date.now(),
    createImageDrawSeed(),
  ].join('_');
}

export function isImageDrawCandidateForOwner(
  candidate: AssetImageDrawCandidate,
  owner: AssetImageDrawOwner,
): boolean {
  if (candidate.ownerType !== owner.ownerType || candidate.ownerId !== owner.ownerId) {
    return false;
  }
  if (owner.projectId && candidate.projectId && candidate.projectId !== owner.projectId) {
    return false;
  }
  if (owner.sessionId !== undefined && owner.sessionId !== null && candidate.sessionId !== owner.sessionId) {
    return false;
  }
  return Boolean(candidate.sessionId);
}

export function getAssetImageDrawCandidateSource(candidate: AssetImageDrawCandidate): string {
  const source = candidate.localPath || candidate.remoteUrl || '';
  if (!source) return '';
  return isDirectDisplaySource(source) ? source : electronService.fs.toLocalUrl(source);
}

export async function cleanupImageDrawCandidates(
  candidates: AssetImageDrawCandidate[],
  keepId?: string,
): Promise<void> {
  await Promise.all(
    candidates.map(async (candidate) => {
      if (candidate.id === keepId) return;
      if (!isRemovableLocalPath(candidate.localPath)) return;
      try {
        await fsRemove(candidate.localPath!);
      } catch (error) {
        console.warn('Failed to remove unused image draw candidate', candidate.localPath, error);
      }
    })
  );
}

export async function generateImageDrawCandidates({
  count = IMAGE_DRAW_CANDIDATE_COUNT,
  sessionId,
  ownerType,
  ownerId,
  projectId,
  getCandidatePath,
  getVariation,
  generate,
  generateBatch,
  validateCandidateResult,
  shouldContinue,
  onCandidateProgress,
}: GenerateImageDrawCandidatesOptions): Promise<GenerateImageDrawCandidatesResult> {
  if (!sessionId || !ownerType || !ownerId) {
    throw new Error('Image draw candidates require sessionId and owner information');
  }

  interface CandidateGenerationContext {
    index: number;
    seed: number;
    variation?: AssetImageDrawVariation;
    destPath: string;
  }

  const candidates: AssetImageDrawCandidate[] = [];
  const errors: string[] = [];
  const usedSeeds = new Set<number>();
  const hasActiveSession = () => shouldContinue?.() ?? true;
  const cleanupAndCancel = async (extraCandidates: AssetImageDrawCandidate[] = []): Promise<GenerateImageDrawCandidatesResult> => {
    await cleanupImageDrawCandidates([...candidates, ...extraCandidates]);
    return {
      candidates: [],
      failed: count,
      errors: ['Generation cancelled'],
    };
  };

  const removeCandidatePath = async (destPath?: string): Promise<void> => {
    if (!isRemovableLocalPath(destPath)) {
      return;
    }
    try {
      await fsRemove(destPath!);
    } catch {
      // ignore missing/partial candidate files
    }
  };

  const removeCandidateArtifacts = async (...paths: Array<string | undefined>): Promise<void> => {
    const uniquePaths = Array.from(new Set(paths.filter((path): path is string => Boolean(path))));
    await Promise.all(uniquePaths.map((path) => removeCandidatePath(path)));
  };

  const createCandidate = (
    context: CandidateGenerationContext,
    result: AssetImageDrawResult,
  ): AssetImageDrawCandidate => ({
    id: `${sessionId}-${context.index}-${result.seed ?? context.seed}`,
    sessionId,
    ownerType,
    ownerId,
    projectId,
    localPath: result.path,
    remoteUrl: result.url,
    seed: result.seed ?? context.seed,
    ...getVariationCandidateMetadata(context.variation),
  });

  const validateGeneratedCandidate = async (
    context: CandidateGenerationContext,
    result: AssetImageDrawResult,
    phase: 'batch' | 'single',
  ): Promise<{ candidate?: AssetImageDrawCandidate; error?: string }> => {
    const candidate = createCandidate(context, result);
    if (!validateCandidateResult) {
      return { candidate };
    }

    try {
      const validationResult = await validateCandidateResult({
        candidate,
        result,
        index: context.index,
        seed: result.seed ?? context.seed,
        destPath: context.destPath,
        variation: context.variation,
        phase,
      });

      if (validationResult === false || typeof validationResult === 'string') {
        await removeCandidateArtifacts(context.destPath, result.path, candidate.localPath);
        return {
          error: typeof validationResult === 'string' && validationResult.trim()
            ? validationResult.trim()
            : 'Candidate validation failed',
        };
      }

      return { candidate };
    } catch (error) {
      await removeCandidateArtifacts(context.destPath, result.path, candidate.localPath);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  const createContext = async (index: number): Promise<CandidateGenerationContext | null> => {
    let seed = createImageDrawSeed();
    while (usedSeeds.has(seed)) {
      seed = createImageDrawSeed();
    }
    usedSeeds.add(seed);
    const variation = getVariation?.(index);
    const destPath = await getCandidatePath(seed, index);
    if (!hasActiveSession()) {
      await removeCandidatePath(destPath);
      return null;
    }
    return {
      index,
      seed,
      variation,
      destPath,
    };
  };

  const runSingleGeneration = async (
    context: CandidateGenerationContext,
  ): Promise<{ candidate?: AssetImageDrawCandidate; error?: string }> => {
    try {
      const result = await generate(context.seed, context.index, context.destPath, context.variation);
      if (result.success && (result.path || result.url)) {
        return validateGeneratedCandidate(context, result, 'single');
      }
      await removeCandidatePath(context.destPath);
      return { error: result.error || 'Generation failed' };
    } catch (error) {
      await removeCandidatePath(context.destPath);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  const getBatchStartIndex = (batchContexts: CandidateGenerationContext[]): number => {
    if (batchContexts.length === 0) {
      return 0;
    }
    const maxIndex = batchContexts[batchContexts.length - 1]?.index ?? batchContexts[0].index;
    return Math.max(0, maxIndex - batchContexts.length + 1);
  };

  const runBatchGeneration = async (
    batchContexts: CandidateGenerationContext[],
  ): Promise<{
    generatedCandidates: AssetImageDrawCandidate[];
    fallbackContexts: CandidateGenerationContext[];
  }> => {
    if (!generateBatch || batchContexts.length === 0) {
      return {
        generatedCandidates: [],
        fallbackContexts: batchContexts,
      };
    }

    let batchResults: AssetImageDrawResult[] = [];
    try {
      batchResults = await generateBatch({
        startIndex: getBatchStartIndex(batchContexts),
        batchSize: batchContexts.length,
        seeds: batchContexts.map((context) => context.seed),
        destPaths: batchContexts.map((context) => context.destPath),
        variations: batchContexts.map((context) => context.variation),
      });
    } catch {
      batchResults = [];
    }

    if (!hasActiveSession()) {
      return {
        generatedCandidates: [],
        fallbackContexts: batchContexts,
      };
    }

    const contextIndexSet = new Set(batchContexts.map((context) => context.index));
    const indexedResults = new Map<number, AssetImageDrawResult>();
    const orderedResults: AssetImageDrawResult[] = [];
    for (const result of batchResults) {
      if (
        typeof result.index === 'number'
        && contextIndexSet.has(result.index)
        && !indexedResults.has(result.index)
      ) {
        indexedResults.set(result.index, result);
      } else {
        orderedResults.push(result);
      }
    }

    const generatedCandidates: AssetImageDrawCandidate[] = [];
    const fallbackContexts: CandidateGenerationContext[] = [];
    for (const context of batchContexts) {
      const result = indexedResults.get(context.index) ?? orderedResults.shift();
      if (result?.success && (result.path || result.url)) {
        const validatedResult = await validateGeneratedCandidate(context, result, 'batch');
        if (validatedResult.candidate) {
          generatedCandidates.push(validatedResult.candidate);
        } else {
          fallbackContexts.push(context);
        }
      } else {
        fallbackContexts.push(context);
      }
    }

    return {
      generatedCandidates,
      fallbackContexts,
    };
  };

  for (let index = 0; index < count;) {
    if (!hasActiveSession()) {
      return cleanupAndCancel();
    }

    const remaining = count - index;
    const batchSize = generateBatch
      ? (ownerType === 'character' ? remaining : Math.min(4, remaining))
      : 1;
    const contexts: CandidateGenerationContext[] = [];

    for (let offset = 0; offset < batchSize; offset += 1) {
      const context = await createContext(index + offset);
      if (!context) {
        return cleanupAndCancel();
      }
      contexts.push(context);
    }

    onCandidateProgress?.((index / count) * 100, index, '');

    if (generateBatch && contexts.length > 1) {
      const initialBatchResult = await runBatchGeneration(contexts);
      for (const candidate of initialBatchResult.generatedCandidates) {
        if (!hasActiveSession()) {
          return cleanupAndCancel([candidate]);
        }
        candidates.push(candidate);
      }

      let remainingFallbackContexts = initialBatchResult.fallbackContexts;
      if (remainingFallbackContexts.length > 0) {
        const retryBatchResult = await runBatchGeneration(remainingFallbackContexts);
        for (const candidate of retryBatchResult.generatedCandidates) {
          if (!hasActiveSession()) {
            return cleanupAndCancel([candidate]);
          }
          candidates.push(candidate);
        }
        remainingFallbackContexts = retryBatchResult.fallbackContexts;
      }

      for (const context of remainingFallbackContexts) {
        if (!hasActiveSession()) {
          return cleanupAndCancel();
        }
        const singleResult = await runSingleGeneration(context);
        if (singleResult.candidate) {
          if (!hasActiveSession()) {
            return cleanupAndCancel([singleResult.candidate]);
          }
          candidates.push(singleResult.candidate);
        } else if (singleResult.error) {
          errors.push(singleResult.error);
        }
      }

      index += contexts.length;
      if (!hasActiveSession()) {
        return cleanupAndCancel();
      }
      onCandidateProgress?.((Math.min(index, count) / count) * 100, Math.min(index, count) - 1, '');
      continue;
    }

    const singleResult = await runSingleGeneration(contexts[0]);
    if (singleResult.candidate) {
      if (!hasActiveSession()) {
        return cleanupAndCancel([singleResult.candidate]);
      }
      candidates.push(singleResult.candidate);
    } else if (singleResult.error) {
      errors.push(singleResult.error);
    }

    index += 1;

    if (!hasActiveSession()) {
      return cleanupAndCancel();
    }
  }

  if (!hasActiveSession()) {
    return cleanupAndCancel();
  }
  onCandidateProgress?.(100, count - 1, '');

  return {
    candidates,
    failed: count - candidates.length,
    errors,
  };
}

export const AssetImageDrawModal: React.FC<AssetImageDrawModalProps> = ({
  open,
  title,
  hint,
  useLabel,
  redrawLabel,
  applyingLabel,
  progress,
  progressStep,
  candidates,
  ownerType,
  generating = false,
  applying = false,
  onCancel,
  onRedraw,
  onUseSelected,
}) => {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [previewCandidate, setPreviewCandidate] = useState<AssetImageDrawCandidate | undefined>();

  useEffect(() => {
    if (!open) {
      setSelectedId(undefined);
      setPreviewCandidate(undefined);
      return;
    }

    setSelectedId((prev) => {
      if (prev && candidates.some((candidate) => candidate.id === prev)) {
        return prev;
      }
      return candidates[0]?.id;
    });
  }, [open, candidates]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedId),
    [candidates, selectedId]
  );

  const effectiveOwnerType = ownerType || candidates[0]?.ownerType || previewCandidate?.ownerType;
  const isCharacterDraw = effectiveOwnerType === 'character';
  const previewSrc = previewCandidate ? getAssetImageDrawCandidateSource(previewCandidate) : '';
  const previewIsCharacter = previewCandidate?.ownerType === 'character';
  const progressPercent = Math.max(0, Math.min(100, Math.round(progress ?? 0)));
  const progressText = progressStep || (isCharacterDraw ? t('asset.drawCharacterDirections') : t('asset.drawImageCandidates'));

  return (
    <>
      <Modal
        open={open}
        title={title || t('asset.imageDrawTitle')}
        onCancel={onCancel}
        width={920}
        centered
        className="asset-image-draw-modal"
        maskClosable={!generating && !applying}
        keyboard={!generating && !applying}
        closable={!generating && !applying}
        footer={[
          <Button key="cancel" onClick={onCancel} disabled={generating || applying}>
            {t('common.cancel')}
          </Button>,
          <Button
            key="redraw"
            icon={<ReloadOutlined />}
            onClick={onRedraw}
            loading={generating}
            disabled={applying}
          >
            {redrawLabel || t('asset.redrawCandidates')}
          </Button>,
          <Button
            key="use"
            type="primary"
            disabled={generating || applying || candidates.length === 0}
            loading={applying}
            onClick={() => {
              if (!selectedCandidate) return;
              onUseSelected(selectedCandidate);
            }}
          >
            {applying ? (applyingLabel || useLabel || t('asset.useSelectedImage')) : (useLabel || t('asset.useSelectedImage'))}
          </Button>,
        ]}
      >
        <div className="asset-image-draw-hint">
          {hint || t('asset.imageDrawHint')}
          <div className="asset-image-draw-preview-tip">
            {t('asset.imageCandidatePreviewHint')}
          </div>
        </div>

        {generating && (
          <div className="asset-image-draw-progress" role="status" aria-live="polite">
            <div className="asset-image-draw-progress-header">
              <Text>{progressText}</Text>
              <Text type="secondary">{progressPercent}%</Text>
            </div>
            <Progress
              percent={progressPercent}
              size="small"
              showInfo={false}
              status={progressPercent >= 100 ? 'success' : 'active'}
            />
          </div>
        )}

        {generating && candidates.length === 0 ? (
          <div className="asset-image-draw-loading">
            <Spin />
            <Text type="secondary">{isCharacterDraw ? t('asset.drawCharacterDirections') : t('asset.drawImageCandidates')}</Text>
          </div>
        ) : candidates.length === 0 ? (
          <Empty description={t('asset.noImageCandidates')} />
        ) : (
          <div className="asset-image-draw-grid">
            {candidates.map((candidate, index) => {
              const selected = candidate.id === selectedId;
              const isCharacterCandidate = candidate.ownerType === 'character';
              const candidateTitle = isCharacterCandidate
                ? t('asset.characterDirectionCardTitle', { current: index + 1, total: candidates.length })
                : String(index + 1);
              const seedTitle = candidate.seed !== undefined ? `seed ${candidate.seed}` : undefined;
              return (
                <div
                  key={candidate.id}
                  className={`asset-image-draw-card${selected ? ' selected' : ''}`}
                  title={isCharacterCandidate ? [candidate.variationLabel, seedTitle].filter(Boolean).join(' · ') : seedTitle}
                >
                  <button
                    type="button"
                    className="asset-image-draw-select-button"
                    onClick={() => {
                      setSelectedId(candidate.id);
                    }}
                    aria-pressed={selected}
                    aria-label={isCharacterCandidate
                      ? t('asset.characterDirectionSelectAlt', { index: index + 1 })
                      : t('asset.imageCandidateSelectAlt', { index: index + 1 })}
                  >
                    <img
                      src={getAssetImageDrawCandidateSource(candidate)}
                      alt={isCharacterCandidate
                        ? t('asset.characterDirectionAlt', { index: index + 1 })
                        : t('asset.imageCandidateAlt', { index: index + 1 })}
                    />
                    <div className="asset-image-draw-card-meta">
                      <Tag color={selected ? 'blue' : 'default'}>{candidateTitle}</Tag>
                      {candidate.variationLabel && (
                        <span className="asset-image-draw-variation" title={candidate.variationLabel}>
                          {candidate.variationLabel}
                        </span>
                      )}
                      {!isCharacterCandidate && candidate.seed !== undefined && (
                        <span className="asset-image-draw-seed">seed {candidate.seed}</span>
                      )}
                    </div>
                    {selected && (
                      <CheckCircleFilled className="asset-image-draw-selected-icon" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="asset-image-draw-preview-badge"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPreviewCandidate(candidate);
                    }}
                    aria-label={isCharacterCandidate
                      ? t('asset.characterDirectionPreviewAlt', { index: index + 1 })
                      : t('asset.imageCandidatePreviewAlt', { index: index + 1 })}
                  >
                    {t('asset.previewImage')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(previewCandidate)}
        title={previewIsCharacter ? t('asset.characterDirectionPreviewTitle') : t('asset.imageCandidatePreviewTitle')}
        footer={null}
        centered
        width="min(92vw, 960px)"
        className="asset-image-draw-preview-modal"
        maskClosable
        keyboard={false}
        onCancel={() => setPreviewCandidate(undefined)}
      >
        {previewCandidate && previewSrc && (
          <button
            type="button"
            className="asset-image-draw-preview-button"
            onClick={() => setPreviewCandidate(undefined)}
            aria-label={t('common.close')}
          >
            <img
              src={previewSrc}
              alt={previewIsCharacter ? t('asset.characterDirectionPreviewTitle') : t('asset.imageCandidatePreviewTitle')}
              className="asset-image-draw-preview-image"
            />
          </button>
        )}
      </Modal>
    </>
  );
};

export default AssetImageDrawModal;
