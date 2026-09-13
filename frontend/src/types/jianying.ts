/**
 * 剪映 (CapCut/Jianying) 草稿类型定义
 * 基于 pyCapCut 和 duo-video 参考代码分析
 */

// 时间范围 (微秒)
export interface JianyingTimerange {
  start: number;
  duration: number;
}

// 画布配置
export interface JianyingCanvasConfig {
  width: number;
  height: number;
  ratio: string;
  background?: null;
}

// 平台信息
export interface JianyingPlatform {
  app_id: number;
  app_source: string;
  app_version: string;
  os: string;
}

// 片段变换设置
export interface JianyingClipSettings {
  alpha: number;
  flip: {
    horizontal: boolean;
    vertical: boolean;
  };
  rotation: number;
  scale: {
    x: number;
    y: number;
  };
  transform: {
    x: number;
    y: number;
  };
}

// 片段 (Segment)
export interface JianyingSegment {
  id: string;
  material_id: string;
  target_timerange: JianyingTimerange;
  source_timerange?: JianyingTimerange;
  speed: number;
  volume: number;
  clip: JianyingClipSettings;
  extra_material_refs: string[];
  enable_adjust: boolean;
  enable_color_correct_adjust: boolean;
  enable_color_curves: boolean;
  enable_color_match_adjust: boolean;
  enable_color_wheels: boolean;
  enable_lut: boolean;
  enable_smart_color_adjust: boolean;
  last_nonzero_volume: number;
  reverse: boolean;
  track_attribute: number;
  track_render_index: number;
  visible: boolean;
  render_index: number;
  common_keyframes: unknown[];
  keyframe_refs: unknown[];
  uniform_scale?: {
    on: boolean;
    value: number;
  };
  hdr_settings?: {
    intensity: number;
    mode: number;
    nits: number;
  };
}

// 轨道 (Track)
export interface JianyingTrack {
  id: string;
  type: 'video' | 'audio' | 'text' | 'sticker' | 'effect' | 'filter';
  attribute: number;
  flag: number;
  is_default_name: boolean;
  name: string;
  segments: JianyingSegment[];
}

// 视频素材
export interface JianyingVideoMaterial {
  id: string;
  type: 'video' | 'photo';
  path: string;
  duration: number;
  width: number;
  height: number;
  material_name: string;
  material_type?: string;
  crop?: {
    lower_left_x: number;
    lower_left_y: number;
    lower_right_x: number;
    lower_right_y: number;
    upper_left_x: number;
    upper_left_y: number;
    upper_right_x: number;
    upper_right_y: number;
  };
  has_audio?: boolean;
  create_time?: number;
  import_time?: number;
  import_time_ms?: number;
  local_id?: string;
  local_material_id?: string;
}

// 音频素材
export interface JianyingAudioMaterial {
  id: string;
  type: 'music' | 'extract_music';
  path: string;
  duration: number;
  name: string;
  local_material_id?: string;
  create_time?: number;
}

// 文本素材
export interface JianyingTextMaterial {
  id: string;
  type: 'text';
  content: string;
  font_path?: string;
}

// 速度设置
export interface JianyingSpeed {
  id: string;
  type: 'speed';
  speed: number;
  mode: number;
  curve_speed: null;
}

// 素材集合
export interface JianyingMaterials {
  videos: JianyingVideoMaterial[];
  audios: JianyingAudioMaterial[];
  texts: JianyingTextMaterial[];
  speeds: JianyingSpeed[];
  stickers: unknown[];
  effects: unknown[];
  transitions: unknown[];
  canvases: unknown[];
  audio_fades: unknown[];
  material_animations: unknown[];
  video_effects: unknown[];
  // 其他素材类型
  ai_translates: unknown[];
  audio_balances: unknown[];
  audio_effects: unknown[];
  audio_track_indexes: unknown[];
  beats: unknown[];
  chromas: unknown[];
  color_curves: unknown[];
  digital_humans: unknown[];
  drafts: unknown[];
  flowers: unknown[];
  green_screens: unknown[];
  handwrites: unknown[];
  hsl: unknown[];
  images: unknown[];
  log_color_wheels: unknown[];
  loudnesses: unknown[];
  manual_deformations: unknown[];
  masks: unknown[];
  material_colors: unknown[];
  multi_language_refs: unknown[];
  placeholders: unknown[];
  plugin_effects: unknown[];
  primary_color_wheels: unknown[];
  realtime_denoises: unknown[];
  shapes: unknown[];
  smart_crops: unknown[];
  smart_relights: unknown[];
  sound_channel_mappings: unknown[];
  tail_leaders: unknown[];
  text_templates: unknown[];
  time_marks: unknown[];
  video_trackings: unknown[];
  vocal_beautifys: unknown[];
  vocal_separations: unknown[];
}

