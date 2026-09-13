/**
 * 项目服务 - SQLite 存储
 */
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import extract from 'extract-zip';
import {
  baseDB,
  SqliteProjectRepository,
  SqliteCharacterRepository,
  SqliteSceneRepository,
  SqlitePropRepository,
  SqliteShotRepository,
  SqliteAssetRepository,
  SqliteEpisodeRepository,
  SqliteTimelineRepository,
} from './storage';
import type {
  IProjectRepository,
  ICharacterRepository,
  ISceneRepository,
  IPropRepository,
  IShotRepository,
  IAssetRepository,
  IEpisodeRepository,
  ITimelineRepository,
  EpisodeRow,
  ProjectRow,
  ShotRow,
  TimelineData,
  TimelineRow,
} from './storage';
import { prepareTimelineForStorage } from './storage/timelineNormalization';
import {
  assetRowToAsset,
  buildEpisodeAnalysis,
  buildShotMeta,
  characterRowToEntity,
  characterToRow,
  episodeRowToEntity,
  propRowToEntity,
  propToRow,
  sceneRowToEntity,
  sceneToRow,
  serializeShotIdsCsv,
  shotRowToEntity,
  shotToRow,
  shotVersionRowToEntity,
  storedMediaAssetToShotEntry,
  storedMediaAssetToShotVersionEntry,
  type EntityEpisodeRefRow,
  type ShotMediaEntryRow,
  type ShotRelationRow,
  type ShotVersionMediaEntryRow,
} from './storage/projectPersistenceHelpers';
import type { MediaOwnerRef, StoredMediaAsset } from '../../frontend/src/types';

// ========== 兼容类型导出（保持 IPC 接口不变） ==========

export interface ProjectStyleSnapshot {
  id: string;
  name: string;
  description: string;
  ttiStylePrefix: string;
  llmPromptSuffix: string;
  sourceType: 'builtin' | 'custom';
  sourcePresetId: string;
  createdAt: number;
}

export interface MediaModelSelection {
  channelId: string;
  modelId: string;
}

export interface ProjectMeta {
  id: string;
  title: string;
  genre: string;
  mode: 'drama' | 'narration';
  status?: 'script' | 'storyboard' | 'generating' | 'completed';
  thumbnail?: string;
  episodes?: number;
  createdAt: number;
  updatedAt: number;
  mediaSelections?: Partial<Record<'llm' | 'tti' | 'itv' | 'tts', MediaModelSelection>>;
  stylePresetId?: string;
  styleSnapshot?: ProjectStyleSnapshot;
  theme?: string;
  stylePrompt?: string;
  aspectRatio?: '16:9' | '9:16';
  // 项目级 extras（落 projects.metadata_json，统一打包）。前后端类型保持一致。
  ttsVoiceId?: string;
  ttsSpeed?: number;
  videoPromptDurationSelections?: { multiRef?: number[]; firstFrame?: number[] };
}

export interface ProjectsIndex {
  version: number;
  projects: ProjectMeta[];
}

export interface ExportOptions {
  excludeCache?: boolean;
  excludeTemp?: boolean;
}

// ========== Row ↔ Meta 转换 ==========

/**
 * 项目元数据里那些不适合开列的小字段（ttsVoiceId / ttsSpeed / videoPromptDurationSelections）
 * 统一打包到 projects.metadata_json TEXT 列。新增小字段时改这里 + ProjectMeta 类型即可。
 */
function buildMetaJsonPayload(meta: Partial<ProjectMeta>): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};
  if (meta.ttsVoiceId !== undefined) payload.ttsVoiceId = meta.ttsVoiceId;
  if (meta.ttsSpeed !== undefined) payload.ttsSpeed = meta.ttsSpeed;
  if (meta.videoPromptDurationSelections !== undefined) {
    payload.videoPromptDurationSelections = meta.videoPromptDurationSelections;
  }
  return Object.keys(payload).length ? payload : undefined;
}

function rowToMeta(row: ProjectRow): ProjectMeta {
  const extras = row.metadata_json ? safeParseJson(row.metadata_json) : null;
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    mode: row.mode as 'drama' | 'narration',
    status: (row.status as ProjectMeta['status']) ?? 'script',
    thumbnail: row.thumbnail ?? undefined,
    episodes: row.episodes ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mediaSelections: row.media_selections_json ? JSON.parse(row.media_selections_json) : undefined,
    stylePresetId: row.style_preset_id ?? undefined,
    styleSnapshot: row.style_snapshot_json ? JSON.parse(row.style_snapshot_json) : undefined,
    theme: row.theme ?? undefined,
    stylePrompt: row.style_prompt ?? undefined,
    aspectRatio: (row.aspect_ratio as ProjectMeta['aspectRatio']) ?? '16:9',
    ttsVoiceId: typeof extras?.ttsVoiceId === 'string' ? extras.ttsVoiceId : undefined,
    ttsSpeed: typeof extras?.ttsSpeed === 'number' ? extras.ttsSpeed : undefined,
    videoPromptDurationSelections: extras?.videoPromptDurationSelections as ProjectMeta['videoPromptDurationSelections'],
  };
}

function safeParseJson(raw: string): Record<string, any> | null {
  try { return JSON.parse(raw); } catch { return null; }
}

function metaToRow(meta: ProjectMeta): Omit<ProjectRow, 'episodes'> {
  const metaJson = buildMetaJsonPayload(meta);
  return {
    id: meta.id,
    title: meta.title,
    genre: meta.genre,
    mode: meta.mode,
    status: meta.status ?? 'script',
    thumbnail: meta.thumbnail,
    theme: meta.theme,
    style_prompt: meta.stylePrompt,
    style_preset_id: meta.stylePresetId,
    style_snapshot_json: meta.styleSnapshot ? JSON.stringify(meta.styleSnapshot) : undefined,
    media_selections_json: meta.mediaSelections ? JSON.stringify(meta.mediaSelections) : undefined,
    metadata_json: metaJson ? JSON.stringify(metaJson) : undefined,
    aspect_ratio: meta.aspectRatio ?? '16:9',
    created_at: meta.createdAt,
    updated_at: meta.updatedAt,
  };
}

function metaToUpdateRow(updates: Partial<ProjectMeta>): Partial<ProjectRow> {
  const row: Partial<ProjectRow> = {};
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.genre !== undefined) row.genre = updates.genre;
  if (updates.mode !== undefined) row.mode = updates.mode;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.thumbnail !== undefined) row.thumbnail = updates.thumbnail;
  if (updates.theme !== undefined) row.theme = updates.theme;
  if (updates.stylePrompt !== undefined) row.style_prompt = updates.stylePrompt;
  if (updates.stylePresetId !== undefined) row.style_preset_id = updates.stylePresetId;
  if (updates.styleSnapshot !== undefined) row.style_snapshot_json = JSON.stringify(updates.styleSnapshot);
  if (updates.mediaSelections !== undefined) row.media_selections_json = JSON.stringify(updates.mediaSelections);
  if (updates.aspectRatio !== undefined) row.aspect_ratio = updates.aspectRatio;
  // metadata_json 字段：任一项目级 extra 改了，就把整体重新打包写入（保持单字段更新语义）
  if (
    updates.ttsVoiceId !== undefined
    || updates.ttsSpeed !== undefined
    || updates.videoPromptDurationSelections !== undefined
  ) {
    const payload = buildMetaJsonPayload(updates);
    row.metadata_json = payload ? JSON.stringify(payload) : null as any;
  }
  row.updated_at = Date.now();
  return row;
}

