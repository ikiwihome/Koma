import type { LLMQueryRequest, LLMTaskKind } from '../types';
import { taskProfileRegistry } from './TaskProfileRegistry';

function asSearchableText(request: LLMQueryRequest): string {
  return [
    request.options?.operation || '',
    request.options?.source || '',
    request.messages.find(message => message.role === 'system')?.content || '',
  ].join('\n').toLowerCase();
}

export class TaskClassifier {
  classify(request: LLMQueryRequest): { taskKind: LLMTaskKind; matchedProfile: boolean; source: 'explicit' | 'profile' | 'heuristic' } {
    if (request.options?.taskKind) {
      return { taskKind: request.options.taskKind, matchedProfile: false, source: 'explicit' };
    }

    const profile = taskProfileRegistry.resolve(
      request.options?.taskProfileId,
      request.options?.operation,
      request.options?.source,
    );
    if (profile) {
      return { taskKind: profile.taskKind, matchedProfile: true, source: 'profile' };
    }

    const text = asSearchableText(request);

    if (text.includes('json') || request.options?.responseFormat === 'json_object') {
      return { taskKind: 'structured', matchedProfile: false, source: 'heuristic' };
    }
    if (text.includes('extract') || text.includes('entity') || text.includes('boundary')) {
      return { taskKind: 'extract', matchedProfile: false, source: 'heuristic' };
    }
    if (text.includes('analysis') || text.includes('analyze') || text.includes('breakdown')) {
      return { taskKind: 'analyze', matchedProfile: false, source: 'heuristic' };
    }
    if (text.includes('polish') || text.includes('rewrite') || text.includes('润色') || text.includes('改写')) {
      return { taskKind: 'rewrite', matchedProfile: false, source: 'heuristic' };
    }
    if (text.includes('script') || text.includes('generate') || text.includes('创作') || text.includes('生成')) {
      return { taskKind: 'generate', matchedProfile: false, source: 'heuristic' };
    }
    return { taskKind: 'chat', matchedProfile: false, source: 'heuristic' };
  }
}

export const taskClassifier = new TaskClassifier();