// 关键帧
export interface JianyingKeyframes {
  adjusts: unknown[];
  audios: unknown[];
  effects: unknown[];
  filters: unknown[];
  handwrites: unknown[];
  stickers: unknown[];
  texts: unknown[];
  videos: unknown[];
}

// 配置
export interface JianyingConfig {
  adjust_max_index: number;
  attachment_info: unknown[];
  combination_max_index: number;
  export_range: null;
  extract_audio_last_index: number;
  lyrics_recognition_id: string;
  lyrics_sync: boolean;
  lyrics_taskinfo: unknown[];
  maintrack_adsorb: boolean;
  material_save_mode: number;
  multi_language_current: string;
  multi_language_list: unknown[];
  multi_language_main: string;
  multi_language_mode: string;
  original_sound_last_index: number;
  record_audio_last_index: number;
  sticker_max_index: number;
  subtitle_keywords_config: null;
  subtitle_recognition_id: string;
  subtitle_sync: boolean;
  subtitle_taskinfo: unknown[];
  system_font_list: unknown[];
  use_float_render: boolean;
  video_mute: boolean;
  zoom_info_params: null;
}

// 草稿内容 (draft_content.json)
export interface JianyingDraftContent {
  canvas_config: JianyingCanvasConfig;
  color_space: number;
  config: JianyingConfig;
  cover: null;
  create_time: number;
  duration: number;
  extra_info: null;
  fps: number;
  free_render_index_mode_on: boolean;
  group_container: null;
  id: string;
  is_drop_frame_timecode: boolean;
  keyframe_graph_list: unknown[];
  keyframes: JianyingKeyframes;
  last_modified_platform: JianyingPlatform;
  lyrics_effects: unknown[];
  materials: JianyingMaterials;
  mutable_config: null;
  name: string;
  new_version: string;
  path: string;
  platform: JianyingPlatform;
  relationships: unknown[];
  render_index_track_mode_on: boolean;
  retouch_cover: null;
  source: string;
  static_cover_image_path: string;
  time_marks: null;
  tracks: JianyingTrack[];
  update_time: number;
  version: number;
}

// 素材引用项
export interface JianyingMaterialItem {
  type: number;
  value: string[];
}

// 企业信息
export interface JianyingEnterpriseInfo {
  draft_enterprise_extra: string;
  draft_enterprise_id: string;
  draft_enterprise_name: string;
  enterprise_material: unknown[];
}

// 草稿元信息 (draft_meta_info.json)
export interface JianyingDraftMetaInfo {
  cloud_draft_cover: boolean;
  cloud_draft_sync: boolean;
  cloud_package_completed_time: string;
  draft_cloud_capcut_purchase_info: string;
  draft_cloud_last_action_download: boolean;
  draft_cloud_package_type: string;
  draft_cloud_purchase_info: string;
  draft_cloud_template_id: string;
  draft_cloud_tutorial_info: string;
  draft_cloud_videocut_purchase_info: string;
  draft_cover: string;
  draft_deeplink_url: string;
  draft_enterprise_info: JianyingEnterpriseInfo;
  draft_fold_path: string;
  draft_id: string;
  draft_is_ae_produce: boolean;
  draft_is_ai_packaging_used: boolean;
  draft_is_ai_shorts: boolean;
  draft_is_ai_translate: boolean;
  draft_is_article_video_draft: boolean;
  draft_is_cloud_temp_draft: boolean;
  draft_is_from_deeplink: string;
  draft_is_invisible: boolean;
  draft_materials: JianyingMaterialItem[];
  draft_materials_copied_info: unknown[];
  draft_name: string;
  draft_new_version: string;
  draft_removable_storage_device: string;
  draft_root_path: string;
  draft_segment_extra_info: unknown[];
  draft_timeline_materials_size_: number;
  draft_type: string;
  tm_draft_cloud_completed: string;
  tm_draft_cloud_entry_id: number;
  tm_draft_cloud_modified: number;
  tm_draft_removed: number;
  tm_duration: number;
}
