/**
 * Repository 接口定义
 * 所有数据操作通过这些接口抽象，与存储引擎解耦
 */

import type { TimelineData as EditorTimelineData } from '../../../../frontend/src/types/editor';

// ========== 数据类型 ==========

export interface ProjectRow {
  id: string;
  title: string;
  genre: string;
  mode: 'drama' | 'narration';
  status?: string;
  thumbnail?: string;
  theme?: string;
  style_prompt?: string;
  style_preset_id?: string;
  style_snapshot_json?: string;
  media_selections_json?: string;
  metadata_json?: string;
  aspect_ratio?: string;
  episodes?: number; // 计算字段
  created_at: number;
  updated_at: number;
}

export interface CharacterRow {
  id: string;
  project_id: string;
  name: string;
  role?: 'protagonist' | 'antagonist' | 'supporting';
  prompt?: string;
  description?: string;
  age?: string;
  gender?: string;
  appearance?: string;
  voice_id?: string;
  sora2_character_id?: string;
  timestamp_start?: number;
  timestamp_end?: number;
  fingerprint?: string;
  costume_photo_local?: string;
  costume_photo_remote?: string;
  preview_video_local?: string;
  preview_video_remote?: string;
  sort_order: number;
  metadata_json?: string;
  created_at: number;
  updated_at: number;
}

export interface SceneRow {
  id: string;
  project_id: string;
  name: string;
  prompt?: string;
  description?: string;
  location?: string;
  time_of_day?: 'day' | 'night' | 'twilight';
  mood?: string;
  fingerprint?: string;
  preview_image_local?: string;
  preview_image_remote?: string;
  sort_order: number;
  metadata_json?: string;
  created_at: number;
  updated_at: number;
}

export interface PropRow {
  id: string;
  project_id: string;
  name: string;
  prompt?: string;
  description?: string;
  prop_type?: string;
  sora2_prop_id?: string;
  timestamp_start?: number;
  timestamp_end?: number;
  fingerprint?: string;
  preview_image_local?: string;
  preview_image_remote?: string;
  preview_video_local?: string;
  preview_video_remote?: string;
  sort_order: number;
  metadata_json?: string;
  created_at: number;
  updated_at: number;
}

export interface ShotRow {
  id: string;
  project_id: string;
  episode_id?: string;
  shot_number?: number;
  description?: string;
  meta_prompt?: string;
  meta_seed?: number;
  meta_model?: string;
  script_lines_json: string;
  shot_type?: 'close-up' | 'medium' | 'wide' | 'extreme-wide';
  camera_movement?: 'static' | 'pan' | 'zoom-in' | 'tracking' | 'handheld';
  duration?: number;
  image_prompt?: string;
  video_prompt?: string;
  image_mode?: 'normal' | 'grid' | 'grid-9' | 'grid-4' | 'storyboard';
  dialogue?: string;
  emotion?: string;
  confirmed?: number;
  seed?: number;
  selected_reference_index?: number;
  current_image_index?: number;
  current_video_index?: number;
  current_audio_index?: number;
  current_version: number;
  sort_order: number;
  metadata_json?: string;
  created_at: number;
  updated_at: number;
}

export interface ShotVersionRow {
  id: string;
  shot_id: string;
  version_number: number;
  image_local?: string;
  image_remote?: string;
  video_local?: string;
  video_remote?: string;
  audio_local?: string;
  audio_remote?: string;
  prompt?: string;
  seed?: number;
  model?: string;
  metadata_json?: string;
  created_at: number;
}

export interface AssetRow {
  id: string;
  project_id: string;
  kind: 'image' | 'video' | 'audio';
  name?: string;
  local_path?: string;
  remote_url?: string;
  thumbnail_path?: string;
  mime_type?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  fps?: number;
  file_size?: number;
  fingerprint?: string;
  ref_count?: number;
  provider?: string;
  provider_task_id?: string;
  channel_id?: string;
  model_id?: string;
  capability?: string;
  metadata_json?: string;
  created_at: number;
}

export interface EpisodeRow {
  id: string;
  project_id: string;
  episode_number: number;
  title?: string;
  script_text?: string;
  status?: 'draft' | 'script' | 'storyboard' | 'generating' | 'completed';
  step_assets?: 'pending' | 'completed';
  step_storyboard?: 'pending' | 'completed';
  step_video?: 'pending' | 'completed';
  has_analysis?: number;
  /** 推文化 / 字幕格式确认门控（1 = 已确认，可解析；0 = 未确认）*/
  script_ready?: number;
  analysis_json?: string;
  metadata_json?: string;
  created_at: number;
  updated_at: number;
}

export interface TimelineRow {
  id: string;
  project_id: string;
  scope_type?: 'project' | 'episode';
  scope_id?: string;
  timeline_version?: number;
  duration: number;
  fps: number;
  resolution_width: number;
  resolution_height: number;
  metadata_json?: string;
  created_at: number;
  updated_at: number;
}

