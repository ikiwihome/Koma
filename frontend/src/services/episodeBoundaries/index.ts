/**
 * 集边界检测管线 — 公开导出
 */

export { detectEpisodeBoundaries } from './pipelineService';
export { buildScriptLineIndex } from './lineIndex';
export { screenRegexBoundaries, parseEpisodeMarkerLine } from './regexScreening';
export { validateCandidates } from './validateStage';

export type {
  EpisodeBoundary,
  EpisodeBoundaryCandidate,
  EpisodeBoundaryPipelineResult,
  EpisodeBoundaryPipelineConfig,
  DetectEpisodeBoundariesOptions,
  EpisodeBoundaryValidationResult,
  RegexBoundaryScreeningResult,
  ScriptLineIndex,
  ScriptLineRecord,
  EpisodeMarkerFormat,
  PipelineSource,
  LLMProvider,
  LLMCallOptions,
} from './types';

export { DEFAULT_PIPELINE_CONFIG } from './types';
