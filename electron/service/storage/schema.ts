/**
 * SQLite 数据库 Schema 定义
 */

export const CURRENT_SCHEMA_VERSION = 10;

export const CREATE_TABLES_SQL = `
-- 项目表
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('drama','narration')),
  status TEXT DEFAULT 'script',
  thumbnail TEXT,
  theme TEXT,
  style_prompt TEXT,
  style_preset_id TEXT,
  style_snapshot_json TEXT,
  media_selections_json TEXT,
  metadata_json TEXT,
  aspect_ratio TEXT DEFAULT '16:9',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 角色表
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  prompt TEXT,
  description TEXT,
  age TEXT,
  gender TEXT,
  appearance TEXT,
  voice_id TEXT,
  sora2_character_id TEXT,
  timestamp_start INTEGER,
  timestamp_end INTEGER,
  fingerprint TEXT,
  costume_photo_local TEXT,
  costume_photo_remote TEXT,
  preview_video_local TEXT,
  preview_video_remote TEXT,
  sort_order INTEGER DEFAULT 0,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 场景表
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT,
  description TEXT,
  location TEXT,
  time_of_day TEXT,
  mood TEXT,
  fingerprint TEXT,
  preview_image_local TEXT,
  preview_image_remote TEXT,
  sort_order INTEGER DEFAULT 0,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 道具表
CREATE TABLE IF NOT EXISTS props (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT,
  description TEXT,
  prop_type TEXT,
  sora2_prop_id TEXT,
  timestamp_start INTEGER,
  timestamp_end INTEGER,
  fingerprint TEXT,
  preview_image_local TEXT,
  preview_image_remote TEXT,
  preview_video_local TEXT,
  preview_video_remote TEXT,
  sort_order INTEGER DEFAULT 0,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 分镜表
CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_id TEXT,
  shot_number INTEGER,
  description TEXT,
  meta_prompt TEXT,
  meta_seed INTEGER,
  meta_model TEXT,
  script_lines_json TEXT NOT NULL DEFAULT '[]',
  shot_type TEXT,
  camera_movement TEXT,
  duration REAL,
  image_prompt TEXT,
  video_prompt TEXT,
  image_mode TEXT,
  dialogue TEXT,
  emotion TEXT,
  confirmed INTEGER DEFAULT 0,
  seed INTEGER,
  selected_reference_index INTEGER,
  current_image_index INTEGER,
  current_video_index INTEGER,
  current_audio_index INTEGER,
  current_version INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 分镜版本表
CREATE TABLE IF NOT EXISTS shot_versions (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  image_local TEXT,
  image_remote TEXT,
  video_local TEXT,
  video_remote TEXT,
  audio_local TEXT,
  audio_remote TEXT,
  prompt TEXT,
  seed INTEGER,
  model TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

-- 资产表
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('image','video','audio')),
  name TEXT,
  local_path TEXT,
  remote_url TEXT,
  thumbnail_path TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  fps REAL,
  file_size INTEGER,
  fingerprint TEXT,
  ref_count INTEGER DEFAULT 0,
  provider TEXT,
  provider_task_id TEXT,
  channel_id TEXT,
  model_id TEXT,
  capability TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

-- 集数表
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  title TEXT,
  script_text TEXT,
  status TEXT DEFAULT 'draft',
  step_assets TEXT DEFAULT 'pending',
  step_storyboard TEXT DEFAULT 'pending',
  step_video TEXT DEFAULT 'pending',
  has_analysis INTEGER DEFAULT 0,
  script_ready INTEGER NOT NULL DEFAULT 0,
  analysis_json TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 时间线表
CREATE TABLE IF NOT EXISTS timelines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'project' CHECK(scope_type IN ('project','episode')),
  scope_id TEXT NOT NULL,
  timeline_version INTEGER NOT NULL DEFAULT 1,
  duration REAL DEFAULT 0,
  fps INTEGER DEFAULT 30,
  resolution_width INTEGER DEFAULT 1920,
  resolution_height INTEGER DEFAULT 1080,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 时间线轨道表
CREATE TABLE IF NOT EXISTS timeline_tracks (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('video','audio','subtitle')),
  kind TEXT NOT NULL DEFAULT 'video' CHECK(kind IN ('video','audio','text','subtitle')),
  muted INTEGER DEFAULT 0,
  locked INTEGER DEFAULT 0,
  visible INTEGER DEFAULT 1,
  height INTEGER DEFAULT 60,
  hidden INTEGER DEFAULT 0,
  is_main_track INTEGER DEFAULT 0,
  track_order INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- 时间线片段表
CREATE TABLE IF NOT EXISTS timeline_clips (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id),
  asset_ref_id TEXT,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  in_point REAL DEFAULT 0,
  out_point REAL,
  duration REAL DEFAULT 0,
  offset_time REAL DEFAULT 0,
  source_duration REAL,
  source_width INTEGER,
  source_height INTEGER,
  sort_order INTEGER DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'VIDEO' CHECK(type IN ('VIDEO','IMAGE','TEXT','AUDIO')),
  src TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  scale REAL NOT NULL DEFAULT 1,
  rotation REAL NOT NULL DEFAULT 0,
  opacity REAL NOT NULL DEFAULT 1,
  text TEXT,
  font_size INTEGER,
  font_family TEXT,
  font_color TEXT,
  background_color TEXT,
  text_position TEXT CHECK(text_position IN ('top','center','bottom')),
  text_align TEXT CHECK(text_align IN ('left','center','right')),
  filter_id TEXT,
  filter_name TEXT,
  filter_resource_id TEXT,
  filter_intensity REAL,
  audio_fade_in REAL,
  audio_fade_out REAL,
  mask_type TEXT CHECK(mask_type IN ('linear','mirror','circle','rectangle','heart','star')),
  mask_center_x REAL,
  mask_center_y REAL,
  mask_size REAL,
  mask_width REAL,
  mask_rotation REAL,
  mask_feather REAL,
  mask_invert INTEGER,
  mask_round_corner REAL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS timeline_track_transitions (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
  from_clip_id TEXT NOT NULL REFERENCES timeline_clips(id) ON DELETE CASCADE,
  to_clip_id TEXT NOT NULL REFERENCES timeline_clips(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('fade')),
  duration REAL NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timeline_clip_keyframes (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL REFERENCES timeline_clips(id) ON DELETE CASCADE,
  time REAL NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  scale REAL NOT NULL,
  rotation REAL NOT NULL,
  opacity REAL NOT NULL,
  easing TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timeline_clip_animations (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL REFERENCES timeline_clips(id) ON DELETE CASCADE,
  animation_type TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  name TEXT,
  duration REAL NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entity_episode_refs (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('character','scene','prop')),
  entity_id TEXT NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  episode_name TEXT NOT NULL,
  first_appearance INTEGER DEFAULT 0,
  shot_ids_csv TEXT,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id, episode_id)
);

CREATE TABLE IF NOT EXISTS shot_characters (
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (shot_id, character_id)
);

CREATE TABLE IF NOT EXISTS shot_scenes (
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (shot_id, scene_id)
);

CREATE TABLE IF NOT EXISTS shot_props (
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  prop_id TEXT NOT NULL REFERENCES props(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (shot_id, prop_id)
);

CREATE TABLE IF NOT EXISTS shot_media_entries (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK(slot IN ('reference','image','video','audio')),
  local_path TEXT,
  remote_url TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  fps REAL,
  provider TEXT,
  provider_task_id TEXT,
  channel_id TEXT,
  model_id TEXT,
  capability TEXT,
  thumbnail_path TEXT,
  prompt_text TEXT,
  seed INTEGER,
  model_name TEXT,
  aspect_ratio TEXT,
  created_at INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shot_version_media_entries (
  id TEXT PRIMARY KEY,
  shot_version_id TEXT NOT NULL REFERENCES shot_versions(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK(slot IN ('image','video','audio')),
  local_path TEXT,
  remote_url TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  fps REAL,
  provider TEXT,
  provider_task_id TEXT,
  channel_id TEXT,
  model_id TEXT,
  capability TEXT,
  thumbnail_path TEXT,
  aspect_ratio TEXT,
  created_at INTEGER NOT NULL
);

-- Schema 版本管理
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);
`;

