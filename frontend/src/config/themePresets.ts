/**
 * 主题预设配置
 * 用于项目风格选择，影响 LLM 创作和 TTI 生成
 */
import type { Project, ProjectStyleSnapshot, ThemePreset } from '../types';
import { getCustomThemePresets } from '../store/globalStore';

// Re-export for convenience
export type { ThemePreset } from '../types';
export type ThemePresetSourceType = 'builtin' | 'custom';

export interface ThemePresetCatalogItem extends ThemePreset {
  sourceType: ThemePresetSourceType;
  sourcePresetId: string;
}

export const DEFAULT_THEME_PRESET_ID = 'anime-urban';

// 内置风格统一收敛到 4 套动漫风（都市 / 玄幻 / 古风 / 像素），
// 减少选择疲劳；非动漫题材统一靠"自定义"或自定义风格预设处理。
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'anime-urban',
    name: '动漫·都市',
    description: '现代都市背景的日式动漫画风',
    ttiStylePrefix: 'anime style, modern urban japan, detailed cityscape, soft cel shading, clean line art, vibrant but balanced colors, expressive characters, ',
    llmPromptSuffix: '以现代都市题材的日式动漫风格呈现，角色表情生动，场景细节丰富。',
    defaultStyleReferenceFile: 'anime-urban.png',
  },
  {
    id: 'anime-xuanhuan',
    name: '动漫·玄幻',
    description: '奇幻法术 / 仙侠 / 异界世界观的动漫画风',
    ttiStylePrefix: 'anime style, xuanhuan / chinese fantasy, mystical aura, glowing magical effects, flowing robes, ethereal landscapes, dramatic cinematic lighting, ',
    llmPromptSuffix: '以玄幻题材的日式动漫风格呈现，画面带有奇幻光效与气韵。',
    defaultStyleReferenceFile: 'anime-xuanhuan.png',
  },
  {
    id: 'anime-classical',
    name: '动漫·古风',
    description: '中式古风背景的动漫画风',
    ttiStylePrefix: 'anime style, ancient china setting, traditional hanfu, classical architecture, soft ink-tinged shading, elegant composition, ',
    llmPromptSuffix: '以中式古风题材的日式动漫风格呈现，服饰与建筑古典考究。',
    defaultStyleReferenceFile: 'anime-classical.png',
  },
  {
    id: 'anime-pixel',
    name: '动漫·像素',
    description: '像素美术 + 动漫角色设计的复古游戏画风',
    ttiStylePrefix: 'anime pixel art style, retro 16-bit / 32-bit game aesthetic, crisp pixel edges, limited palette, anime character proportions in pixel form, ',
    llmPromptSuffix: '以像素动漫风格呈现，复古游戏画面观感。',
    defaultStyleReferenceFile: 'anime-pixel.png',
  },
  {
    id: 'custom',
    name: '自定义',
    description: '使用自定义风格描述',
    ttiStylePrefix: '',
    llmPromptSuffix: '',
    // custom 风格无内置默认图，用户需手动上传
  },
];

function isLegacyCustomPreset(themeId?: string): boolean {
  return !themeId || themeId === 'custom';
}

function toCatalogItem(preset: ThemePreset, sourceType: ThemePresetSourceType): ThemePresetCatalogItem {
  return {
    ...preset,
    sourceType,
    sourcePresetId: preset.id,
  };
}

export function getBuiltinThemePresets(): ThemePresetCatalogItem[] {
  return THEME_PRESETS
    .filter((preset) => preset.id !== 'custom')
    .map((preset) => toCatalogItem(preset, 'builtin'));
}

export function getThemePreset(themeId: string): ThemePresetCatalogItem | undefined {
  return getBuiltinThemePresets().find((preset) => preset.id === themeId);
}

export async function getAllThemePresets(): Promise<ThemePresetCatalogItem[]> {
  const customPresets = await getCustomThemePresets();
  const customCatalog = customPresets.map((preset) => toCatalogItem(preset, 'custom'));
  return [...customCatalog, ...getBuiltinThemePresets()];
}

export async function getThemePresetAsync(themeId: string): Promise<ThemePresetCatalogItem | undefined> {
  if (isLegacyCustomPreset(themeId)) {
    return undefined;
  }

  const catalog = await getAllThemePresets();
  return catalog.find((preset) => preset.id === themeId);
}

export async function resolveThemePreset(
  themeId: string = DEFAULT_THEME_PRESET_ID
): Promise<ThemePresetCatalogItem> {
  const preset = await getThemePresetAsync(themeId);
  if (preset) {
    return preset;
  }

  const fallbackPreset = getThemePreset(DEFAULT_THEME_PRESET_ID);
  if (!fallbackPreset) {
    throw new Error(`Default theme preset not found: ${DEFAULT_THEME_PRESET_ID}`);
  }
  return fallbackPreset;
}

export async function createProjectStyleSnapshot(
  themeId: string = DEFAULT_THEME_PRESET_ID
): Promise<ProjectStyleSnapshot> {
  const preset = await resolveThemePreset(themeId);
  const createdAt = Date.now();

  return {
    id: `${preset.sourceType}:${preset.id}:${createdAt}`,
    name: preset.name,
    description: preset.description,
    ttiStylePrefix: preset.ttiStylePrefix,
    llmPromptSuffix: preset.llmPromptSuffix,
    sourceType: preset.sourceType,
    sourcePresetId: preset.sourcePresetId,
    createdAt,
  };
}

export function resolveProjectStyleSnapshot(project?: Pick<Project, 'styleSnapshot'> | null): ProjectStyleSnapshot | undefined {
  return project?.styleSnapshot;
}

export function getStylePrefixFromSnapshot(styleSnapshot?: ProjectStyleSnapshot | null): string {
  return styleSnapshot?.ttiStylePrefix || '';
}

export function getLLMStyleSuffixFromSnapshot(styleSnapshot?: ProjectStyleSnapshot | null): string {
  return styleSnapshot?.llmPromptSuffix || '';
}

export function buildLLMStyleInstruction(styleSnapshot?: ProjectStyleSnapshot | null): string {
  return getLLMStyleSuffixFromSnapshot(styleSnapshot).trim();
}

export function getThemeStylePrefix(themeId?: string, customStylePrompt?: string): string {
  if (isLegacyCustomPreset(themeId)) {
    return customStylePrompt ? `${customStylePrompt}, ` : '';
  }
  const theme = getThemePreset(themeId ?? '');
  return theme?.ttiStylePrefix || '';
}

export function getThemeLLMSuffix(themeId?: string, customStylePrompt?: string): string {
  if (isLegacyCustomPreset(themeId)) {
    return customStylePrompt || '';
  }
  const theme = getThemePreset(themeId ?? '');
  return theme?.llmPromptSuffix || '';
}

/**
 * 异步获取风格前缀（支持自定义预设）
 */
export async function getThemeStylePrefixAsync(themeId?: string, customStylePrompt?: string): Promise<string> {
  if (isLegacyCustomPreset(themeId)) {
    return customStylePrompt ? `${customStylePrompt}, ` : '';
  }
  const theme = await getThemePresetAsync(themeId ?? '');
  return theme?.ttiStylePrefix || '';
}

/**
 * 异步获取 LLM 后缀（支持自定义预设）
 */
export async function getThemeLLMSuffixAsync(themeId?: string, customStylePrompt?: string): Promise<string> {
  if (isLegacyCustomPreset(themeId)) {
    return customStylePrompt || '';
  }
  const theme = await getThemePresetAsync(themeId ?? '');
  return theme?.llmPromptSuffix || '';
}
