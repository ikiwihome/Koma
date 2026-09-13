import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ipcInvoke: vi.fn(),
  runtime: {
    isElectron: true,
  },
}));

vi.mock('./electronService', () => ({
  electronService: {
    isElectron: () => mocks.runtime.isElectron,
    ipc: {
      invoke: (channel: string, args?: unknown) => mocks.ipcInvoke(channel, args),
    },
  },
}));

import { activationService, KOMAAPI_ACTIVATION_CHANNEL_ID } from './activationService';
import {
  KOMA_ACTIVATION_MANAGED_BY,
  KOMAAPI_ACTIVATION_CHANNEL_IDS,
  isKomaActivationManagedChannel,
} from '../utils/activationManagedChannels';

const STORAGE_KEY = 'koma-activation';
const FAKE_LEGACY_KEY = 'test-key-value-1234';
type ActivationTestCategory = 'llm' | 'tti' | 'itv' | 'tts';

const ACTIVATION_CATEGORY_BY_ID: Record<string, ActivationTestCategory> = {
  [KOMAAPI_ACTIVATION_CHANNEL_IDS.llm]: 'llm',
  [KOMAAPI_ACTIVATION_CHANNEL_IDS.tti]: 'tti',
  [KOMAAPI_ACTIVATION_CHANNEL_IDS.itv]: 'itv',
  [KOMAAPI_ACTIVATION_CHANNEL_IDS.itvJimeng]: 'itv',
  [KOMAAPI_ACTIVATION_CHANNEL_IDS.tts]: 'tts',
};

