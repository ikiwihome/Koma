import type { LLMMessage } from '../types';

const MAX_COLLAPSE_BULLET_LENGTH = 180;
const MAX_COLLAPSE_BULLETS = 8;

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function summarizeMessage(message: LLMMessage): string {
  const normalized = normalizeLine(message.content);
  if (!normalized) {
    return `${message.role}: （空内容）`;
  }

  const firstSentence = normalized.split(/(?<=[。！？.!?])\s+/)[0] || normalized;
  const compact = firstSentence.length > MAX_COLLAPSE_BULLET_LENGTH
    ? `${firstSentence.slice(0, MAX_COLLAPSE_BULLET_LENGTH)}…`
    : firstSentence;

  return `${message.role}: ${compact}`;
}

export class ContextCollapseStore {
  createSummary(messages: LLMMessage[]): string {
    const bullets = messages
      .filter(message => message.role !== 'system')
      .slice(0, MAX_COLLAPSE_BULLETS)
      .map(summarizeMessage);

    const extraCount = Math.max(0, messages.filter(message => message.role !== 'system').length - bullets.length);
    const extraLine = extraCount > 0 ? `- 其余 ${extraCount} 条历史消息已折叠保留。` : '';

    return [
      '【历史上下文折叠摘要】',
      ...bullets.map(item => `- ${item}`),
      extraLine,
    ].filter(Boolean).join('\n');
  }
}

export const contextCollapseStore = new ContextCollapseStore();
