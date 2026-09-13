/**
 * media_defaults 表 Repository
 */
import { settingsDB } from '../SettingsDB';
import type {
  IMediaDefaultsRepository,
  MediaDefaultRow,
  MediaCategory,
} from './settingsInterfaces';

export class SqliteMediaDefaultsRepository implements IMediaDefaultsRepository {
  get(category: MediaCategory): MediaDefaultRow | null {
    const db = settingsDB.getDb();
    const row = db
      .prepare('SELECT * FROM media_defaults WHERE category = ?')
      .get(category) as MediaDefaultRow | undefined;
    return row ?? null;
  }

  set(row: MediaDefaultRow): void {
    const db = settingsDB.getDb();
    db.prepare(
      `INSERT INTO media_defaults
        (category, channel_id, model_id, payload_json, updated_at)
       VALUES (@category, @channel_id, @model_id, @payload_json, @updated_at)
       ON CONFLICT(category) DO UPDATE SET
         channel_id = excluded.channel_id,
         model_id = excluded.model_id,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    ).run(row);
  }

  list(): MediaDefaultRow[] {
    const db = settingsDB.getDb();
    return db.prepare('SELECT * FROM media_defaults').all() as MediaDefaultRow[];
  }

  delete(category: MediaCategory): boolean {
    const db = settingsDB.getDb();
    const info = db.prepare('DELETE FROM media_defaults WHERE category = ?').run(category);
    return info.changes > 0;
  }

  deleteByChannelId(channelId: string): number {
    const db = settingsDB.getDb();
    const info = db.prepare('DELETE FROM media_defaults WHERE channel_id = ?').run(channelId);
    return info.changes;
  }
}