type BindableOwnerSlot =
  | 'costumePhoto'
  | 'previewImage'
  | 'previewVideo'
  | 'referenceImage'
  | 'image'
  | 'video'
  | 'audio';

function normalizeOwnerSlot(slot: MediaOwnerRef['slot']): BindableOwnerSlot | undefined {
  switch (slot) {
    case 'costumePhoto':
    case 'previewImage':
    case 'previewVideo':
    case 'referenceImage':
    case 'image':
    case 'video':
    case 'audio':
      return slot;
    case 'gridImage':
      return 'image';
    default:
      return undefined;
  }
}

function buildStoredAssetIdentity(asset: StoredMediaAsset): string {
  return [
    asset.providerTaskId,
    asset.localPath,
    asset.remoteUrl,
    asset.createdAt,
  ].filter(Boolean).join('|');
}

function appendUniqueStoredAsset(
  list: StoredMediaAsset[] | undefined,
  asset: StoredMediaAsset,
): StoredMediaAsset[] {
  const nextList = Array.isArray(list) ? [...list] : [];
  const incomingKey = buildStoredAssetIdentity(asset);
  if (!incomingKey) return [...nextList, asset];
  if (nextList.some(item => buildStoredAssetIdentity(item) === incomingKey)) {
    return nextList;
  }
  nextList.push(asset);
  return nextList;
}

