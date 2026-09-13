import { safeFetch } from '../utils/safeFetch';
import { electronService } from './electronService';
import * as channelConfigService from './channelConfigService';
import type { ModelCapability } from '../providers/channel/types';
import {
  KOMAAPI_ACTIVATION_CHANNEL_IDS,
  isKomaActivationManagedChannel,
  withKomaActivationChannelMarker,
} from '../utils/activationManagedChannels';

export interface ActivationInfo {
  activatedAt: number;
  lastValidatedAt: number;
  maskedKey: string;
  defaultChannelIds: {
    llm: string;
    tti: string;
    itv: string;
  };
}

const STORAGE_KEY = 'koma-activation';

async function deleteActivationManagedChannels(): Promise<void> {
  if (!electronService.isElectron()) return;

  for (const id of Object.values(KOMAAPI_ACTIVATION_CHANNEL_IDS)) {
    try {
      const channel = await channelConfigService.getChannel(id);
      if (!isKomaActivationManagedChannel(channel)) continue;
      await channelConfigService.deleteChannel(id);
    } catch {
      console.error('Failed to delete activation managed channel');
    }
  }
}

export interface TokenUsageInfo {
  name?: string;
  totalGranted?: number;
  totalUsed?: number;
  totalAvailable?: number;
  unlimitedQuota?: boolean;
  expiresAt?: number;
  quotaPerUnit?: number;
}

export const DEFAULT_QUOTA_PER_UNIT = 500000;
export const KOMAAPI_ACTIVATION_CHANNEL_ID = KOMAAPI_ACTIVATION_CHANNEL_IDS.llm;

