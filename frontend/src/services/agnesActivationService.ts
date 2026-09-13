import { safeFetch } from '../utils/safeFetch';
import { electronService } from './electronService';
import * as channels from './channelConfigService';
import presets from '../../../resources/agnes-models.json';
import type { ActivationInfo, TokenUsageInfo } from './activationService';

export type { ActivationInfo, TokenUsageInfo } from './activationService';
const STORAGE_KEY = 'agnes-activation';
const BASE = 'https://api.agnes-ai.cn/v1';
const ids = { llm: 'agnes-default-llm', tti: 'agnes-default-tti', itv: 'agnes-default-itv' };

async function verify(headers: Record<string, string>) {
  try {
    const response = await safeFetch(`${BASE}/models`, { headers });
    return { success: response.ok, status: response.status,
      error: response.ok ? undefined : [401, 403].includes(response.status) ? 'invalid_key' : 'verify_failed' };
  } catch { return { success: false, error: 'network_error' }; }
}

async function usage(headers: Record<string, string>): Promise<{ success: boolean; data?: TokenUsageInfo; error?: string }> {
  try {
    const [subscription, usageResponse] = await Promise.all([
      safeFetch(`${BASE}/dashboard/billing/subscription`, { headers }),
      safeFetch(`${BASE}/dashboard/billing/usage`, { headers }),
    ]);
    if (!subscription.ok || !usageResponse.ok) return { success: false, error: 'usage_failed' };
    const granted = (await subscription.json()).hard_limit_usd;
    const usedCents = (await usageResponse.json()).total_usage;
    if (typeof granted !== 'number' || !Number.isFinite(granted)
      || typeof usedCents !== 'number' || !Number.isFinite(usedCents)) return { success: false, error: 'usage_failed' };
    const used = usedCents / 100;
    return { success: true, data: { totalGranted: granted, totalUsed: used,
      totalAvailable: Math.max(0, granted - used), quotaPerUnit: 1 } };
  } catch { return { success: false, error: 'network_error' }; }
}

export const activationService = {
  maskApiKey: (key: string) => key.length <= 10 ? '***' : `${key.slice(0, 6)}...${key.slice(-4)}`,
  formatUsdQuota: (value = 0, unit = 1) => `$${(value / unit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  async getActivationInfo(): Promise<ActivationInfo | null> {
    const result = await electronService.ipc.invoke('app-kv:get', { key: STORAGE_KEY });
    return result?.ok ? result.data?.value ?? null : null;
  },
  async saveActivationInfo(info: ActivationInfo): Promise<void> {
    const result = await electronService.ipc.invoke('app-kv:set', { key: STORAGE_KEY, value: info });
    if (!result?.ok) throw new Error('保存激活信息失败');
  },
  async clearActivationInfo(): Promise<void> {
    for (const id of Object.values(ids)) await channels.deleteChannel(id);
    await electronService.ipc.invoke('app-kv:delete', { key: STORAGE_KEY });
  },
  async verifyApiKey(key: string) {
    if (!key.trim()) return { success: false, error: 'empty_key' };
    return verify({ Authorization: `Bearer ${key.trim()}` });
  },
  async verifyStoredActivation(id: string) {
    if (id !== ids.llm) return { success: false, error: 'invalid_channel' };
    return verify({ 'x-koma-channel-id': id });
  },
  async getTokenUsage(key: string) {
    if (!key.trim()) return { success: false, error: 'empty_key' };
    return usage({ Authorization: `Bearer ${key.trim()}` });
  },
  async getStoredTokenUsage(id: string) {
    if (id !== ids.llm) return { success: false, error: 'invalid_channel' };
    return usage({ 'x-koma-channel-id': id });
  },
  async ensureDefaultModelChannels(apiKey: string) {
    try {
      for (const preset of presets) {
        const { baseUrl, ...rest } = preset;
        const config = { ...rest, source: 'builtin', enabled: true,
          providerConfig: { ...preset.providerConfig, baseUrl, apiKey, managedBy: 'agnes-activation' } } as Parameters<typeof channels.createChannel>[0];
        if (await channels.getChannel(preset.id)) await channels.updateChannel(preset.id, config);
        else await channels.createChannel(config);
        await channels.setMediaDefault(config.category, { channelId: preset.id, modelId: preset.defaultModelId });
      }
      return { success: true, channelIds: ids };
    } catch { return { success: false, error: 'default_channels_failed' }; }
  },
};
