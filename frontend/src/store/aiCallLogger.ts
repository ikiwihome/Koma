/**
 * AI 调用日志工具
 * 统一打印所有 AI 服务调用的完整提示词，方便调试
 */
import { createLogger } from './logger';

export type AICallType = 'llm' | 'tti' | 'itv' | 'tts';

export interface AICallLog {
  type: AICallType;
  service: string;      // provider 名称
  prompt: string;       // 完整提示词
  options?: Record<string, any>;  // 调用参数
  projectId?: string;
  targetId?: string;
  targetName?: string;
  systemPrompt?: string; // LLM 专用
  traceId?: string;
  source?: string;
  operation?: string;
  templateId?: string;
  promptSource?: 'default' | 'custom' | 'finalized';
}

const TYPE_LABELS: Record<AICallType, string> = {
  llm: 'LLM',
  tti: 'TTI',
  itv: 'ITV',
  tts: 'TTS',
};

const logger = createLogger('AICall');

/**
 * 打印 AI 调用日志
 */
export function logAICall(log: AICallLog): void {
  const prefix = `[AI:${TYPE_LABELS[log.type]}]`;
  const meta = {
    traceId: log.traceId,
    service: log.service,
    source: log.source,
    operation: log.operation,
    templateId: log.templateId,
    promptSource: log.promptSource,
    projectId: log.projectId,
    targetId: log.targetId,
    targetName: log.targetName,
  };

  logger.info(`${prefix} ========== ${log.service} ==========`, meta);
  logger.info(`${prefix} prompt`, {
    traceId: log.traceId,
    prompt: log.prompt,
  });

  if (log.systemPrompt) {
    logger.info(`${prefix} systemPrompt`, {
      traceId: log.traceId,
      systemPrompt: log.systemPrompt,
    });
  }

  if (log.options && Object.keys(log.options).length > 0) {
    logger.info(`${prefix} options`, {
      traceId: log.traceId,
      options: log.options,
    });
  }
}

/**
 * 便捷函数：记录 TTI 调用
 */
export function logTTICall(
  service: string,
  prompt: string,
  options?: { width?: number; height?: number; [key: string]: any },
  meta?: {
    projectId?: string;
    targetId?: string;
    targetName?: string;
    templateId?: string;
    promptSource?: 'default' | 'custom' | 'finalized';
  }
): void {
  logAICall({
    type: 'tti',
    service,
    prompt,
    options,
    ...meta,
  });
}

/**
 * 便捷函数：记录 ITV 调用
 */
export function logITVCall(
  service: string,
  imageSource: string,
  prompt: string,
  options?: { duration?: number; aspectRatio?: string; [key: string]: any },
  meta?: {
    projectId?: string;
    targetId?: string;
    targetName?: string;
    templateId?: string;
    promptSource?: 'default' | 'custom' | 'finalized';
  }
): void {
  logAICall({
    type: 'itv',
    service,
    prompt: `Image: ${imageSource}\nMotion: ${prompt}`,
    options,
    ...meta,
  });
}

/**
 * 便捷函数：记录 LLM 调用
 */
export function logLLMCall(
  service: string,
  prompt: string,
  systemPrompt?: string,
  meta?: {
    projectId?: string;
    targetId?: string;
    targetName?: string;
    traceId?: string;
    source?: string;
    operation?: string;
    templateId?: string;
    promptSource?: 'default' | 'custom' | 'finalized';
  }
): void {
  logAICall({
    type: 'llm',
    service,
    prompt,
    systemPrompt,
    ...meta,
  });
}

/**
 * 便捷函数：记录 TTS 调用
 */
export function logTTSCall(
  service: string,
  text: string,
  voiceId: string,
  options?: { rate?: number; pitch?: number; [key: string]: any },
  meta?: {
    projectId?: string;
    targetId?: string;
    targetName?: string;
    traceId?: string;
    source?: string;
    operation?: string;
    templateId?: string;
    promptSource?: 'default' | 'custom' | 'finalized';
  }
): void {
  logAICall({
    type: 'tts',
    service,
    prompt: `Voice: ${voiceId}\nText: ${text}`,
    options,
    ...meta,
  });
}

export default {
  logAICall,
  logTTICall,
  logITVCall,
  logLLMCall,
  logTTSCall,
};
