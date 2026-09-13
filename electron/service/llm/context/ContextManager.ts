import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChunkPlan, LLMMessage, LLMQueryRequest } from '../types';
import { targetChunkCharSize } from '../providers/ProviderCapabilityRegistry';
import { contextCollapseStore } from './ContextCollapseStore';

const COMPACT_RECENT_MESSAGE_COUNT = 4;
const COLLAPSE_MIN_OLD_MESSAGE_COUNT = 3;
const COMPACT_OLD_MESSAGE_HEAD_CHARS = 1_500;
const COMPACT_OLD_MESSAGE_TAIL_CHARS = 800;
const CHUNK_OVERLAP_LINES = 3;
const CHUNK_TARGET_TOKEN_SIZE = 12_000;

export class ContextManager {
  compactMessageContent(content: string): string {
    if (content.length <= COMPACT_OLD_MESSAGE_HEAD_CHARS + COMPACT_OLD_MESSAGE_TAIL_CHARS + 200) {
      return content;
    }
    const omitted = content.length - COMPACT_OLD_MESSAGE_HEAD_CHARS - COMPACT_OLD_MESSAGE_TAIL_CHARS;
    return `${content.slice(0, COMPACT_OLD_MESSAGE_HEAD_CHARS)}\n\n[中间已压缩，省略约 ${omitted} 个字符]\n\n${content.slice(-COMPACT_OLD_MESSAGE_TAIL_CHARS)}`;
  }

  compactMessagesForBudget(request: LLMQueryRequest): LLMQueryRequest {
    const recentMessages = request.messages.slice(-COMPACT_RECENT_MESSAGE_COUNT);
    const recentSet = new Set(recentMessages);

    const oldMessages = request.messages.filter(message => message.role !== 'system' && !recentSet.has(message));
    const collapsedSummary = oldMessages.length >= COLLAPSE_MIN_OLD_MESSAGE_COUNT
      ? contextCollapseStore.createSummary(oldMessages)
      : null;

    const collapsedHistoryMessage = collapsedSummary
      ? { role: 'assistant' as const, content: collapsedSummary }
      : null;

    const compactedRecentMessages = request.messages
      .filter(message => message.role === 'system' || recentSet.has(message))
      .map((message) => {
        if (message.role === 'system') {
          return message;
        }
        return {
          ...message,
          content: this.compactMessageContent(message.content),
        };
      });

    return {
      ...request,
      messages: [
        ...request.messages.filter(message => message.role === 'system'),
        ...(collapsedHistoryMessage ? [collapsedHistoryMessage] : []),
        ...compactedRecentMessages.filter(message => message.role !== 'system'),
      ],
    };
  }

  totalUserContentLength(messages: LLMMessage[]): number {
    return messages.filter(message => message.role === 'user').reduce((sum, message) => sum + message.content.length, 0);
  }

  toLangChainMessages(messages: LLMMessage[]): BaseMessage[] {
    return messages.map((message) => {
      switch (message.role) {
        case 'system': return new SystemMessage(message.content);
        case 'assistant': return new AIMessage(message.content);
        case 'user':
        default: return new HumanMessage(message.content);
      }
    });
  }

  splitTextAtParagraphs(text: string, targetSize: number): string[] {
    const paragraphs = text.split(/\n{2,}/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if (paragraph.length > targetSize) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        const lines = paragraph.split('\n');
        let lineChunk = '';
        for (const line of lines) {
          if (lineChunk.length + line.length + 1 > targetSize && lineChunk.trim()) {
            chunks.push(lineChunk.trim());
            lineChunk = '';
          }
          lineChunk += (lineChunk ? '\n' : '') + line;
        }
        if (lineChunk.trim()) {
          currentChunk = lineChunk;
        }
        continue;
      }

      const separator = '\n\n';
      if (currentChunk.length + separator.length + paragraph.length > targetSize && currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      currentChunk += (currentChunk ? separator : '') + paragraph;
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    if (chunks.length <= 1 || CHUNK_OVERLAP_LINES <= 0) return chunks;

    const overlapped: string[] = [chunks[0]];
    for (let index = 1; index < chunks.length; index++) {
      const previousLines = chunks[index - 1].split('\n');
      const overlapText = previousLines.slice(-CHUNK_OVERLAP_LINES).join('\n');
      overlapped.push(overlapText + '\n\n' + chunks[index]);
    }
    return overlapped;
  }

  createChunkPlan(request: LLMQueryRequest): ChunkPlan | null {
    const systemMessages = request.messages.filter(message => message.role === 'system');
    const userMessages = request.messages.filter(message => message.role === 'user');
    if (userMessages.length === 0) return null;

    const lastUserMessage = userMessages[userMessages.length - 1];
    const longText = lastUserMessage.content;
    const prefixUserMessages = userMessages.slice(0, -1);
    const chunks = this.splitTextAtParagraphs(longText, targetChunkCharSize(request.config, CHUNK_TARGET_TOKEN_SIZE));

    return {
      systemMessages,
      prefixUserMessages,
      lastUserMessage,
      longText,
      chunks,
    };
  }
}

export const contextManager = new ContextManager();
