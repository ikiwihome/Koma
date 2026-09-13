import type Database from 'better-sqlite3';
import type { ISceneRepository, SceneRow } from './interfaces';

export class SqliteSceneRepository implements ISceneRepository {
  constructor(private db: Database.Database) {}

  list(projectId: string): SceneRow[] {
    return this.db.prepare(
      'SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order'
    ).all(projectId) as SceneRow[];
  }

  getById(id: string): SceneRow | undefined {
    return this.db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as SceneRow | undefined;
  }

  create(data: SceneRow): void {
    this.db.prepare(`
      INSERT INTO scenes (id, project_id, name, prompt, description, location, time_of_day, mood, fingerprint,
        preview_image_local, preview_image_remote,
        sort_order, metadata_json, created_at, updated_at)
      VALUES (@id, @project_id, @name, @prompt, @description, @location, @time_of_day, @mood, @fingerprint,
        @preview_image_local, @preview_image_remote,
        @sort_order, @metadata_json, @created_at, @updated_at)
    `).run({
      id: data.id,
      project_id: data.project_id,
      name: data.name,
      prompt: data.prompt ?? null,
      description: data.description ?? null,
      location: data.location ?? null,
      time_of_day: data.time_of_day ?? null,
      mood: data.mood ?? null,
      fingerprint: data.fingerprint ?? null,
      preview_image_local: data.preview_image_local ?? null,
      preview_image_remote: data.preview_image_remote ?? null,
      sort_order: data.sort_order ?? 0,
      metadata_json: data.metadata_json ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  }

  update(id: string, data: Partial<SceneRow>): void {
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
      `UPDATE scenes SET ${fields.join(', ')} WHERE id = @id`
    ).run(values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
  }
}
