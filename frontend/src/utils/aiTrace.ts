export interface AITraceContext {
  traceId?: string;
  source?: string;
  operation?: string;
  projectId?: string;
  targetId?: string;
  targetName?: string;
}

export function createAITraceId(prefix: string = 'ai'): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}_${random}`;
}

export function buildAITraceHeaders(context?: AITraceContext): Record<string, string> {
  if (!context?.traceId) {
    return {};
  }

  const headers: Record<string, string> = {
    'x-koma-trace-id': context.traceId,
  };

  if (context.source) {
    headers['x-koma-trace-source'] = context.source;
  }

  if (context.operation) {
    headers['x-koma-trace-operation'] = context.operation;
  }

  if (context.targetName) {
    headers['x-koma-trace-target'] = context.targetName;
  }

  return headers;
}

export function describeLLMProviderTransport(providerType: string): 'ipc' | 'direct' {
  return providerType === 'gemini' ? 'direct' : 'ipc';
}
