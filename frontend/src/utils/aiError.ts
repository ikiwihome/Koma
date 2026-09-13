import { extractErrorMessage } from './errorHandler';

export type AIErrorKind =
  | 'gateway_timeout'
  | 'network'
  | 'config'
  | 'parse'
  | 'format'
  | 'unknown';

export interface AIErrorInfo {
  kind: AIErrorKind;
  rawMessage: string;
  userMessage: string;
  retryable: boolean;
}

const GATEWAY_STATUS_RE = /API 请求失败 \((502|503|504|520|522|524)/;
const HTML_RE = /<!DOCTYPE html>|<html/i;

export function classifyAIError(error: unknown): AIErrorInfo {
  const rawMessage = extractErrorMessage(error);

  if (/未配置 LLM|LLM 配置未设置|未配置 LLM 模型/.test(rawMessage)) {
    return {
      kind: 'config',
      rawMessage,
      userMessage: '未配置可用的 LLM 模型，请先检查模型配置。',
      retryable: false,
    };
  }

  if (/JSON 解析失败/.test(rawMessage)) {
    return {
      kind: 'parse',
      rawMessage,
      userMessage: 'AI 返回内容格式不正确，请重试。',
      retryable: true,
    };
  }

  if (/润色结果包含说明文字|润色结果为空|润色结果未返回有效正文/.test(rawMessage)) {
    return {
      kind: 'format',
      rawMessage,
      userMessage: rawMessage,
      retryable: true,
    };
  }

  if (/响应数据中断|无法连接 API/.test(rawMessage) || GATEWAY_STATUS_RE.test(rawMessage) || HTML_RE.test(rawMessage)) {
    return {
      kind: 'gateway_timeout',
      rawMessage,
      userMessage: 'AI 服务网关超时或代理异常，请稍后重试。',
      retryable: true,
    };
  }

  // 上游瞬态错误：HTTP/2 stream reset、curl(92)、upstream_error、server_error 等
  // 网关层已自动重试 2 次仍失败 → 通常是上游真实模型服务器抖动，建议用户稍后再试
  if (/upstream_error|server_error|HTTP\/2 stream\s+\d+\s+was not closed cleanly|INTERNAL_ERROR|curl:\s*\(\d+\)/.test(rawMessage)) {
    return {
      kind: 'gateway_timeout',
      rawMessage,
      userMessage: '上游 AI 服务暂时不可用（已自动重试），请稍后再试或切换其它渠道。',
      retryable: true,
    };
  }

  if (/网络|ECONN|ETIMEDOUT|UND_ERR_SOCKET/.test(rawMessage)) {
    return {
      kind: 'network',
      rawMessage,
      userMessage: '网络请求失败，请检查网络或代理地址后重试。',
      retryable: true,
    };
  }

  return {
    kind: 'unknown',
    rawMessage,
    userMessage: rawMessage,
    retryable: true,
  };
}

export function summarizeHTTPErrorDetail(status: number, detail: string): string {
  if (HTML_RE.test(detail) && [502, 503, 504, 520, 522, 524].includes(status)) {
    return '网关超时或代理服务异常（上游未及时返回响应）';
  }
  return detail;
}