export interface TrackRow {
  id: string;
  timeline_id: string;
  name?: string;
  type: 'video' | 'audio' | 'subtitle';
  kind?: 'video' | 'audio' | 'text' | 'subtitle';
  muted: number;
  locked?: number;
  visible?: number;
  hidden?: number;
  is_main_track?: number;
  height?: number;
  track_order?: number;
  sort_order: number;
}

export interface ClipRow {
  id: string;
  track_id: string;
  asset_id?: string;
  asset_ref_id?: string;
  start_time: number;
  end_time: number;
  in_point: number;
  out_point?: number;
  duration?: number;
  offset_time?: number;
  source_duration?: number;
  source_width?: number;
  source_height?: number;
  sort_order?: number;
  name?: string;
  type?: 'VIDEO' | 'IMAGE' | 'TEXT' | 'AUDIO';
  src?: string;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  text?: string;
  font_size?: number;
  font_family?: string;
  font_color?: string;
  background_color?: string;
  text_position?: 'top' | 'center' | 'bottom';
  text_align?: 'left' | 'center' | 'right';
  filter_id?: string;
  filter_name?: string;
  filter_resource_id?: string;
  filter_intensity?: number;
  audio_fade_in?: number;
  audio_fade_out?: number;
  mask_type?: 'linear' | 'mirror' | 'circle' | 'rectangle' | 'heart' | 'star';
  mask_center_x?: number;
  mask_center_y?: number;
  mask_size?: number;
  mask_width?: number;
  mask_rotation?: number;
  mask_feather?: number;
  mask_invert?: number;
  mask_round_corner?: number;
  metadata_json?: string;
}

// ========== 组装后的时间线结构 ==========

export type TimelineData = EditorTimelineData;

// ========== Repository 接口 ==========

export interface IProjectRepository {
  list(): ProjectRow[];
  getById(id: string): ProjectRow | undefined;
  create(data: Omit<ProjectRow, 'episodes'>): void;
  update(id: string, data: Partial<ProjectRow>): void;
  delete(id: string): void;
}

export interface ICharacterRepository {
  list(projectId: string): CharacterRow[];
  getById(id: string): CharacterRow | undefined;
  create(data: CharacterRow): void;
  update(id: string, data: Partial<CharacterRow>): void;
  delete(id: string): void;
}

export interface ISceneRepository {
  list(projectId: string): SceneRow[];
  getById(id: string): SceneRow | undefined;
  create(data: SceneRow): void;
  update(id: string, data: Partial<SceneRow>): void;
  delete(id: string): void;
}

export interface IPropRepository {
  list(projectId: string): PropRow[];
  getById(id: string): PropRow | undefined;
  create(data: PropRow): void;
  update(id: string, data: Partial<PropRow>): void;
  delete(id: string): void;
}

export interface IShotRepository {
  list(projectId: string): ShotRow[];
  listProjectLevel(projectId: string): ShotRow[];
  listByEpisode(projectId: string, episodeId: string): ShotRow[];
  getById(id: string): ShotRow | undefined;
  create(data: ShotRow): void;
  update(id: string, data: Partial<ShotRow>): void;
  delete(id: string): void;
  // 版本管理
  listVersions(shotId: string): ShotVersionRow[];
  createVersion(data: ShotVersionRow): void;
  deleteVersion(id: string): void;
  setCurrentVersion(shotId: string, versionNumber: number): void;
}

export interface IAssetRepository {
  list(projectId: string): AssetRow[];
  getById(id: string): AssetRow | undefined;
  create(data: AssetRow): void;
  update(id: string, data: Partial<AssetRow>): void;
  delete(id: string): void;
  findByFingerprint(projectId: string, fingerprint: string): AssetRow | undefined;
  listUnreferenced(projectId: string): AssetRow[];
}

export interface IEpisodeRepository {
  list(projectId: string): EpisodeRow[];
  getById(id: string): EpisodeRow | undefined;
  create(data: EpisodeRow): void;
  update(id: string, data: Partial<EpisodeRow>): void;
  delete(id: string): void;
  count(projectId: string): number;
}

export interface ITimelineRepository {
  getByProjectId(projectId: string): TimelineData | undefined;
  getProjectTimeline(projectId: string): TimelineData | undefined;
  getEpisodeTimeline(projectId: string, episodeId: string): TimelineData | undefined;
  listEpisodeTimelines(projectId: string): Record<string, TimelineData>;
  createDefault(projectId: string): TimelineData;
  saveProjectTimeline(projectId: string, timeline: TimelineData): TimelineData;
  saveEpisodeTimeline(projectId: string, episodeId: string, timeline: TimelineData): TimelineData;
  deleteEpisodeTimeline(episodeId: string): void;
  updateTimeline(id: string, data: Partial<TimelineRow>): void;
  // 轨道
  addTrack(data: TrackRow): void;
  updateTrack(id: string, data: Partial<TrackRow>): void;
  deleteTrack(id: string): void;
  // 片段
  addClip(data: ClipRow): void;
  updateClip(id: string, data: Partial<ClipRow>): void;
  deleteClip(id: string): void;
}