function makeChannelDto(input: any) {
  return {
    id: input.id,
    category: input.category,
    providerType: input.providerType,
    name: input.name,
    description: input.description ?? null,
    baseUrl: input.baseUrl ?? null,
    hasApiKey: Boolean(input.providerConfig?.apiKey),
    providerConfig: {},
    models: input.models ?? [],
    capabilities: input.capabilities ?? [],
    polling: input.polling ?? null,
    extras: input.extras ?? {},
    defaultModelId: input.defaultModelId ?? null,
    source: input.source ?? 'builtin',
    pluginId: input.pluginId ?? null,
    enabled: input.enabled ?? true,
    isDefault: input.isDefault ?? false,
    sortOrder: input.sortOrder ?? 0,
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeActivationChannelDto(id: string, providerConfig: Record<string, unknown>) {
  return {
    ...makeChannelDto({
      id,
      category: ACTIVATION_CATEGORY_BY_ID[id],
      providerType: 'openai',
      name: 'Koma官方',
      providerConfig,
      defaultModelId: 'test-model',
      models: [],
    }),
    providerConfig,
  };
}

function mockSuccessfulElectronMigration(value: unknown) {
  mocks.ipcInvoke.mockImplementation(async (channel: string, args?: any) => {
    if (channel === 'app-kv:get') {
      return { ok: true, data: { value } };
    }
    if (channel === 'app-kv:set') {
      return { ok: true, data: undefined };
    }
    if (channel === 'channel:get') {
      return { ok: true, data: null };
    }
    if (channel === 'channel:create') {
      return { ok: true, data: makeChannelDto(args) };
    }
    if (channel === 'channel:setDefault') {
      return {
        ok: true,
        data: {
          category: args.category,
          channelId: args.channelId,
          modelId: args.modelId,
          payload: {},
          updatedAt: 3,
        },
      };
    }
    throw new Error(`unexpected ipc channel: ${channel}`);
  });
}

beforeEach(() => {
  mocks.runtime.isElectron = true;
  mocks.ipcInvoke.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('activation managed channel markers', () => {
  it('只通过 providerConfig marker 识别激活渠道，不通过固定 id 识别', () => {
    const channelWithDefaultIdOnly = {
      id: KOMAAPI_ACTIVATION_CHANNEL_IDS.llm,
      providerConfig: {},
    };

    expect(isKomaActivationManagedChannel(channelWithDefaultIdOnly)).toBe(false);
    expect(isKomaActivationManagedChannel({
      providerConfig: { managedBy: KOMA_ACTIVATION_MANAGED_BY },
    })).toBe(true);
    expect(isKomaActivationManagedChannel({
      providerConfig: { activationManaged: true },
    })).toBe(true);
  });
});

describe('activationService clearActivationInfo', () => {
  it('取消激活会删除三个带 marker 的默认渠道，并删除 koma-activation app-kv', async () => {
    mocks.ipcInvoke.mockImplementation(async (channel: string, args?: any) => {
      if (channel === 'channel:get') {
        return {
          ok: true,
          data: makeActivationChannelDto(args.id, {
            managedBy: KOMA_ACTIVATION_MANAGED_BY,
            activationManaged: true,
          }),
        };
      }
      if (channel === 'channel:delete') {
        return { ok: true, data: true };
      }
      if (channel === 'app-kv:delete') {
        return { ok: true, data: true };
      }
      throw new Error(`unexpected ipc channel: ${channel}`);
    });

    await activationService.clearActivationInfo();

    const expectedIds = Object.values(KOMAAPI_ACTIVATION_CHANNEL_IDS);
    const getCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'channel:get');
    const deleteCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'channel:delete');
    const appKvDeleteCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'app-kv:delete');

    expect(getCalls.map(([, args]) => args.id)).toEqual(expectedIds);
    expect(deleteCalls.map(([, args]) => args.id)).toEqual(expectedIds);
    expect(appKvDeleteCalls).toHaveLength(1);
    expect(appKvDeleteCalls[0][1]).toEqual({ key: STORAGE_KEY });
  });

  it('固定 id 渠道没有 marker 时不删除，并仍删除 koma-activation app-kv', async () => {
    mocks.ipcInvoke.mockImplementation(async (channel: string, args?: any) => {
      if (channel === 'channel:get') {
        return { ok: true, data: makeActivationChannelDto(args.id, {}) };
      }
      if (channel === 'channel:delete') {
        throw new Error('channel:delete should not be called');
      }
      if (channel === 'app-kv:delete') {
        return { ok: true, data: true };
      }
      throw new Error(`unexpected ipc channel: ${channel}`);
    });

    await activationService.clearActivationInfo();

    const expectedIds = Object.values(KOMAAPI_ACTIVATION_CHANNEL_IDS);
    const getCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'channel:get');
    const deleteCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'channel:delete');
    const appKvDeleteCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'app-kv:delete');

    expect(getCalls.map(([, args]) => args.id)).toEqual(expectedIds);
    expect(deleteCalls).toHaveLength(0);
    expect(appKvDeleteCalls).toHaveLength(1);
    expect(appKvDeleteCalls[0][1]).toEqual({ key: STORAGE_KEY });
  });
});

