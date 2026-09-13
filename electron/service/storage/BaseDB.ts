/**
 * SQLite 数据库连接管理
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { CURRENT_SCHEMA_VERSION, CREATE_TABLES_SQL, CREATE_INDEXES_SQL, MIGRATIONS } from './schema';

export class BaseDB {
  private db: Database.Database | null = null;
  private dbPath: string = '';

  /**
   * 初始化数据库连接
   */
  init(storageRoot: string): void {
    const dbDir = path.join(storageRoot, 'db');
    fs.mkdirSync(dbDir, { recursive: true });

    const nextDbPath = path.join(dbDir, 'koma.db');
    if (this.db && this.dbPath === nextDbPath) {
      return;
    }
    this.close();

    this.dbPath = nextDbPath;
    this.db = new Database(this.dbPath, { timeout: 6000 });

    // 启用 WAL 模式和外键约束
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 6000');

    this._initSchema();
  }

  /**
   * 获取数据库实例
   */
  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db;
  }

  /**
   * 在事务中执行操作
   */
  transaction<T>(fn: () => T): T {
    const db = this.getDb();
    const runInTransaction = db.transaction(fn);
    return runInTransaction();
  }

  /**
   * 关闭数据库连接
   */
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

  /**
   * 初始化 schema（建表 + 版本迁移）
   */
  private _initSchema(): void {
    const db = this.getDb();

    // 检查 schema_version 表是否存在
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).get();

    if (!tableExists) {
      // 首次初始化：建表 + 索引
      db.exec(CREATE_TABLES_SQL);
      db.exec(CREATE_INDEXES_SQL);
      db.prepare(
        'INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)'
      ).run(CURRENT_SCHEMA_VERSION, Date.now(), 'Initial schema');
      return;
    }

    // 已有数据库：检查版本并执行增量迁移
    const row = db.prepare(
      'SELECT MAX(version) as version FROM schema_version'
    ).get() as { version: number } | undefined;

    let currentVersion = row?.version ?? 0;

    while (currentVersion < CURRENT_SCHEMA_VERSION) {
      const nextVersion = currentVersion + 1;
      const migration = MIGRATIONS[nextVersion];
      if (!migration) {
        throw new Error(`Missing migration for version ${nextVersion}`);
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

export const baseDB = new BaseDB();
