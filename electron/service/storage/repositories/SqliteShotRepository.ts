import type Database from 'better-sqlite3';
import type { IShotRepository, ShotRow, ShotVersionRow } from './interfaces';

export class SqliteShotRepository implements IShotRepository {
  constructor(private db: Database.Database) {}

  list(projectId: string): ShotRow[] {
    return this.db.prepare(
      'SELECT * FROM shots WHERE project_id = ? ORDER BY sort_order'
    ).all(projectId) as ShotRow[];
  }

  listProjectLevel(projectId: string): ShotRow[] {
    return this.db.prepare(
      'SELECT * FROM shots WHERE project_id = ? AND episode_id IS NULL ORDER BY sort_order'
    ).all(projectId) as ShotRow[];
  }

  listByEpisode(projectId: string, episodeId: string): ShotRow[] {
    return this.db.prepare(
      'SELECT * FROM shots WHERE project_id = ? AND episode_id = ? ORDER BY sort_order'
    ).all(projectId, episodeId) as ShotRow[];
  }

  getById(id: string): ShotRow | undefined {
    return this.db.prepare('SELECT * FROM shots WHERE id = ?').get(id) as ShotRow | undefined;
  }

  create(data: ShotRow): void {
    this.db.prepare(`
      INSERT INTO shots (id, project_id, episode_id, shot_number, description,
        meta_prompt, meta_seed, meta_model, script_lines_json, shot_type, camera_movement, duration,
        image_prompt, video_prompt, image_mode, dialogue, emotion, confirmed, seed,
        selected_reference_index, current_image_index, current_video_index, current_audio_index,
        current_version, sort_order, metadata_json, created_at, updated_at)
      VALUES (@id, @project_id, @episode_id, @shot_number, @description,
        @meta_prompt, @meta_seed, @meta_model, @script_lines_json, @shot_type, @camera_movement, @duration,
        @image_prompt, @video_prompt, @image_mode, @dialogue, @emotion, @confirmed, @seed,
        @selected_reference_index, @current_image_index, @current_video_index, @current_audio_index,
        @current_version, @sort_order, @metadata_json, @created_at, @updated_at)
    `).run({
      id: data.id,
      project_id: data.project_id,
      episode_id: data.episode_id ?? null,
      shot_number: data.shot_number ?? null,
      description: data.description ?? null,
      meta_prompt: data.meta_prompt ?? null,
      meta_seed: data.meta_seed ?? null,
      meta_model: data.meta_model ?? null,
      script_lines_json: data.script_lines_json ?? '[]',
      shot_type: data.shot_type ?? null,
      camera_movement: data.camera_movement ?? null,
      duration: data.duration ?? null,
      image_prompt: data.image_prompt ?? null,
      video_prompt: data.video_prompt ?? null,
      image_mode: data.image_mode ?? null,
      dialogue: data.dialogue ?? null,
      emotion: data.emotion ?? null,
      confirmed: data.confirmed ?? 0,
      seed: data.seed ?? null,
      selected_reference_index: data.selected_reference_index ?? null,
      current_image_index: data.current_image_index ?? null,
      current_video_index: data.current_video_index ?? null,
      current_audio_index: data.current_audio_index ?? null,
      current_version: data.current_version ?? 0,
      sort_order: data.sort_order ?? 0,
      metadata_json: data.metadata_json ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  }

  update(id: string, data: Partial<ShotRow>): void {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      fields.push(`${key} = @${key}`);
      values[key] = value ?? null;
    }

    if (!fields.some(f => f.startsWith('updated_at'))) {
      fields.push('updated_at = @updated_at');
      values.updated_at = Date.now();
    }

    if (fields.length === 0) return;

    this.db.prepare(
      `UPDATE shots SET ${fields.join(', ')} WHERE id = @id`
    ).run(values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM shots WHERE id = ?').run(id);
  }

  // ========== 版本管理 ==========

  listVersions(shotId: string): ShotVersionRow[] {
    return this.db.prepare(
      'SELECT * FROM shot_versions WHERE shot_id = ? ORDER BY version_number DESC'
    ).all(shotId) as ShotVersionRow[];
  }

  createVersion(data: ShotVersionRow): void {
    this.db.prepare(`
      INSERT INTO shot_versions (id, shot_id, version_number,
        image_local, image_remote, video_local, video_remote, audio_local, audio_remote,
        prompt, seed, model, metadata_json, created_at)
      VALUES (@id, @shot_id, @version_number,
        @image_local, @image_remote, @video_local, @video_remote, @audio_local, @audio_remote,
        @prompt, @seed, @model, @metadata_json, @created_at)
    `).run({
      id: data.id,
      shot_id: data.shot_id,
      version_number: data.version_number,
      image_local: data.image_local ?? null,
      image_remote: data.image_remote ?? null,
      video_local: data.video_local ?? null,
      video_remote: data.video_remote ?? null,
      audio_local: data.audio_local ?? null,
      audio_remote: data.audio_remote ?? null,
      prompt: data.prompt ?? null,
      seed: data.seed ?? null,
      model: data.model ?? null,
      metadata_json: data.metadata_json ?? null,
      created_at: data.created_at,
    });
  }

  deleteVersion(id: string): void {
    this.db.prepare('DELETE FROM shot_versions WHERE id = ?').run(id);
  }

  setCurrentVersion(shotId: string, versionNumber: number): void {
    this.db.prepare(
      'UPDATE shots SET current_version = ?, updated_at = ? WHERE id = ?'
    ).run(versionNumber, Date.now(), shotId);
  }
}
