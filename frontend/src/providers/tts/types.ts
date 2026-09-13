/**
 * TTS Provider 类型定义（OpenSpec: request-based + start/snapshot lifecycle）
 */
import type {
  TTSConfig,
  TTSOptions,
  AudioResult,
  Voice,
  TTSProviderType,
  ProviderStartResult,
  ProviderTaskSnapshot,
  TTSRequest as BaseTTSRequest,
} from '../../types';

export type TTSRequest = BaseTTSRequest<TTSOptions>;

export interface TTSProvider {
  type: TTSProviderType;
  config: TTSConfig;

  validate(): boolean;
  testConnection(): Promise<boolean>;

  start(request: TTSRequest): Promise<ProviderStartResult<AudioResult>>;
  getTaskSnapshot?(taskId: string): Promise<ProviderTaskSnapshot<AudioResult>>;
  cancelTask?(taskId: string): Promise<void>;

  listVoices(): Promise<Voice[]>;
}

export { TTSConfig, TTSOptions, AudioResult, Voice };