function trimUrlTail(candidate: string): string {
  let value = String(candidate || '').trim();
  for (let i = 0; i < 10; i += 1) {
    const before = value;
    value = value.replace(/[)"'<>.,;\]]+$/g, '');
    value = value.replace(/(%22|%27|%3E|%3C)+$/gi, '');
    if (value === before) break;
  }
  return value;
}

function rewriteTimelineObject(
  timeline: TimelineData,
  fromRemoteUrl: string,
  toLocalPath: string,
): boolean {
  const from = trimUrlTail(fromRemoteUrl);
  let changed = false;
  for (const track of timeline.tracks || []) {
    for (const clip of track.clips || []) {
      if (typeof clip.src !== 'string') continue;
      const normalizedSrc = trimUrlTail(clip.src);
      if (normalizedSrc !== clip.src) {
        clip.src = normalizedSrc;
        changed = true;
      }
      if (normalizedSrc === from) {
        clip.src = toLocalPath;
        changed = true;
      }
    }
  }
  return changed;
}

// ========== ProjectService ==========

export class ProjectService {
  private storageRoot: string = '';
  projectRepo!: IProjectRepository;
  characterRepo!: ICharacterRepository;
  sceneRepo!: ISceneRepository;
  propRepo!: IPropRepository;
  shotRepo!: IShotRepository;
  assetRepo!: IAssetRepository;
  episodeRepo!: IEpisodeRepository;
  timelineRepo!: ITimelineRepository;

  async init(rootPath: string): Promise<string> {
    this.storageRoot = rootPath;

    // 确保目录存在
    await fs.promises.mkdir(this.storageRoot, { recursive: true });
    await fs.promises.mkdir(path.join(this.storageRoot, 'projects'), { recursive: true });

    // 初始化数据库
    baseDB.init(this.storageRoot);
    const db = baseDB.getDb();

    // 初始化所有 Repository
    this.projectRepo = new SqliteProjectRepository(db);
    this.characterRepo = new SqliteCharacterRepository(db);
    this.sceneRepo = new SqliteSceneRepository(db);
    this.propRepo = new SqlitePropRepository(db);
    this.shotRepo = new SqliteShotRepository(db);
    this.assetRepo = new SqliteAssetRepository(db);
    this.episodeRepo = new SqliteEpisodeRepository(db);
    this.timelineRepo = new SqliteTimelineRepository(db);

    return this.storageRoot;
  }

  async setStorageRoot(rootPath: string): Promise<string> {
    if (rootPath === this.storageRoot) {
      return this.storageRoot;
    }
    return this.init(rootPath);
  }

  getStorageRoot(): string {
    return this.storageRoot;
  }

  private getDb() {
    return baseDB.getDb();
  }

  private listEntityEpisodeRefs(
    entityType: EntityEpisodeRefRow['entity_type'],
    entityIds?: string[],
    episodeId?: string,
  ): EntityEpisodeRefRow[] {
    const db = this.getDb();
    if (episodeId) {
      return db.prepare(
        'SELECT * FROM entity_episode_refs WHERE entity_type = ? AND episode_id = ? ORDER BY sort_order'
      ).all(entityType, episodeId) as EntityEpisodeRefRow[];
    }
    if (!entityIds?.length) return [];
    const placeholders = entityIds.map(() => '?').join(',');
    return db.prepare(
      `SELECT * FROM entity_episode_refs WHERE entity_type = ? AND entity_id IN (${placeholders}) ORDER BY sort_order`
    ).all(entityType, ...entityIds) as EntityEpisodeRefRow[];
  }

  private replaceEntityEpisodeRefs(
    entityType: EntityEpisodeRefRow['entity_type'],
    entityId: string,
    refs?: Array<{
      episodeId: string;
      episodeName: string;
      firstAppearance: boolean;
      shotIds?: string[];
    }>,
  ): void {
    const db = this.getDb();
    db.prepare('DELETE FROM entity_episode_refs WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
    if (!refs?.length) return;
    const insert = db.prepare(`
      INSERT INTO entity_episode_refs (
        entity_type, entity_id, episode_id, episode_name, first_appearance, shot_ids_csv, sort_order
      ) VALUES (
        @entity_type, @entity_id, @episode_id, @episode_name, @first_appearance, @shot_ids_csv, @sort_order
      )
    `);
    refs.forEach((ref, index) => {
      insert.run({
        entity_type: entityType,
        entity_id: entityId,
        episode_id: ref.episodeId,
        episode_name: ref.episodeName,
        first_appearance: ref.firstAppearance ? 1 : 0,
        shot_ids_csv: serializeShotIdsCsv(ref.shotIds),
        sort_order: index,
      });
    });
  }

  private replaceShotRelations(
    table: 'shot_characters' | 'shot_scenes' | 'shot_props',
    shotId: string,
    entityIds: string[] | undefined,
  ): void {
    const db = this.getDb();
    db.prepare(`DELETE FROM ${table} WHERE shot_id = ?`).run(shotId);
    if (!entityIds?.length) return;
    const key = table === 'shot_characters' ? 'character_id' : table === 'shot_scenes' ? 'scene_id' : 'prop_id';
    const seen = new Set<string>();
    const uniqueIds: string[] = [];
    for (const id of entityIds) {
      if (typeof id !== 'string' || !id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      uniqueIds.push(id);
    }
    if (!uniqueIds.length) return;
    const insert = db.prepare(
      `INSERT INTO ${table} (shot_id, ${key}, sort_order) VALUES (@shot_id, @entity_id, @sort_order)`
    );
    uniqueIds.forEach((entityId, index) => {
      insert.run({ shot_id: shotId, entity_id: entityId, sort_order: index });
    });
  }

  private listShotRelations(
    table: 'shot_characters' | 'shot_scenes' | 'shot_props',
    shotIds: string[],
  ): Map<string, ShotRelationRow[]> {
    const map = new Map<string, ShotRelationRow[]>();
    if (!shotIds.length) return map;
    const db = this.getDb();
    const key = table === 'shot_characters' ? 'character_id' : table === 'shot_scenes' ? 'scene_id' : 'prop_id';
    const placeholders = shotIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT shot_id, ${key} as entity_id, sort_order FROM ${table} WHERE shot_id IN (${placeholders}) ORDER BY sort_order`
    ).all(...shotIds) as ShotRelationRow[];
    rows.forEach(row => {
      const existing = map.get(row.shot_id) || [];
      existing.push(row);
      map.set(row.shot_id, existing);
    });
    return map;
  }

  private replaceShotMediaEntries(shotId: string, shot: any): void {
    const db = this.getDb();
    db.prepare('DELETE FROM shot_media_entries WHERE shot_id = ?').run(shotId);
    const entries: ShotMediaEntryRow[] = [];
    (shot.media?.references || []).forEach((asset: any, index: number) => {
      entries.push(storedMediaAssetToShotEntry(shotId, 'reference', asset, index));
    });
    (shot.media?.images || []).forEach((asset: any, index: number) => {
      entries.push(storedMediaAssetToShotEntry(shotId, 'image', asset, index));
    });
    (shot.media?.videos || []).forEach((asset: any, index: number) => {
      entries.push(storedMediaAssetToShotEntry(shotId, 'video', asset, index));
    });
    (shot.media?.audios || []).forEach((asset: any, index: number) => {
      entries.push(storedMediaAssetToShotEntry(shotId, 'audio', asset, index));
    });
    if (!entries.length) return;
    const insert = db.prepare(`
      INSERT INTO shot_media_entries (
        id, shot_id, slot, local_path, remote_url, mime_type, width, height, duration_ms, fps,
        provider, provider_task_id, channel_id, model_id, capability, thumbnail_path, prompt_text,
        seed, model_name, aspect_ratio, created_at, sort_order
      ) VALUES (
        @id, @shot_id, @slot, @local_path, @remote_url, @mime_type, @width, @height, @duration_ms, @fps,
        @provider, @provider_task_id, @channel_id, @model_id, @capability, @thumbnail_path, @prompt_text,
        @seed, @model_name, @aspect_ratio, @created_at, @sort_order
      )
    `);
    entries.forEach(entry => insert.run(entry));
  }

  private listShotMediaEntries(shotIds: string[]): Map<string, ShotMediaEntryRow[]> {
    const map = new Map<string, ShotMediaEntryRow[]>();
    if (!shotIds.length) return map;
    const db = this.getDb();
    const placeholders = shotIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM shot_media_entries WHERE shot_id IN (${placeholders}) ORDER BY slot, sort_order`
    ).all(...shotIds) as ShotMediaEntryRow[];
    rows.forEach(row => {
      const existing = map.get(row.shot_id) || [];
      existing.push(row);
      map.set(row.shot_id, existing);
    });
    return map;
  }

  private replaceShotVersionMediaEntries(versionId: string, media?: Record<string, any>): void {
    const db = this.getDb();
    db.prepare('DELETE FROM shot_version_media_entries WHERE shot_version_id = ?').run(versionId);
    if (!media) return;
    const entries: ShotVersionMediaEntryRow[] = [];
    if (media.image) entries.push(storedMediaAssetToShotVersionEntry(versionId, 'image', media.image));
    if (media.video) entries.push(storedMediaAssetToShotVersionEntry(versionId, 'video', media.video));
    if (media.audio) entries.push(storedMediaAssetToShotVersionEntry(versionId, 'audio', media.audio));
    if (!entries.length) return;
    const insert = db.prepare(`
      INSERT INTO shot_version_media_entries (
        id, shot_version_id, slot, local_path, remote_url, mime_type, width, height, duration_ms, fps,
        provider, provider_task_id, channel_id, model_id, capability, thumbnail_path, aspect_ratio, created_at
      ) VALUES (
        @id, @shot_version_id, @slot, @local_path, @remote_url, @mime_type, @width, @height, @duration_ms, @fps,
        @provider, @provider_task_id, @channel_id, @model_id, @capability, @thumbnail_path, @aspect_ratio, @created_at
      )
    `);
    entries.forEach(entry => insert.run(entry));
  }

  private listShotVersionMediaEntries(versionIds: string[]): Map<string, ShotVersionMediaEntryRow[]> {
    const map = new Map<string, ShotVersionMediaEntryRow[]>();
    if (!versionIds.length) return map;
    const db = this.getDb();
    const placeholders = versionIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM shot_version_media_entries WHERE shot_version_id IN (${placeholders})`
    ).all(...versionIds) as ShotVersionMediaEntryRow[];
    rows.forEach(row => {
      const existing = map.get(row.shot_version_id) || [];
      existing.push(row);
      map.set(row.shot_version_id, existing);
    });
    return map;
  }

  private saveShotCollection(projectId: string, items: any[], episodeId?: string): void {
    const existingRows = episodeId
      ? this.shotRepo.listByEpisode(projectId, episodeId)
      : this.shotRepo.listProjectLevel(projectId);
    const existingMap = new Map(existingRows.map(row => [row.id, row]));
    const incomingIds = new Set(items.map(item => item.id).filter(Boolean));

    existingRows
      .filter(row => !incomingIds.has(row.id))
      .forEach(row => this.shotRepo.delete(row.id));

    items.forEach((shot, index) => {
      const existing = existingMap.get(shot.id);
      const nextRow = shotToRow(shot, projectId, index, episodeId);
      const payload: ShotRow = {
        ...nextRow,
        created_at: existing?.created_at ?? Date.now(),
        updated_at: Date.now(),
      };
      if (existing) {
        this.shotRepo.update(shot.id, payload);
      } else {
        this.shotRepo.create(payload);
      }
      this.replaceShotRelations('shot_characters', shot.id, shot.characters || []);
      this.replaceShotRelations('shot_scenes', shot.id, shot.scenes || []);
      this.replaceShotRelations('shot_props', shot.id, shot.props || []);
      this.replaceShotMediaEntries(shot.id, shot);
    });
  }

  private loadShotCollection(projectId: string, episodeId?: string): any[] {
    const rows = episodeId
      ? this.shotRepo.listByEpisode(projectId, episodeId)
      : this.shotRepo.listProjectLevel(projectId);
    const shotIds = rows.map(row => row.id);
    const characterRelations = this.listShotRelations('shot_characters', shotIds);
    const sceneRelations = this.listShotRelations('shot_scenes', shotIds);
    const propRelations = this.listShotRelations('shot_props', shotIds);
    const mediaEntries = this.listShotMediaEntries(shotIds);

    return rows.map(row => shotRowToEntity(
      row,
      characterRelations.get(row.id),
      sceneRelations.get(row.id),
      propRelations.get(row.id),
      mediaEntries.get(row.id),
    ));
  }

  // ========== 项目 CRUD ==========

  listProjects(): ProjectMeta[] {
    return this.projectRepo.list().map(rowToMeta);
  }

  createProject(meta: ProjectMeta): ProjectMeta {
    const row = metaToRow(meta);

    baseDB.transaction(() => {
      this.projectRepo.create(row);
      this.timelineRepo.createDefault(meta.id);
    });

    // 创建文件目录结构
    const projectDir = path.join(this.storageRoot, 'projects', meta.id);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'assets', 'images'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'assets', 'videos'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'assets', 'audio'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'assets', 'fonts'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'shots'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'cache', 'thumbnails'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'cache', 'waveforms'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'cache', 'previews'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'exports'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'temp'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'episodes'), { recursive: true });

    return meta;
  }

  updateProject(projectId: string, updates: Partial<ProjectMeta>): ProjectMeta {
    const rowUpdates = metaToUpdateRow(updates);
    this.projectRepo.update(projectId, rowUpdates);

    const updated = this.projectRepo.getById(projectId);
    if (!updated) throw new Error(`Project not found: ${projectId}`);
    return rowToMeta(updated);
  }

  async deleteProject(projectId: string): Promise<{ success: boolean }> {
    // 数据库级联删除
    this.projectRepo.delete(projectId);

    // 联动清理通用任务表（避免删除项目后 tasks 表中残留 'project:<id>' 行）
    try {
      const { taskService } = await import('./tasks/TaskService');
      taskService.removeByScope(`project:${projectId}`);
    } catch (err) {
      console.error('清理项目相关任务失败:', err);
    }

    // 删除文件目录
    const projectDir = path.join(this.storageRoot, 'projects', projectId);
    try {
      await fs.promises.rm(projectDir, { recursive: true, force: true });
    } catch (err) {
      console.error('删除项目目录失败:', err);
    }

    return { success: true };
  }

  loadProject(projectId: string): ProjectMeta {
    const row = this.projectRepo.getById(projectId);
    if (!row) throw new Error(`Project not found: ${projectId}`);
    return rowToMeta(row);
  }

  saveProject(projectId: string, data: any): { success: boolean } {
    this.updateProject(projectId, data);
    return { success: true };
  }

  deleteEpisode(episodeId: string): { success: boolean } {
    const row = this.episodeRepo.getById(episodeId);
    if (!row) {
      return { success: false };
    }

    baseDB.transaction(() => {
      this.timelineRepo.deleteEpisodeTimeline(episodeId);
      this.getDb().prepare('DELETE FROM entity_episode_refs WHERE episode_id = ?').run(episodeId);
      this.shotRepo.listByEpisode(row.project_id, episodeId).forEach(shot => this.shotRepo.delete(shot.id));
      this.episodeRepo.delete(episodeId);
    });

    return { success: true };
  }

  private rewriteTimelineSources(projectId: string, remoteUrl?: string, localPath?: string): void {
    if (!remoteUrl || !localPath) return;
    if (!/^https?:\/\//i.test(remoteUrl)) return;

    const projectTimeline = this.loadProjectTimeline(projectId);
    if (projectTimeline && rewriteTimelineObject(projectTimeline, remoteUrl, localPath)) {
      this.saveProjectTimeline(projectId, projectTimeline);
    }

    this.episodeRepo.list(projectId).forEach(episode => {
      const episodeTimeline = this.loadEpisodeTimeline(projectId, episode.id);
      if (episodeTimeline && rewriteTimelineObject(episodeTimeline, remoteUrl, localPath)) {
        this.saveEpisodeTimeline(projectId, episode.id, episodeTimeline);
      }
    });
  }

  private bindShotAssetCollection(
    projectId: string,
    ownerRef: MediaOwnerRef,
    slot: 'referenceImage' | 'image' | 'video' | 'audio',
    asset: StoredMediaAsset,
  ): void {
    const shots = ownerRef.episodeId
      ? this.loadShotCollection(projectId, ownerRef.episodeId)
      : this.loadShotCollection(projectId, undefined);
    const index = shots.findIndex(shot => shot.id === ownerRef.ownerId);
    if (index === -1) return;

    const shot = shots[index];
    const media = shot.media || {};
    if (slot === 'referenceImage') {
      const next = appendUniqueStoredAsset(media.references, asset);
      shots[index] = {
        ...shot,
        media: {
          ...media,
          references: next,
          selectedReferenceIndex: next.length - 1,
        },
      };
    } else if (slot === 'image') {
      const next = appendUniqueStoredAsset(media.images, asset);
      shots[index] = {
        ...shot,
        media: {
          ...media,
          images: next,
          currentImageIndex: next.length - 1,
        },
      };
    } else if (slot === 'video') {
      const next = appendUniqueStoredAsset(media.videos, asset);
      shots[index] = {
        ...shot,
        media: {
          ...media,
          videos: next,
          currentVideoIndex: next.length - 1,
        },
      };
    } else {
      // audio：与 images / videos 同模式 —— 多次生成保留历史，currentAudioIndex 指向最新
      const next = appendUniqueStoredAsset(media.audios, asset);
      shots[index] = {
        ...shot,
        media: {
          ...media,
          audios: next,
          currentAudioIndex: next.length - 1,
        },
      };
    }

    this.saveShotCollection(projectId, shots, ownerRef.episodeId);
  }

  private bindShotVersionMedia(
    projectId: string,
    shotId: string,
    versionId: string,
    slot: 'image' | 'video' | 'audio',
    asset: StoredMediaAsset,
  ): void {
    const meta = this.loadShotMeta(projectId, shotId);
    if (!meta) return;
    const versionNumber = Number(String(versionId).replace(/^v/i, ''));
    if (!Number.isFinite(versionNumber)) return;
    const index = Array.isArray(meta.versions)
      ? meta.versions.findIndex((version: any) => version.version === versionNumber)
      : -1;
    if (index === -1) return;

    const currentVersion = meta.versions[index];
    meta.versions[index] = {
      ...currentVersion,
      media: {
        ...(currentVersion.media || {}),
        [slot]: asset,
      },
    };

    this.saveShotMeta(projectId, shotId, meta);
  }

  bindOwnerRefMedia(
    projectId: string,
    ownerRef: MediaOwnerRef,
    asset: StoredMediaAsset,
  ): { success: boolean; error?: string } {
    return this.bindOwnerRefMediaImpl(projectId, ownerRef, asset);
  }

  private bindOwnerRefMediaImpl(
    projectId: string,
    ownerRef: MediaOwnerRef,
    asset: StoredMediaAsset,
  ): { success: boolean; error?: string } {
    if (!ownerRef || ownerRef.projectId !== projectId) {
      return { success: false, error: 'ownerRef projectId mismatch' };
    }
    const slot = normalizeOwnerSlot(ownerRef.slot);
    if (!slot) {
      return { success: false, error: `unknown slot "${String(ownerRef.slot)}"` };
    }

    try {
    if (ownerRef.ownerType === 'character') {
      if (slot !== 'costumePhoto' && slot !== 'previewVideo') {
        return { success: false };
      }
      const updates: Record<string, unknown> = { updated_at: Date.now() };
      if (slot === 'costumePhoto') {
        updates.costume_photo_local = asset.localPath ?? null;
        updates.costume_photo_remote = asset.remoteUrl ?? null;
      } else {
        updates.preview_video_local = asset.localPath ?? null;
        updates.preview_video_remote = asset.remoteUrl ?? null;
      }
      this.characterRepo.update(ownerRef.ownerId, updates as any);
    } else if (ownerRef.ownerType === 'scene') {
      if (slot !== 'previewImage') {
        return { success: false };
      }
      this.sceneRepo.update(ownerRef.ownerId, {
        preview_image_local: asset.localPath,
        preview_image_remote: asset.remoteUrl,
        updated_at: Date.now(),
      });
    } else if (ownerRef.ownerType === 'prop') {
      if (slot !== 'previewImage' && slot !== 'previewVideo') {
        return { success: false };
      }
      const updates: Record<string, unknown> = { updated_at: Date.now() };
      if (slot === 'previewImage') {
        updates.preview_image_local = asset.localPath ?? null;
        updates.preview_image_remote = asset.remoteUrl ?? null;
      } else {
        updates.preview_video_local = asset.localPath ?? null;
        updates.preview_video_remote = asset.remoteUrl ?? null;
      }
      this.propRepo.update(ownerRef.ownerId, updates as any);
    } else if (ownerRef.ownerType === 'shot') {
      if (slot !== 'referenceImage' && slot !== 'image' && slot !== 'video' && slot !== 'audio') {
        return { success: false };
      }
      baseDB.transaction(() => {
        this.bindShotAssetCollection(projectId, ownerRef, slot, asset);
      });
    } else if (ownerRef.ownerType === 'shot-version' && ownerRef.versionId) {
      if (slot !== 'image' && slot !== 'video' && slot !== 'audio') {
        return { success: false };
      }
      baseDB.transaction(() => {
        this.bindShotVersionMedia(projectId, ownerRef.ownerId, ownerRef.versionId!, slot, asset);
        if (slot === 'video') {
          this.bindShotAssetCollection(projectId, {
            ...ownerRef,
            ownerType: 'shot',
            slot: 'video',
          }, 'video', asset);
        }
      });
    } else {
      return { success: false, error: `unsupported owner ${ownerRef.ownerType}/${slot}` };
    }

    this.rewriteTimelineSources(projectId, asset.remoteUrl, asset.localPath);
    return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 把 SQLite 约束 / 迁移未跑等错误显式带回前端，避免 ee-core 吞掉异常后
      // 渲染端只能看到"媒体生成完成但回写失败"这种无信息提示。
      console.error('[ProjectService] bindOwnerRefMedia threw', {
        projectId, ownerRef, error: msg, stack: err instanceof Error ? err.stack : undefined,
      });
      return { success: false, error: msg };
    }
  }

  // ========== 批量实体操作（Electron 作为唯一业务真值） ==========

  saveAllCharacters(projectId: string, items: any[]): void {
    baseDB.transaction(() => {
      const existing = this.characterRepo.list(projectId);
      const existingIds = new Set(existing.map(row => row.id));
      const nextIds = new Set(items.map(item => item.id).filter(Boolean));
      existing.filter(row => !nextIds.has(row.id)).forEach(row => this.characterRepo.delete(row.id));

      const now = Date.now();
      items.forEach((item, index) => {
        const existingRow = existing.find(row => row.id === item.id);
        const row = characterToRow(item, projectId, index, existingRow?.created_at ?? now);
        if (existingIds.has(item.id)) {
          this.characterRepo.update(item.id, row);
        } else {
          this.characterRepo.create(row);
        }
        this.replaceEntityEpisodeRefs('character', item.id, item.episodeRefs);
      });
    });
  }

  loadAllCharacters(projectId: string): any[] {
    const rows = this.characterRepo.list(projectId);
    const refs = this.listEntityEpisodeRefs('character', rows.map(row => row.id));
    const refMap = new Map<string, EntityEpisodeRefRow[]>();
    refs.forEach(ref => {
      const existing = refMap.get(ref.entity_id) || [];
      existing.push(ref);
      refMap.set(ref.entity_id, existing);
    });
    return rows.map(row => characterRowToEntity(row, refMap.get(row.id)));
  }

  saveAllScenes(projectId: string, items: any[]): void {
    baseDB.transaction(() => {
      const existing = this.sceneRepo.list(projectId);
      const existingIds = new Set(existing.map(row => row.id));
      const nextIds = new Set(items.map(item => item.id).filter(Boolean));
      existing.filter(row => !nextIds.has(row.id)).forEach(row => this.sceneRepo.delete(row.id));

      const now = Date.now();
      items.forEach((item, index) => {
        const existingRow = existing.find(row => row.id === item.id);
        const row = sceneToRow(item, projectId, index, existingRow?.created_at ?? now);
        if (existingIds.has(item.id)) {
          this.sceneRepo.update(item.id, row);
        } else {
          this.sceneRepo.create(row);
        }
        this.replaceEntityEpisodeRefs('scene', item.id, item.episodeRefs);
      });
    });
  }

  loadAllScenes(projectId: string): any[] {
    const rows = this.sceneRepo.list(projectId);
    const refs = this.listEntityEpisodeRefs('scene', rows.map(row => row.id));
    const refMap = new Map<string, EntityEpisodeRefRow[]>();
    refs.forEach(ref => {
      const existing = refMap.get(ref.entity_id) || [];
      existing.push(ref);
      refMap.set(ref.entity_id, existing);
    });
    return rows.map(row => sceneRowToEntity(row, refMap.get(row.id)));
  }

  saveAllProps(projectId: string, items: any[]): void {
    baseDB.transaction(() => {
      const existing = this.propRepo.list(projectId);
      const existingIds = new Set(existing.map(row => row.id));
      const nextIds = new Set(items.map(item => item.id).filter(Boolean));
      existing.filter(row => !nextIds.has(row.id)).forEach(row => this.propRepo.delete(row.id));

      const now = Date.now();
      items.forEach((item, index) => {
        const existingRow = existing.find(row => row.id === item.id);
        const row = propToRow(item, projectId, index, existingRow?.created_at ?? now);
        if (existingIds.has(item.id)) {
          this.propRepo.update(item.id, row);
        } else {
          this.propRepo.create(row);
        }
        this.replaceEntityEpisodeRefs('prop', item.id, item.episodeRefs);
      });
    });
  }

  loadAllProps(projectId: string): any[] {
    const rows = this.propRepo.list(projectId);
    const refs = this.listEntityEpisodeRefs('prop', rows.map(row => row.id));
    const refMap = new Map<string, EntityEpisodeRefRow[]>();
    refs.forEach(ref => {
      const existing = refMap.get(ref.entity_id) || [];
      existing.push(ref);
      refMap.set(ref.entity_id, existing);
    });
    return rows.map(row => propRowToEntity(row, refMap.get(row.id)));
  }

  saveAllShots(projectId: string, items: any[]): void {
    baseDB.transaction(() => {
      this.saveShotCollection(projectId, items, undefined);
    });
  }

  loadAllShots(projectId: string): any[] {
    return this.loadShotCollection(projectId, undefined);
  }

  saveShotMeta(projectId: string, shotId: string, meta: any): void {
    baseDB.transaction(() => {
      const existing = this.shotRepo.getById(shotId);
      const now = Date.now();
      if (!existing) {
        this.shotRepo.create({
          id: shotId,
          project_id: projectId,
          shot_number: 0,
          description: meta.prompt || '',
          meta_prompt: meta.prompt || '',
          meta_seed: meta.seed ?? null,
          meta_model: meta.model || '',
          script_lines_json: '[]',
          current_version: meta.currentVersion ?? 0,
          sort_order: 0,
          metadata_json: undefined,
          created_at: now,
          updated_at: now,
        } as ShotRow);
      } else {
        this.shotRepo.update(shotId, {
          current_version: meta.currentVersion ?? 0,
          meta_prompt: meta.prompt || '',
          meta_seed: meta.seed ?? null,
          meta_model: meta.model || '',
          updated_at: now,
        });
      }

      const db = this.getDb();
      const existingVersions = this.shotRepo.listVersions(shotId);
      existingVersions.forEach(version => {
        db.prepare('DELETE FROM shot_version_media_entries WHERE shot_version_id = ?').run(version.id);
      });
      db.prepare('DELETE FROM shot_versions WHERE shot_id = ?').run(shotId);

      if (Array.isArray(meta.versions)) {
        meta.versions.forEach((version: any) => {
          const versionId = `${shotId}-v${version.version}`;
          this.shotRepo.createVersion({
            id: versionId,
            shot_id: shotId,
            version_number: version.version,
            image_local: version.media?.image?.localPath,
            image_remote: version.media?.image?.remoteUrl,
            video_local: version.media?.video?.localPath,
            video_remote: version.media?.video?.remoteUrl,
            audio_local: version.media?.audio?.localPath,
            audio_remote: version.media?.audio?.remoteUrl,
            prompt: version.prompt,
            seed: version.seed,
            model: version.model,
            metadata_json: undefined,
            created_at: version.createdAt || now,
          });
          this.replaceShotVersionMediaEntries(versionId, version.media);
        });
      }
    });
  }

  loadShotMeta(_projectId: string, shotId: string): any | null {
    const row = this.shotRepo.getById(shotId);
    if (!row) return null;
    const versions = this.shotRepo.listVersions(shotId);
    const versionMedia = this.listShotVersionMediaEntries(versions.map(version => version.id));
    const mappedVersions = versions.map(version => shotVersionRowToEntity(version, versionMedia.get(version.id)));
    return buildShotMeta(row, mappedVersions);
  }

  listShotMetas(projectId: string): any[] {
    const rows = this.shotRepo.list(projectId);
    const allVersions = rows.flatMap(row => this.shotRepo.listVersions(row.id));
    const versionMedia = this.listShotVersionMediaEntries(allVersions.map(version => version.id));
    return rows.map(row => {
      const versions = allVersions
        .filter(version => version.shot_id === row.id)
        .map(version => shotVersionRowToEntity(version, versionMedia.get(version.id)));
      return buildShotMeta(row, versions);
    });
  }

  saveEpisodeAnalysis(projectId: string, episodeId: string, analysis: any): void {
    baseDB.transaction(() => {
      const episode = this.episodeRepo.getById(episodeId);
      if (!analysis) {
        this.episodeRepo.update(episodeId, {
          has_analysis: 0,
          updated_at: Date.now(),
        });
        const db = this.getDb();
        db.prepare('DELETE FROM entity_episode_refs WHERE episode_id = ?').run(episodeId);
        this.shotRepo.listByEpisode(projectId, episodeId).forEach(shot => this.shotRepo.delete(shot.id));
        this.timelineRepo.deleteEpisodeTimeline(episodeId);
        return;
      }

      const hasExplicitStages = Array.isArray(analysis.completedStages);
      const completedStages = new Set(hasExplicitStages ? analysis.completedStages : []);
      const assetsCompleted = completedStages.has('characters')
        || completedStages.has('scenes')
        || completedStages.has('props');
      const storyboardCompleted = completedStages.has('shots');
      this.episodeRepo.update(episodeId, {
        has_analysis: 1,
        // 前端显式传入 completedStages（含空数组 reset 信号）时以其为准；未传字段才沿用旧值
        step_assets: assetsCompleted
          ? 'completed'
          : hasExplicitStages
            ? 'pending'
            : episode?.step_assets ?? 'pending',
        step_storyboard: storyboardCompleted
          ? 'completed'
          : hasExplicitStages
            ? 'pending'
            : episode?.step_storyboard ?? 'pending',
        updated_at: Date.now(),
      });

      const episodeName = episode?.title || `第${episode?.episode_number || ''}集`;
      this.getDb().prepare('DELETE FROM entity_episode_refs WHERE episode_id = ?').run(episodeId);

      (analysis.characterRefs || []).forEach((entityId: string, index: number) => {
        this.getDb().prepare(`
          INSERT INTO entity_episode_refs (
            entity_type, entity_id, episode_id, episode_name, first_appearance, shot_ids_csv, sort_order
          ) VALUES ('character', ?, ?, ?, 0, NULL, ?)
        `).run(entityId, episodeId, episodeName, index);
      });
      (analysis.sceneRefs || []).forEach((entityId: string, index: number) => {
        this.getDb().prepare(`
          INSERT INTO entity_episode_refs (
            entity_type, entity_id, episode_id, episode_name, first_appearance, shot_ids_csv, sort_order
          ) VALUES ('scene', ?, ?, ?, 0, NULL, ?)
        `).run(entityId, episodeId, episodeName, index);
      });
      (analysis.propRefs || []).forEach((entityId: string, index: number) => {
        this.getDb().prepare(`
          INSERT INTO entity_episode_refs (
            entity_type, entity_id, episode_id, episode_name, first_appearance, shot_ids_csv, sort_order
          ) VALUES ('prop', ?, ?, ?, 0, NULL, ?)
        `).run(entityId, episodeId, episodeName, index);
      });

      this.saveShotCollection(projectId, analysis.shots || [], episodeId);
    });
  }

  loadEpisodeAnalysis(projectId: string, episodeId: string): any | null {
    const row = this.episodeRepo.getById(episodeId);
    if (!row || !row.has_analysis) return null;
    const shots = this.loadShotCollection(projectId, episodeId);
    const refs = this.listEntityEpisodeRefs('character', undefined, episodeId);
    const sceneRefs = this.listEntityEpisodeRefs('scene', undefined, episodeId);
    const propRefs = this.listEntityEpisodeRefs('prop', undefined, episodeId);
    return buildEpisodeAnalysis(episodeId, shots, {
      characters: refs,
      scenes: sceneRefs,
      props: propRefs,
    }, row);
  }

  private normalizeTimelinePayload(timeline: any): TimelineData {
    const candidate = timeline && typeof timeline === 'object' ? timeline : { tracks: [] };
    return prepareTimelineForStorage(candidate as any);
  }

  private parseJsonSafely(raw?: string | null): any | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private extractLegacyEpisodeTimeline(row?: EpisodeRow): {
    timeline: TimelineData | null;
    remainingMetadataJson: string | null;
  } {
    const parsed = this.parseJsonSafely(row?.metadata_json);
    if (!parsed || typeof parsed !== 'object' || !('timeline' in parsed)) {
      return {
        timeline: null,
        remainingMetadataJson: row?.metadata_json ?? null,
      };
    }

    const { timeline, ...rest } = parsed as Record<string, unknown>;
    return {
      timeline: timeline ? this.normalizeTimelinePayload(timeline) : null,
      remainingMetadataJson: Object.keys(rest).length ? JSON.stringify(rest) : null,
    };
  }

  private hydrateLegacyProjectTimeline(projectId: string): TimelineData | null {
    const row = this.getDb().prepare(`
      SELECT * FROM timelines
      WHERE project_id = ? AND (scope_type = 'project' OR scope_type IS NULL)
      ORDER BY created_at
      LIMIT 1
    `).get(projectId) as TimelineRow | undefined;

    const parsed = this.parseJsonSafely(row?.metadata_json);
    if (!parsed || typeof parsed !== 'object') return null;

    const normalized = this.normalizeTimelinePayload(parsed);
    this.timelineRepo.saveProjectTimeline(projectId, normalized);
    return normalized;
  }

  private hydrateLegacyEpisodeTimeline(projectId: string, episodeId: string): TimelineData | null {
    const row = this.episodeRepo.getById(episodeId);
    const { timeline, remainingMetadataJson } = this.extractLegacyEpisodeTimeline(row);
    if (!timeline) return null;

    this.timelineRepo.saveEpisodeTimeline(projectId, episodeId, timeline);
    this.episodeRepo.update(episodeId, {
      metadata_json: remainingMetadataJson ?? undefined,
      updated_at: Date.now(),
    });
    return timeline;
  }

  saveEpisodeTimeline(projectId: string, episodeId: string, timeline: any): void {
    const normalized = this.normalizeTimelinePayload(timeline);
    this.timelineRepo.saveEpisodeTimeline(projectId, episodeId, normalized);
    this.episodeRepo.update(episodeId, {
      metadata_json: undefined,
      updated_at: normalized.updatedAt,
    });
  }

  loadEpisodeTimeline(projectId: string, episodeId: string): TimelineData | null {
    return this.timelineRepo.getEpisodeTimeline(projectId, episodeId)
      ?? this.hydrateLegacyEpisodeTimeline(projectId, episodeId);
  }

  saveProjectTimeline(projectId: string, timeline: any): void {
    const normalized = this.normalizeTimelinePayload(timeline);
    this.timelineRepo.saveProjectTimeline(projectId, normalized);
  }

  loadProjectTimeline(projectId: string): TimelineData | null {
    return this.timelineRepo.getProjectTimeline(projectId)
      ?? this.hydrateLegacyProjectTimeline(projectId);
  }

  // ========== 关联数据查询 ==========

  loadProjectFull(projectId: string): {
    meta: ProjectMeta;
    characters: any[];
    scenes: any[];
    props: any[];
    shots: any[];
    shotMetas: any[];
    assets: any[];
    episodes: any[];
    episodeAnalyses: Record<string, any>;
    episodeTimelines: Record<string, TimelineData>;
    timeline: TimelineData | undefined;
  } {
    const meta = this.loadProject(projectId);
    const characters = this.loadAllCharacters(projectId);
    const scenes = this.loadAllScenes(projectId);
    const props = this.loadAllProps(projectId);
    const shots = this.loadAllShots(projectId);
    const shotMetas = this.listShotMetas(projectId);
    const assets = this.assetRepo.list(projectId).map(assetRowToAsset);
    const episodeRows = this.episodeRepo.list(projectId);
    const episodes = episodeRows.map(episodeRowToEntity);
    const episodeAnalyses = Object.fromEntries(
      episodes
        .filter(episode => episode.hasAnalysis)
        .map(episode => [episode.id, this.loadEpisodeAnalysis(projectId, episode.id)])
    );
    const episodeTimelines = Object.fromEntries(
      episodes
        .map(episode => [episode.id, this.loadEpisodeTimeline(projectId, episode.id)] as const)
        .filter((entry): entry is [string, TimelineData] => Boolean(entry[1]))
    );
    const timeline = this.loadProjectTimeline(projectId) ?? undefined;

    return {
      meta,
      characters,
      scenes,
      props,
      shots,
      shotMetas,
      assets,
      episodes,
      episodeAnalyses,
      episodeTimelines,
      timeline,
    };
  }

  // ========== 重建索引（兼容接口，现在直接查库） ==========

  rebuildIndex(): ProjectsIndex {
    const projects = this.listProjects();
    return { version: 1, projects };
  }

  // ========== 导入导出 ==========

  async exportProject(
    projectId: string,
    destPath: string,
    options: ExportOptions = {}
  ): Promise<{ success: boolean; path: string }> {
    const projectDir = path.join(this.storageRoot, 'projects', projectId);
    const { excludeCache = true, excludeTemp = true } = options;

    // 从数据库导出 JSON 数据到临时文件
    const fullData = this.loadProjectFull(projectId);
    const exportDataPath = path.join(projectDir, '_export_data.json');
    await fs.promises.writeFile(exportDataPath, JSON.stringify(fullData, null, 2));

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', async () => {
        // 清理临时导出文件
        try { await fs.promises.unlink(exportDataPath); } catch {}
        resolve({ success: true, path: destPath });
      });

      archive.on('error', (err: Error) => reject(err));
      archive.pipe(output);

      archive.glob('**/*', {
        cwd: projectDir,
        ignore: [
          ...(excludeCache ? ['cache/**'] : []),
          ...(excludeTemp ? ['temp/**'] : []),
        ],
      });

      archive.finalize();
    });
  }

  async importProject(
    zipPath: string,
    newProjectId?: string
  ): Promise<{ success: boolean; projectId: string; meta: ProjectMeta }> {
    const tempDir = path.join(this.storageRoot, 'temp_import_' + Date.now());

    try {
      await extract(zipPath, { dir: tempDir });

      // 尝试读取导出数据
      const exportDataPath = path.join(tempDir, '_export_data.json');
      let importData: any;

      if (fs.existsSync(exportDataPath)) {
        importData = JSON.parse(await fs.promises.readFile(exportDataPath, 'utf-8'));
      } else {
        // 兼容旧格式：读取 meta.json
        const metaPath = path.join(tempDir, 'meta.json');
        if (!fs.existsSync(metaPath)) throw new Error('Invalid project package');
        const metaContent = await fs.promises.readFile(metaPath, 'utf-8');
        importData = { meta: JSON.parse(metaContent) };
      }

      const originalMeta = importData.meta as ProjectMeta;
      const projectId = newProjectId || `${originalMeta.id}_imported_${Date.now()}`;

      const meta: ProjectMeta = {
        ...originalMeta,
        id: projectId,
        updatedAt: Date.now(),
      };

      this.createProject(meta);

      if (Array.isArray(importData.characters)) {
        this.saveAllCharacters(projectId, importData.characters);
      }
      if (Array.isArray(importData.scenes)) {
        this.saveAllScenes(projectId, importData.scenes);
      }
      if (Array.isArray(importData.props)) {
        this.saveAllProps(projectId, importData.props);
      }
      if (Array.isArray(importData.shots)) {
        this.saveAllShots(projectId, importData.shots);
      }
      if (Array.isArray(importData.shotMetas)) {
        for (const shotMeta of importData.shotMetas) {
          this.saveShotMeta(projectId, shotMeta.id, shotMeta);
        }
      }
      if (Array.isArray(importData.assets)) {
        for (const asset of importData.assets) {
          const durationMs = typeof asset.duration === 'number'
            ? Math.round(asset.duration * 1000)
            : asset.duration_ms;
          this.assetRepo.create({
            id: asset.id,
            project_id: projectId,
            kind: asset.type || asset.kind,
            name: asset.name,
            local_path: asset.path || asset.local_path,
            remote_url: asset.remote_url,
            thumbnail_path: asset.thumbnailPath || asset.thumbnail_path,
            duration_ms: durationMs,
            file_size: asset.size || asset.file_size,
            width: asset.width,
            height: asset.height,
            fingerprint: asset.md5 || asset.fingerprint,
            ref_count: asset.refCount || asset.ref_count || 0,
            metadata_json: undefined,
            created_at: asset.createdAt || asset.created_at || Date.now(),
          });
        }
      }
      if (Array.isArray(importData.episodes)) {
        const db = this.getDb();
        baseDB.transaction(() => {
          db.prepare('DELETE FROM episodes WHERE project_id = ?').run(projectId);
          importData.episodes.forEach((episode: any) => {
            const row = 'episode_number' in episode
              ? {
                  ...episode,
                  project_id: projectId,
                }
              : {
                  id: episode.id,
                  project_id: projectId,
                  episode_number: episode.number,
                  title: episode.title,
                  script_text: episode.scriptText,
                  status: episode.status,
                  step_assets: episode.stepProgress?.assets || 'pending',
                  step_storyboard: episode.stepProgress?.storyboard || 'pending',
                  step_video: episode.stepProgress?.video || 'pending',
                  has_analysis: episode.hasAnalysis ? 1 : 0,
                  created_at: episode.createdAt || Date.now(),
                  updated_at: episode.updatedAt || Date.now(),
                };
            this.episodeRepo.create(row);
          });
        });
      }
      if (importData.episodeAnalyses && typeof importData.episodeAnalyses === 'object') {
        for (const [episodeId, analysis] of Object.entries(importData.episodeAnalyses)) {
          if (analysis) {
            this.saveEpisodeAnalysis(projectId, episodeId, analysis);
          }
        }
      } else if (Array.isArray(importData.episodes)) {
        for (const episode of importData.episodes) {
          const analysis = episode.analysis || episode.analysis_json;
          if (analysis) {
            this.saveEpisodeAnalysis(
              projectId,
              episode.id,
              typeof analysis === 'string' ? JSON.parse(analysis) : analysis,
            );
          }
        }
      }
      if (importData.episodeTimelines && typeof importData.episodeTimelines === 'object') {
        for (const [episodeId, timeline] of Object.entries(importData.episodeTimelines)) {
          if (timeline) {
            this.saveEpisodeTimeline(projectId, episodeId, timeline);
          }
        }
      } else if (Array.isArray(importData.episodes)) {
        for (const episode of importData.episodes) {
          const { timeline } = this.extractLegacyEpisodeTimeline({
            id: episode.id,
            project_id: projectId,
            episode_number: episode.number ?? episode.episode_number ?? 0,
            metadata_json: episode.metadata_json,
            created_at: episode.createdAt || episode.created_at || Date.now(),
            updated_at: episode.updatedAt || episode.updated_at || Date.now(),
          } as EpisodeRow);
          if (timeline) {
            this.saveEpisodeTimeline(projectId, episode.id, timeline);
          }
        }
      }
      if (importData.timeline) {
        this.saveProjectTimeline(projectId, importData.timeline);
      }

      // 移动文件到项目目录
      const projectDir = path.join(this.storageRoot, 'projects', projectId);
      await this.copyDir(tempDir, projectDir);

      // 确保目录结构完整
      for (const sub of [
        'cache/thumbnails', 'cache/waveforms', 'cache/previews', 'temp',
      ]) {
        await fs.promises.mkdir(path.join(projectDir, sub), { recursive: true });
      }

      // 清理
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      // 清理临时导出数据
      try { await fs.promises.unlink(path.join(projectDir, '_export_data.json')); } catch {}

      return { success: true, projectId, meta };
    } catch (err) {
      try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch {}
      throw err;
    }
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await fs.promises.mkdir(destPath, { recursive: true });
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  }
}

export const projectService = new ProjectService();
export default projectService;
