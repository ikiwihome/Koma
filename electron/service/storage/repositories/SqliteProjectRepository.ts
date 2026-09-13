import type Database from 'better-sqlite3';
import type { IProjectRepository, ProjectRow } from './interfaces';

export class SqliteProjectRepository implements IProjectRepository {
  constructor(private db: Database.Database) {}

  list(): ProjectRow[] {
    const rows = this.db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM episodes e WHERE e.project_id = p.id) as episodes
      FROM projects p ORDER BY p.updated_at DESC
    `).all() as ProjectRow[];
    return rows;
  }

  getById(id: string): ProjectRow | undefined {
    return this.db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM episodes e WHERE e.project_id = p.id) as episodes
      FROM projects p WHERE p.id = ?
    `).get(id) as ProjectRow | undefined;
  }

  create(data: Omit<ProjectRow, 'episodes'>): void {
    this.db.prepare(`
      INSERT INTO projects (id, title, genre, mode, status, thumbnail, theme, style_prompt,
        style_preset_id, style_snapshot_json, media_selections_json, metadata_json, aspect_ratio, created_at, updated_at)
      VALUES (@id, @title, @genre, @mode, @status, @thumbnail, @theme, @style_prompt,
        @style_preset_id, @style_snapshot_json, @media_selections_json, @metadata_json, @aspect_ratio, @created_at, @updated_at)
    `).run({
      id: data.id,
      title: data.title,
      genre: data.genre,
      mode: data.mode,
      status: data.status ?? 'script',
      thumbnail: data.thumbnail ?? null,
      theme: data.theme ?? null,
      style_prompt: data.style_prompt ?? null,
      style_preset_id: data.style_preset_id ?? null,
      style_snapshot_json: data.style_snapshot_json ?? null,
      media_selections_json: data.media_selections_json ?? null,
      metadata_json: data.metadata_json ?? null,
      aspect_ratio: data.aspect_ratio ?? '16:9',
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  }

  update(id: string, data: Partial<ProjectRow>): void {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id' || key === 'episodes') continue;
      fields.push(`${key} = @${key}`);
      values[key] = value ?? null;
    }

    if (!fields.includes('updated_at = @updated_at')) {
      fields.push('updated_at = @updated_at');
      values.updated_at = Date.now();
    }

    if (fields.length === 0) return;

    this.db.prepare(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = @id`
    ).run(values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
}
