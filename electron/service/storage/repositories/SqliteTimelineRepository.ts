import type Database from 'better-sqlite3';
import type { ITimelineRepository, TimelineRow, TrackRow, ClipRow, TimelineData } from './interfaces';
import {
  animationToRow,
  buildTimelineData,
  clipToRow,
  keyframeToRow,
  timelineToRow,
  trackToRow,
  transitionToRow,
  type TimelineClipAnimationRow,
  type TimelineClipKeyframeRow,
  type TimelineTrackTransitionRow,
} from '../projectPersistenceHelpers';

type TimelineScope = 'project' | 'episode';

/**
 * 子表（tracks / clips / keyframes / animations / transitions）的 PK 都是单列
 * `id TEXT PRIMARY KEY`，但前端跨 timeline（project + 每个 episode）会复用同一
 * track / clip id（如 'main' / 'v1'），导致跨 episode 的相同 id 在写库时 PK 冲突。
 *
 * 为避免大动 schema（涉及多张表的外键 cascade），在 repository 层做透明命名空间：
 *   - 写库：所有子表 id 与外键引用前缀加 `${timeline_id}::`
 *   - 读库：再剥掉前缀还原前端 id
 * 同一 timeline 内的 id 仍唯一（先 DELETE WHERE timeline_id = ? 再 INSERT，
 * 不会自冲）；跨 timeline 因前缀不同也唯一。
 *
 * 老数据（无前缀）继续兼容：DELETE 按 timeline_id 清理旧行，再 INSERT 加前缀的
 * 新行，不再混合冲突；读时 stripTimelinePrefix 对无前缀字符串原样返回。
 */
const TIMELINE_ID_SEPARATOR = '::';

function namespaceWithinTimeline(timelineId: string, id: string): string {
  if (!id) return id;
  // 已经带前缀的（重复 save 走回写路径）不再二次包裹
  if (id.startsWith(`${timelineId}${TIMELINE_ID_SEPARATOR}`)) return id;
  return `${timelineId}${TIMELINE_ID_SEPARATOR}${id}`;
}

