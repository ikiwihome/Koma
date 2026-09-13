import type {
  Character,
  Episode,
  EpisodeAnalysis,
  EpisodeRef,
  Prop,
  Scene,
  Shot,
  ShotMeta,
  ShotScriptLine,
  ShotVersion,
  StoredMediaAsset,
} from '../../../frontend/src/types';
import type {
  Clip,
  ClipAnimation,
  Keyframe,
  TimelineData,
  Track,
  Transition,
} from '../../../frontend/src/types/editor';
import type {
  AssetRow,
  CharacterRow,
  EpisodeRow,
  PropRow,
  SceneRow,
  ShotRow,
  ShotVersionRow,
  TimelineRow,
  TrackRow,
  ClipRow,
} from './repositories/interfaces';

export interface EntityEpisodeRefRow {
  entity_type: 'character' | 'scene' | 'prop';
  entity_id: string;
  episode_id: string;
  episode_name: string;
  first_appearance: number;
  shot_ids_csv?: string | null;
  sort_order: number;
}

export interface ShotRelationRow {
  shot_id: string;
  entity_id: string;
  sort_order: number;
}

export interface ShotMediaEntryRow {
  id: string;
  shot_id: string;
  slot: 'reference' | 'image' | 'video' | 'audio';
  local_path?: string | null;
  remote_url?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  fps?: number | null;
  provider?: string | null;
  provider_task_id?: string | null;
  channel_id?: string | null;
  model_id?: string | null;
  capability?: string | null;
  thumbnail_path?: string | null;
  prompt_text?: string | null;
  seed?: number | null;
  model_name?: string | null;
  aspect_ratio?: string | null;
  created_at: number;
  sort_order: number;
}

export interface ShotVersionMediaEntryRow {
  id: string;
  shot_version_id: string;
  slot: 'image' | 'video' | 'audio';
  local_path?: string | null;
  remote_url?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  fps?: number | null;
  provider?: string | null;
  provider_task_id?: string | null;
  channel_id?: string | null;
  model_id?: string | null;
  capability?: string | null;
  thumbnail_path?: string | null;
  aspect_ratio?: string | null;
  created_at: number;
}

export interface TimelineTrackTransitionRow {
  id: string;
  track_id: string;
  from_clip_id: string;
  to_clip_id: string;
  type: 'fade';
  duration: number;
  sort_order: number;
}

export interface TimelineClipKeyframeRow {
  id: string;
  clip_id: string;
  time: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  easing: string;
  sort_order: number;
}

export interface TimelineClipAnimationRow {
  id: string;
  clip_id: string;
  animation_type: string;
  effect_id: string;
  name?: string | null;
  duration: number;
  sort_order: number;
}

/**
 * 解析 shots.script_lines_json 列。
 * - 正常路径：解析 JSON 数组，过滤掉非法项，保证 id / text 都存在
 * - 兜底：JSON 解析失败 / 数组为空时，按 description 文本按 \n 拆分作为字幕行
 *   （应对历史数据 / dev 环境数据），每行生成新 id
 */
