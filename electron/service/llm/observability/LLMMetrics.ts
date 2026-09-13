import type { LongTextStrategy } from '../types';

export function logLongTextStrategy(
  mode: 'query' | 'stream',
  strategy: LongTextStrategy,
  context: Record<string, unknown>,
): void {
  console.info('[LLMQuery] 长文本策略', {
    mode,
    strategy,
    ...context,
  });
}

export function logQueryCompletion(
  mode: 'query' | 'stream',
  strategy: LongTextStrategy,
  context: Record<string, unknown>,
): void {
  console.info('[LLMQuery] 统计汇总', {
    mode,
    strategy,
    ...context,
  });
}
