import type { ChannelConfig } from '../providers/channel/types';

export const KOMA_ACTIVATION_MANAGED_BY = 'koma-activation';

export const KOMAAPI_ACTIVATION_CHANNEL_IDS = {
  llm: 'komaapi-default-llm',
  tti: 'komaapi-default-tti',
  itv: 'komaapi-default-itv',
  // 即梦视频（Koma 即梦上游 seedance）：与 grok 视频共用 OpenAI /v1/videos 协议，
  // 通过 model 字段在 new-api 端分流到不同上游渠道。
  itvJimeng: 'komaapi-default-itv-jimeng',
  // Koma 官方 TTS（qwen-tts 模型，OpenAI 兼容 /v1/audio/speech）
  tts: 'komaapi-default-tts',
} as const;

type ActivationProviderConfig = Record<string, unknown> | null | undefined;

export function isKomaActivationProviderConfig(providerConfig: ActivationProviderConfig): boolean {
  return providerConfig?.managedBy === KOMA_ACTIVATION_MANAGED_BY
    || providerConfig?.activationManaged === true;
}

export function isKomaActivationManagedChannel(
  channel: Pick<ChannelConfig, 'providerConfig'> | null | undefined,
): boolean {
  if (!channel) return false;
  return isKomaActivationProviderConfig(channel.providerConfig);
}

export function withKomaActivationChannelMarker<T extends Record<string, unknown>>(
  providerConfig: T,
): T & { managedBy: typeof KOMA_ACTIVATION_MANAGED_BY; activationManaged: true } {
  return {
    ...providerConfig,
    managedBy: KOMA_ACTIVATION_MANAGED_BY,
    activationManaged: true,
  };
}