function parseScriptLines(raw: string | null | undefined, fallbackText?: string | null): ShotScriptLine[] {
  if (raw && raw !== '[]') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const out: ShotScriptLine[] = [];
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const id = typeof (item as Record<string, unknown>).id === 'string' ? (item as Record<string, string>).id : '';
          const text = typeof (item as Record<string, unknown>).text === 'string' ? (item as Record<string, string>).text : '';
          if (!text) continue;
          out.push({ id: id || `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text });
        }
        if (out.length > 0) return out;
      }
    } catch {
      // 落到下面的 fallback 路径
    }
  }
  const text = (fallbackText || '').trim();
  if (!text) return [];
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => ({
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: line,
  }));
}

function boolToInt(value?: boolean): number {
  return value ? 1 : 0;
}

function intToBool(value?: number | null): boolean {
  return Boolean(value);
}

interface ShotRowMetadata {
  inheritPreviousStoryboard?: boolean;
}

function parseShotRowMetadata(raw?: string | null): ShotRowMetadata {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const meta = parsed as Record<string, unknown>;
    return {
      inheritPreviousStoryboard: typeof meta.inheritPreviousStoryboard === 'boolean'
        ? meta.inheritPreviousStoryboard
        : undefined,
    };
  } catch {
    return {};
  }
}

function buildShotRowMetadata(shot: Shot): string | undefined {
  const meta: ShotRowMetadata = {};
  if (typeof shot.inheritPreviousStoryboard === 'boolean') {
    meta.inheritPreviousStoryboard = shot.inheritPreviousStoryboard;
  }
  return Object.keys(meta).length ? JSON.stringify(meta) : undefined;
}

export function serializeShotIdsCsv(shotIds?: string[]): string | null {
  if (!shotIds?.length) return null;
  const normalized = shotIds.map(id => String(id || '').trim()).filter(Boolean);
  return normalized.length ? normalized.join(',') : null;
}

export function parseShotIdsCsv(raw?: string | null): string[] | undefined {
  if (!raw) return undefined;
  const values = raw.split(',').map(item => item.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

function buildEpisodeRefs(
  refs: EntityEpisodeRefRow[] | undefined,
): EpisodeRef[] | undefined {
  if (!refs?.length) return undefined;
  return refs
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(ref => ({
      episodeId: ref.episode_id,
      episodeName: ref.episode_name,
      firstAppearance: intToBool(ref.first_appearance),
      shotIds: parseShotIdsCsv(ref.shot_ids_csv),
    }));
}

function buildMediaMetadata(row: {
  thumbnail_path?: string | null;
  prompt_text?: string | null;
  seed?: number | null;
  model_name?: string | null;
  aspect_ratio?: string | null;
}): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (row.thumbnail_path) metadata.thumbnailPath = row.thumbnail_path;
  if (row.prompt_text) metadata.prompt = row.prompt_text;
  if (typeof row.seed === 'number') metadata.seed = row.seed;
  if (row.model_name) metadata.model = row.model_name;
  if (row.aspect_ratio) metadata.aspectRatio = row.aspect_ratio;
  return Object.keys(metadata).length ? metadata : undefined;
}

export function entryRowToStoredMediaAsset(
  row: ShotMediaEntryRow | ShotVersionMediaEntryRow,
  kind: StoredMediaAsset['kind'],
): StoredMediaAsset {
  return {
    kind,
    localPath: row.local_path ?? undefined,
    remoteUrl: row.remote_url ?? undefined,
    mimeType: row.mime_type ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    fps: row.fps ?? undefined,
    provider: row.provider ?? undefined,
    providerTaskId: row.provider_task_id ?? undefined,
    channelId: row.channel_id ?? undefined,
    modelId: row.model_id ?? undefined,
    capability: row.capability ?? undefined,
    metadata: buildMediaMetadata(row),
    createdAt: row.created_at,
  };
}

export function storedMediaAssetToShotEntry(
  shotId: string,
  slot: ShotMediaEntryRow['slot'],
  asset: StoredMediaAsset,
  sortOrder: number,
): ShotMediaEntryRow {
  return {
    id: `${shotId}:${slot}:${sortOrder}:${asset.createdAt || Date.now()}`,
    shot_id: shotId,
    slot,
    local_path: asset.localPath ?? null,
    remote_url: asset.remoteUrl ?? null,
    mime_type: asset.mimeType ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    duration_ms: asset.durationMs ?? null,
    fps: asset.fps ?? null,
    provider: asset.provider ?? null,
    provider_task_id: asset.providerTaskId ?? null,
    channel_id: asset.channelId ?? null,
    model_id: asset.modelId ?? null,
    capability: asset.capability ?? null,
    thumbnail_path: typeof asset.metadata?.thumbnailPath === 'string' ? asset.metadata.thumbnailPath : null,
    prompt_text: typeof asset.metadata?.prompt === 'string' ? asset.metadata.prompt : null,
    seed: typeof asset.metadata?.seed === 'number' ? asset.metadata.seed : null,
    model_name: typeof asset.metadata?.model === 'string' ? asset.metadata.model : null,
    aspect_ratio: typeof asset.metadata?.aspectRatio === 'string' ? asset.metadata.aspectRatio : null,
    created_at: asset.createdAt,
    sort_order: sortOrder,
  };
}

export function storedMediaAssetToShotVersionEntry(
  shotVersionId: string,
  slot: ShotVersionMediaEntryRow['slot'],
  asset: StoredMediaAsset,
): ShotVersionMediaEntryRow {
  return {
    id: `${shotVersionId}:${slot}`,
    shot_version_id: shotVersionId,
    slot,
    local_path: asset.localPath ?? null,
    remote_url: asset.remoteUrl ?? null,
    mime_type: asset.mimeType ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    duration_ms: asset.durationMs ?? null,
    fps: asset.fps ?? null,
    provider: asset.provider ?? null,
    provider_task_id: asset.providerTaskId ?? null,
    channel_id: asset.channelId ?? null,
    model_id: asset.modelId ?? null,
    capability: asset.capability ?? null,
    thumbnail_path: typeof asset.metadata?.thumbnailPath === 'string' ? asset.metadata.thumbnailPath : null,
    aspect_ratio: typeof asset.metadata?.aspectRatio === 'string' ? asset.metadata.aspectRatio : null,
    created_at: asset.createdAt,
  };
}

export function characterToRow(character: Character, projectId: string, sortOrder: number, now: number): CharacterRow {
  return {
    id: character.id,
    project_id: projectId,
    name: character.name,
    role: character.role,
    prompt: character.prompt,
    description: character.description,
    age: character.age,
    gender: character.gender,
    appearance: character.appearance,
    voice_id: character.voiceId,
    sora2_character_id: character.sora2CharacterId,
    timestamp_start: character.timestampRange?.start,
    timestamp_end: character.timestampRange?.end,
    fingerprint: character.fingerprint,
    costume_photo_local: character.media?.costumePhoto?.localPath,
    costume_photo_remote: character.media?.costumePhoto?.remoteUrl,
    preview_video_local: character.media?.previewVideo?.localPath,
    preview_video_remote: character.media?.previewVideo?.remoteUrl,
    sort_order: sortOrder,
    metadata_json: undefined,
    created_at: now,
    updated_at: now,
  };
}

export function characterRowToEntity(row: CharacterRow, refs?: EntityEpisodeRefRow[]): Character {
  return {
    id: row.id,
    name: row.name,
    role: row.role || 'supporting',
    prompt: row.prompt || '',
    description: row.description ?? undefined,
    age: row.age ?? undefined,
    gender: row.gender as Character['gender'] | undefined,
    appearance: row.appearance ?? undefined,
    voiceId: row.voice_id ?? undefined,
    sora2CharacterId: row.sora2_character_id ?? undefined,
    timestampRange: typeof row.timestamp_start === 'number' || typeof row.timestamp_end === 'number'
      ? {
          start: row.timestamp_start ?? 0,
          end: row.timestamp_end ?? row.timestamp_start ?? 0,
        }
      : undefined,
    fingerprint: row.fingerprint ?? undefined,
    media: row.costume_photo_local || row.costume_photo_remote || row.preview_video_local || row.preview_video_remote
      ? {
          costumePhoto: row.costume_photo_local || row.costume_photo_remote
            ? {
                kind: 'image',
                localPath: row.costume_photo_local ?? undefined,
                remoteUrl: row.costume_photo_remote ?? undefined,
                createdAt: row.updated_at,
              }
            : undefined,
          previewVideo: row.preview_video_local || row.preview_video_remote
            ? {
                kind: 'video',
                localPath: row.preview_video_local ?? undefined,
                remoteUrl: row.preview_video_remote ?? undefined,
                createdAt: row.updated_at,
              }
            : undefined,
        }
      : undefined,
    episodeRefs: buildEpisodeRefs(refs),
  };
}

export function sceneToRow(scene: Scene, projectId: string, sortOrder: number, now: number): SceneRow {
  return {
    id: scene.id,
    project_id: projectId,
    name: scene.name,
    prompt: scene.prompt,
    description: scene.description,
    location: scene.location,
    time_of_day: scene.time,
    mood: scene.mood,
    fingerprint: scene.fingerprint,
    preview_image_local: scene.media?.previewImage?.localPath,
    preview_image_remote: scene.media?.previewImage?.remoteUrl,
    sort_order: sortOrder,
    metadata_json: undefined,
    created_at: now,
    updated_at: now,
  };
}

export function sceneRowToEntity(row: SceneRow, refs?: EntityEpisodeRefRow[]): Scene {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt || '',
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    time: row.time_of_day as Scene['time'] | undefined,
    mood: row.mood ?? undefined,
    fingerprint: row.fingerprint ?? undefined,
    media: row.preview_image_local || row.preview_image_remote
      ? {
          previewImage: {
            kind: 'image',
            localPath: row.preview_image_local ?? undefined,
            remoteUrl: row.preview_image_remote ?? undefined,
            createdAt: row.updated_at,
          },
        }
      : undefined,
    episodeRefs: buildEpisodeRefs(refs),
  };
}

export function propToRow(prop: Prop, projectId: string, sortOrder: number, now: number): PropRow {
  return {
    id: prop.id,
    project_id: projectId,
    name: prop.name,
    prompt: prop.prompt,
    description: prop.description,
    prop_type: prop.type,
    sora2_prop_id: prop.sora2PropId,
    timestamp_start: prop.timestampRange?.start,
    timestamp_end: prop.timestampRange?.end,
    fingerprint: prop.fingerprint,
    preview_image_local: prop.media?.previewImage?.localPath,
    preview_image_remote: prop.media?.previewImage?.remoteUrl,
    preview_video_local: prop.media?.previewVideo?.localPath,
    preview_video_remote: prop.media?.previewVideo?.remoteUrl,
    sort_order: sortOrder,
    metadata_json: undefined,
    created_at: now,
    updated_at: now,
  };
}

export function propRowToEntity(row: PropRow, refs?: EntityEpisodeRefRow[]): Prop {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt || '',
    description: row.description ?? undefined,
    type: row.prop_type ?? undefined,
    sora2PropId: row.sora2_prop_id ?? undefined,
    timestampRange: typeof row.timestamp_start === 'number' || typeof row.timestamp_end === 'number'
      ? {
          start: row.timestamp_start ?? 0,
          end: row.timestamp_end ?? row.timestamp_start ?? 0,
        }
      : undefined,
    fingerprint: row.fingerprint ?? undefined,
    media: row.preview_image_local || row.preview_image_remote || row.preview_video_local || row.preview_video_remote
      ? {
          previewImage: row.preview_image_local || row.preview_image_remote
            ? {
                kind: 'image',
                localPath: row.preview_image_local ?? undefined,
                remoteUrl: row.preview_image_remote ?? undefined,
                createdAt: row.updated_at,
              }
            : undefined,
          previewVideo: row.preview_video_local || row.preview_video_remote
            ? {
                kind: 'video',
                localPath: row.preview_video_local ?? undefined,
                remoteUrl: row.preview_video_remote ?? undefined,
                createdAt: row.updated_at,
              }
            : undefined,
        }
      : undefined,
    episodeRefs: buildEpisodeRefs(refs),
  };
}

export function episodeToRow(episode: Episode, projectId: string): EpisodeRow {
  return {
    id: episode.id,
    project_id: projectId,
    episode_number: episode.number,
    title: episode.title,
    script_text: episode.scriptText,
    status: episode.status,
    step_assets: episode.stepProgress?.assets ?? 'pending',
    step_storyboard: episode.stepProgress?.storyboard ?? 'pending',
    step_video: episode.stepProgress?.video ?? 'pending',
    has_analysis: boolToInt(episode.hasAnalysis),
    script_ready: boolToInt(episode.scriptReady),
    analysis_json: undefined,
    metadata_json: undefined,
    created_at: episode.createdAt,
    updated_at: episode.updatedAt,
  };
}

export function episodeRowToEntity(row: EpisodeRow): Episode {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.episode_number,
    title: row.title || '',
    scriptText: row.script_text ?? undefined,
    status: (row.status as Episode['status']) || 'draft',
    stepProgress: {
      assets: row.step_assets || 'pending',
      storyboard: row.step_storyboard || 'pending',
      video: row.step_video || 'pending',
    },
    hasAnalysis: intToBool(row.has_analysis),
    scriptReady: intToBool(row.script_ready),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function shotToRow(shot: Shot, projectId: string, sortOrder: number, episodeId?: string): ShotRow {
  const scriptLines = Array.isArray(shot.scriptLines) ? shot.scriptLines : [];
  const description = scriptLines.map(line => line.text).join('\n');
  return {
    id: shot.id,
    project_id: projectId,
    episode_id: episodeId,
    shot_number: sortOrder,
    description,
    meta_prompt: undefined,
    meta_seed: undefined,
    meta_model: undefined,
    script_lines_json: JSON.stringify(scriptLines),
    shot_type: shot.shotType,
    camera_movement: shot.cameraMovement,
    duration: shot.duration,
    image_prompt: shot.imagePrompt,
    video_prompt: shot.videoPrompt,
    image_mode: shot.imageMode,
    dialogue: shot.dialogue,
    emotion: shot.emotion,
    confirmed: boolToInt(shot.confirmed),
    seed: shot.seed,
    selected_reference_index: shot.media?.selectedReferenceIndex,
    current_image_index: shot.media?.currentImageIndex,
    current_video_index: shot.media?.currentVideoIndex,
    current_audio_index: shot.media?.currentAudioIndex,
    current_version: shot.currentVersion ?? 0,
    sort_order: sortOrder,
    metadata_json: buildShotRowMetadata(shot),
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

export function shotRowToEntity(
  row: ShotRow,
  characterRelations: ShotRelationRow[] | undefined,
  sceneRelations: ShotRelationRow[] | undefined,
  propRelations: ShotRelationRow[] | undefined,
  mediaEntries: ShotMediaEntryRow[] | undefined,
): Shot {
  const orderedIds = (rels?: ShotRelationRow[]) =>
    (rels || []).slice().sort((a, b) => a.sort_order - b.sort_order).map(item => item.entity_id);

  const refs = (mediaEntries || [])
    .filter(entry => entry.slot === 'reference')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(entry => entryRowToStoredMediaAsset(entry, 'image'));
  const images = (mediaEntries || [])
    .filter(entry => entry.slot === 'image')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(entry => entryRowToStoredMediaAsset(entry, 'image'));
  const videos = (mediaEntries || [])
    .filter(entry => entry.slot === 'video')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(entry => entryRowToStoredMediaAsset(entry, 'video'));
  const audios = (mediaEntries || [])
    .filter(entry => entry.slot === 'audio')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(entry => entryRowToStoredMediaAsset(entry, 'audio'));
  const metadata = parseShotRowMetadata(row.metadata_json);

  return {
    id: row.id,
    scriptLines: parseScriptLines(row.script_lines_json, row.description),
    shotType: (row.shot_type as Shot['shotType']) || 'medium',
    cameraMovement: (row.camera_movement as Shot['cameraMovement']) || 'static',
    duration: typeof row.duration === 'number' ? row.duration : 4,
    imagePrompt: row.image_prompt ?? undefined,
    videoPrompt: row.video_prompt ?? undefined,
    imageMode: (row.image_mode as Shot['imageMode']) ?? undefined,
    inheritPreviousStoryboard: metadata.inheritPreviousStoryboard,
    dialogue: row.dialogue ?? undefined,
    emotion: row.emotion ?? undefined,
    confirmed: intToBool(row.confirmed),
    seed: row.seed ?? undefined,
    currentVersion: row.current_version ?? 0,
    characters: orderedIds(characterRelations),
    scenes: orderedIds(sceneRelations),
    props: orderedIds(propRelations),
    media: refs.length || images.length || videos.length || audios.length
      ? {
          references: refs.length ? refs : undefined,
          images: images.length ? images : undefined,
          videos: videos.length ? videos : undefined,
          audios: audios.length ? audios : undefined,
          selectedReferenceIndex: row.selected_reference_index ?? undefined,
          currentImageIndex: row.current_image_index ?? undefined,
          currentVideoIndex: row.current_video_index ?? undefined,
          currentAudioIndex: row.current_audio_index ?? undefined,
        }
      : undefined,
  };
}

export function shotVersionRowToEntity(
  row: ShotVersionRow,
  mediaEntries: ShotVersionMediaEntryRow[] | undefined,
): ShotVersion {
  const mediaBySlot = new Map((mediaEntries || []).map(entry => [entry.slot, entry]));
  return {
    version: row.version_number,
    prompt: row.prompt || '',
    seed: row.seed ?? 0,
    model: row.model || '',
    createdAt: row.created_at,
    media: {
      image: mediaBySlot.get('image') ? entryRowToStoredMediaAsset(mediaBySlot.get('image')!, 'image') : undefined,
      video: mediaBySlot.get('video') ? entryRowToStoredMediaAsset(mediaBySlot.get('video')!, 'video') : undefined,
      audio: mediaBySlot.get('audio') ? entryRowToStoredMediaAsset(mediaBySlot.get('audio')!, 'audio') : undefined,
    },
  };
}

export function buildShotMeta(
  row: ShotRow,
  versions: ShotVersion[],
): ShotMeta {
  const preferred = versions.find(version => version.version === row.current_version) || versions[0];
  return {
    id: row.id,
    prompt: row.meta_prompt || preferred?.prompt || '',
    seed: row.meta_seed ?? preferred?.seed ?? 0,
    model: row.meta_model || preferred?.model || '',
    currentVersion: row.current_version ?? 0,
    versions: versions.slice().sort((a, b) => a.version - b.version),
  };
}

export function buildEpisodeAnalysis(
  episodeId: string,
  shots: Shot[],
  refs: {
    characters?: EntityEpisodeRefRow[];
    scenes?: EntityEpisodeRefRow[];
    props?: EntityEpisodeRefRow[];
  },
  row?: EpisodeRow,
): EpisodeAnalysis {
  const completedStages: EpisodeAnalysis['completedStages'] = [];
  if (row?.step_assets === 'completed') completedStages.push('characters', 'scenes', 'props');
  if (row?.step_storyboard === 'completed') completedStages.push('shots');

  return {
    episodeId,
    characterRefs: (refs.characters || []).map(item => item.entity_id),
    sceneRefs: (refs.scenes || []).map(item => item.entity_id),
    propRefs: (refs.props || []).map(item => item.entity_id),
    completedStages,
    shots,
    createdAt: row?.created_at ?? Date.now(),
    updatedAt: row?.updated_at ?? Date.now(),
  };
}

export function assetRowToAsset(row: AssetRow) {
  return {
    id: row.id,
    name: row.name || '',
    type: row.kind,
    path: row.local_path || '',
    thumbnailPath: row.thumbnail_path ?? undefined,
    duration: typeof row.duration_ms === 'number' ? row.duration_ms / 1000 : undefined,
    size: row.file_size || 0,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    createdAt: row.created_at,
    md5: row.fingerprint ?? undefined,
    refCount: row.ref_count ?? 0,
  };
}

function trackRuntimeType(row: Pick<TrackRow, 'type' | 'kind'>): Track['type'] {
  const value = row.kind || row.type || 'video';
  return (value === 'subtitle' ? 'text' : value) as Track['type'];
}

function trackStorageType(type: Track['type']): TrackRow['type'] {
  return type === 'text' ? 'subtitle' : type;
}

function trackDefaultName(track: Pick<Track, 'type'>, index: number): string {
  if (track.type === 'audio') return `音频轨道 ${index + 1}`;
  if (track.type === 'text') return `文本轨道 ${index + 1}`;
  return `视频轨道 ${index + 1}`;
}

function trackDefaultHeight(track: Pick<Track, 'type'>): number {
  if (track.type === 'audio') return 40;
  if (track.type === 'text') return 30;
  return 60;
}

function calculateTimelineDuration(tracks: Track[]): number {
  return tracks.reduce((maxDuration, track) => {
    const trackEnd = track.clips.reduce(
      (trackMax, clip) => Math.max(trackMax, clip.start + clip.duration),
      0,
    );
    return Math.max(maxDuration, trackEnd);
  }, 0);
}

function makeClipFilter(row: ClipRow): Clip['filter'] {
  if (!row.filter_id) return undefined;
  return {
    id: row.filter_id,
    name: row.filter_name ?? row.filter_id,
    resourceId: row.filter_resource_id ?? undefined,
    intensity: row.filter_intensity ?? 100,
  };
}

function makeClipAnimations(rows: TimelineClipAnimationRow[] | undefined): Clip['animations'] {
  if (!rows?.length) return undefined;
  return rows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(row => ({
      type: row.animation_type as ClipAnimation['type'],
      effectId: row.effect_id,
      name: row.name ?? undefined,
      duration: row.duration,
    }));
}

function makeAudioFade(row: ClipRow): Clip['audioFade'] {
  if (typeof row.audio_fade_in !== 'number' && typeof row.audio_fade_out !== 'number') {
    return undefined;
  }
  return {
    fadeIn: row.audio_fade_in ?? 0,
    fadeOut: row.audio_fade_out ?? 0,
  };
}

function makeMask(row: ClipRow): Clip['mask'] {
  if (!row.mask_type) return undefined;
  return {
    type: row.mask_type,
    centerX: row.mask_center_x ?? undefined,
    centerY: row.mask_center_y ?? undefined,
    size: row.mask_size ?? undefined,
    width: row.mask_width ?? undefined,
    rotation: row.mask_rotation ?? undefined,
    feather: row.mask_feather ?? undefined,
    invert: typeof row.mask_invert === 'number' ? Boolean(row.mask_invert) : undefined,
    roundCorner: row.mask_round_corner ?? undefined,
  };
}

function makeClipKeyframes(rows: TimelineClipKeyframeRow[] | undefined): Keyframe[] | undefined {
  if (!rows?.length) return undefined;
  return rows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(row => ({
      id: row.id,
      time: row.time,
      x: row.x,
      y: row.y,
      scale: row.scale,
      rotation: row.rotation,
      opacity: row.opacity,
      easing: row.easing as Keyframe['easing'],
    }));
}

function buildClipEntity(
  row: ClipRow,
  keyframes: TimelineClipKeyframeRow[] | undefined,
  animations: TimelineClipAnimationRow[] | undefined,
): Clip {
  return {
    id: row.id,
    assetId: row.asset_ref_id || row.asset_id || row.id,
    trackId: row.track_id,
    start: row.start_time,
    duration: row.duration ?? Math.max((row.end_time ?? row.start_time) - row.start_time, 0),
    offset: row.offset_time ?? row.in_point ?? 0,
    sourceDuration: row.source_duration
      ?? (typeof row.out_point === 'number' ? Math.max(row.out_point - (row.in_point ?? 0), 0) : undefined),
    sourceWidth: row.source_width ?? undefined,
    sourceHeight: row.source_height ?? undefined,
    name: row.name || row.id,
    type: (row.type || 'IMAGE') as Clip['type'],
    src: row.src || '',
    x: row.x ?? 0,
    y: row.y ?? 0,
    scale: row.scale ?? 1,
    rotation: row.rotation ?? 0,
    opacity: row.opacity ?? 1,
    keyframes: makeClipKeyframes(keyframes),
    text: row.text ?? undefined,
    fontSize: row.font_size ?? undefined,
    fontFamily: row.font_family ?? undefined,
    fontColor: row.font_color ?? undefined,
    backgroundColor: row.background_color ?? undefined,
    textPosition: row.text_position ?? undefined,
    textAlign: row.text_align ?? undefined,
    filter: makeClipFilter(row),
    animations: makeClipAnimations(animations),
    audioFade: makeAudioFade(row),
    mask: makeMask(row),
  };
}

export function buildTimelineData(
  timelineRow: TimelineRow,
  trackRows: TrackRow[],
  clipRows: ClipRow[],
  transitionRows: TimelineTrackTransitionRow[] | undefined,
  keyframeRows: TimelineClipKeyframeRow[] | undefined,
  animationRows: TimelineClipAnimationRow[] | undefined,
): TimelineData {
  const clipsByTrack = new Map<string, ClipRow[]>();
  for (const row of clipRows) {
    const bucket = clipsByTrack.get(row.track_id) ?? [];
    bucket.push(row);
    clipsByTrack.set(row.track_id, bucket);
  }

  const keyframesByClip = new Map<string, TimelineClipKeyframeRow[]>();
  for (const row of keyframeRows || []) {
    const bucket = keyframesByClip.get(row.clip_id) ?? [];
    bucket.push(row);
    keyframesByClip.set(row.clip_id, bucket);
  }

  const animationsByClip = new Map<string, TimelineClipAnimationRow[]>();
  for (const row of animationRows || []) {
    const bucket = animationsByClip.get(row.clip_id) ?? [];
    bucket.push(row);
    animationsByClip.set(row.clip_id, bucket);
  }

  const transitionsByTrack = new Map<string, TimelineTrackTransitionRow[]>();
  for (const row of transitionRows || []) {
    const bucket = transitionsByTrack.get(row.track_id) ?? [];
    bucket.push(row);
    transitionsByTrack.set(row.track_id, bucket);
  }

  const tracks = trackRows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(row => {
      const clips = (clipsByTrack.get(row.id) || [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(clipRow => buildClipEntity(
          clipRow,
          keyframesByClip.get(clipRow.id),
          animationsByClip.get(clipRow.id),
        ));

      const transitions = (transitionsByTrack.get(row.id) || [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(transition => ({
          id: transition.id,
          fromClipId: transition.from_clip_id,
          toClipId: transition.to_clip_id,
          type: transition.type as Transition['type'],
          duration: transition.duration,
        }));

      return {
        id: row.id,
        type: trackRuntimeType(row),
        clips,
        transitions: transitions.length ? transitions : undefined,
        isMainTrack: intToBool(row.is_main_track),
        order: row.track_order ?? row.sort_order ?? 0,
        name: row.name || undefined,
        muted: intToBool(row.muted),
        hidden: typeof row.hidden === 'number'
          ? Boolean(row.hidden)
          : !intToBool(row.visible),
      } satisfies Track;
    });

  return {
    version: timelineRow.timeline_version ?? 1,
    tracks,
    createdAt: timelineRow.created_at,
    updatedAt: timelineRow.updated_at,
  };
}

export function timelineToRow(
  projectId: string,
  scopeType: 'project' | 'episode',
  scopeId: string,
  timeline: TimelineData,
  existing?: TimelineRow,
): TimelineRow {
  return {
    id: existing?.id ?? `timeline:${scopeType}:${scopeId}`,
    project_id: projectId,
    scope_type: scopeType,
    scope_id: scopeId,
    timeline_version: timeline.version,
    duration: calculateTimelineDuration(timeline.tracks),
    fps: existing?.fps ?? 30,
    resolution_width: existing?.resolution_width ?? 1920,
    resolution_height: existing?.resolution_height ?? 1080,
    metadata_json: undefined,
    created_at: typeof timeline.createdAt === 'number' ? timeline.createdAt : (existing?.created_at ?? Date.now()),
    updated_at: typeof timeline.updatedAt === 'number' ? timeline.updatedAt : Date.now(),
  };
}

export function trackToRow(timelineId: string, track: Track, sortOrder: number): TrackRow {
  return {
    id: track.id,
    timeline_id: timelineId,
    name: track.name || trackDefaultName(track, sortOrder),
    type: trackStorageType(track.type),
    kind: track.type,
    muted: boolToInt(track.muted),
    locked: 0,
    visible: track.hidden ? 0 : 1,
    hidden: boolToInt(track.hidden),
    is_main_track: boolToInt(track.isMainTrack),
    height: trackDefaultHeight(track),
    track_order: track.order ?? sortOrder,
    sort_order: sortOrder,
  };
}

export function clipToRow(trackId: string, clip: Clip, sortOrder: number): ClipRow {
  const duration = clip.duration;
  const offset = clip.offset ?? 0;
  const sourceDuration = clip.sourceDuration;
  return {
    id: clip.id,
    track_id: trackId,
    asset_id: undefined,
    asset_ref_id: clip.assetId,
    start_time: clip.start,
    end_time: clip.start + duration,
    in_point: offset,
    out_point: typeof sourceDuration === 'number' ? offset + sourceDuration : undefined,
    duration,
    offset_time: offset,
    source_duration: sourceDuration,
    source_width: clip.sourceWidth,
    source_height: clip.sourceHeight,
    sort_order: sortOrder,
    name: clip.name,
    type: clip.type as ClipRow['type'],
    src: clip.src,
    x: clip.x,
    y: clip.y,
    scale: clip.scale,
    rotation: clip.rotation,
    opacity: clip.opacity,
    text: clip.text,
    font_size: clip.fontSize,
    font_family: clip.fontFamily,
    font_color: clip.fontColor,
    background_color: clip.backgroundColor,
    text_position: clip.textPosition,
    text_align: clip.textAlign,
    filter_id: clip.filter?.id,
    filter_name: clip.filter?.name,
    filter_resource_id: clip.filter?.resourceId,
    filter_intensity: clip.filter?.intensity,
    audio_fade_in: clip.audioFade?.fadeIn,
    audio_fade_out: clip.audioFade?.fadeOut,
    mask_type: clip.mask?.type,
    mask_center_x: clip.mask?.centerX,
    mask_center_y: clip.mask?.centerY,
    mask_size: clip.mask?.size,
    mask_width: clip.mask?.width,
    mask_rotation: clip.mask?.rotation,
    mask_feather: clip.mask?.feather,
    mask_invert: typeof clip.mask?.invert === 'boolean' ? boolToInt(clip.mask.invert) : undefined,
    mask_round_corner: clip.mask?.roundCorner,
    metadata_json: undefined,
  };
}

export function keyframeToRow(clipId: string, keyframe: Keyframe, sortOrder: number): TimelineClipKeyframeRow {
  return {
    id: keyframe.id,
    clip_id: clipId,
    time: keyframe.time,
    x: keyframe.x,
    y: keyframe.y,
    scale: keyframe.scale,
    rotation: keyframe.rotation,
    opacity: keyframe.opacity,
    easing: keyframe.easing,
    sort_order: sortOrder,
  };
}

export function transitionToRow(trackId: string, transition: Transition, sortOrder: number): TimelineTrackTransitionRow {
  return {
    id: transition.id,
    track_id: trackId,
    from_clip_id: transition.fromClipId,
    to_clip_id: transition.toClipId,
    type: transition.type,
    duration: transition.duration,
    sort_order: sortOrder,
  };
}

export function animationToRow(
  clipId: string,
  animation: ClipAnimation,
  sortOrder: number,
): TimelineClipAnimationRow {
  return {
    id: `${clipId}:animation:${sortOrder}:${animation.effectId}`,
    clip_id: clipId,
    animation_type: animation.type,
    effect_id: animation.effectId,
    name: animation.name ?? null,
    duration: animation.duration,
    sort_order: sortOrder,
  };
}

// 阶段 2-B 清理：jianyingTrackToRows / TimelineClipJianyingTrackRow /
// TimelineClipJianyingKeyframeRow 已删除。原 schema 中的
// timeline_clip_jianying_tracks / timeline_clip_jianying_keyframes 两表也一并删除
// （见 electron/service/storage/schema.ts），剪映关键帧改由导出器从
// Clip.keyframes 派生。