export const CREATE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
CREATE INDEX IF NOT EXISTS idx_props_project ON props(project_id);
CREATE INDEX IF NOT EXISTS idx_shots_project ON shots(project_id);
CREATE INDEX IF NOT EXISTS idx_shots_episode ON shots(project_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_shot_versions_shot ON shot_versions(shot_id);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_fingerprint ON assets(fingerprint);
CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes(project_id);
CREATE INDEX IF NOT EXISTS idx_timelines_project ON timelines(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_timelines_scope ON timelines(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_timeline_tracks_timeline ON timeline_tracks(timeline_id);
CREATE INDEX IF NOT EXISTS idx_timeline_clips_track ON timeline_clips(track_id);
CREATE INDEX IF NOT EXISTS idx_timeline_track_transitions_track ON timeline_track_transitions(track_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_timeline_clip_keyframes_clip ON timeline_clip_keyframes(clip_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_timeline_clip_animations_clip ON timeline_clip_animations(clip_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_entity_episode_refs_episode ON entity_episode_refs(episode_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_shot_characters_shot ON shot_characters(shot_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_shot_scenes_shot ON shot_scenes(shot_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_shot_props_shot ON shot_props(shot_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_shot_media_entries_shot ON shot_media_entries(shot_id, slot, sort_order);
CREATE INDEX IF NOT EXISTS idx_shot_version_media_entries_version ON shot_version_media_entries(shot_version_id, slot);
`;

/**
 * 增量迁移脚本
 * key = 目标版本号, value = SQL
 */
export const MIGRATIONS: Record<number, { sql: string; description: string }> = {
  2: {
    description: 'Normalize project management persistence and remove large JSON dependencies',
    sql: `
ALTER TABLE characters ADD COLUMN role TEXT;
ALTER TABLE characters ADD COLUMN prompt TEXT;
ALTER TABLE characters ADD COLUMN age TEXT;
ALTER TABLE characters ADD COLUMN gender TEXT;
ALTER TABLE characters ADD COLUMN appearance TEXT;
ALTER TABLE characters ADD COLUMN voice_id TEXT;
ALTER TABLE characters ADD COLUMN sora2_character_id TEXT;
ALTER TABLE characters ADD COLUMN timestamp_start INTEGER;
ALTER TABLE characters ADD COLUMN timestamp_end INTEGER;
ALTER TABLE characters ADD COLUMN fingerprint TEXT;

ALTER TABLE scenes ADD COLUMN prompt TEXT;
ALTER TABLE scenes ADD COLUMN location TEXT;
ALTER TABLE scenes ADD COLUMN time_of_day TEXT;
ALTER TABLE scenes ADD COLUMN mood TEXT;
ALTER TABLE scenes ADD COLUMN fingerprint TEXT;

ALTER TABLE props ADD COLUMN prompt TEXT;
ALTER TABLE props ADD COLUMN prop_type TEXT;
ALTER TABLE props ADD COLUMN sora2_prop_id TEXT;
ALTER TABLE props ADD COLUMN timestamp_start INTEGER;
ALTER TABLE props ADD COLUMN timestamp_end INTEGER;
ALTER TABLE props ADD COLUMN fingerprint TEXT;

ALTER TABLE shots ADD COLUMN meta_prompt TEXT;
ALTER TABLE shots ADD COLUMN meta_seed INTEGER;
ALTER TABLE shots ADD COLUMN meta_model TEXT;
ALTER TABLE shots ADD COLUMN script_content TEXT;
ALTER TABLE shots ADD COLUMN shot_type TEXT;
ALTER TABLE shots ADD COLUMN camera_movement TEXT;
ALTER TABLE shots ADD COLUMN duration REAL;
ALTER TABLE shots ADD COLUMN image_prompt TEXT;
ALTER TABLE shots ADD COLUMN video_prompt TEXT;
ALTER TABLE shots ADD COLUMN image_mode TEXT;
ALTER TABLE shots ADD COLUMN dialogue TEXT;
ALTER TABLE shots ADD COLUMN emotion TEXT;
ALTER TABLE shots ADD COLUMN confirmed INTEGER DEFAULT 0;
ALTER TABLE shots ADD COLUMN seed INTEGER;
ALTER TABLE shots ADD COLUMN selected_reference_index INTEGER;
ALTER TABLE shots ADD COLUMN current_image_index INTEGER;
ALTER TABLE shots ADD COLUMN current_video_index INTEGER;

ALTER TABLE assets ADD COLUMN name TEXT;
ALTER TABLE assets ADD COLUMN thumbnail_path TEXT;
ALTER TABLE assets ADD COLUMN ref_count INTEGER DEFAULT 0;

ALTER TABLE episodes ADD COLUMN status TEXT DEFAULT 'draft';
ALTER TABLE episodes ADD COLUMN step_assets TEXT DEFAULT 'pending';
ALTER TABLE episodes ADD COLUMN step_storyboard TEXT DEFAULT 'pending';
ALTER TABLE episodes ADD COLUMN step_video TEXT DEFAULT 'pending';
ALTER TABLE episodes ADD COLUMN has_analysis INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS entity_episode_refs (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('character','scene','prop')),
  entity_id TEXT NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  episode_name TEXT NOT NULL,
  first_appearance INTEGER DEFAULT 0,
  shot_ids_csv TEXT,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id, episode_id)
);

CREATE TABLE IF NOT EXISTS shot_characters (
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (shot_id, character_id)
);

CREATE TABLE IF NOT EXISTS shot_scenes (
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (shot_id, scene_id)
);

CREATE TABLE IF NOT EXISTS shot_props (
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  prop_id TEXT NOT NULL REFERENCES props(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (shot_id, prop_id)
);

CREATE TABLE IF NOT EXISTS shot_media_entries (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK(slot IN ('reference','image','video')),
  local_path TEXT,
  remote_url TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  fps REAL,
  provider TEXT,
  provider_task_id TEXT,
  channel_id TEXT,
  model_id TEXT,
  capability TEXT,
  thumbnail_path TEXT,
  prompt_text TEXT,
  seed INTEGER,
  model_name TEXT,
  aspect_ratio TEXT,
  created_at INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shot_version_media_entries (
  id TEXT PRIMARY KEY,
  shot_version_id TEXT NOT NULL REFERENCES shot_versions(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK(slot IN ('image','video','audio')),
  local_path TEXT,
  remote_url TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  fps REAL,
  provider TEXT,
  provider_task_id TEXT,
  channel_id TEXT,
  model_id TEXT,
  capability TEXT,
  thumbnail_path TEXT,
  aspect_ratio TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shots_episode ON shots(project_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_entity_episode_refs_episode ON entity_episode_refs(episode_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_shot_characters_shot ON shot_characters(shot_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_shot_scenes_shot ON shot_scenes(shot_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_shot_props_shot ON shot_props(shot_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_shot_media_entries_shot ON shot_media_entries(shot_id, slot, sort_order);
CREATE INDEX IF NOT EXISTS idx_shot_version_media_entries_version ON shot_version_media_entries(shot_version_id, slot);
`,
  },
  3: {
    description: 'Normalize timeline persistence into structured SQLite tables',
    sql: `
ALTER TABLE timelines ADD COLUMN scope_type TEXT DEFAULT 'project';
ALTER TABLE timelines ADD COLUMN scope_id TEXT;
ALTER TABLE timelines ADD COLUMN timeline_version INTEGER DEFAULT 1;
UPDATE timelines
SET scope_type = COALESCE(scope_type, 'project'),
    scope_id = COALESCE(scope_id, project_id),
    timeline_version = COALESCE(timeline_version, 1);

ALTER TABLE timeline_tracks ADD COLUMN kind TEXT DEFAULT 'video';
ALTER TABLE timeline_tracks ADD COLUMN hidden INTEGER DEFAULT 0;
ALTER TABLE timeline_tracks ADD COLUMN is_main_track INTEGER DEFAULT 0;
ALTER TABLE timeline_tracks ADD COLUMN track_order INTEGER DEFAULT 0;
UPDATE timeline_tracks
SET kind = CASE WHEN kind IS NULL OR kind = '' THEN CASE WHEN type = 'subtitle' THEN 'text' ELSE type END ELSE kind END,
    hidden = CASE WHEN hidden IS NULL THEN CASE WHEN COALESCE(visible, 1) = 0 THEN 1 ELSE 0 END ELSE hidden END,
    is_main_track = CASE WHEN is_main_track IS NULL THEN CASE WHEN type = 'video' AND sort_order = 0 THEN 1 ELSE 0 END ELSE is_main_track END,
    track_order = CASE WHEN track_order IS NULL THEN COALESCE(sort_order, 0) ELSE track_order END;

ALTER TABLE timeline_clips ADD COLUMN duration REAL DEFAULT 0;
ALTER TABLE timeline_clips ADD COLUMN asset_ref_id TEXT;
ALTER TABLE timeline_clips ADD COLUMN offset_time REAL DEFAULT 0;
ALTER TABLE timeline_clips ADD COLUMN source_duration REAL;
ALTER TABLE timeline_clips ADD COLUMN source_width INTEGER;
ALTER TABLE timeline_clips ADD COLUMN source_height INTEGER;
ALTER TABLE timeline_clips ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE timeline_clips ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE timeline_clips ADD COLUMN type TEXT NOT NULL DEFAULT 'VIDEO';
ALTER TABLE timeline_clips ADD COLUMN src TEXT NOT NULL DEFAULT '';
ALTER TABLE timeline_clips ADD COLUMN x REAL NOT NULL DEFAULT 0;
ALTER TABLE timeline_clips ADD COLUMN y REAL NOT NULL DEFAULT 0;
ALTER TABLE timeline_clips ADD COLUMN scale REAL NOT NULL DEFAULT 1;
ALTER TABLE timeline_clips ADD COLUMN rotation REAL NOT NULL DEFAULT 0;
ALTER TABLE timeline_clips ADD COLUMN opacity REAL NOT NULL DEFAULT 1;
ALTER TABLE timeline_clips ADD COLUMN text TEXT;
ALTER TABLE timeline_clips ADD COLUMN font_size INTEGER;
ALTER TABLE timeline_clips ADD COLUMN font_family TEXT;
ALTER TABLE timeline_clips ADD COLUMN font_color TEXT;
ALTER TABLE timeline_clips ADD COLUMN background_color TEXT;
ALTER TABLE timeline_clips ADD COLUMN text_position TEXT;
ALTER TABLE timeline_clips ADD COLUMN text_align TEXT;
ALTER TABLE timeline_clips ADD COLUMN filter_id TEXT;
ALTER TABLE timeline_clips ADD COLUMN filter_name TEXT;
ALTER TABLE timeline_clips ADD COLUMN filter_resource_id TEXT;
ALTER TABLE timeline_clips ADD COLUMN filter_intensity REAL;
ALTER TABLE timeline_clips ADD COLUMN audio_fade_in REAL;
ALTER TABLE timeline_clips ADD COLUMN audio_fade_out REAL;
ALTER TABLE timeline_clips ADD COLUMN mask_type TEXT;
ALTER TABLE timeline_clips ADD COLUMN mask_center_x REAL;
ALTER TABLE timeline_clips ADD COLUMN mask_center_y REAL;
ALTER TABLE timeline_clips ADD COLUMN mask_size REAL;
ALTER TABLE timeline_clips ADD COLUMN mask_width REAL;
ALTER TABLE timeline_clips ADD COLUMN mask_rotation REAL;
ALTER TABLE timeline_clips ADD COLUMN mask_feather REAL;
ALTER TABLE timeline_clips ADD COLUMN mask_invert INTEGER;
ALTER TABLE timeline_clips ADD COLUMN mask_round_corner REAL;
UPDATE timeline_clips
SET asset_ref_id = COALESCE(asset_ref_id, asset_id),
    duration = CASE WHEN COALESCE(duration, 0) = 0 THEN MAX(end_time - start_time, 0) ELSE duration END,
    offset_time = COALESCE(offset_time, in_point, 0),
    source_duration = CASE
      WHEN source_duration IS NULL AND out_point IS NOT NULL THEN MAX(out_point - COALESCE(in_point, 0), 0)
      ELSE source_duration
    END,
    name = CASE WHEN name = '' THEN id ELSE name END;

CREATE TABLE IF NOT EXISTS timeline_track_transitions (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
  from_clip_id TEXT NOT NULL REFERENCES timeline_clips(id) ON DELETE CASCADE,
  to_clip_id TEXT NOT NULL REFERENCES timeline_clips(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('fade')),
  duration REAL NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timeline_clip_keyframes (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL REFERENCES timeline_clips(id) ON DELETE CASCADE,
  time REAL NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  scale REAL NOT NULL,
  rotation REAL NOT NULL,
  opacity REAL NOT NULL,
  easing TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timeline_clip_animations (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL REFERENCES timeline_clips(id) ON DELETE CASCADE,
  animation_type TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  name TEXT,
  duration REAL NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timelines_scope ON timelines(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_timeline_track_transitions_track ON timeline_track_transitions(track_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_timeline_clip_keyframes_clip ON timeline_clip_keyframes(clip_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_timeline_clip_animations_clip ON timeline_clip_animations(clip_id, sort_order);
`,
  },
  4: {
    description: 'Reserved migration (deprecated module removed)',
    sql: `SELECT 1;`,
  },
  5: {
    description: 'Replace shots.script_content with script_lines_json (one-line-per-block subtitles); add episodes.script_ready gate',
    sql: `
ALTER TABLE shots DROP COLUMN script_content;
ALTER TABLE shots ADD COLUMN script_lines_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE episodes ADD COLUMN script_ready INTEGER NOT NULL DEFAULT 0;
`,
  },
  6: {
    description: 'Allow audio slot in shot_media_entries (TTS 配音 持久化); add shots.current_audio_index',
    sql: `
-- SQLite 不支持 ALTER 既有 CHECK 约束，必须 rename + recreate + copy 数据。
-- 旧表 slot CHECK ('reference','image','video') → 新表加 'audio'。
ALTER TABLE shot_media_entries RENAME TO shot_media_entries_legacy;
CREATE TABLE shot_media_entries (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK(slot IN ('reference','image','video','audio')),
  local_path TEXT,
  remote_url TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  fps REAL,
  provider TEXT,
  provider_task_id TEXT,
  channel_id TEXT,
  model_id TEXT,
  capability TEXT,
  thumbnail_path TEXT,
  prompt_text TEXT,
  seed INTEGER,
  model_name TEXT,
  aspect_ratio TEXT,
  created_at INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0
);
INSERT INTO shot_media_entries SELECT * FROM shot_media_entries_legacy;
DROP TABLE shot_media_entries_legacy;
CREATE INDEX IF NOT EXISTS idx_shot_media_entries_shot ON shot_media_entries(shot_id, slot, sort_order);

ALTER TABLE shots ADD COLUMN current_audio_index INTEGER;
`,
  },
  7: {
    description: 'Add projects.metadata_json column for project-level extras (ttsVoiceId, ttsSpeed, videoPromptDurationSelections)',
    sql: `
ALTER TABLE projects ADD COLUMN metadata_json TEXT;
`,
  },
  8: {
    description: 'Reserved migration (deprecated module removed)',
    sql: `SELECT 1;`,
  },
  9: {
    description: 'Reserved migration (deprecated module removed)',
    sql: `SELECT 1;`,
  },
  10: {
    description: 'Drop residual tables from deprecated workspace module',
    sql: `
DROP TABLE IF EXISTS linghui_workspace_history_records;
DROP TABLE IF EXISTS linghui_workspace_assets;
DROP TABLE IF EXISTS linghui_workflow_template_edges;
DROP TABLE IF EXISTS linghui_workflow_template_nodes;
DROP TABLE IF EXISTS linghui_workflow_template_groups;
DROP TABLE IF EXISTS linghui_workflow_templates;
DROP TABLE IF EXISTS linghui_workspace_execution_logs;
DROP TABLE IF EXISTS linghui_workspace_node_runs;
DROP TABLE IF EXISTS linghui_workspace_edges;
DROP TABLE IF EXISTS linghui_workspace_nodes;
DROP TABLE IF EXISTS linghui_workspace_groups;
DROP TABLE IF EXISTS linghui_workspaces;
DROP TABLE IF EXISTS linghui_global_assets;
`,
  },
};
