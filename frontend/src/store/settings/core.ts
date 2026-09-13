/**
 * 核心设置存储
 *
 * 数据分层（最终形态）：
 *   渠道类：channelConfigs / mediaDefaults → {userData}/settings.db (via channel:* IPC)
 *   其它类：promptTemplates / customThemePresets / stylePrompts → {storageRoot}/settings.json
 *
 * loadSettings 负责把两处数据拼成一个 AppSettings 返回，让上游消费者透明。
 * saveSettings 只写 json；channelConfigs/mediaDefaults 由 channelConfigService 负责。
 */
import { electronService } from '../../services/electronService';
import { getStorageConfig, initStorageConfig } from '../storageConfig';
import type { AppSettings } from '../../types';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { createLogger } from '../logger';
import { encryptSettings, decryptSettings, initEncryption } from '../encryption';
import * as channelService from '../../services/channelConfigService';
import { DEFAULT_APP_THEME_ID, normalizeAppThemeId } from './uiTheme';

const logger = createLogger('Settings');

// 路径工具
export async function getGlobalPath(filename: string): Promise<string> {
  const config = getStorageConfig() || (await initStorageConfig());
  return `${config.rootPath}/${filename}`;
}

// 默认设置
export const DEFAULT_SETTINGS: AppSettings = {
  uiThemeId: DEFAULT_APP_THEME_ID,
  channelConfigs: [],
  mediaDefaults: {},
  promptTemplates: {},
};

type PersistedSettings = Partial<AppSettings> & {
  themeId?: string;
};

function applyDefaultSettings(settings: PersistedSettings): AppSettings {
  const { themeId: legacyThemeId, ...rest } = settings;

  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    uiThemeId: normalizeAppThemeId(settings.uiThemeId ?? legacyThemeId),
  };
}

// 生成唯一 ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// 迁移旧的加密数据格式
function migrateEncryptedData<T>(data: T): T {
  if (Array.isArray(data)) {
    return data.map(item => migrateEncryptedData(item)) as T;
  }
  if (data && typeof data === 'object') {
    const result = { ...data } as Record<string, any>;
    for (const key of Object.keys(result)) {
      const value = result[key];
      if (value && typeof value === 'object' && value.encrypted === true) {
        result[key] = '';
      } else if (value && typeof value === 'object') {
        result[key] = migrateEncryptedData(value);
      }
    }
    return result as T;
  }
  return data;
}

// 确保加密模块已初始化
let _encryptionReady = false;
async function ensureEncryption(): Promise<void> {
  if (_encryptionReady) return;
  const machineId = await electronService.getMachineId();
  await initEncryption(machineId);
  _encryptionReady = true;
}

/**
 * 把 SQLite 里的渠道配置与默认值覆盖到 settings 对象上。
 * 仅在 Electron 环境执行。
 */
async function applyChannelStore(settings: AppSettings): Promise<AppSettings> {
  if (!electronService.isElectron()) return settings;
  try {
    const [channelConfigs, mediaDefaults] = await Promise.all([
      channelService.listChannels(),
      channelService.listMediaDefaults(),
    ]);
    return {
      ...settings,
      channelConfigs,
      mediaDefaults,
    };
  } catch (err) {
    logger.error('applyChannelStore failed', err);
    return {
      ...settings,
      channelConfigs: settings.channelConfigs ?? [],
      mediaDefaults: settings.mediaDefaults ?? {},
    };
  }
}

// 加载设置
export async function loadSettings(): Promise<AppSettings> {
  // 浏览器 fallback —— 开发调试/测试用，渠道配置不可用
  if (!electronService.isElectron()) {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (data) {
        let parsed = JSON.parse(data);
        parsed = migrateEncryptedData(parsed);
        return applyDefaultSettings(parsed);
      }
    } catch (err) {
      logger.error('loadSettings error', err);
    }
    return DEFAULT_SETTINGS;
  }

  // Electron 正式路径
  let base: AppSettings = { ...DEFAULT_SETTINGS };

  try {
    await ensureEncryption();
    const path = await getGlobalPath('settings.json');
    const exists = await electronService.fs.exists(path);
    if (exists) {
      const data = await electronService.fs.readFile(path);
      let parsed = JSON.parse(data);
      parsed = migrateEncryptedData(parsed);
      const decrypted = await decryptSettings(parsed);
      base = applyDefaultSettings(decrypted);
    }
  } catch (err) {
    logger.error('loadSettings error', err);
  }

  // 无论 json 是否存在，都以 SQLite 为真值填充渠道类字段
  return applyChannelStore(base);
}

// 保存设置 —— 仅持久化非渠道字段到 settings.json
export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!electronService.isElectron()) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    return;
  }

  await ensureEncryption();

  // 剥离由 SQLite 托管的字段，避免 json 与 db 双写
  const { channelConfigs: _chs, mediaDefaults: _md, ...rest } = settings;
  const toPersist = rest as AppSettings;

  const encrypted = await encryptSettings(toPersist);
  const path = await getGlobalPath('settings.json');
  await electronService.fs.writeFile(path, JSON.stringify(encrypted, null, 2));
}
