/**
 * Settings 全局数据库 schema（独立于项目级 koma.db）
 * 路径：{userData}/settings.db
 *
 * v1 → v2:
 *   channel_configs 扩列：source / plugin_id / default_model_id / provider_config_json
 *   目的：与前端 ChannelConfig 字段平铺对齐，减少 extras_json 黑盒
 *
 * v2 → v3:
 *   新增 chat_sessions / chat_messages 表，将聊天历史从 localStorage 迁到 SQLite
 *
 * v3 → v4:
 *   chat_messages 列名从 tool_calls_json 改为 extras_json（开发期重命名）
 *   该表无重要业务数据，直接 DROP+CREATE 重建（清空已有 chat_messages）
 *
 * v4 → v5:
 *   新增 tasks 表：通用后台任务存储（取代项目目录下的 background-tasks.json / tasks.json）
 *   scope 字段实现项目/对话/全局多源；payload_json 装载完整业务数据；冗余 columns 走索引
 */

export const CURRENT_SETTINGS_SCHEMA_VERSION = 5;

export const CREATE_SETTINGS_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version      INTEGER PRIMARY KEY,
  applied_at   INTEGER NOT NULL,
  description  TEXT
);

-- category: 'llm' | 'tti' | 'itv' | 'tts' | 'image-hosting'
-- source:   'builtin' | 'plugin'
CREATE TABLE IF NOT EXISTS channel_configs (
  id                    TEXT PRIMARY KEY,
  category              TEXT NOT NULL,
  channel_def_id        TEXT NOT NULL,            -- = 前端 providerType
  name                  TEXT NOT NULL,
  description           TEXT,
  base_url              TEXT,
  api_key_cipher        BLOB,                     -- safeStorage 加密后的 apiKey
  provider_config_json  TEXT NOT NULL DEFAULT '{}', -- providerConfig 去掉 apiKey 后的剩余字段
  models_json           TEXT NOT NULL DEFAULT '[]',
  capabilities_json     TEXT NOT NULL DEFAULT '[]',
  polling_json          TEXT,
  extras_json           TEXT NOT NULL DEFAULT '{}',
  default_model_id      TEXT,
  source                TEXT NOT NULL DEFAULT 'builtin',
  plugin_id             TEXT,
  enabled               INTEGER NOT NULL DEFAULT 1,
  is_default            INTEGER NOT NULL DEFAULT 0,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_defaults (
  category     TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL,
  model_id     TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings_kv (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 聊天会话元数据
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0
);

-- 聊天消息明细
-- content_json：序列化后的 ChatMessage.content（string | ContentPart[]）
CREATE TABLE IF NOT EXISTS chat_messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  role          TEXT NOT NULL,
  content_json  TEXT NOT NULL,
  reasoning     TEXT,
  extras_json   TEXT,
  created_at    INTEGER NOT NULL
);

-- 通用后台任务表：项目/对话/全局任务统一落库
-- scope 形如 'project:<id>' | 'chat:<sessionId>' | 'global'
-- payload_json：完整业务字段（兼容旧 Task / AsyncTask 形状），冗余列只为索引和过滤
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  scope           TEXT NOT NULL,
  type            TEXT NOT NULL,
  target_kind     TEXT,
  target_id       TEXT,
  status          TEXT NOT NULL,
  progress        REAL NOT NULL DEFAULT 0,
  remote_task_id  TEXT,
  attempt         INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  error           TEXT,
  payload_json    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  heartbeat_at    INTEGER,
  completed_at    INTEGER
);
`;

export const CREATE_SETTINGS_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_channel_configs_category
  ON channel_configs(category, sort_order);
CREATE INDEX IF NOT EXISTS idx_channel_configs_source
  ON channel_configs(source, plugin_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at
  ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq
  ON chat_messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_tasks_scope
  ON tasks(scope);
CREATE INDEX IF NOT EXISTS idx_tasks_scope_status
  ON tasks(scope, status);
CREATE INDEX IF NOT EXISTS idx_tasks_target
  ON tasks(scope, target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at
  ON tasks(status, completed_at);
`;

export interface SettingsMigration {
  description: string;
  sql: string;
}

/**
 * 版本迁移：每个 key = 目标版本
 * 只对已存在的 v1 库追加列；新建库已经是 v2。
 */
export const SETTINGS_MIGRATIONS: Record<number, SettingsMigration> = {
  2: {
    description: 'v2: expand channel_configs columns (source/plugin_id/default_model_id/provider_config_json/etc)',
    sql: `
      ALTER TABLE channel_configs ADD COLUMN description TEXT;
      ALTER TABLE channel_configs ADD COLUMN provider_config_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE channel_configs ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE channel_configs ADD COLUMN polling_json TEXT;
      ALTER TABLE channel_configs ADD COLUMN default_model_id TEXT;
      ALTER TABLE channel_configs ADD COLUMN source TEXT NOT NULL DEFAULT 'builtin';
      ALTER TABLE channel_configs ADD COLUMN plugin_id TEXT;
      ALTER TABLE channel_configs ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_channel_configs_source ON channel_configs(source, plugin_id);
    `,
  },
  3: {
    description: 'v3: add chat_sessions / chat_messages tables for SQLite-backed chat history',
    sql: `
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        seq           INTEGER NOT NULL,
        role          TEXT NOT NULL,
        content_json  TEXT NOT NULL,
        reasoning     TEXT,
        extras_json   TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq ON chat_messages(session_id, seq);
    `,
  },
  4: {
    description: 'v4: rebuild chat_messages with extras_json column (rename from tool_calls_json)',
    sql: `
      DROP TABLE IF EXISTS chat_messages;
      CREATE TABLE chat_messages (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        seq           INTEGER NOT NULL,
        role          TEXT NOT NULL,
        content_json  TEXT NOT NULL,
        reasoning     TEXT,
        extras_json   TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq ON chat_messages(session_id, seq);
    `,
  },
  5: {
    description: 'v5: add tasks table for unified background task storage',
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        id              TEXT PRIMARY KEY,
        scope           TEXT NOT NULL,
        type            TEXT NOT NULL,
        target_kind     TEXT,
        target_id       TEXT,
        status          TEXT NOT NULL,
        progress        REAL NOT NULL DEFAULT 0,
        remote_task_id  TEXT,
        attempt         INTEGER NOT NULL DEFAULT 0,
        max_retries     INTEGER NOT NULL DEFAULT 3,
        error           TEXT,
        payload_json    TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        heartbeat_at    INTEGER,
        completed_at    INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_scope ON tasks(scope);
      CREATE INDEX IF NOT EXISTS idx_tasks_scope_status ON tasks(scope, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_target ON tasks(scope, target_kind, target_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(status, completed_at);
    `,
  },
};
