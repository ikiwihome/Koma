/**
 * 存储层统一导出
 */
export { BaseDB, baseDB } from './BaseDB';

// Repository 接口
export type {
  IProjectRepository,
  ICharacterRepository,
  ISceneRepository,
  IPropRepository,
  IShotRepository,
  IAssetRepository,
  IEpisodeRepository,
  ITimelineRepository,
  ProjectRow,
  CharacterRow,
  SceneRow,
  PropRow,
  ShotRow,
  ShotVersionRow,
  AssetRow,
  EpisodeRow,
  TimelineRow,
  TrackRow,
  ClipRow,
  TimelineData,
} from './repositories/interfaces';

// SQLite 实现
export { SqliteProjectRepository } from './repositories/SqliteProjectRepository';
export { SqliteCharacterRepository } from './repositories/SqliteCharacterRepository';
export { SqliteSceneRepository } from './repositories/SqliteSceneRepository';
export { SqlitePropRepository } from './repositories/SqlitePropRepository';
export { SqliteShotRepository } from './repositories/SqliteShotRepository';
export { SqliteAssetRepository } from './repositories/SqliteAssetRepository';
export { SqliteEpisodeRepository } from './repositories/SqliteEpisodeRepository';
export { SqliteTimelineRepository } from './repositories/SqliteTimelineRepository';

// 全局 Settings 数据库（独立于项目级 baseDB）
export { SettingsDB, settingsDB } from './SettingsDB';
export type {
  IChannelConfigRepository,
  IMediaDefaultsRepository,
  IAppSettingsKvRepository,
  ChannelConfigRow,
  MediaDefaultRow,
  AppSettingRow,
  MediaCategory,
} from './repositories/settingsInterfaces';
export { SqliteChannelConfigRepository } from './repositories/SqliteChannelConfigRepository';
export { SqliteMediaDefaultsRepository } from './repositories/SqliteMediaDefaultsRepository';
export { SqliteAppSettingsKvRepository } from './repositories/SqliteAppSettingsKvRepository';
export { SqliteChatHistoryRepository, sqliteChatHistoryRepository } from './repositories/SqliteChatHistoryRepository';
export type { ChatSessionRow, ChatMessageRow } from './repositories/SqliteChatHistoryRepository';
export { SqliteTaskRepository, sqliteTaskRepository } from './repositories/SqliteTaskRepository';
export type { TaskRow, TaskQuery } from './repositories/SqliteTaskRepository';
