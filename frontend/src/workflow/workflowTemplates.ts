/**
 * 预定义 DAG 工作流模板
 */
import type { DAGDefinition } from './DAGExecutor';

/**
 * 完整创作流水线 DAG
 * 剧本分析 → 实体提取 / 分集拆分 → 分镜分析 → 分镜提示词 / 资产匹配 → 分镜生成
 */
export function createFullCreationDAG(projectId: string, episodeId: string): DAGDefinition {
  return {
    id: `creation-${projectId}-${episodeId}-${Date.now()}`,
    nodes: [
      { id: 'script-analysis', type: 'script-analysis', dependencies: [], status: 'pending' },
      { id: 'entity-extraction', type: 'entity-extraction', dependencies: ['script-analysis'], status: 'pending' },
      { id: 'episode-split', type: 'episode-split', dependencies: ['script-analysis'], status: 'pending' },
      { id: 'shot-analysis', type: 'shot-analysis', dependencies: ['entity-extraction', 'episode-split'], status: 'pending' },
      { id: 'shot-prompt', type: 'shot-prompt', dependencies: ['shot-analysis'], status: 'pending' },
      { id: 'asset-match', type: 'asset-match', dependencies: ['shot-analysis', 'entity-extraction'], status: 'pending' },
      { id: 'shot-generation', type: 'shot-generation', dependencies: ['shot-prompt', 'asset-match'], status: 'pending' },
    ],
    metadata: { projectId, episodeId },
  };
}

/**
 * 提示词重新生成 DAG（局部重跑）
 * 分镜分析 → 分镜提示词
 */
export function createPromptRegenerationDAG(projectId: string, episodeId: string): DAGDefinition {
  return {
    id: `prompt-regen-${projectId}-${episodeId}-${Date.now()}`,
    nodes: [
      { id: 'shot-analysis', type: 'shot-analysis', dependencies: [], status: 'pending' },
      { id: 'shot-prompt', type: 'shot-prompt', dependencies: ['shot-analysis'], status: 'pending' },
    ],
    metadata: { projectId, episodeId },
  };
}
