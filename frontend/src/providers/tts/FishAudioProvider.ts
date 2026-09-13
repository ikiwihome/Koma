/**
 * Fish Audio TTS Provider
 * https://fish.audio/
 *
 * 凭据走 ChannelAuth Strategy：
 *   - profileId 存在 → x-koma-channel-id 主进程代理 Bearer
 *   - 回退 → 明文 Authorization: Bearer <apiKey>
 */
import type { TTSConfig, AudioResult, Voice } from '../../types';
import type { ProviderStartResult } from '../../types';
import type { TTSProvider, TTSRequest } from './types';
import { fetchWithChannelAuth } from '../channel/auth';
import { isChannelNetError } from '../netError';

export class FishAudioProvider implements TTSProvider {
  type = 'fish-audio' as const;
  config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  validate(): boolean {
    return Boolean(this.config.profileId || this.config.apiKey);
  }

  async testConnection(): Promise<boolean> {
    if (!this.validate()) return false;

    try {
      const response = await fetchWithChannelAuth(`${this.getBaseUrl()}/model`, {
        channelId: this.config.profileId,
        apiKey: this.config.apiKey,
        mode: 'bearer-header',
        fetchOptions: { method: 'GET' },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private getBaseUrl(): string {
    return this.config.baseUrl || 'https://api.fish.audio/v1';
  }

  async start(request: TTSRequest): Promise<ProviderStartResult<AudioResult>> {
    const { text, voiceId, options } = request;
    if (!this.validate()) {
      throw new Error('Fish Audio API Key 未配置');
    }

    let response: Response;
    try {
      response = await fetchWithChannelAuth(`${this.getBaseUrl()}/tts`, {
        channelId: this.config.profileId,
        apiKey: this.config.apiKey,
        mode: 'bearer-header',
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            reference_id: voiceId,
            format: 'mp3',
            latency: 'normal',
            streaming: false,
            ...(options?.rate && { speed: options.rate }),
          }),
        },
      });
    } catch (err) {
      if (isChannelNetError(err)) {
        throw new Error(`Fish Audio 合成失败 (${err.status}): ${err.message}`);
      }
      throw err;
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    // 估算时长 (实际需要解析音频)
    const estimatedDuration = text.length * 0.15;

    return {
      mode: 'immediate',
      output: {
        path: audioUrl,
        duration: estimatedDuration,
        format: 'mp3',
      },
    };
  }

  async listVoices(): Promise<Voice[]> {
    if (!this.validate()) {
      return [];
    }

    try {
      const response = await fetchWithChannelAuth(`${this.getBaseUrl()}/model`, {
        channelId: this.config.profileId,
        apiKey: this.config.apiKey,
        mode: 'bearer-header',
        fetchOptions: { method: 'GET' },
      });

      if (!response.ok) {
        return this.getDefaultVoices();
      }

      const data = await response.json();
      return (data.items || []).map((item: any) => ({
        id: item._id,
        name: item.title || item.name || item._id,
        language: item.languages?.[0] || 'zh',
        gender: item.gender || 'unknown',
        provider: 'fish-audio' as const,
        previewUrl: item.cover_image,
      }));
    } catch {
      return this.getDefaultVoices();
    }
  }

  private getDefaultVoices(): Voice[] {
    return [
      { id: 'default', name: '默认音色', language: 'zh', gender: 'female', provider: 'fish-audio' },
    ];
  }
}
