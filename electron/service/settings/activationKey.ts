/**
 * 激活 Key 解析共享逻辑：
 * - 老格式：kv 表 `koma-activation` 直接存了明文 apiKey；
 * - 新格式：kv 仅存 maskedKey + defaultChannelIds，明文 apiKey 加密落库到渠道（默认 llm 渠道）。
 *
 * 主进程内部统一通过 readActivationApiKey() 取激活 Key，避免各处重复实现兼容逻辑。
 */
import { SqliteAppSettingsKvRepository } from '../storage/repositories/SqliteAppSettingsKvRepository';
import { getDecryptedApiKey, listChannelConfigs } from './ChannelConfigService';

// 必须与前端 activationService.STORAGE_KEY 保持一致
export const ACTIVATION_STORAGE_KEY = 'koma-activation';
// 必须与前端 KOMAAPI_ACTIVATION_CHANNEL_IDS.llm 保持一致
const DEFAULT_ACTIVATION_CHANNEL_ID = 'komaapi-default-llm';

export interface ResolvedActivationInfo {
  apiKey: string;
  activatedAt: number;
  lastValidatedAt: number;
}

const activationKvRepo = new SqliteAppSettingsKvRepository();

export function readActivationInfo(): ResolvedActivationInfo | null {
  try {
    // The fixed Koma image host has its own credential; never fall back to Agnes.
    const hosting = listChannelConfigs('image-hosting')
      .filter(channel => channel.pluginId === 'com.koma.qiniu-image-hosting'
        && channel.providerType === 'qiniu-image-hosting' && channel.hasApiKey)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (hosting) {
      const apiKey = getDecryptedApiKey(hosting.id);
      if (apiKey) return { apiKey, activatedAt: hosting.createdAt, lastValidatedAt: hosting.updatedAt };
    }
    const row = activationKvRepo.get(ACTIVATION_STORAGE_KEY);
    if (!row?.value_json) return null;
    const parsed = JSON.parse(row.value_json);
    if (!parsed || typeof parsed !== 'object') return null;

    if (typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0) {
      return parsed as ResolvedActivationInfo;
    }

    const channelId =
      typeof parsed?.defaultChannelIds?.llm === 'string' && parsed.defaultChannelIds.llm
        ? parsed.defaultChannelIds.llm
        : DEFAULT_ACTIVATION_CHANNEL_ID;
    const decrypted = getDecryptedApiKey(channelId);
    if (!decrypted) return null;
    return {
      apiKey: decrypted,
      activatedAt: typeof parsed.activatedAt === 'number' ? parsed.activatedAt : Date.now(),
      lastValidatedAt:
        typeof parsed.lastValidatedAt === 'number' ? parsed.lastValidatedAt : Date.now(),
    };
  } catch (err: any) {
    console.warn('[activationKey] Failed to read activation info', err?.message || err);
    return null;
  }
}

export function readActivationApiKey(): string | null {
  return readActivationInfo()?.apiKey || null;
}
