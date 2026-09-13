/**
 * RollingContext — 滚动上下文窗口
 *
 * 借鉴 Claude Code 的 Compact 模式，管理 chunk 间的上下文传递。
 * 保留最近 N 个 chunk 的完整内容，更早的 chunk 压缩为摘要。
 * 当累积摘要 token 超过阈值时，自动将旧摘要合并压缩为精炼版本。
 * 支持两种压缩模式：
 *   - heuristic（默认）：基于句子去重 + 截断，零 LLM 开销
 *   - llm：调用 LLM 生成更精炼的摘要，保留实体和关系
 */
import type { EntitySummary } from './CreationContext';
import type { LLMProvider } from '../providers/llm/types';

/** 粗略估算 token 数（中文约 1.5 字/token，英文约 4 字/token） */
function estimateTokens(text: string): number {
  // 统计中文字符数和非中文字符数，分别估算
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.5 + otherCount / 4);
}

/**
 * 将多条摘要合并为一条精炼摘要（保留实体和关系，去除冗余）
 * 采用简单的启发式策略：按句子去重 + 截断到目标长度
 */
function compressSummaries(summaries: string[], targetTokens: number): string {
  const combined = summaries.join('\n');
  // 按句子拆分（支持中英文句号、换行）
  const sentences = combined.split(/(?<=[。！？.!?\n])\s*/);
  const seen = new Set<string>();
  const kept: string[] = [];
  let tokens = 0;

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    // 简单去重：规范化后比较
    const normalized = s.replace(/\s+/g, ' ');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const t = estimateTokens(s);
    if (tokens + t > targetTokens) break;
    kept.push(s);
    tokens += t;
  }

  return kept.join(' ');
}

export class RollingContext {
  private summaries: string[] = [];
  private recentChunks: string[] = [];
  private entities: Map<string, EntitySummary> = new Map();
  private windowSize: number;
  /** 累积摘要 token 超过此阈值时触发压缩 */
  private summaryTokenThreshold: number;
  /** 压缩后目标 token 数（约为阈值的一半） */
  private compressTargetTokens: number;
  /** 可选 LLM provider，用于智能压缩 */
  private llmProvider?: LLMProvider;
  /** 是否有待处理的 LLM 压缩（避免并发压缩） */
  private compressing = false;

  constructor(windowSize = 2, summaryTokenThreshold = 800, llmProvider?: LLMProvider) {
    this.windowSize = windowSize;
    this.summaryTokenThreshold = summaryTokenThreshold;
    this.compressTargetTokens = Math.ceil(summaryTokenThreshold / 2);
    this.llmProvider = llmProvider;
  }

  /**
   * 添加已处理 chunk 的结果
   * 如果 recentChunks 超过 windowSize，最早的移入 summaries；
   * 若累积摘要 token 超过阈值，自动将旧摘要合并压缩。
   */
  addChunkResult(chunkIndex: number, fullContent: string, summary: string): void {
    this.recentChunks.push(fullContent);

    // 超出窗口的 chunk 压缩为摘要
    while (this.recentChunks.length > this.windowSize) {
      const oldest = this.recentChunks.shift()!;
      if (this.summaries.length < chunkIndex - this.windowSize + 1) {
        this.summaries.push(summary || oldest.slice(0, 200) + '…');
      }
    }

    // 确保摘要列表与 chunk 索引对齐
    if (summary && this.summaries.length <= chunkIndex - this.windowSize) {
      this.summaries.push(summary);
    }

    // 动态压缩：累积摘要 token 超过阈值时合并旧摘要
    this.maybeCompressSummaries();
  }

  /**
   * 当累积摘要 token 超过阈值时，将所有摘要合并为一条精炼摘要。
   * 如果有 LLM provider，异步调用 LLM 做智能压缩；否则用启发式方法。
   */
  private maybeCompressSummaries(): void {
    if (this.summaries.length < 2) return;
    const totalTokens = this.summaries.reduce((sum, s) => sum + estimateTokens(s), 0);
    if (totalTokens <= this.summaryTokenThreshold) return;

    if (this.llmProvider && !this.compressing) {
      // 异步 LLM 压缩（不阻塞主流程）
      this.compressing = true;
      const toCompress = [...this.summaries];
      const entityContext = Array.from(this.entities.values())
        .map(e => `${e.name}（${e.type}）`)
        .join('、');

      this.llmProvider.chat([{
        role: 'user',
        content: `请将以下剧本分析摘要压缩为一段精炼摘要（约${this.compressTargetTokens * 2}字），必须保留所有提到的实体名称和关系。\n\n已知实体：${entityContext || '无'}\n\n摘要内容：\n${toCompress.join('\n---\n')}`,
      }]).then(compressed => {
        // 只有当摘要没有被其他操作修改时才替换
        if (this.summaries.length >= toCompress.length) {
          this.summaries = [compressed.trim()];
        }
      }).catch(() => {
        // LLM 压缩失败，回退到启发式
        const compressed = compressSummaries(this.summaries, this.compressTargetTokens);
        this.summaries = [compressed];
      }).finally(() => {
        this.compressing = false;
      });
    } else {
      // 启发式压缩（同步，零开销）
      const compressed = compressSummaries(this.summaries, this.compressTargetTokens);
      this.summaries = [compressed];
    }
  }

  /**
   * 获取当前上下文（供下一个 chunk 使用）
   * 格式：早期摘要 + 近期完整内容
   */
  getContextForNextChunk(): string {
    const parts: string[] = [];

    if (this.summaries.length > 0) {
      parts.push('【早期段落摘要】');
      parts.push(this.summaries.join('\n'));
    }

    if (this.recentChunks.length > 0) {
      if (parts.length > 0) parts.push('---');
      parts.push('【近期完整内容】');
      parts.push(this.recentChunks.join('\n---\n'));
    }

    return parts.join('\n');
  }

  /**
   * 获取前一个 chunk 的摘要（用于 buildChunkContextPrompt）
   */
  getPreviousChunkSummary(): string | undefined {
    if (this.summaries.length > 0) {
      return this.summaries[this.summaries.length - 1];
    }
    // 如果还没有摘要但有 recent chunks，返回最后一个的截取
    if (this.recentChunks.length > 0) {
      const last = this.recentChunks[this.recentChunks.length - 1];
      return last.length > 300 ? last.slice(0, 300) + '…' : last;
    }
    return undefined;
  }

  /**
   * 添加实体（自动去重）
   */
  addEntities(entities: EntitySummary[]): void {
    for (const e of entities) {
      const key = `${e.type}:${e.name}`;
      if (!this.entities.has(key)) {
        this.entities.set(key, e);
      }
    }
  }

  /**
   * 获取所有已累积的实体
   */
  getEntityAccumulator(): EntitySummary[] {
    return Array.from(this.entities.values());
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.summaries = [];
    this.recentChunks = [];
    this.entities.clear();
  }
}
