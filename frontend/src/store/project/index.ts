/**
 * Project Store 统一导出
 */

// 核心 - 使用静态导出
export type { ProjectMeta } from '../../types';
export {
  getProjectsRoot,
  getProjectPath,
  createProject,
  loadProject,
  saveProject,
  updateProjectLLMConfig,
  deleteProject,
  listProjects,
} from './core';

// 时间线
export type { TimelineData } from '../../types/editor';
export { loadTimeline, saveTimeline } from './timeline';

// 素材管理
export {
  importAsset,
  loadAssets,
  findDuplicateAsset,
  incrementAssetRef,
  decrementAssetRef,
  getUnusedAssets,
  cleanUnusedAssets,
} from './assets';

// 分镜版本
export {
  saveShotVersion,
  loadShotMeta,
  listShots,
  getShotVersionHistory,
} from './shots';

// 剧集管理
export {
  createEpisode,
  loadEpisode,
  saveEpisode,
  deleteEpisode,
  listEpisodes,
} from './episodes';

// 剧集解析结果
export {
  saveEpisodeAnalysis,
  loadEpisodeAnalysis,
  loadEpisodeShots,
  saveEpisodeShots,
  loadEpisodeTimeline,
  saveEpisodeTimeline,
  updateShot,
  removeAssetFromAnalysis,
  deleteEpisodeAnalysis,
} from './analysis';

// 角色/场景/道具存储
export {
  saveCharacterCostumePhoto,
  saveCharacterPreviewVideo,
  saveSceneImage,
  savePropImage,
  loadProps,
  saveProps,
  switchShotVersion,
  deleteShotVersion,
} from './assetStorage';

// 实体加载/保存
export {
  loadCharacters,
  saveCharacters,
  loadScenes,
  saveScenes,
  loadShots,
  saveShots,
} from './entities';

// 资产引用
export {
  calculateAssetFingerprint,
  addCharacterEpisodeRef,
  removeCharacterEpisodeRef,
  addSceneEpisodeRef,
  removeSceneEpisodeRef,
  addPropEpisodeRef,
  removePropEpisodeRef,
  findCharacterByName,
  findSceneByName,
  findPropByName,
  getOrphanedAssets,
  repairAssetEpisodeRefs,
} from './refs';

// 缓存管理
export type { CacheStats } from './cache';
export {
  getCacheStats,
  saveThumbnail,
  getThumbnail,
  saveWaveform,
  getWaveform,
  savePreviewFrame,
  getPreviewFrame,
  clearCacheByType,
  clearCache,
  clearTemp,
} from './cache';

// 临时文件
export {
  createTempFile,
  cleanAllTempOnStartup,
} from './temp';

// Manju-DSL
export {
  saveProjectAsManju,
  loadProjectFromManju,
  exportProjectToManjuFile,
  importProjectFromManjuFile,
} from './manju';
export type { ManjuProject } from '../../manju-dsl/protocol';
