/**
 * 全局 Settings SQLite 连接（独立于项目级 baseDB）
 * 路径：{businessRoot}/settings.db （= ~/.koma/settings.db）
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { getSettingsDir } from '../paths';
import {
  CURRENT_SETTINGS_SCHEMA_VERSION,
  CREATE_SETTINGS_TABLES_SQL,
  CREATE_SETTINGS_INDEXES_SQL,
  SETTINGS_MIGRATIONS,
} from './settingsSchema';

export class SettingsDB {
  private db: Database.Database | null = null;
  private dbPath: string = '';

  /**
   * 初始化全局 settings 数据库。
   * 不接收外部 root：固定落在业务根目录下，确保跨项目共享。
   */
  init(): void {
    const dir = getSettingsDir();
    fs.mkdirSync(dir, { recursive: true });

    this.dbPath = path.join(dir, 'settings.db');
    this.db = new Database(this.dbPath, { timeout: 6000 });

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 6000');

    this._initSchema();
  }

  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('SettingsDB not initialized. Call init() first.');
    }
    return this.db;
  }

  getPath(): string {
    return this.dbPath;
  }

  transaction<T>(fn: () => T): T {
    const db = this.getDb();
    const runInTransaction = db.transaction(fn);
    return runInTransaction();
  }

  close(): void {
    if (this.db) {
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // 忽略 checkpoint 错误
      }
      this.db.close();
      this.db = null;
    }
  }

  private _initSchema(): void {
    const db = this.getDb();

    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
      )
      .get();

    if (!tableExists) {
      db.exec(CREATE_SETTINGS_TABLES_SQL);
      db.exec(CREATE_SETTINGS_INDEXES_SQL);
      db.prepare(
        'INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)'
      ).run(CURRENT_SETTINGS_SCHEMA_VERSION, Date.now(), 'Initial settings schema');
      return;
    }

    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number } | undefined;

    let currentVersion = row?.version ?? 0;

    while (currentVersion < CURRENT_SETTINGS_SCHEMA_VERSION) {
      const nextVersion = currentVersion + 1;
      const migration = SETTINGS_MIGRATIONS[nextVersion];
      if (!migration) {
        throw new Error(`Missing settings migration for version ${nextVersion}`);
      }

      const migrate = db.transaction(() => {
        db.exec(migration.sql);
        db.prepare(
          'INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)'
        ).run(nextVersion, Date.now(), migration.description);
      });
      migrate();

      currentVersion = nextVersion;
    }
  }
}

export const settingsDB = new SettingsDB();
