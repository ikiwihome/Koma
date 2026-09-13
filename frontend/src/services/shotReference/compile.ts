/**
 * 把分镜提示词中的 mention token 编译成 `@Image N` —— N 严格对应 bundle.items 的位置。
 *
 * 这一层是生图 / 生视频共用的 grok-image-index 协议落地点。LLM 推理时面对的是
 * `@shot_anchor` / `@grid_anchor` / `@storyboard_anchor` /
 * `@previous_storyboard_anchor` / `@char_xxx` / `@scene_xxx` / `@prop_xxx` /
 * `@user_<idx>` 这些有语义的 token；上游 provider（OpenAI gpt-image / grok2 /
 * gemini / seedance）真正需要的是位置编码 `@Image N`。这里在请求构造层做翻译，
 * provider 自己不感知 mention 协议。
 *
 * 老 `grokImageIndexCompiler` 仍服务历史路径（chat 等），不在这条链路上。
 */
import type { MediaAssetSource } from '../../types';
import type { ShotReferenceBundle, ShotReferenceItem } from './types';

/**
 * 把 prompt 内出现的 mention token 翻译为 `@Image N`，N 1-based 对应 bundle.items 位置。
 *
 * 支持的 token 形式（按 ShotReferenceItem.kind 派生）：
 *  - `@shot_anchor`   — 已生成分镜首帧
 *  - `@grid_anchor`   — 九宫格 3×3 锚点
 *  - `@storyboard_anchor` — 当前故事板整图
 *  - `@previous_storyboard_anchor` — 上一分镜故事板整图
 *  - `@char_<id>`     — 角色
 *  - `@scene_<id>`    — 场景
 *  - `@prop_<id>`     — 道具
 *  - `@user_<idx>`    — 用户上传，idx 从 0 开始
 *  - `@Image <N>` / `@图片<N>` — 已经是位置编码（统一归一化为 `@Image N`，并校验越界）
 *
 * 未在 bundle 中找到的 token 会记录到 `unmappedTokens`，并按可读标签降级：
 *  - 资产存在但没有可用图片 / 被模型引用上限裁掉：替换为资产名称；
 *  - token 后面已经紧跟同名中文名：只剥离 token，保留原文名称；
 *  - 完全未知 token 或无真实锚定图的 anchor：剥离 token，避免 raw ID 污染 provider prompt。
 */
export interface CompiledBundlePrompt {
  compiledPrompt: string;
  references: ReadonlyArray<MediaAssetSource>;
  debug: {
    /** prompt 中未在 bundle 找到对应项的 token 原样列表 */
    unmappedTokens: string[];
    /** token → references 位置（1-based）的映射，用于诊断 */
    tokenToIndex: Array<{ token: string; index: number }>;
    /** prompt 显式引用了 references[N]（N >= bundle.items.length）—— 越界，被剥离 */
    overflowImageNumbers: number[];
  };
}

const MENTION_RE = /@(shot_anchor|grid_anchor|storyboard_anchor|previous_storyboard_anchor|char_[A-Za-z0-9_-]+|scene_[A-Za-z0-9_-]+|prop_[A-Za-z0-9_-]+|user_\d+)\b/g;
const IMAGE_NUMBER_RE = /(?:@Image|@图片)\s*(\d+)/g;

export function compileShotPromptToBundle(params: {
  prompt: string;
  bundle: ShotReferenceBundle;
}): CompiledBundlePrompt {
  const { prompt, bundle } = params;
  const items = bundle.items;
  const tokenToIndex = new Map<string, number>();
  items.forEach((item, idx) => {
    tokenToIndex.set(item.mentionToken, idx + 1);
  });
  const fallbackLabelByToken = new Map<string, string>();
  for (const fallback of bundle.mentionFallbacks || []) {
    const label = fallback.label.trim();
    if (fallback.mentionToken && label) {
      fallbackLabelByToken.set(fallback.mentionToken, label);
    }
  }

  const unmappedTokens: string[] = [];
  const overflowImageNumbers: number[] = [];
  const tokenAuditTrail: Array<{ token: string; index: number }> = [];

  // 第一遍：替换语义 mention token 为 @Image N
  let compiledPrompt = prompt.replace(MENTION_RE, (full: string, body: string, offset: number, sourceText: string) => {
    const token = `@${body}`;
    const idx = tokenToIndex.get(token);
    if (idx == null) {
      unmappedTokens.push(token);
      return buildUnmappedMentionReplacement({
        sourceText,
        tokenStart: offset,
        tokenLength: full.length,
        fallbackLabel: fallbackLabelByToken.get(token),
      });
    }
    tokenAuditTrail.push({ token, index: idx });
    return `@Image ${idx}`;
  });

  // 第二遍：清理越界的 @Image N / @图片N（N 大于 bundle.items 长度），避免 LLM 引用了被裁
  // 掉的位置导致 provider 收到无效引用。
  compiledPrompt = compiledPrompt.replace(IMAGE_NUMBER_RE, (full, nRaw: string) => {
    const n = Number(nRaw);
    if (!Number.isFinite(n) || n <= 0) return full;
    if (n > items.length) {
      overflowImageNumbers.push(n);
      return ''; // 越界——剥离，避免 provider 困惑
    }
    return `@Image ${n}`; // 归一化协议（@图片N / @ImageN → @Image N）
  });

  // 折叠 mention 剥离后的多余空白
  compiledPrompt = compiledPrompt.replace(/[ \t]{2,}/g, ' ');

  const references: MediaAssetSource[] = items.map(item => item.source);

  return {
    compiledPrompt,
    references,
    debug: {
      unmappedTokens: dedupe(unmappedTokens),
      tokenToIndex: tokenAuditTrail,
      overflowImageNumbers: dedupe(overflowImageNumbers),
    },
  };
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function buildUnmappedMentionReplacement(params: {
  sourceText: string;
  tokenStart: number;
  tokenLength: number;
  fallbackLabel?: string;
}): string {
  const fallbackLabel = params.fallbackLabel?.trim();
  if (!fallbackLabel) return '';

  const afterToken = params.sourceText.slice(params.tokenStart + params.tokenLength);
  // 模板要求 `@prop_x 红烧肉` 这种“token + 名称”格式。降级时如果名称已经紧跟在后面，
  // 只剥掉机器 token，避免生成“红烧肉 红烧肉”。
  if (afterToken.trimStart().startsWith(fallbackLabel)) {
    return '';
  }
  return fallbackLabel;
}

/** 内部测试 hook：检查某 token 是否能从 bundle 翻译到位置。 */
export function _resolveTokenIndex(
  token: string,
  bundle: ShotReferenceBundle,
): number | undefined {
  for (let i = 0; i < bundle.items.length; i += 1) {
    if (bundle.items[i].mentionToken === token) return i + 1;
  }
  return undefined;
}

/** 仅类型重导出，方便调用处 */
export type { ShotReferenceBundle, ShotReferenceItem };
