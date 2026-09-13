/**
 * Mention 相关类型定义
 */

// Mention 项目类型
export type AssetMentionType = 'char' | 'prop' | 'scene';
export type AnchorMentionType = 'shot' | 'grid' | 'storyboard' | 'previous_storyboard';
export type MentionType = AssetMentionType | AnchorMentionType;

// Mention 数据项
// 收口约定: id 一律使用项目内资产 ID（与持久化数据一致），不要在提示词层混入 Provider 私有 ID。
export interface MentionItem {
  id: string;           // 用于生成 mention 格式 @type_id
  type: MentionType;
  name: string;
  description?: string;
  previewImage?: string;
}

// 解析后的 Mention
export interface ParsedMention {
  type: MentionType;
  id: string;
  fullMatch: string;
  from: number;
  to: number;
}

// Mention 正则匹配
// 匹配格式:
// - 资产: @char_xxx, @prop_xxx, @scene_xxx
// - 分镜锚点: @shot_anchor, @grid_anchor, @storyboard_anchor, @previous_storyboard_anchor
export const MENTION_REGEX = /@(char|prop|scene)_([a-zA-Z0-9_-]+)|@(shot|grid|storyboard|previous_storyboard)_anchor\b/g;

export function isAssetMentionType(type: MentionType): type is AssetMentionType {
  return type === 'char' || type === 'prop' || type === 'scene';
}

export function isAnchorMentionType(type: MentionType): type is AnchorMentionType {
  return type === 'shot' || type === 'grid' || type === 'storyboard' || type === 'previous_storyboard';
}

/**
 * 解析文本中的所有 Mention
 */
export function parseMentions(text: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  let match: RegExpExecArray | null;

  const regex = new RegExp(MENTION_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    const type = (match[1] || match[3]) as MentionType;
    const id = match[2] || 'anchor';
    mentions.push({
      type,
      id,
      fullMatch: match[0],
      from: match.index,
      to: match.index + match[0].length,
    });
  }

  return mentions;
}

/**
 * 规范化 Mention ID，去除重复前缀
 * 例如: normalizeMentionId('char', 'char_abc') => 'abc'
 */
export function normalizeMentionId(type: MentionType, id: string): string {
  const prefix = `${type}_`;
  // 如果 ID 以 type_ 开头，去除前缀
  if (id.startsWith(prefix)) {
    return id.slice(prefix.length);
  }
  return id;
}

/**
 * 生成 Mention 字符串
 * @param type - 类型 (char/prop/scene/shot/grid/storyboard/previous_storyboard)
 * @param id - 资产 ID（项目内 ID）；锚点类型会忽略 id 并生成内置 anchor token
 * @returns 格式为 @type_id 的字符串，如 @char_sora2xxx；锚点为 @shot_anchor / @grid_anchor 等
 */
export function createMentionString(type: MentionType, id: string): string {
  // 先规范化 ID，避免双前缀
  const normalizedId = normalizeMentionId(type, id);
  if (isAnchorMentionType(type)) {
    return `@${type}_anchor`;
  }
  return `@${type}_${normalizedId}`;
}

/**
 * 从 ID 解析 Mention 类型
 * 支持容错解析双前缀格式 @char_char_xxx
 */
export function parseMentionId(mentionStr: string): { type: MentionType; id: string } | null {
  // 先尝试标准格式
  const anchorMatch = mentionStr.match(/@(shot|grid|storyboard|previous_storyboard)_anchor\b/);
  if (anchorMatch) {
    return { type: anchorMatch[1] as MentionType, id: 'anchor' };
  }

  const match = mentionStr.match(/@(char|prop|scene)_([a-zA-Z0-9_-]+)/);
  if (!match) return null;

  const type = match[1] as MentionType;
  let id = match[2];

  // 容错处理：如果 ID 以 type_ 开头（双前缀），去除
  const prefix = `${type}_`;
  if (id.startsWith(prefix)) {
    id = id.slice(prefix.length);
  }

  return { type, id };
}

export function resolveBuiltInMentionItem(type: MentionType, id: string): MentionItem | undefined {
  const normalizedId = normalizeMentionId(type, id);
  if (type === 'shot' && normalizedId === 'anchor') {
    return {
      id: 'anchor',
      type: 'shot',
      name: '分镜锚定图',
      description: '当前分镜已经生成的首帧/锚定图。只有存在真实分镜图引用时才应出现在提示词中。',
    };
  }
  if (type === 'grid' && normalizedId === 'anchor') {
    return {
      id: 'anchor',
      type: 'grid',
      name: '网格锚定图',
      description: '当前分镜已经生成的九宫格/四宫格时序锚定图。没有生成分镜图时不要使用。',
    };
  }
  if (type === 'storyboard' && normalizedId === 'anchor') {
    return {
      id: 'anchor',
      type: 'storyboard',
      name: '故事板锚定图',
      description: '当前分镜已经生成的电影故事板/制作方案板。只有存在真实故事板图引用时才应出现在提示词中。',
    };
  }
  if (type === 'previous_storyboard' && normalizedId === 'anchor') {
    return {
      id: 'anchor',
      type: 'previous_storyboard',
      name: '上一故事板锚定图',
      description: '上一分镜生成的故事板图，用于继承场景、人物、光影和情绪连续性。',
    };
  }
  return undefined;
}
