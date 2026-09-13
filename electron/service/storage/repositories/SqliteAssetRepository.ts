import type Database from 'better-sqlite3';
import type { IAssetRepository, AssetRow } from './interfaces';

export class SqliteAssetRepository implements IAssetRepository {
  constructor(private db: Database.Database) {}

  list(projectId: string): AssetRow[] {
    return this.db.prepare(
      'SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId) as AssetRow[];
  }

  getById(id: string): AssetRow | undefined {
    return this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
  }

  create(data: AssetRow): void {
    this.db.prepare(`
      INSERT INTO assets (id, project_id, kind, name, local_path, remote_url, thumbnail_path,
        mime_type, width, height, duration_ms, fps, file_size, fingerprint,
        ref_count, provider, provider_task_id, channel_id, model_id, capability,
        metadata_json, created_at)
      VALUES (@id, @project_id, @kind, @name, @local_path, @remote_url, @thumbnail_path,
        @mime_type, @width, @height, @duration_ms, @fps, @file_size, @fingerprint,
        @ref_count, @provider, @provider_task_id, @channel_id, @model_id, @capability,
        @metadata_json, @created_at)
    `).run({
      id: data.id,
      project_id: data.project_id,
      kind: data.kind,
      name: data.name ?? null,
      local_path: data.local_path ?? null,
      remote_url: data.remote_url ?? null,
      thumbnail_path: data.thumbnail_path ?? null,
      mime_type: data.mime_type ?? null,
      width: data.width ?? null,
      height: data.height ?? null,
      duration_ms: data.duration_ms ?? null,
      fps: data.fps ?? null,
      file_size: data.file_size ?? null,
      fingerprint: data.fingerprint ?? null,
      ref_count: data.ref_count ?? 0,
      provider: data.provider ?? null,
      provider_task_id: data.provider_task_id ?? null,
      channel_id: data.channel_id ?? null,
      model_id: data.model_id ?? null,
      capability: data.capability ?? null,
      metadata_json: data.metadata_json ?? null,
      created_at: data.created_at,
    });
  }

  update(id: string, data: Partial<AssetRow>): void {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      fields.push(`${key} = @${key}`);
      values[key] = value ?? null;
    }

    if (fields.length === 0) return;

    this.db.prepare(
      `UPDATE assets SET ${fields.join(', ')} WHERE id = @id`
    ).run(values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  }

  findByFingerprint(projectId: string, fingerprint: string): AssetRow | undefined {
    return this.db.prepare(
      'SELECT * FROM assets WHERE project_id = ? AND fingerprint = ? LIMIT 1'
    ).get(projectId, fingerprint) as AssetRow | undefined;
  }

  listUnreferenced(projectId: string): AssetRow[] {
    return this.db.prepare(`
      SELECT a.* FROM assets a
      WHERE a.project_id = ?
        AND a.id NOT IN (
          SELECT COALESCE(asset_ref_id, asset_id)
          FROM timeline_clips
          WHERE COALESCE(asset_ref_id, asset_id) IS NOT NULL
        )
        AND a.id NOT IN (
          SELECT image_local FROM shot_versions WHERE image_local IS NOT NULL
          UNION SELECT video_local FROM shot_versions WHERE video_local IS NOT NULL
          UNION SELECT audio_local FROM shot_versions WHERE audio_local IS NOT NULL
        )
    `).all(projectId) as AssetRow[];
  }
}
