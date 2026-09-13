import { classifyAIError } from '../utils/aiError';
import { extractErrorMessage } from '../utils/errorHandler';

export interface ScriptAnalysisChunkFailure {
  chunkIndex: number;
  chunkTotal: number;
  error: unknown;
}

const MAX_DISPLAYED_FAILURES = 2;
const MAX_ERROR_LENGTH = 120;

function compactMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

function truncateMessage(message: string, maxLength = MAX_ERROR_LENGTH): string {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength - 1).trimEnd()}…`;
}

export function formatScriptAnalysisChunkError(error: unknown): string {
  const info = classifyAIError(error);
  const rawMessage = truncateMessage(compactMessage(info.rawMessage || extractErrorMessage(error)));

  if (!rawMessage) {
    return '未知错误';
  }

  switch (info.kind) {
    case 'config':
      return info.userMessage;
    case 'gateway_timeout':
    case 'network':
      return rawMessage === info.userMessage
        ? rawMessage
        : `${info.userMessage}（${rawMessage}）`;
    case 'parse':
    case 'format':
    case 'unknown':
    default:
      return rawMessage;
  }
}

export function buildScriptAnalysisChunkFailureMessage(
  label: string,
  failures: ScriptAnalysisChunkFailure[],
): string {
  if (failures.length === 0) {
    return `${label}提取失败`;
  }

  const totalChunks = failures.reduce(
    (max, item) => Math.max(max, item.chunkTotal || item.chunkIndex || 0),
    failures.length,
  );

  const failureDetails = failures
    .slice(0, MAX_DISPLAYED_FAILURES)
    .map((item) => `分块 ${item.chunkIndex}/${item.chunkTotal}：${formatScriptAnalysisChunkError(item.error)}`);

  const remainingFailures = failures.length - failureDetails.length;
  const suffix = remainingFailures > 0 ? `；另 ${remainingFailures} 个分块失败` : '';

  return `${label}提取失败：${failures.length}/${totalChunks} 个分块失败。${failureDetails.join('；')}${suffix}`;
}