describe('activationService legacy activation migration', () => {
  it('Electron 旧明文格式迁移前先用 trimmed key 补齐默认渠道，再保存脱敏激活信息', async () => {
    mockSuccessfulElectronMigration({
      apiKey: `  ${FAKE_LEGACY_KEY}  `,
      activatedAt: 100,
      lastValidatedAt: 200,
    });

    const info = await activationService.getActivationInfo();

    expect(info).toEqual({
      activatedAt: 100,
      lastValidatedAt: 200,
      maskedKey: activationService.maskApiKey(FAKE_LEGACY_KEY),
      defaultChannelIds: {
        llm: KOMAAPI_ACTIVATION_CHANNEL_ID,
        tti: KOMAAPI_ACTIVATION_CHANNEL_IDS.tti,
        itv: KOMAAPI_ACTIVATION_CHANNEL_IDS.itv,
      },
    });

    const createCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'channel:create');
    // 5 个 koma-activation 管理渠道：llm / tti / itv（grok）/ itvJimeng（即梦）/ tts
    expect(createCalls).toHaveLength(5);
    expect(createCalls.map(([, args]) => args.providerConfig.apiKey)).toEqual([
      FAKE_LEGACY_KEY,
      FAKE_LEGACY_KEY,
      FAKE_LEGACY_KEY,
      FAKE_LEGACY_KEY,
      FAKE_LEGACY_KEY,
    ]);
    expect(createCalls.map(([, args]) => args.name)).toEqual([
      'Koma官方',
      'Koma官方',
      'Koma官方',
      'Koma官方-即梦',
      'Koma 官方 TTS',
    ]);
    expect(createCalls.map(([, args]) => args.providerConfig.managedBy)).toEqual([
      KOMA_ACTIVATION_MANAGED_BY,
      KOMA_ACTIVATION_MANAGED_BY,
      KOMA_ACTIVATION_MANAGED_BY,
      KOMA_ACTIVATION_MANAGED_BY,
      KOMA_ACTIVATION_MANAGED_BY,
    ]);
    expect(createCalls.map(([, args]) => args.providerConfig.activationManaged)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);

    const saveCallIndex = mocks.ipcInvoke.mock.calls.findIndex(([channel]) => channel === 'app-kv:set');
    const lastDefaultWriteIndex = mocks.ipcInvoke.mock.calls.reduce(
      (lastIndex, [channel], index) => (channel === 'channel:setDefault' ? index : lastIndex),
      -1,
    );
    expect(saveCallIndex).toBeGreaterThan(lastDefaultWriteIndex);

    const saveCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'app-kv:set');
    expect(saveCalls).toHaveLength(1);
    const savedValue = saveCalls[0][1].value;
    expect(savedValue.apiKey).toBeUndefined();
    expect(JSON.stringify(savedValue)).not.toContain(FAKE_LEGACY_KEY);
  });

  it('Electron 默认渠道补齐失败时返回 null，且不覆盖旧明文记录', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.ipcInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'app-kv:get') {
        return {
          ok: true,
          data: { value: { apiKey: FAKE_LEGACY_KEY, activatedAt: 100, lastValidatedAt: 200 } },
        };
      }
      if (channel === 'channel:get') {
        return { ok: false, code: 'TEST_FAILURE', message: 'failed' };
      }
      if (channel === 'app-kv:set') {
        throw new Error('app-kv:set should not be called');
      }
      throw new Error(`unexpected ipc channel: ${channel}`);
    });

    const info = await activationService.getActivationInfo();

    expect(info).toBeNull();
    expect(mocks.ipcInvoke.mock.calls.some(([channel]) => channel === 'app-kv:set')).toBe(false);
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(FAKE_LEGACY_KEY);
  });

  it('旧格式 apiKey 为空白字符串时返回 null，且不保存脱敏激活态', async () => {
    mocks.ipcInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'app-kv:get') {
        return { ok: true, data: { value: { apiKey: '   ', activatedAt: 100 } } };
      }
      throw new Error(`unexpected ipc channel: ${channel}`);
    });

    const info = await activationService.getActivationInfo();

    expect(info).toBeNull();
    expect(mocks.ipcInvoke.mock.calls.map(([channel]) => channel)).toEqual(['app-kv:get']);
  });

  it('浏览器环境迁移旧格式时使用默认 channelIds 并保存脱敏信息', async () => {
    mocks.runtime.isElectron = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey: ` ${FAKE_LEGACY_KEY} `, activatedAt: 100 }));

    const info = await activationService.getActivationInfo();

    expect(info?.defaultChannelIds).toEqual({
      llm: KOMAAPI_ACTIVATION_CHANNEL_ID,
      tti: KOMAAPI_ACTIVATION_CHANNEL_IDS.tti,
      itv: KOMAAPI_ACTIVATION_CHANNEL_IDS.itv,
    });
    expect(info?.maskedKey).toBe(activationService.maskApiKey(FAKE_LEGACY_KEY));
    expect(mocks.ipcInvoke).not.toHaveBeenCalled();

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(saved.apiKey).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain(FAKE_LEGACY_KEY);
  });
});

