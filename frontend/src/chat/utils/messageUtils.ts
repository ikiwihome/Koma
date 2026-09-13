/**
 * 消息处理工具函数
 */
import type { ChatMessage } from '../types';

export interface NormalizedMessage {
  displayContent: string;
  displayReasoning?: string;
}

// <think> 标签正则（支持多行）
const THINK_REGEX = /<think>([\s\S]*?)<\/think>/gi;

/**
 * 归一化消息内容
 * 从 content 中提取 <think> 标签内容作为 reasoning（兜底处理历史数据）
 */
export function normalizeMessage(message: ChatMessage): NormalizedMessage {
  // 获取文本内容
  let text = typeof message.content === 'string'
    ? message.content
    : message.content
        .filter(part => part.type === 'text')
        .map(part => (part as { type: 'text'; text: string }).text)
        .join('\n');

  let reasoning = message.reasoning;

  // 兜底：如果没有 reasoning 字段，从 content 中解析 <think> 标签
  if (!reasoning) {
    const matches: string[] = [];
    let match: RegExpExecArray | null;

    // 重置 lastIndex（因为使用了 g 标志）
    THINK_REGEX.lastIndex = 0;

    while ((match = THINK_REGEX.exec(text)) !== null) {
      matches.push(match[1].trim());
    }

    if (matches.length > 0) {
      reasoning = matches.join('\n\n');
      // 移除 <think> 标签
      text = text.replace(THINK_REGEX, '').trim();
    }
  }

  return {
    displayContent: text,
    displayReasoning: reasoning || undefined,
  };
}

/**
 * 从文本中提取并移除 <think> 标签
 * 用于数据迁移
 */
export function extractThinkFromText(text: string): { content: string; reasoning?: string } {
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  THINK_REGEX.lastIndex = 0;

  while ((match = THINK_REGEX.exec(text)) !== null) {
    matches.push(match[1].trim());
  }

  if (matches.length > 0) {
    return {
      content: text.replace(THINK_REGEX, '').trim(),
      reasoning: matches.join('\n\n'),
    };
  }

  return { content: text };
}