function stripTimelinePrefix(timelineId: string, id: string | null | undefined): string {
  if (!id) return id ?? '';
  const prefix = `${timelineId}${TIMELINE_ID_SEPARATOR}`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

export class SqliteTimelineRepository implements ITimelineRepository {
  constructor(private db: Database.Database) {}

  getByProjectId(projectId: string): TimelineData | undefined {
    return this.getProjectTimeline(projectId);
  }

  getProjectTimeline(projectId: string): TimelineData | undefined {
    return this.getTimelineByScope('project', projectId, projectId);
  }

  getEpisodeTimeline(projectId: string, episodeId: string): TimelineData | undefined {
    return this.getTimelineByScope('episode', episodeId, projectId);
  }

  listEpisodeTimelines(projectId: string): Record<string, TimelineData> {
    const rows = this.db.prepare(
      "SELECT * FROM timelines WHERE project_id = ? AND scope_type = 'episode' ORDER BY updated_at"
    ).all(projectId) as TimelineRow[];

    const result: Record<string, TimelineData> = {};
    for (const row of rows) {
      if (!row.scope_id) continue;
      const timeline = this.loadTimelineFromRow(row);
      if (timeline) {
        result[row.scope_id] = timeline;
      }
    }
    return result;
  }

  createDefault(projectId: string): TimelineData {
    const now = Date.now();
    const timeline: TimelineData = {
      version: 1,
      createdAt: now,
      updatedAt: now,
      tracks: [
        {
          id: `video-${now}`,
          type: 'video',
          clips: [],
          order: 0,
          isMainTrack: true,
          name: '视频轨道 1',
          muted: false,
          hidden: false,
        },
        {
          id: `audio-${now}`,
          type: 'audio',
          clips: [],
          order: -1,
          name: '音频轨道 1',
          muted: false,
          hidden: false,
        },
        {
          id: `text-${now}`,
          type: 'text',
          clips: [],
          order: 1,
          name: '文本轨道 1',
          muted: false,
          hidden: false,
        },
      ],
    };

    return this.saveProjectTimeline(projectId, timeline);
  }

  saveProjectTimeline(projectId: string, timeline: TimelineData): TimelineData {
    return this.saveTimelineByScope(projectId, 'project', projectId, timeline);
  }

  saveEpisodeTimeline(projectId: string, episodeId: string, timeline: TimelineData): TimelineData {
    return this.saveTimelineByScope(projectId, 'episode', episodeId, timeline);
  }

  deleteEpisodeTimeline(episodeId: string): void {
    this.db.prepare("DELETE FROM timelines WHERE scope_type = 'episode' AND scope_id = ?").run(episodeId);
  }

  updateTimeline(id: string, data: Partial<TimelineRow>): void {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      fields.push(`${key} = @${key}`);
      values[key] = value ?? null;
    }

    if (!fields.some(field => field.startsWith('updated_at'))) {
      fields.push('updated_at = @updated_at');
      values.updated_at = Date.now();
    }

    if (fields.length === 0) return;

    this.db.prepare(`UPDATE timelines SET ${fields.join(', ')} WHERE id = @id`).run(values);
  }

  addTrack(data: TrackRow): void {
    this.db.prepare(`
      INSERT INTO timeline_tracks (
        id, timeline_id, name, type, kind, muted, locked, visible, height,
        hidden, is_main_track, track_order, sort_order
      ) VALUES (
        @id, @timeline_id, @name, @type, @kind, @muted, @locked, @visible, @height,
        @hidden, @is_main_track, @track_order, @sort_order
      )
    `).run({
      id: data.id,
      timeline_id: data.timeline_id,
      name: data.name ?? '',
      type: data.type,
      kind: data.kind ?? (data.type === 'subtitle' ? 'text' : data.type),
      muted: data.muted ?? 0,
      locked: data.locked ?? 0,
      visible: data.visible ?? 1,
      height: data.height ?? 60,
      hidden: data.hidden ?? 0,
      is_main_track: data.is_main_track ?? 0,
      track_order: data.track_order ?? data.sort_order ?? 0,
      sort_order: data.sort_order ?? 0,
    });
  }

  updateTrack(id: string, data: Partial<TrackRow>): void {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      fields.push(`${key} = @${key}`);
      values[key] = value ?? null;
    }

    if (fields.length === 0) return;

    this.db.prepare(`UPDATE timeline_tracks SET ${fields.join(', ')} WHERE id = @id`).run(values);
  }

  deleteTrack(id: string): void {
    this.db.prepare('DELETE FROM timeline_tracks WHERE id = ?').run(id);
  }

  addClip(data: ClipRow): void {
    this.db.prepare(`
      INSERT INTO timeline_clips (
        id, track_id, asset_id, asset_ref_id, start_time, end_time, in_point, out_point,
        duration, offset_time, source_duration, source_width, source_height, sort_order,
        name, type, src, x, y, scale, rotation, opacity, text,
        font_size, font_family, font_color, background_color, text_position, text_align,
        filter_id, filter_name, filter_resource_id, filter_intensity,
        audio_fade_in, audio_fade_out,
        mask_type, mask_center_x, mask_center_y, mask_size, mask_width,
        mask_rotation, mask_feather, mask_invert, mask_round_corner,
        metadata_json
      ) VALUES (
        @id, @track_id, @asset_id, @asset_ref_id, @start_time, @end_time, @in_point, @out_point,
        @duration, @offset_time, @source_duration, @source_width, @source_height, @sort_order,
        @name, @type, @src, @x, @y, @scale, @rotation, @opacity, @text,
        @font_size, @font_family, @font_color, @background_color, @text_position, @text_align,
        @filter_id, @filter_name, @filter_resource_id, @filter_intensity,
        @audio_fade_in, @audio_fade_out,
        @mask_type, @mask_center_x, @mask_center_y, @mask_size, @mask_width,
        @mask_rotation, @mask_feather, @mask_invert, @mask_round_corner,
        @metadata_json
      )
    `).run({
      id: data.id,
      track_id: data.track_id,
      asset_id: data.asset_id ?? null,
      asset_ref_id: data.asset_ref_id ?? data.asset_id ?? null,
      start_time: data.start_time,
      end_time: data.end_time,
      in_point: data.in_point ?? 0,
      out_point: data.out_point ?? null,
      duration: data.duration ?? Math.max(data.end_time - data.start_time, 0),
      offset_time: data.offset_time ?? data.in_point ?? 0,
      source_duration: data.source_duration ?? null,
      source_width: data.source_width ?? null,
      source_height: data.source_height ?? null,
      sort_order: data.sort_order ?? 0,
      name: data.name ?? data.id,
      type: data.type ?? 'IMAGE',
      src: data.src ?? '',
      x: data.x ?? 0,
      y: data.y ?? 0,
      scale: data.scale ?? 1,
      rotation: data.rotation ?? 0,
      opacity: data.opacity ?? 1,
      text: data.text ?? null,
      font_size: data.font_size ?? null,
      font_family: data.font_family ?? null,
      font_color: data.font_color ?? null,
      background_color: data.background_color ?? null,
      text_position: data.text_position ?? null,
      text_align: data.text_align ?? null,
      filter_id: data.filter_id ?? null,
      filter_name: data.filter_name ?? null,
      filter_resource_id: data.filter_resource_id ?? null,
      filter_intensity: data.filter_intensity ?? null,
      audio_fade_in: data.audio_fade_in ?? null,
      audio_fade_out: data.audio_fade_out ?? null,
      mask_type: data.mask_type ?? null,
      mask_center_x: data.mask_center_x ?? null,
      mask_center_y: data.mask_center_y ?? null,
      mask_size: data.mask_size ?? null,
      mask_width: data.mask_width ?? null,
      mask_rotation: data.mask_rotation ?? null,
      mask_feather: data.mask_feather ?? null,
      mask_invert: data.mask_invert ?? null,
      mask_round_corner: data.mask_round_corner ?? null,
      metadata_json: data.metadata_json ?? null,
    });
  }

  updateClip(id: string, data: Partial<ClipRow>): void {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      fields.push(`${key} = @${key}`);
      values[key] = value ?? null;
    }

    if (fields.length === 0) return;

    this.db.prepare(`UPDATE timeline_clips SET ${fields.join(', ')} WHERE id = @id`).run(values);
  }

  deleteClip(id: string): void {
    this.db.prepare('DELETE FROM timeline_clips WHERE id = ?').run(id);
  }

  private getTimelineByScope(
    scopeType: TimelineScope,
    scopeId: string,
    projectId: string,
  ): TimelineData | undefined {
    const row = this.findTimelineRow(scopeType, scopeId, projectId);
    return row ? this.loadTimelineFromRow(row) : undefined;
  }

  private findTimelineRow(
    scopeType: TimelineScope,
    scopeId: string,
    projectId: string,
  ): TimelineRow | undefined {
    return this.db.prepare(
      'SELECT * FROM timelines WHERE project_id = ? AND scope_type = ? AND scope_id = ? LIMIT 1'
    ).get(projectId, scopeType, scopeId) as TimelineRow | undefined;
  }

  private saveTimelineByScope(
    projectId: string,
    scopeType: TimelineScope,
    scopeId: string,
    timeline: TimelineData,
  ): TimelineData {
    const existing = this.findTimelineRow(scopeType, scopeId, projectId);
    const timelineRow = timelineToRow(projectId, scopeType, scopeId, timeline, existing);

    const trackRows: TrackRow[] = [];
    const clipRows: ClipRow[] = [];
    const transitionRows: TimelineTrackTransitionRow[] = [];
    const keyframeRows: TimelineClipKeyframeRow[] = [];
    const animationRows: TimelineClipAnimationRow[] = [];

    // 子表 id 与外键引用统一加 `${timelineId}::` 前缀，避免跨 timeline 共享同名
    // track/clip id 撞 PK。helper 输出后再就地改写 id / 外键到带前缀的形式。
    const ns = (id: string) => namespaceWithinTimeline(timelineRow.id, id);

    timeline.tracks.forEach((track, trackIndex) => {
      const trackRow = trackToRow(timelineRow.id, track, trackIndex);
      trackRow.id = ns(trackRow.id);
      trackRows.push(trackRow);

      (track.clips || []).forEach((clip, clipIndex) => {
        const clipRow = clipToRow(track.id, clip, clipIndex);
        clipRow.id = ns(clipRow.id);
        clipRow.track_id = ns(clipRow.track_id);
        clipRows.push(clipRow);
        (clip.keyframes || []).forEach((frame, frameIndex) => {
          const kfRow = keyframeToRow(clip.id, frame, frameIndex);
          kfRow.id = ns(kfRow.id);
          kfRow.clip_id = ns(kfRow.clip_id);
          keyframeRows.push(kfRow);
        });
        (clip.animations || []).forEach((animation, animationIndex) => {
          const animRow = animationToRow(clip.id, animation, animationIndex);
          animRow.id = ns(animRow.id);
          animRow.clip_id = ns(animRow.clip_id);
          animationRows.push(animRow);
        });
      });

      (track.transitions || []).forEach((transition, transitionIndex) => {
        const transitionRow = transitionToRow(track.id, transition, transitionIndex);
        transitionRow.id = ns(transitionRow.id);
        transitionRow.track_id = ns(transitionRow.track_id);
        if (transitionRow.from_clip_id) {
          transitionRow.from_clip_id = ns(transitionRow.from_clip_id);
        }
        if (transitionRow.to_clip_id) {
          transitionRow.to_clip_id = ns(transitionRow.to_clip_id);
        }
        transitionRows.push(transitionRow);
      });
    });

    const write = this.db.transaction(() => {
      if (existing) {
        this.updateTimeline(timelineRow.id, timelineRow);
        this.db.prepare('DELETE FROM timeline_tracks WHERE timeline_id = ?').run(timelineRow.id);
      } else {
        this.db.prepare(`
          INSERT INTO timelines (
            id, project_id, scope_type, scope_id, timeline_version,
            duration, fps, resolution_width, resolution_height, metadata_json,
            created_at, updated_at
          ) VALUES (
            @id, @project_id, @scope_type, @scope_id, @timeline_version,
            @duration, @fps, @resolution_width, @resolution_height, @metadata_json,
            @created_at, @updated_at
          )
        `).run({
          id: timelineRow.id,
          project_id: timelineRow.project_id,
          scope_type: timelineRow.scope_type ?? scopeType,
          scope_id: timelineRow.scope_id ?? scopeId,
          timeline_version: timelineRow.timeline_version ?? timeline.version,
          duration: timelineRow.duration,
          fps: timelineRow.fps,
          resolution_width: timelineRow.resolution_width,
          resolution_height: timelineRow.resolution_height,
          metadata_json: null,
          created_at: timelineRow.created_at,
          updated_at: timelineRow.updated_at,
        });
      }

      for (const row of trackRows) this.addTrack(row);
      for (const row of clipRows) this.addClip(row);

      const insertTransition = this.db.prepare(`
        INSERT INTO timeline_track_transitions (
          id, track_id, from_clip_id, to_clip_id, type, duration, sort_order
        ) VALUES (
          @id, @track_id, @from_clip_id, @to_clip_id, @type, @duration, @sort_order
        )
      `);
      for (const row of transitionRows) insertTransition.run(row);

      const insertKeyframe = this.db.prepare(`
        INSERT INTO timeline_clip_keyframes (
          id, clip_id, time, x, y, scale, rotation, opacity, easing, sort_order
        ) VALUES (
          @id, @clip_id, @time, @x, @y, @scale, @rotation, @opacity, @easing, @sort_order
        )
      `);
      for (const row of keyframeRows) insertKeyframe.run(row);

      const insertAnimation = this.db.prepare(`
        INSERT INTO timeline_clip_animations (
          id, clip_id, animation_type, effect_id, name, duration, sort_order
        ) VALUES (
          @id, @clip_id, @animation_type, @effect_id, @name, @duration, @sort_order
        )
      `);
      for (const row of animationRows) insertAnimation.run(row);
    });

    write();
    return this.getTimelineByScope(scopeType, scopeId, projectId) ?? timeline;
  }

  private loadTimelineFromRow(timelineRow: TimelineRow): TimelineData | undefined {
    const trackRows = this.db.prepare(
      'SELECT * FROM timeline_tracks WHERE timeline_id = ? ORDER BY sort_order'
    ).all(timelineRow.id) as TrackRow[];

    const trackIds = trackRows.map(track => track.id);
    const clipRows = trackIds.length > 0
      ? this.db.prepare(
          `SELECT * FROM timeline_clips WHERE track_id IN (${trackIds.map(() => '?').join(',')}) ORDER BY sort_order, start_time`
        ).all(...trackIds) as ClipRow[]
      : [];

    const clipIds = clipRows.map(clip => clip.id);
    const transitionRows = trackIds.length > 0
      ? this.db.prepare(
          `SELECT * FROM timeline_track_transitions WHERE track_id IN (${trackIds.map(() => '?').join(',')}) ORDER BY sort_order`
        ).all(...trackIds) as TimelineTrackTransitionRow[]
      : [];
    const keyframeRows = clipIds.length > 0
      ? this.db.prepare(
          `SELECT * FROM timeline_clip_keyframes WHERE clip_id IN (${clipIds.map(() => '?').join(',')}) ORDER BY sort_order`
        ).all(...clipIds) as TimelineClipKeyframeRow[]
      : [];
    const animationRows = clipIds.length > 0
      ? this.db.prepare(
          `SELECT * FROM timeline_clip_animations WHERE clip_id IN (${clipIds.map(() => '?').join(',')}) ORDER BY sort_order`
        ).all(...clipIds) as TimelineClipAnimationRow[]
      : [];

    // 剥前缀：写库时统一加了 `${timeline_id}::`，读出还原前端原始 id（老数据无前缀
    // 时 strip 不变）。track_id / clip_id 等外键引用一并剥，保持 buildTimelineData
    // 内部的 Map.get(row.id) 能命中。
    const strip = (id: string | null | undefined) => stripTimelinePrefix(timelineRow.id, id);
    const strippedTracks = trackRows.map(row => ({ ...row, id: strip(row.id) }));
    const strippedClips = clipRows.map(row => ({
      ...row,
      id: strip(row.id),
      track_id: strip(row.track_id),
    }));
    const strippedTransitions = transitionRows.map(row => ({
      ...row,
      id: strip(row.id),
      track_id: strip(row.track_id),
      from_clip_id: strip(row.from_clip_id),
      to_clip_id: strip(row.to_clip_id),
    }));
    const strippedKeyframes = keyframeRows.map(row => ({
      ...row,
      id: strip(row.id),
      clip_id: strip(row.clip_id),
    }));
    const strippedAnimations = animationRows.map(row => ({
      ...row,
      id: strip(row.id),
      clip_id: strip(row.clip_id),
    }));

    return buildTimelineData(
      timelineRow,
      strippedTracks,
      strippedClips,
      strippedTransitions,
      strippedKeyframes,
      strippedAnimations,
    );
  }
}
