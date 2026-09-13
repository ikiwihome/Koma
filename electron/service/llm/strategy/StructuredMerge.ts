import type { LLMTaskKind } from '../types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mergeArrays(left: unknown[], right: unknown[]): unknown[] {
  return [...left, ...right];
}

function mergeObjects(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...left };

  for (const [key, rightValue] of Object.entries(right)) {
    const leftValue = merged[key];

    if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
      merged[key] = mergeArrays(leftValue, rightValue);
      continue;
    }

    if (isPlainObject(leftValue) && isPlainObject(rightValue)) {
      merged[key] = mergeObjects(leftValue, rightValue);
      continue;
    }

    if (leftValue === undefined || leftValue === null || leftValue === '') {
      merged[key] = rightValue;
      continue;
    }

    if (rightValue !== undefined && rightValue !== null && rightValue !== '') {
      merged[key] = rightValue;
    }
  }

  return merged;
}

export function mergeChunkResults(taskKind: LLMTaskKind, parts: string[]): { content: string; merged: boolean } {
  const supportsStructuredMerge = taskKind === 'structured' || taskKind === 'extract' || taskKind === 'analyze';
  if (!supportsStructuredMerge || parts.length <= 1) {
    return { content: parts.join('\n\n'), merged: false };
  }

  const parsedParts = parts.map(tryParseJson);
  if (parsedParts.some((item) => item === null)) {
    return { content: parts.join('\n\n'), merged: false };
  }

  let current = parsedParts[0] as unknown;
  for (let index = 1; index < parsedParts.length; index++) {
    const next = parsedParts[index] as unknown;
    if (Array.isArray(current) && Array.isArray(next)) {
      current = mergeArrays(current, next);
      continue;
    }
    if (isPlainObject(current) && isPlainObject(next)) {
      current = mergeObjects(current, next);
      continue;
    }
    return { content: parts.join('\n\n'), merged: false };
  }

  return {
    content: JSON.stringify(current, null, 2),
    merged: true,
  };
}
