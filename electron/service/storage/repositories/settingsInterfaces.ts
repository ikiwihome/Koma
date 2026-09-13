/**
 * Channel / MediaDefaults / Kv Repository 接口
 * 全局 settings.db 专用
 */

export type MediaCategory = 'llm' | 'tti' | 'itv' | 'tts' | 'image-hosting';

export type ChannelSource = 'builtin' | 'plugin';

export interface ChannelConfigRow {
  id: string;
  category: MediaCategory;
  channel_def_id: string;            // = 前端 providerType
  name: string;
  description: string | null;
  base_url: string | null;
  api_key_cipher: Buffer | null;
  provider_config_json: string;      // providerConfig 去 apiKey 后的剩余
  models_json: string;
  capabilities_json: string;
  polling_json: string | null;
  extras_json: string;
  default_model_id: string | null;
  source: ChannelSource;
  plugin_id: string | null;
  enabled: number;
  is_default: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface MediaDefaultRow {
  category: MediaCategory;
  channel_id: string;
  model_id: string | null;
  payload_json: string;
  updated_at: number;
}

export interface AppSettingRow {
  key: string;
  value_json: string;
  updated_at: number;
}

export interface IChannelConfigRepository {
  list(category?: MediaCategory): ChannelConfigRow[];
  getById(id: string): ChannelConfigRow | null;
  insert(row: ChannelConfigRow): void;
  update(id: string, patch: Partial<ChannelConfigRow>): void;
  delete(id: string): boolean;
  bulkInsert(rows: ChannelConfigRow[]): number;
  count(): number;
}

export interface IMediaDefaultsRepository {
  get(category: MediaCategory): MediaDefaultRow | null;
  set(row: MediaDefaultRow): void;
  list(): MediaDefaultRow[];
  delete(category: MediaCategory): boolean;
  deleteByChannelId(channelId: string): number;
}

export interface IAppSettingsKvRepository {
  get(key: string): AppSettingRow | null;
  set(key: string, valueJson: string): void;
  delete(key: string): boolean;
}
