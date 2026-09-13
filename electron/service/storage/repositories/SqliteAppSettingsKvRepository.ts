/**
 * app_settings_kv 表 Repository
 */
import { settingsDB } from '../SettingsDB';
import type { IAppSettingsKvRepository, AppSettingRow } from './settingsInterfaces';

export class SqliteAppSettingsKvRepository implements IAppSettingsKvRepository {
  get(key: string): AppSettingRow | null {
    const db = settingsDB.getDb();
    const row = db
      .prepare('SELECT * FROM app_settings_kv WHERE key = ?')
      .get(key) as AppSettingRow | undefined;
    return row ?? null;
  }

  set(key: string, valueJson: string): void {
    const db = settingsDB.getDb();
    db.prepare(
      `INSERT INTO app_settings_kv (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    ).run(key, valueJson, Date.now());
  }

  delete(key: string): boolean {
    const db = settingsDB.getDb();
    const info = db.prepare('DELETE FROM app_settings_kv WHERE key = ?').run(key);
    return info.changes > 0;
  }
}
