import type { LLMTaskKind } from '../types';

export interface TaskProfileConfig {
  id: string;
  operation?: string;
  source?: string;
  taskKind: LLMTaskKind;
}

export const TASK_PROFILE_CONFIGS: TaskProfileConfig[] = [
  { id: 'test-connection', operation: 'testConnection', taskKind: 'chat' },
  { id: 'shot-breakdown', operation: 'breakdown', taskKind: 'structured' },
  { id: 'script-analysis', operation: 'script_analysis', taskKind: 'analyze' },
  { id: 'episode-boundary-extract', operation: 'episode-boundary-extract', taskKind: 'extract' },
  { id: 'script-polish-stream', operation: 'script_polish_stream', taskKind: 'rewrite' },
  { id: 'script-polish', operation: 'script_polish', taskKind: 'rewrite' },
  { id: 'text-node-generate', operation: 'text-node-generate', taskKind: 'generate' },
  { id: 'media-generate-video', operation: 'media.generate-video', taskKind: 'generate' },
  { id: 'query-chunk-summary', operation: 'query-chunk-summary', taskKind: 'analyze' },
  { id: 'chunk-summary', operation: 'chunk-summary', taskKind: 'analyze' },
  { id: 'shot-analysis-source', source: 'shot-analysis', taskKind: 'structured' },
  { id: 'script-generator-polish-source', source: 'scriptGenerator.polishScript', taskKind: 'rewrite' },
  { id: 'script-analysis-source', source: 'ScriptAnalysisService.callLLM', taskKind: 'analyze' },
  { id: 'story-script', source: 'story-script', taskKind: 'generate' },
  { id: 'voice-script', source: 'voice-script', taskKind: 'generate' },
  { id: 'script-node', source: 'script-node', taskKind: 'generate' },
  { id: 'shot-source', source: 'shot', taskKind: 'analyze' },
  { id: 'shot-image-1', source: 'shot-image-1', taskKind: 'generate' },
  { id: 'shot-image-2', source: 'shot-image-2', taskKind: 'generate' },
];
