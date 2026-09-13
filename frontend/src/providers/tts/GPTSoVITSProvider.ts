/**
 * GPT-SoVITS TTS Provider (本地)
 * 支持本地部署的 GPT-SoVITS 服务
 */
import type { TTSConfig, AudioResult, Voice } from '../../types';
import type { ProviderStartResult } from '../../types';
import type { TTSProvider, TTSRequest } from './types';

export class GPTSoVITSProvider implements TTSProvider {
  type = 'gpt-sovits' as const;
  config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  validate(): boolean {
    return !!this.getBaseUrl();
  }

  private getBaseUrl(): string {
    return this.config.baseUrl || 'http://127.0.0.1:9880';
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async start(request: TTSRequest): Promise<ProviderStartResult<AudioResult>> {
    const { text, voiceId, options } = request;
    const baseUrl = this.getBaseUrl();

    // GPT-SoVITS API 参数
    const params = new URLSearchParams({
      text,
      text_language: 'zh',
      ...(voiceId && { refer_wav_path: voiceId }),
      ...(options?.rate && { speed: String(options.rate) }),
    });

    const response = await fetch(`${baseUrl}/tts?${params}`, {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GPT-SoVITS 合成失败: ${error}`);
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    // 估算时长
    const estimatedDuration = text.length * 0.15;

    return {
      mode: 'immediate',
      output: {
        path: audioUrl,
        duration: estimatedDuration,
        format: 'wav',
      },
    };
  }

  async listVoices(): Promise<Voice[]> {
    // GPT-SoVITS 使用参考音频作为音色
    // 返回预设的本地音色列表
    return [
      { id: '', name: '默认音色', language: 'zh', gender: 'unknown', provider: 'gpt-sovits' },
      { id: 'reference_1.wav', name: '参考音色 1', language: 'zh', gender: 'unknown', provider: 'gpt-sovits' },
      { id: 'reference_2.wav', name: '参考音色 2', language: 'zh', gender: 'unknown', provider: 'gpt-sovits' },
    ];
  }
}