export const activationService = {
  /**
   * 格式化 USD 额度
   */
  formatUsdQuota(rawQuota?: number, quotaPerUnit: number = DEFAULT_QUOTA_PER_UNIT): string {
    if (rawQuota === undefined || rawQuota === null) return '$0.00';
    const usd = rawQuota / quotaPerUnit;
    return `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  /**
   * 获取本地保存的激活信息
   */
  async getActivationInfo(): Promise<ActivationInfo | null> {
    try {
      let data: any = null;
      if (electronService.isElectron()) {
        const res = await electronService.ipc.invoke('app-kv:get', { key: STORAGE_KEY });
        if (res && res.ok && res.data) {
          data = res.data.value;
        }
      } else {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          data = JSON.parse(stored);
        }
      }

      if (!data) return null;

      // 1. 如果已经是新格式 (包含 maskedKey 和 defaultChannelIds.llm)，
      //    再做一次补齐：新版本可能加了 koma-activation 管理渠道（如 itvJimeng），
      //    老用户激活时还没有，启动时默默给补建出来（apiKey 从已存在的同批渠道继承）。
      if (data.maskedKey && data.defaultChannelIds?.llm) {
        if (electronService.isElectron()) {
          await activationService.reconcileMissingManagedChannels().catch((err) => {
            console.warn('reconcileMissingManagedChannels failed (ignored)', err?.message || err);
          });
        }
        return data as ActivationInfo;
      }

      // 2. 如果是包含 apiKey 的旧格式，先补齐默认渠道，再进行脱敏迁移
      if (typeof data.apiKey === 'string') {
        const trimmedKey = data.apiKey.trim();
        if (!trimmedKey) {
          return null;
        }

        let defaultChannelIds: ActivationInfo['defaultChannelIds'] = {
          llm: KOMAAPI_ACTIVATION_CHANNEL_ID,
          tti: KOMAAPI_ACTIVATION_CHANNEL_IDS.tti,
          itv: KOMAAPI_ACTIVATION_CHANNEL_IDS.itv
        };

        if (electronService.isElectron()) {
          const channelResult = await activationService.ensureDefaultModelChannels(trimmedKey);
          if (!channelResult.success) {
            // 保持旧记录不覆盖，避免写入缺少加密渠道 key 的脱敏激活态
            return null;
          }
          defaultChannelIds = channelResult.channelIds ?? defaultChannelIds;
        }

        const now = Date.now();
        const activatedAt = data.activatedAt || now;
        const sanitized: ActivationInfo = {
          activatedAt,
          lastValidatedAt: data.lastValidatedAt || activatedAt,
          maskedKey: activationService.maskApiKey(trimmedKey),
          defaultChannelIds
        };
        // 将脱敏后的信息存回，从而移除存储中的 full apiKey
        await activationService.saveActivationInfo(sanitized);
        return sanitized;
      }

      // 格式不匹配
      return null;
    } catch (err) {
      // 不记录 err 对象或 apiKey
      console.error('Failed to get activation info');
      return null;
    }
  },

  /**
   * 保存激活信息
   */
  async saveActivationInfo(info: ActivationInfo): Promise<void> {
    try {
      if (electronService.isElectron()) {
        const res = await electronService.ipc.invoke('app-kv:set', { key: STORAGE_KEY, value: info });
        if (res && !res.ok) {
          throw new Error(res.error || 'Unknown error');
        }
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
      }
    } catch (err) {
      console.error('Failed to save activation info');
    }
  },

  /**
   * 清除激活信息
   */
  async clearActivationInfo(): Promise<void> {
    if (electronService.isElectron()) {
      try {
        await deleteActivationManagedChannels();
      } catch {
        console.error('Failed to delete activation managed channels');
      }

      try {
        const res = await electronService.ipc.invoke('app-kv:delete', { key: STORAGE_KEY });
        if (res && !res.ok) {
          throw new Error(res.error || 'Unknown error');
        }
      } catch {
        console.error('Failed to clear activation info');
      }
      return;
    }

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      console.error('Failed to clear activation info');
    }
  },

  /**
   * 验证 API Key (用于新输入 Key 激活时)
   */
  async verifyApiKey(apiKey: string): Promise<{ success: boolean; status?: number; error?: string }> {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      return { success: false, error: 'empty_key' };
    }

    try {
      const response = await safeFetch('https://komaapi.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${trimmedKey}`,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        return { success: true, status: response.status };
      }

      // 401/403 表示无效 key
      if (response.status === 401 || response.status === 403) {
        return { success: false, status: response.status, error: 'invalid_key' };
      }

      // 其它错误不视为无效，但验证不通过
      return { success: false, status: response.status, error: 'verify_failed' };
    } catch (err) {
      console.error('Network error during API key verification');
      return { success: false, error: 'network_error' };
    }
  },

  /**
   * 验证已保存的激活信息 (使用加密渠道 Key)
   */
  async verifyStoredActivation(channelId: string): Promise<{ success: boolean; status?: number; error?: string }> {
    if (channelId !== KOMAAPI_ACTIVATION_CHANNEL_ID) {
      return { success: false, error: 'invalid_channel' };
    }

    try {
      const response = await safeFetch('https://komaapi.com/v1/models', {
        method: 'GET',
        headers: {
          'x-koma-channel-id': channelId,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        return { success: true, status: response.status };
      }

      if (response.status === 401 || response.status === 403) {
        return { success: false, status: response.status, error: 'invalid_key' };
      }

      return { success: false, status: response.status, error: 'verify_failed' };
    } catch (err) {
      console.error('Network error during stored activation verification');
      return { success: false, error: 'network_error' };
    }
  },

  /**
   * 获取 API Key 额度信息 (用于新输入 Key 激活时)
   */
  async getTokenUsage(apiKey: string): Promise<{ success: boolean; data?: TokenUsageInfo; status?: number; error?: 'invalid_key' | 'network_error' | 'usage_failed' | 'empty_key' }> {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      return { success: false, error: 'empty_key' };
    }

    try {
      const response = await safeFetch('https://komaapi.com/api/usage/token', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${trimmedKey}`,
          'Accept': 'application/json',
        },
      });

      if (response.status === 401 || response.status === 403) {
        return { success: false, status: response.status, error: 'invalid_key' };
      }

      if (!response.ok) {
        return { success: false, status: response.status, error: 'usage_failed' };
      }

      const resData = await response.json();
      const isSuccess = resData.code === true || resData.success === true;

      if (isSuccess && resData.data) {
        const d = resData.data;
        return {
          success: true,
          data: {
            name: d.name,
            totalGranted: d.total_granted,
            totalUsed: d.total_used,
            totalAvailable: d.total_available,
            unlimitedQuota: d.unlimited_quota,
            expiresAt: d.expires_at,
            quotaPerUnit: DEFAULT_QUOTA_PER_UNIT,
          }
        };
      }

      return { success: false, error: 'usage_failed' };
    } catch (err) {
      console.error('Network error during token usage check');
      return { success: false, error: 'network_error' };
    }
  },

  /**
   * 获取已保存的 API Key 额度信息 (使用加密渠道 Key)
   */
  async getStoredTokenUsage(channelId: string): Promise<{ success: boolean; data?: TokenUsageInfo; status?: number; error?: string }> {
    if (channelId !== KOMAAPI_ACTIVATION_CHANNEL_ID) {
      return { success: false, error: 'invalid_channel' };
    }

    try {
      const response = await safeFetch('https://komaapi.com/api/usage/token', {
        method: 'GET',
        headers: {
          'x-koma-channel-id': channelId,
          'Accept': 'application/json',
        },
      });

      if (response.status === 401 || response.status === 403) {
        return { success: false, status: response.status, error: 'invalid_key' };
      }

      if (!response.ok) {
        return { success: false, status: response.status, error: 'usage_failed' };
      }

      const resData = await response.json();
      const isSuccess = resData.code === true || resData.success === true;

      if (isSuccess && resData.data) {
        const d = resData.data;
        return {
          success: true,
          data: {
            name: d.name,
            totalGranted: d.total_granted,
            totalUsed: d.total_used,
            totalAvailable: d.total_available,
            unlimitedQuota: d.unlimited_quota,
            expiresAt: d.expires_at,
            quotaPerUnit: DEFAULT_QUOTA_PER_UNIT,
          }
        };
      }
      return { success: false, error: 'usage_failed' };
    } catch (err) {
      console.error('Network error during stored token usage check');
      return { success: false, error: 'network_error' };
    }
  },

  /**
   * 取已激活的 API Key 明文（仅 Electron 环境）。
   * 主进程会兼容老格式 kv 与新格式（加密渠道）；未激活返回 null。
   */
  async getApiKey(): Promise<string | null> {
    if (!electronService.isElectron()) {
      // Web 端没有加密渠道，仅当 kv 还存着旧格式 apiKey 时能拿到明文
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return null;
        const data = JSON.parse(stored);
        return typeof data?.apiKey === 'string' && data.apiKey ? data.apiKey : null;
      } catch {
        return null;
      }
    }

    try {
      const res = await electronService.ipc.invoke('activation:get-api-key');
      if (res && res.ok) {
        const apiKey = res.data?.apiKey;
        return typeof apiKey === 'string' && apiKey ? apiKey : null;
      }
      return null;
    } catch {
      return null;
    }
  },

  /**
   * 脱敏 API Key
   */
  maskApiKey(key: string): string {
    if (key.length <= 10) return '***';
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  },

  /**
   * 确保默认模型渠道存在（激活成功后调用）
   */
  async ensureDefaultModelChannels(apiKey: string): Promise<{ success: boolean; channelIds?: { llm: string; tti: string; itv: string }; error?: string }> {
    if (!electronService.isElectron()) {
      return {
        success: true,
        channelIds: {
          llm: KOMAAPI_ACTIVATION_CHANNEL_ID,
          tti: KOMAAPI_ACTIVATION_CHANNEL_IDS.tti,
          itv: KOMAAPI_ACTIVATION_CHANNEL_IDS.itv
        }
      };
    }

    const configs = [
      {
        id: KOMAAPI_ACTIVATION_CHANNEL_ID,
        category: 'llm' as const,
        providerType: 'openai',
        name: 'Koma官方',
        providerConfig: withKomaActivationChannelMarker({ baseUrl: 'https://komaapi.com/v1', apiKey }),
        defaultModelId: 'glm-5',
        models: [
          {
            id: 'glm-5',
            label: 'glm-5',
            providerModelName: 'glm-5',
            capabilities: ['llm.chat' as ModelCapability],
          },
        ],
        enabled: true,
        source: 'builtin' as const,
      },
      {
        id: KOMAAPI_ACTIVATION_CHANNEL_IDS.tti,
        category: 'tti' as const,
        providerType: 'grok2api-imagine-tti',
        name: 'Koma官方',
        providerConfig: withKomaActivationChannelMarker({
          baseUrl: 'https://komaapi.com',
          apiKey,
          promptProtocol: 'grok-image-index',
          defaultSize: '720x1280',
          defaultSteps: 20,
        }),
        defaultModelId: 'grok-image-all',
        models: [
          {
            id: 'grok-image-all',
            label: 'grok-image-all',
            providerModelName: 'grok-image-all',
            capabilities: [
              'image.text-to-image' as ModelCapability,
              'image.image-to-image' as ModelCapability,
            ],
          },
        ],
        enabled: true,
        source: 'builtin' as const,
      },
      {
        id: KOMAAPI_ACTIVATION_CHANNEL_IDS.itv,
        category: 'itv' as const,
        providerType: 'grok2api-imagine-itv',
        name: 'Koma官方',
        providerConfig: withKomaActivationChannelMarker({
          baseUrl: 'https://komaapi.com',
          apiKey,
          promptProtocol: 'grok-image-index',
          defaultDuration: 10,
          defaultResolution: '720p',
        }),
        defaultModelId: 'grok-imagine-video',
        models: [
          {
            id: 'grok-imagine-video',
            label: 'grok-imagine-video',
            providerModelName: 'grok-imagine-video',
            capabilities: [
              'video.text-to-video' as ModelCapability,
              'video.image-to-video' as ModelCapability,
              'video.reference-to-video' as ModelCapability,
            ],
          },
        ],
        enabled: true,
        source: 'builtin' as const,
      },
      // 即梦视频（Koma 即梦 seedance）：用独立的 SuiheITVProvider runtime，不复用 grok2api。
      // 上游路径都是 OpenAI 兼容的 /v1/videos/generations，但 grok2api 内部
      // 会强制注入 grok-image-index 协议、特殊 ratio 处理等，与Koma 即梦参数不兼容。
      // 上游约束：
      //   - 上游当前阶段强制锁定 480p
      //   - 时长 seedance-2.5-r / seedance-2.5-f: 4-15s（缺省 5s）
      // baseUrl 走 komaapi.com，通过 model 字段路由到Koma 即梦上游渠道。
      // 注：上游模型名为 `seedance-2.5-r` / `seedance-2.5-f`，UI label 仍展示
      //     "Seedance 2.0" / "Seedance 2.0 Fast" 两个友好名。
      {
        id: KOMAAPI_ACTIVATION_CHANNEL_IDS.itvJimeng,
        category: 'itv' as const,
        providerType: 'koma-suihe-itv',
        name: 'Koma官方-即梦',
        providerConfig: withKomaActivationChannelMarker({
          baseUrl: 'https://komaapi.com',
          apiKey,
          // 与 Koma 官方-Grok 渠道对齐：默认开启 Koma 协议，把 @char/@scene/@prop
          // 编译为 @Image N。SuiheITVProvider 构造函数会兜底默认这个值，但显式
          // 写到 providerConfig 让 UI 里能看到"Koma 协议"被选中而不是"不启用"。
          promptProtocol: 'grok-image-index',
          defaultDuration: 5,
          defaultResolution: '480p',
        }),
        defaultModelId: 'seedance-2.5-r',
        models: [
          {
            id: 'seedance-2.5-r',
            label: 'Seedance 2.0',
            providerModelName: 'seedance-2.5-r',
            // Koma 即梦 seedance 上游同时支持 reference-to-video（多参考），
            // 默认放出来与 grok 视频对齐，用户无需手动改 capability。
            capabilities: [
              'video.text-to-video' as ModelCapability,
              'video.image-to-video' as ModelCapability,
              'video.reference-to-video' as ModelCapability,
            ],
          },
          {
            id: 'seedance-2.5-f',
            label: 'Seedance 2.0 Fast',
            providerModelName: 'seedance-2.5-f',
            capabilities: [
              'video.text-to-video' as ModelCapability,
              'video.image-to-video' as ModelCapability,
              'video.reference-to-video' as ModelCapability,
            ],
          },
        ],
        enabled: true,
        // 不抢占 itv 默认渠道；保持 grok 为默认，用户可在设置里切换。
        source: 'builtin' as const,
      },
      // Koma 官方 TTS（qwen-tts，OpenAI 兼容 /v1/audio/speech）。内置音色 cherry / 芊悦。
      // 走 komaapi.com 网关，激活 Key 直接复用。
      {
        id: KOMAAPI_ACTIVATION_CHANNEL_IDS.tts,
        category: 'tts' as const,
        providerType: 'koma-tts',
        name: 'Koma 官方 TTS',
        providerConfig: withKomaActivationChannelMarker({
          baseUrl: 'https://komaapi.com',
          apiKey,
          model: 'qwen-tts',
          defaultVoice: 'cherry',
        }),
        defaultModelId: 'qwen-tts',
        models: [
          {
            id: 'qwen-tts',
            label: 'Qwen TTS',
            providerModelName: 'qwen-tts',
            capabilities: ['speech.text-to-speech' as ModelCapability],
          },
        ],
        enabled: true,
        source: 'builtin' as const,
      },
    ];

    try {
      for (const cfg of configs) {
        const existing = await channelConfigService.getChannel(cfg.id);
        if (existing) {
          await channelConfigService.updateChannel(cfg.id, {
            ...cfg,
            // providerConfig 包含 apiKey，updateChannel 会处理加密
          });
        } else {
          await channelConfigService.createChannel(cfg);
        }

        // 设置为该类型的默认；同一 category 下后注册的渠道不抢占默认。
        // 即梦渠道作为 grok 的并行选项，仅在用户手动切换时生效。
        if (cfg.id === KOMAAPI_ACTIVATION_CHANNEL_IDS.itvJimeng) {
          continue;
        }
        await channelConfigService.setMediaDefault(cfg.category, {
          channelId: cfg.id,
          modelId: cfg.defaultModelId,
        });
      }
      return {
        success: true,
        channelIds: {
          llm: KOMAAPI_ACTIVATION_CHANNEL_IDS.llm,
          tti: KOMAAPI_ACTIVATION_CHANNEL_IDS.tti,
          itv: KOMAAPI_ACTIVATION_CHANNEL_IDS.itv
        }
      };
    } catch (err) {
      console.error('Failed to ensure default model channels');
      return { success: false, error: 'default_channels_failed' };
    }
  },

  /**
   * 补齐 / 修正已激活老用户的 koma-activation 管理渠道。
   *
   * 启动时检测两类问题，通过后端 `channel:reconcileActivation` 自动处理：
   *   1) **缺失**：v1 激活流程只创建 llm/tti/itv 三个渠道；后续版本新增 itvJimeng 等管理渠道，
   *      老用户重启后 getActivationInfo 走"新格式直接返回"分支，不会重跑 ensureDefaultModelChannels。
   *   2) **providerType 漂移**：早期错误把即梦渠道 providerType 写成 grok2api-imagine-itv / seedance
   *      等，需要纠正为 koma-suihe-itv（独立 runtime）。仅按 id+providerType 期望值校验，
   *      不匹配就强制 update 修正（apiKey 由后端从同批管理渠道解密继承，不需要前端持有明文）。
   *
   * 失败/部分失败都不影响应用启动（仅 console.warn）。
   */
  async reconcileMissingManagedChannels(): Promise<void> {
    if (!electronService.isElectron()) return;

    // 期望状态：每个管理渠道应该是哪个 providerType + 配套的完整配置
    const itvJimengCfg: Parameters<typeof channelConfigService.reconcileActivationChannels>[0][number] = {
      id: KOMAAPI_ACTIVATION_CHANNEL_IDS.itvJimeng,
      category: 'itv',
      providerType: 'koma-suihe-itv',
      name: 'Koma官方-即梦',
      providerConfig: withKomaActivationChannelMarker({
        baseUrl: 'https://komaapi.com',
        // apiKey 由后端从 sourceChannelIds 解密继承
        // 默认开启 Koma 协议（与首次激活保持一致），UI 上显式显示而不是 placeholder
        promptProtocol: 'grok-image-index',
        defaultDuration: 5,
        defaultResolution: '480p',
      }),
      defaultModelId: 'seedance-2.5-r',
      models: [
        {
          id: 'seedance-2.5-r',
          label: 'Seedance 2.0',
          providerModelName: 'seedance-2.5-r',
          // 老用户激活时多参考能力默认未开，reconcile 时也补上。
          capabilities: [
            'video.text-to-video' as ModelCapability,
            'video.image-to-video' as ModelCapability,
            'video.reference-to-video' as ModelCapability,
          ],
        },
        {
          id: 'seedance-2.5-f',
          label: 'Seedance 2.0 Fast',
          providerModelName: 'seedance-2.5-f',
          capabilities: [
            'video.text-to-video' as ModelCapability,
            'video.image-to-video' as ModelCapability,
            'video.reference-to-video' as ModelCapability,
          ],
        },
      ],
      enabled: true,
      source: 'builtin',
    };

    // Koma 官方 TTS（qwen-tts）：v1 激活流程没建过 tts 管理渠道，老用户重启时
    // 走 reconcile 兜底补齐。这里同样不带 apiKey（后端从 sourceChannelIds 解密继承）。
    const ttsCfg: Parameters<typeof channelConfigService.reconcileActivationChannels>[0][number] = {
      id: KOMAAPI_ACTIVATION_CHANNEL_IDS.tts,
      category: 'tts',
      providerType: 'koma-tts',
      name: 'Koma 官方 TTS',
      providerConfig: withKomaActivationChannelMarker({
        baseUrl: 'https://komaapi.com',
        // apiKey 由后端从 sourceChannelIds 解密继承
        model: 'qwen-tts',
        defaultVoice: 'cherry',
      }),
      defaultModelId: 'qwen-tts',
      models: [
        {
          id: 'qwen-tts',
          label: 'Qwen TTS',
          providerModelName: 'qwen-tts',
          capabilities: ['speech.text-to-speech' as ModelCapability],
        },
      ],
      enabled: true,
      source: 'builtin',
    };

    // 期望管理渠道清单：[(id, expected providerType, 期望完整配置)]
    const expected = [
      { id: itvJimengCfg.id!, providerType: itvJimengCfg.providerType, cfg: itvJimengCfg },
      { id: ttsCfg.id!, providerType: ttsCfg.providerType, cfg: ttsCfg },
      // 其它管理渠道（llm/tti/itv）原 ensureDefaultModelChannels 已建出，
      // 这里也可以加进来作为额外保护（落入 update 路径），但目前没有 providerType 漂移问题，先不加。
    ];

    // 拉取现状
    const allManagedIds = Object.values(KOMAAPI_ACTIVATION_CHANNEL_IDS);
    const channelMap = new Map<string, Awaited<ReturnType<typeof channelConfigService.getChannel>>>();
    await Promise.all(
      allManagedIds.map(async (id) => {
        const channel = await channelConfigService.getChannel(id);
        channelMap.set(id, channel);
      }),
    );

    // 计算需要 reconcile 的 cfg：缺失 OR providerType 不匹配 OR 期望 model 的
    // capabilities 漂移（老 build 写的是 ['tts']，新 build 期望 ['speech.text-to-speech']）。
    const reconcileConfigs: Parameters<typeof channelConfigService.reconcileActivationChannels>[0] = [];
    for (const entry of expected) {
      const existing = channelMap.get(entry.id);
      if (!existing) {
        reconcileConfigs.push(entry.cfg);
        continue;
      }
      if (existing.providerType !== entry.providerType) {
        console.info(
          `[activation] managed channel ${entry.id} providerType drift detected: ${existing.providerType} → ${entry.providerType}, fixing`,
        );
        reconcileConfigs.push(entry.cfg);
        continue;
      }
      // 检查每个期望 model 在 existing 里有对应 id 且 capabilities 完全包含期望集合
      const existingModels = Array.isArray(existing.models) ? existing.models : [];
      const capabilityDrift = entry.cfg.models?.some((expectedModel) => {
        const existingModel = existingModels.find((m: any) => m.id === expectedModel.id);
        if (!existingModel) return true;
        const existingCaps = new Set(Array.isArray(existingModel.capabilities) ? existingModel.capabilities : []);
        return (expectedModel.capabilities || []).some((cap) => !existingCaps.has(cap));
      });
      if (capabilityDrift) {
        console.info(
          `[activation] managed channel ${entry.id} model capability drift detected, fixing`,
        );
        reconcileConfigs.push(entry.cfg);
      }
    }
    if (reconcileConfigs.length === 0) return;

    // 用所有"已存在"的管理渠道做 apiKey 继承源（含被纠正的渠道本身——它们也已经有密文 apiKey）
    const sourceChannelIds = allManagedIds.filter((id) => channelMap.get(id));
    if (sourceChannelIds.length === 0) {
      console.warn('[activation] no source channel to inherit apiKey, skipping reconcile');
      return;
    }
    await channelConfigService.reconcileActivationChannels(reconcileConfigs, sourceChannelIds);
    console.info(`[activation] reconciled ${reconcileConfigs.length} managed channel(s)`);
  },
};
