/**
 * OpenAI TTS Provider
 */
import type { TTSConfig, AudioResult, Voice } from '../../types';
import type { ProviderStartResult } from '../../types';
import type { TTSProvider, TTSRequest } from './types';
import { electronService } from '../../services/electronService';
import { createLogger } from '../../store/logger';
import { fetchWithChannelAuth } from '../channel/auth';
import { isChannelNetError } from '../netError';

const logger = createLogger('OpenAITTSProvider');

const OPENAI_VOICES: Voice[] = [
  { id: 'alloy', name: 'Alloy', language: 'multi', gender: 'neutral', provider: 'openai-tts' },
  { id: 'echo', name: 'Echo', language: 'multi', gender: 'male', provider: 'openai-tts' },
  { id: 'fable', name: 'Fable', language: 'multi', gender: 'female', provider: 'openai-tts' },
  { id: 'onyx', name: 'Onyx', language: 'multi', gender: 'male', provider: 'openai-tts' },
  { id: 'nova', name: 'Nova', language: 'multi', gender: 'female', provider: 'openai-tts' },
  { id: 'shimmer', name: 'Shimmer', language: 'multi', gender: 'female', provider: 'openai-tts' },
];

export class OpenAITTSProvider implements TTSProvider {
  type: 'openai-tts' = 'openai-tts';
  config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  private getModelName(): string {
    const value = String(this.config.modelName || '').trim();
    if (!value) {
      throw new Error('模型名称未配置');
    }
    return value;
  }

  validate(): boolean {
    return Boolean(
      (this.config.profileId || this.config.apiKey)
      && String(this.config.modelName || '').trim(),
    );
  }

  async testConnection(): Promise<boolean> {
    // 简单验证凭据 + 模型格式
    return this.validate();
  }

  async start(request: TTSRequest): Promise<ProviderStartResult<AudioResult>> {
    const { text, voiceId, options } = request;
    if (!this.config.profileId && !this.config.apiKey) {
      throw new Error('OpenAI API Key 未配置');
    }
    if (!String(this.config.modelName || '').trim()) {
      throw new Error('OpenAI TTS 模型未配置');
    }

    let response: Response;
    try {
      response = await fetchWithChannelAuth(
        `${this.config.baseUrl || 'https://api.openai.com/v1'}/audio/speech`,
        {
          channelId: this.config.profileId,
          apiKey: this.config.apiKey,
          mode: 'bearer-header',
          fetchOptions: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: this.getModelName(),
              input: text,
              voice: voiceId,
              speed: options?.rate || 1.0,
            }),
          },
        },
      );
    } catch (err) {
      if (isChannelNetError(err)) {
        throw new Error(`OpenAI TTS 合成失败 (${err.status}): ${err.message}`);
      }
      throw err;
    }

    const blob = await response.blob();

    // Save to file in Electron environment
    if (electronService.isElectron()) {
      try {
        const storagePath = await electronService.getStoragePath?.();
        if (storagePath) {
          const ttsDir = `${storagePath}/cache/tts`;
          await electronService.fs.mkdir(ttsDir);

          const filename = `openai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
          const filePath = `${ttsDir}/${filename}`;

          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          await electronService.fs.writeFileBuffer(filePath, uint8Array);

          return {
            mode: 'immediate',
            output: {
              path: filePath,
              duration: 0,
              sampleRate: 24000,
            },
          };
        }
      } catch (err) {
        logger.warn('Failed to save to file, falling back to Blob URL:', err);
      }
    }

    // Fallback to Blob URL for browser environment
    const url = URL.createObjectURL(blob);
    return {
      mode: 'immediate',
      output: {
        path: url,
        duration: 0,
        sampleRate: 24000,
      },
    };
  }

  async listVoices(): Promise<Voice[]> {
    return OPENAI_VOICES;
  }
}

export default OpenAITTSProvider;
