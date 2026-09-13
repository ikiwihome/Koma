/**
 * channel_configs 表 Repository (v2 schema)
 */
import { settingsDB } from '../SettingsDB';
import type {
  IChannelConfigRepository,
  ChannelConfigRow,
  MediaCategory,
} from './settingsInterfaces';

const COLUMNS = `
  id, category, channel_def_id, name, description, base_url, api_key_cipher,
  provider_config_json, models_json, capabilities_json, polling_json, extras_json,
  default_model_id, source, plugin_id,
  enabled, is_default, sort_order, created_at, updated_at
`;

const PLACEHOLDERS = `
  @id, @category, @channel_def_id, @name, @description, @base_url, @api_key_cipher,
  @provider_config_json, @models_json, @capabilities_json, @polling_json, @extras_json,
  @default_model_id, @source, @plugin_id,
  @enabled, @is_default, @sort_order, @created_at, @updated_at
`;

export class SqliteChannelConfigRepository implements IChannelConfigRepository {
  list(category?: MediaCategory): ChannelConfigRow[] {
    const db = settingsDB.getDb();
    if (category) {
      return db
        .prepare(
          'SELECT * FROM channel_configs WHERE category = ? ORDER BY sort_order ASC, created_at ASC'
        )
        .all(category) as ChannelConfigRow[];
    }
    return db
      .prepare('SELECT * FROM channel_configs ORDER BY category ASC, sort_order ASC')
      .all() as ChannelConfigRow[];
  }

  getById(id: string): ChannelConfigRow | null {
    const db = settingsDB.getDb();
    const row = db
      .prepare('SELECT * FROM channel_configs WHERE id = ?')
      .get(id) as ChannelConfigRow | undefined;
    return row ?? null;
  }

  insert(row: ChannelConfigRow): void {
    const db = settingsDB.getDb();
    db.prepare(
      `INSERT INTO channel_configs (${COLUMNS}) VALUES (${PLACEHOLDERS})`
    ).run(row);
  }

  update(id: string, patch: Partial<ChannelConfigRow>): void {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`channel_configs row not found: ${id}`);
    }
    const merged: ChannelConfigRow = {
      ...existing,
      ...patch,
      id,
      updated_at: Date.now(),
    };
    const db = settingsDB.getDb();
    db.prepare(
      `UPDATE channel_configs SET
        category = @category,
        channel_def_id = @channel_def_id,
        name = @name,
        description = @description,
        base_url = @base_url,
        api_key_cipher = @api_key_cipher,
        provider_config_json = @provider_config_json,
        models_json = @models_json,
        capabilities_json = @capabilities_json,
        polling_json = @polling_json,
        extras_json = @extras_json,
        default_model_id = @default_model_id,
        source = @source,
        plugin_id = @plugin_id,
        enabled = @enabled,
        is_default = @is_default,
        sort_order = @sort_order,
        updated_at = @updated_at
       WHERE id = @id`
    ).run(merged);
  }

  delete(id: string): boolean {
    const db = settingsDB.getDb();
    const info = db.prepare('DELETE FROM channel_configs WHERE id = ?').run(id);
    return info.changes > 0;
  }

  bulkInsert(rows: ChannelConfigRow[]): number {
    // 注意：本方法假定调用方已确认所有 row 为"新记录"（不会覆盖 existing）。
    // 对于 upsert 语义，请使用 ChannelConfigService.bulkImportChannelConfigs，
    // 由 service 层先查 existing → buildRow(input, existing) → insert/update 分派。
    if (rows.length === 0) return 0;
    const db = settingsDB.getDb();
    const stmt = db.prepare(
      `INSERT INTO channel_configs (${COLUMNS}) VALUES (${PLACEHOLDERS})`
    );
    const tx = db.transaction((items: ChannelConfigRow[]) => {
      for (const item of items) stmt.run(item);
    });
    tx(rows);
    return rows.length;
  }

  count(): number {
    const db = settingsDB.getDb();
    const row = db
      .prepare('SELECT COUNT(*) as n FROM channel_configs')
      .get() as { n: number };
    return row.n;
  }
}
