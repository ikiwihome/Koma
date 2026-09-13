/**
 * 风格参考图（"画风锚"）解析器
 *
 * 用途：在角色 / 场景 / 道具生图（角色服装照、场景图、道具图）入口，
 * 把当前生效的风格参考图作为 `references[0]` 注入，让 provider 走图生图分支
 * 严格继承画风（色调 / 笔触 / 光影 / 笔法），prompt 里硬约束"仅参考画风、不参考内容"。
 *
 * 优先级（高 → 低）：
 *   1. 项目级 styleSnapshot.styleReferenceImage（用户在项目设置上传/覆盖）
 *   2. 全局风格预设默认图（从 ThemePreset.defaultStyleReferenceFile 解析为
 *      `${userData_business_root}/style-references/{file}`）
 *   3. 都没有 → 返回 undefined，上游回退到纯 text-to-image
 *
 * 启动时已由 electron 主进程把内置占位图镜像到该目录，所以前端直接 IPC 取本地路径即可。
 */
import type { Project, StoredMediaAsset } from '../types';
import { getThemePresetAsync, type ThemePresetCatalogItem } from '../config/themePresets';
import { ipc, ipcApiRoute } from '../utils/ipcRenderer';

interface ActiveStyleReferencePathResponse {
  localPath: string | null;
  mtimeMs?: number;
}

async function fetchActiveStyleReferenceLocalPath(
  presetId: string,
  fallbackFilename?: string,
): Promise<{ localPath: string; mtimeMs: number } | null> {
  try {
    const result = await ipc.invoke(
      ipcApiRoute.app.getActiveStyleReferenceImagePath,
      { presetId, fallbackFilename },
    ) as ActiveStyleReferencePathResponse | null;
    if (!result?.localPath) return null;
    return { localPath: result.localPath, mtimeMs: result.mtimeMs ?? 0 };
  } catch {
    return null;
  }
}

function projectStyleReferenceAsset(project?: Pick<Project, 'styleSnapshot'> | null): StoredMediaAsset | undefined {
  return project?.styleSnapshot?.styleReferenceImage;
}

async function presetStyleReferenceAsset(themeId?: string): Promise<StoredMediaAsset | undefined> {
  if (!themeId) return undefined;
  const preset = await getThemePresetAsync(themeId) as ThemePresetCatalogItem | undefined;
  if (!preset) return undefined;

  const resolved = await fetchActiveStyleReferenceLocalPath(preset.id, preset.defaultStyleReferenceFile);
  if (!resolved) return undefined;

  return {
    kind: 'image',
    localPath: resolved.localPath,
    createdAt: resolved.mtimeMs || 0,
    metadata: { sourcePresetId: preset.id, source: 'global-style-reference' },
  };
}

/**
 * 解析当前生效的风格参考图。
 * - 优先项目级 override；其次预设默认图；都没有返回 undefined。
 */
export async function resolveActiveStyleReferenceAsset(params: {
  project?: Pick<Project, 'styleSnapshot' | 'stylePresetId'> | null;
  themeId?: string;
}): Promise<StoredMediaAsset | undefined> {
  const projectAsset = projectStyleReferenceAsset(params.project);
  if (projectAsset) return projectAsset;

  const presetIdFromProject = params.project?.styleSnapshot?.sourcePresetId
    ?? params.project?.stylePresetId;
  return presetStyleReferenceAsset(params.themeId ?? presetIdFromProject);
}

/**
 * 风格锚定参考图的 prompt 守则：放在 prompt 末尾，明确告诉模型
 * `references[0]` 只是画风锚点（色调 / 笔触 / 光影 / 整体氛围 / 笔法），
 * **不要**继承其内容（角色 / 物体 / 服装 / 场景结构）；那些由其它 references 与文本约束决定。
 *
 * 没有风格锚定图时不输出本块，避免模型误以为存在第一张参考图。
 */
const STYLE_ANCHOR_GUARD_LINES = [
  'Style anchor reference (references[0]) — strict role:',
  '- Inherit ONLY the visual art style: color palette, lighting, brush/line work, texture, atmosphere, rendering technique.',
  '- Do NOT copy or reference any of its content: not its characters, faces, bodies, costumes, props, objects, layout or scene structure.',
  '- Treat all subject matter (character / scene / prop identity, action, costume, composition) as fully defined by the text prompt and any later references — never overridden by the style anchor.',
];

export function buildStyleAnchorGuardPromptSuffix(): string {
  return STYLE_ANCHOR_GUARD_LINES.join('\n');
}

/**
 * 把 prompt 末尾追加风格锚定守则。仅在 hasStyleAnchor 为 true 时追加，
 * 避免模型在无锚图时误以为存在 references[0]。
 */
export function appendStyleAnchorGuard(prompt: string, hasStyleAnchor: boolean): string {
  if (!hasStyleAnchor) return prompt;
  return `${prompt}\n\n${buildStyleAnchorGuardPromptSuffix()}`;
}
