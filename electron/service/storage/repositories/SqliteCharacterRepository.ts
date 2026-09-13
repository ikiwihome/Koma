import type Database from 'better-sqlite3';
import type { ICharacterRepository, CharacterRow } from './interfaces';

export class SqliteCharacterRepository implements ICharacterRepository {
  constructor(private db: Database.Database) {}

  list(projectId: string): CharacterRow[] {
    return this.db.prepare(
      'SELECT * FROM characters WHERE project_id = ? ORDER BY sort_order'
    ).all(projectId) as CharacterRow[];
  }

  getById(id: string): CharacterRow | undefined {
    return this.db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as CharacterRow | undefined;
  }

  create(data: CharacterRow): void {
    this.db.prepare(`
      INSERT INTO characters (id, project_id, name, role, prompt, description,
        age, gender, appearance, voice_id, sora2_character_id, timestamp_start, timestamp_end, fingerprint,
        costume_photo_local, costume_photo_remote, preview_video_local, preview_video_remote,
        sort_order, metadata_json, created_at, updated_at)
      VALUES (@id, @project_id, @name, @role, @prompt, @description,
        @age, @gender, @appearance, @voice_id, @sora2_character_id, @timestamp_start, @timestamp_end, @fingerprint,
        @costume_photo_local, @costume_photo_remote, @preview_video_local, @preview_video_remote,
        @sort_order, @metadata_json, @created_at, @updated_at)
    `).run({
      id: data.id,
      project_id: data.project_id,
      name: data.name,
      role: data.role ?? null,
      prompt: data.prompt ?? null,
      description: data.description ?? null,
      age: data.age ?? null,
      gender: data.gender ?? null,
      appearance: data.appearance ?? null,
      voice_id: data.voice_id ?? null,
      sora2_character_id: data.sora2_character_id ?? null,
      timestamp_start: data.timestamp_start ?? null,
      timestamp_end: data.timestamp_end ?? null,
      fingerprint: data.fingerprint ?? null,
      costume_photo_local: data.costume_photo_local ?? null,
      costume_photo_remote: data.costume_photo_remote ?? null,
      preview_video_local: data.preview_video_local ?? null,
      preview_video_remote: data.preview_video_remote ?? null,
      sort_order: data.sort_order ?? 0,
      metadata_json: data.metadata_json ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  }

  update(id: string, data: Partial<CharacterRow>): void {
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
      `UPDATE characters SET ${fields.join(', ')} WHERE id = @id`
    ).run(values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  }
}
