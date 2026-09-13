import { describe, expect, it } from 'vitest';
import type { ActivationInfo } from '../../services/activationService';
import type { AppSettings } from '../../types';
import type { ModelCapability } from '../../providers/channel/types';
import {
  buildLLMConfigFromContext,
  resolveConfiguredChannelModel,
  serializeMediaSelection,
} from '../../providers/channel/resolver';
import {
  buildChatSessionConfig,
  CHAT_AUTH_ERROR_MESSAGE,
  formatChatErrorMessage,
  resolveInitialChatLLMSelection,
} from './chatPageUtils';

const KOMA_OFFICIAL_LLM_CHANNEL_ID = 'komaapi-default-llm';

function createActivationInfo(): ActivationInfo {
  return {
    activatedAt: 1,
    lastValidatedAt: 2,
    maskedKey: 'sk-***',
    defaultChannelIds: {
      llm: KOMA_OFFICIAL_LLM_CHANNEL_ID,
      tti: 'komaapi-default-tti',
      itv: 'komaapi-default-itv',
    },
  };
}

function createSettings(options?: { officialEnabled?: boolean; officialModelCapabilities?: ModelCapability[] }): AppSettings {
  return {
    channelConfigs: [
      {
        id: 'legacy-openai',
        name: '旧 OpenAI',
        category: 'llm',
        providerType: 'openai',
        providerConfig: {
          baseUrl: 'https://api.openai.com/v1',
          hasApiKey: true,
        },
        defaultModelId: 'gpt-4o',
        models: [
          {
            id: 'gpt-4o',
            label: 'gpt-4o',
            providerModelName: 'gpt-4o',
            capabilities: ['llm.chat'],
          },
        ],
        enabled: true,
        source: 'builtin',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: KOMA_OFFICIAL_LLM_CHANNEL_ID,
        name: 'Koma官方',
        category: 'llm',
        providerType: 'openai',
        providerConfig: {
          baseUrl: 'https://komaapi.com/v1',
          hasApiKey: true,
        },
        defaultModelId: 'glm-5',
        models: [
          {
            id: 'glm-5',
            label: 'glm-5',
            providerModelName: 'glm-5',
            capabilities: options?.officialModelCapabilities ?? ['llm.chat'],
          },
        ],
        enabled: options?.officialEnabled ?? true,
        source: 'builtin',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    mediaDefaults: {
      llm: {
        channelId: 'legacy-openai',
        modelId: 'gpt-4o',
      },
    },
    promptTemplates: {},
  };
}

describe('chatPageUtils', () => {
  it('激活信息存在且官方 LLM 渠道可用时，初始选择优先于旧 OpenAI 默认', () => {
    const settings = createSettings();
    const selection = resolveInitialChatLLMSelection(settings, createActivationInfo());

    expect(serializeMediaSelection(selection)).toBe('komaapi-default-llm::glm-5');

    const context = resolveConfiguredChannelModel(settings, 'llm', selection, 'llm.chat');
    expect(context).toBeDefined();

    const selectedConfig = buildLLMConfigFromContext(context!);
    expect(selectedConfig.profileId).toBe(KOMA_OFFICIAL_LLM_CHANNEL_ID);
    expect(selectedConfig.baseUrl).toBe('https://komaapi.com/v1');

    const sessionConfig = buildChatSessionConfig(selectedConfig);
    expect(sessionConfig).toMatchObject({
      llmProfileId: KOMA_OFFICIAL_LLM_CHANNEL_ID,
      modelProvider: 'openai-compatible',
      modelName: 'glm-5',
      baseUrl: 'https://komaapi.com/v1',
    });
  });

  it('官方渠道不可用时回退现有默认 LLM 选择', () => {
    const selection = resolveInitialChatLLMSelection(
      createSettings({ officialEnabled: false }),
      createActivationInfo(),
    );

    expect(serializeMediaSelection(selection)).toBe('legacy-openai::gpt-4o');
  });

  it('官方渠道模型不支持 llm.chat 时回退现有默认 LLM 选择', () => {
    const selection = resolveInitialChatLLMSelection(
      createSettings({ officialModelCapabilities: [] }),
      createActivationInfo(),
    );

    expect(serializeMediaSelection(selection)).toBe('legacy-openai::gpt-4o');
  });

  it('鉴权错误显示友好提示且不保留 API Key', () => {
    const formatted = formatChatErrorMessage(
      new Error('401 Incorrect API key provided: sk-xxxx. You can find your API key at https://platform.openai.com/account/api-keys.'),
    );

    expect(formatted).toBe(CHAT_AUTH_ERROR_MESSAGE);
    expect(formatted).not.toContain('sk-xxxx');
  });

  it('非鉴权错误会脱敏常见 API Key 片段', () => {
    const formatted = formatChatErrorMessage(
      'provider failed with sk-abcdefghijklmnop xai-abcdefghi AIzaSyA1234567890abcdef and Bearer secret-token-123456',
    );

    expect(formatted).toContain('[REDACTED_API_KEY]');
    expect(formatted).not.toContain('sk-abcdefghijklmnop');
    expect(formatted).not.toContain('xai-abcdefghi');
    expect(formatted).not.toContain('AIzaSyA1234567890abcdef');
    expect(formatted).not.toContain('secret-token-123456');
  });
});
