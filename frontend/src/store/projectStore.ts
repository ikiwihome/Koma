/**
 * 项目存储
 * 管理项目数据、时间线、素材、分镜版本
 *
 * 注意：此文件已重构为重新导出 project 模块
 * 实际实现已迁移到 store/project/ 目录
 */

// 统一使用静态导出
export {
  // 核心
  listProjects,
  loadProject,
  saveProject,
  getProjectsRoot,
  getProjectPath,
  createProject,
  updateProjectLLMConfig,
  deleteProject,
  // 时间线
  loadTimeline,
  saveTimeline,
  // 素材管理
  importAsset,
  loadAssets,
  findDuplicateAsset,
  incrementAssetRef,
  decrementAssetRef,
  getUnusedAssets,
  cleanUnusedAssets,
  // 分镜版本
  saveShotVersion,
  loadShotMeta,
  listShots,
  getShotVersionHistory,
  // 剧集管理
  createEpisode,
  loadEpisode,
  saveEpisode,
  deleteEpisode,
  listEpisodes,
  // 剧集解析结果
  saveEpisodeAnalysis,
  loadEpisodeAnalysis,
  loadEpisodeShots,
  saveEpisodeShots,
  loadEpisodeTimeline,
  saveEpisodeTimeline,
  updateShot,
  removeAssetFromAnalysis,
  deleteEpisodeAnalysis,
  // 角色/场景/道具存储
  saveCharacterCostumePhoto,
  saveCharacterPreviewVideo,
  saveSceneImage,
  savePropImage,
  loadProps,
  saveProps,
  switchShotVersion,
  deleteShotVersion,
  // 实体加载/保存
  loadCharacters,
  saveCharacters,
  loadScenes,
  saveScenes,
  loadShots,
  saveShots,
  // 资产引用
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
  // 缓存管理
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
  // 临时文件
  createTempFile,
  cleanAllTempOnStartup,
  // Manju-DSL
  saveProjectAsManju,
  loadProjectFromManju,
  exportProjectToManjuFile,
  importProjectFromManjuFile,
} from './project';

// 重新导出类型
export type { CacheStats, ManjuProject } from './project';
