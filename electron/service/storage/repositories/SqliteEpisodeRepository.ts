import type Database from 'better-sqlite3';
import type { IEpisodeRepository, EpisodeRow } from './interfaces';

export class SqliteEpisodeRepository implements IEpisodeRepository {
  constructor(private db: Database.Database) {}

  list(projectId: string): EpisodeRow[] {
    return this.db.prepare(
      'SELECT * FROM episodes WHERE project_id = ? ORDER BY episode_number'
    ).all(projectId) as EpisodeRow[];
  }

  getById(id: string): EpisodeRow | undefined {
    return this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as EpisodeRow | undefined;
  }

  create(data: EpisodeRow): void {
    this.db.prepare(`
      INSERT INTO episodes (id, project_id, episode_number, title, script_text,
        status, step_assets, step_storyboard, step_video, has_analysis, script_ready,
        analysis_json, metadata_json, created_at, updated_at)
      VALUES (@id, @project_id, @episode_number, @title, @script_text,
        @status, @step_assets, @step_storyboard, @step_video, @has_analysis, @script_ready,
        @analysis_json, @metadata_json, @created_at, @updated_at)
    `).run({
      id: data.id,
      project_id: data.project_id,
      episode_number: data.episode_number,
      title: data.title ?? null,
      script_text: data.script_text ?? null,
      status: data.status ?? 'draft',
      step_assets: data.step_assets ?? 'pending',
      step_storyboard: data.step_storyboard ?? 'pending',
      step_video: data.step_video ?? 'pending',
      has_analysis: data.has_analysis ?? 0,
      script_ready: data.script_ready ?? 0,
      analysis_json: data.analysis_json ?? null,
      metadata_json: data.metadata_json ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  }

  update(id: string, data: Partial<EpisodeRow>): void {
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
      `UPDATE episodes SET ${fields.join(', ')} WHERE id = @id`
    ).run(values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
  }

  count(projectId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM episodes WHERE project_id = ?'
    ).get(projectId) as { cnt: number };
    return row.cnt;
  }
}
