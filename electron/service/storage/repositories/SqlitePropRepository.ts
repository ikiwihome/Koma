import type Database from 'better-sqlite3';
import type { IPropRepository, PropRow } from './interfaces';

export class SqlitePropRepository implements IPropRepository {
  constructor(private db: Database.Database) {}

  list(projectId: string): PropRow[] {
    return this.db.prepare(
      'SELECT * FROM props WHERE project_id = ? ORDER BY sort_order'
    ).all(projectId) as PropRow[];
  }

  getById(id: string): PropRow | undefined {
    return this.db.prepare('SELECT * FROM props WHERE id = ?').get(id) as PropRow | undefined;
  }

  create(data: PropRow): void {
    this.db.prepare(`
      INSERT INTO props (id, project_id, name, prompt, description, prop_type, sora2_prop_id, timestamp_start, timestamp_end, fingerprint,
        preview_image_local, preview_image_remote, preview_video_local, preview_video_remote,
        sort_order, metadata_json, created_at, updated_at)
      VALUES (@id, @project_id, @name, @prompt, @description, @prop_type, @sora2_prop_id, @timestamp_start, @timestamp_end, @fingerprint,
        @preview_image_local, @preview_image_remote, @preview_video_local, @preview_video_remote,
        @sort_order, @metadata_json, @created_at, @updated_at)
    `).run({
      id: data.id,
      project_id: data.project_id,
      name: data.name,
      prompt: data.prompt ?? null,
      description: data.description ?? null,
      prop_type: data.prop_type ?? null,
      sora2_prop_id: data.sora2_prop_id ?? null,
      timestamp_start: data.timestamp_start ?? null,
      timestamp_end: data.timestamp_end ?? null,
      fingerprint: data.fingerprint ?? null,
      preview_image_local: data.preview_image_local ?? null,
      preview_image_remote: data.preview_image_remote ?? null,
      preview_video_local: data.preview_video_local ?? null,
      preview_video_remote: data.preview_video_remote ?? null,
      sort_order: data.sort_order ?? 0,
      metadata_json: data.metadata_json ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  }

  update(id: string, data: Partial<PropRow>): void {
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
      `UPDATE props SET ${fields.join(', ')} WHERE id = @id`
    ).run(values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM props WHERE id = ?').run(id);
  }
}