describe('activationService ensureDefaultModelChannels', () => {
  it('默认渠道已存在时也会更新激活 marker', async () => {
    const categoryById: Record<string, ActivationTestCategory> = {
      [KOMAAPI_ACTIVATION_CHANNEL_IDS.llm]: 'llm',
      [KOMAAPI_ACTIVATION_CHANNEL_IDS.tti]: 'tti',
      [KOMAAPI_ACTIVATION_CHANNEL_IDS.itv]: 'itv',
      [KOMAAPI_ACTIVATION_CHANNEL_IDS.itvJimeng]: 'itv',
      [KOMAAPI_ACTIVATION_CHANNEL_IDS.tts]: 'tts',
    };

    mocks.ipcInvoke.mockImplementation(async (channel: string, args?: any) => {
      if (channel === 'channel:get') {
        return {
          ok: true,
          data: makeChannelDto({
            id: args.id,
            category: categoryById[args.id],
            providerType: 'existing-provider',
            name: 'Existing Channel',
            providerConfig: {},
            defaultModelId: 'existing-model',
            models: [],
          }),
        };
      }
      if (channel === 'channel:update') {
        return { ok: true, data: makeChannelDto({ id: args.id, ...args.patch }) };
      }
      if (channel === 'channel:setDefault') {
        return {
          ok: true,
          data: {
            category: args.category,
            channelId: args.channelId,
            modelId: args.modelId,
            payload: {},
            updatedAt: 3,
          },
        };
      }
      throw new Error(`unexpected ipc channel: ${channel}`);
    });

    const result = await activationService.ensureDefaultModelChannels(FAKE_LEGACY_KEY);

    expect(result.success).toBe(true);
    const updateCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'channel:update');
    // 5 个管理渠道：llm / tti / itv（grok） / itvJimeng（即梦） / tts
    expect(updateCalls).toHaveLength(5);
    expect(updateCalls.map(([, args]) => args.patch.name)).toEqual([
      'Koma官方',
      'Koma官方',
      'Koma官方',
      'Koma官方-即梦',
      'Koma 官方 TTS',
    ]);
    expect(updateCalls.map(([, args]) => args.patch.providerConfig.managedBy)).toEqual([
      KOMA_ACTIVATION_MANAGED_BY,
      KOMA_ACTIVATION_MANAGED_BY,
      KOMA_ACTIVATION_MANAGED_BY,
      KOMA_ACTIVATION_MANAGED_BY,
      KOMA_ACTIVATION_MANAGED_BY,
    ]);
    expect(updateCalls.map(([, args]) => args.patch.providerConfig.activationManaged)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('激活时创建/更新 TTI 渠道使用新的默认模型 grok-image-all', async () => {
    mocks.ipcInvoke.mockImplementation(async (channel: string, args?: any) => {
      if (channel === 'channel:get') {
        return { ok: true, data: null };
      }
      if (channel === 'channel:create') {
        return { ok: true, data: makeChannelDto(args) };
      }
      if (channel === 'channel:setDefault') {
        return { ok: true, data: { updatedAt: Date.now() } };
      }
      throw new Error(`unexpected ipc channel: ${channel}`);
    });

    await activationService.ensureDefaultModelChannels(FAKE_LEGACY_KEY);

    const createCalls = mocks.ipcInvoke.mock.calls.filter(([channel]) => channel === 'channel:create');
    const ttiCreateCall = createCalls.find(([, args]) => args.id === KOMAAPI_ACTIVATION_CHANNEL_IDS.tti);

    expect(ttiCreateCall).toBeDefined();
    expect(ttiCreateCall?.[1].defaultModelId).toBe('grok-image-all');
    expect(ttiCreateCall?.[1].models[0].id).toBe('grok-image-all');
  });
});
