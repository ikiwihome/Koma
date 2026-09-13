import type { ITVRequest } from '../types';
import {
  isImageToVideoRequest,
  isReferenceToVideoRequest,
  isStartEndToVideoRequest,
} from '../types';
import { createAITraceId } from './aiTrace';
import { sanitizeBodyForLog, truncateString } from './logFormatting';

export interface VideoGenerationTraceContext {
  traceId: string;
  source: string;
  operation: string;
  debugBody?: boolean;
}

export type ITVRequestWithTrace<TAsset = unknown, TOptions = Record<string, unknown>> = ITVRequest<TAsset, TOptions> & {
  __komaTrace?: VideoGenerationTraceContext;
};

function summarizeSourceValue(value: string): string {
  if (value.startsWith('data:')) {
    return `${value.slice(0, 140)}...(data-url ${value.length} chars)`;
  }
  return truncateString(value, 400);
}

function summarizeAssetForLog(value: unknown): unknown {
  if (!value) return value;

  if (typeof value === 'string') {
    return summarizeSourceValue(value);
  }

  if (typeof value === 'object') {
    if ('transport' in value && 'value' in value) {
      const input = value as { transport?: unknown; value?: unknown; mimeType?: unknown };
      return {
        transport: input.transport,
        value: typeof input.value === 'string' ? summarizeSourceValue(input.value) : input.value,
        mimeType: input.mimeType,
      };
    }

    if ('kind' in value) {
      const asset = value as {
        kind?: unknown;
        localPath?: unknown;
        remoteUrl?: unknown;
        mimeType?: unknown;
        width?: unknown;
        height?: unknown;
      };
      return {
        kind: asset.kind,
        localPath: typeof asset.localPath === 'string' ? summarizeSourceValue(asset.localPath) : asset.localPath,
        remoteUrl: typeof asset.remoteUrl === 'string' ? summarizeSourceValue(asset.remoteUrl) : asset.remoteUrl,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      };
    }
  }

  return sanitizeBodyForLog(value);
}

export function createVideoTraceContext(params: {
  prefix: string;
  source: string;
  operation: string;
  debugBody?: boolean;
}): VideoGenerationTraceContext {
  return {
    traceId: createAITraceId(params.prefix),
    source: params.source,
    operation: params.operation,
    debugBody: params.debugBody,
  };
}

export function withVideoTrace<TAsset, TOptions>(
  request: ITVRequest<TAsset, TOptions>,
  trace: VideoGenerationTraceContext,
): ITVRequestWithTrace<TAsset, TOptions> {
  return {
    ...request,
    __komaTrace: trace,
  };
}

export function readVideoTraceContext(
  request: ITVRequest<unknown, unknown>,
): VideoGenerationTraceContext | undefined {
  const candidate = (request as ITVRequestWithTrace<unknown, unknown>).__komaTrace;
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  if (typeof candidate.traceId !== 'string' || !candidate.traceId.trim()) {
    return undefined;
  }
  return candidate;
}

export function summarizeVideoRequestForLog<TAsset, TOptions>(
  request: ITVRequest<TAsset, TOptions>,
): Record<string, unknown> {
  const base = {
    capability: request.capability,
    prompt: truncateString(String(request.prompt || ''), 800),
    options: request.options ? sanitizeBodyForLog(request.options) : undefined,
  } satisfies Record<string, unknown>;

  if (isImageToVideoRequest(request)) {
    return {
      ...base,
      primaryImage: summarizeAssetForLog(request.primaryImage),
      additionalReferences: (request.additionalReferences || []).map(summarizeAssetForLog),
      visualInputCount: 1 + (request.additionalReferences || []).length,
    };
  }

  if (isReferenceToVideoRequest(request)) {
    return {
      ...base,
      referenceImages: request.referenceImages.map(summarizeAssetForLog),
      visualInputCount: request.referenceImages.length,
    };
  }

  if (isStartEndToVideoRequest(request)) {
    return {
      ...base,
      startFrame: summarizeAssetForLog(request.startFrame),
      endFrame: summarizeAssetForLog(request.endFrame),
      visualInputCount: 2,
    };
  }

  return {
    ...base,
    visualInputCount: 0,
  };
}
