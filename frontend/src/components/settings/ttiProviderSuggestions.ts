/**
 * TTI 渠道表单默认值建议。
 *
 * 与 itvProviderSuggestions.ts 对称：把 Koma 官方 TTI 渠道默认开启 Koma 协议
 * （grok-image-index）落到表单初始值，避免 UI 上 promptProtocol Select 显示
 * "不启用（默认）"误导用户以为没开。
 *
 * Provider 构造函数侧（OpenAICompatibleTTIProvider / Grok2ApiImagineTTIProvider /
 * GeminiNativeTTIProvider）已经兜底默认 'grok-image-index'，这里只是把 UI 表单
 * 初始值与 runtime 行为对齐。
 */

const TTI_PROVIDER_FIELD_DEFAULTS: Record<string, Record<string, unknown>> = {
  // Koma 官方三家 TTI 渠道：默认开启 Koma 协议
  'openai-compatible-tti': {
    promptProtocol: 'grok-image-index',
  },
  'grok2api-imagine-tti': {
    promptProtocol: 'grok-image-index',
  },
  'gemini-native-tti': {
    promptProtocol: 'grok-image-index',
  },
};

export function getSuggestedTTIFieldDefaults(providerType?: string): Record<string, unknown> {
  if (!providerType) return {};
  return { ...(TTI_PROVIDER_FIELD_DEFAULTS[providerType] || {}) };
}
