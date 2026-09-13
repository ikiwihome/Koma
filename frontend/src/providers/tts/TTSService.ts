/**
 * TTS 服务层
 * 角色音色绑定、多角色对话合成、缓存、后处理
 */
import type { AudioResult, Character } from '../../types';
import { getProjectTTSProvider } from '..';
import { electronService } from '../../services/electronService';
import { persistMediaAsset } from '../../services/mediaPersistenceService';
import type { TTSRequest } from './types';
import {
  isBlobUri,
  isDataUri,
  isRemoteMediaUri,
} from '../../types';

// TTS 缓存条目
interface TTSCacheEntry {
  text: string;
  voiceId: string;
  hash: string;
  audioPath: string;
  duration: number;
  timestamp: number;
}

// 对话片段
export interface DialogueSegment {
  characterId: string;
  text: string;
  emotion?: string;
}

// 合成结果
export interface SynthesizedDialogue {
  segments: {
    characterId: string;
    audioPath: string;
    duration: number;
    startTime: number;
  }[];
  totalDuration: number;
  combinedAudioPath?: string;
}

// 缓存管理器
class TTSCacheManager {
  private cache: Map<string, TTSCacheEntry> = new Map();
  private cacheDir: string = '';
  private maxCacheSize = 500; // 最大缓存条目数

  async init(projectId: string): Promise<void> {
    if (!electronService.isElectron()) {
      return;
    }

    const storagePath = await electronService.getStoragePath?.();
    if (storagePath) {
      this.cacheDir = `${storagePath}/projects/${projectId}/cache/tts`;
      await electronService.fs.mkdir(this.cacheDir);
      await this.loadCacheIndex();
    }
  }

  private async loadCacheIndex(): Promise<void> {
    if (!this.cacheDir) return;

    try {
      const indexPath = `${this.cacheDir}/index.json`;
      const exists = await electronService.fs.exists(indexPath);
      if (exists) {
        const data = await electronService.fs.readFile(indexPath);
        const entries: TTSCacheEntry[] = JSON.parse(data);
        entries.forEach(entry => this.cache.set(entry.hash, entry));
      }
    } catch {
      // ignore
    }
  }

  private async saveCacheIndex(): Promise<void> {
    if (!this.cacheDir) return;

    try {
      const indexPath = `${this.cacheDir}/index.json`;
      const entries = Array.from(this.cache.values());
      await electronService.fs.writeFile(indexPath, JSON.stringify(entries, null, 2));
    } catch {
      // ignore
    }
  }

  private generateHash(text: string, voiceId: string): string {
    // 简单哈希
    const str = `${text}_${voiceId}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  getCachePath(text: string, voiceId: string, extension: string): string | undefined {
    if (!this.cacheDir) return undefined;
    const hash = this.generateHash(text, voiceId);
    return `${this.cacheDir}/${hash}.${extension}`;
  }

  async get(text: string, voiceId: string): Promise<TTSCacheEntry | null> {
    const hash = this.generateHash(text, voiceId);
    const entry = this.cache.get(hash);

    if (entry) {
      // 验证文件存在
      if (electronService.isElectron()) {
        const exists = await electronService.fs.exists(entry.audioPath);
        if (!exists) {
          this.cache.delete(hash);
          return null;
        }
      }
      return entry;
    }
    return null;
  }

  async set(text: string, voiceId: string, audioPath: string, duration: number): Promise<void> {
    const hash = this.generateHash(text, voiceId);

    // LRU 淘汰
    if (this.cache.size >= this.maxCacheSize) {
      const oldest = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) {
        this.cache.delete(oldest[0]);
      }
    }

    this.cache.set(hash, {
      text,
      voiceId,
      hash,
      audioPath,
      duration,
      timestamp: Date.now(),
    });

    await this.saveCacheIndex();
  }

  async clear(): Promise<void> {
    this.cache.clear();
    if (this.cacheDir && electronService.isElectron()) {
      try {
        await electronService.fs.remove(this.cacheDir);
        await electronService.fs.mkdir(this.cacheDir);
      } catch {
        // ignore
      }
    }
  }
}

// 角色音色管理器
class CharacterVoiceManager {
  private mappings: Map<string, string> = new Map();

  setVoice(characterId: string, voiceId: string): void {
    this.mappings.set(characterId, voiceId);
  }

  getVoice(characterId: string): string | undefined {
    return this.mappings.get(characterId);
  }

  loadFromCharacters(characters: Character[]): void {
    characters.forEach(char => {
      if (char.voiceId) {
        this.mappings.set(char.id, char.voiceId);
      }
    });
  }

  clear(): void {
    this.mappings.clear();
  }
}

// TTS 服务
export class TTSService {
  private cacheManager = new TTSCacheManager();
  private voiceManager = new CharacterVoiceManager();
  private ttsSelection?: string;
  private projectId?: string;

  async init(projectId: string, ttsSelection?: string): Promise<void> {
    this.projectId = projectId;
    this.ttsSelection = ttsSelection;
    await this.cacheManager.init(projectId);
  }

  setTTSSelection(ttsSelection?: string): void {
    this.ttsSelection = ttsSelection;
  }

  loadCharacterVoices(characters: Character[]): void {
    this.voiceManager.loadFromCharacters(characters);
  }

  setCharacterVoice(characterId: string, voiceId: string): void {
    this.voiceManager.setVoice(characterId, voiceId);
  }

  /**
   * 合成单条文本
   */
  async synthesize(
    text: string,
    voiceId?: string,
    useCache = true
  ): Promise<AudioResult> {
    const provider = await getProjectTTSProvider(this.ttsSelection);
    if (!provider) {
      throw new Error('未配置 TTS 服务');
    }

    const effectiveVoiceId = await this.resolveVoiceId(provider, voiceId);

    // 检查缓存
    if (useCache) {
      const cached = await this.cacheManager.get(text, effectiveVoiceId);
      if (cached) {
        return {
          path: cached.audioPath,
          duration: cached.duration,
          format: 'mp3',
        };
      }
    }

    // 调用 Provider
    const request: TTSRequest = {
      text,
      voiceId: effectiveVoiceId,
    };
    const started = await provider.start(request);
    const result = started.mode === 'immediate'
      ? started.output
      : await this.pollAsyncTTS(provider, started.taskId);
    const normalizedResult = await this.persistAudioResult(text, effectiveVoiceId, result);

    // 存入缓存
    if (useCache) {
      await this.cacheManager.set(text, effectiveVoiceId, normalizedResult.path, normalizedResult.duration);
    }

    return normalizedResult;
  }

  /**
   * 合成多角色对话
   */
  async synthesizeDialogue(
    segments: DialogueSegment[],
    onProgress?: (progress: number, segment: number) => void
  ): Promise<SynthesizedDialogue> {
    const provider = await getProjectTTSProvider(this.ttsSelection);
    if (!provider) {
      throw new Error('未配置 TTS 服务');
    }

    const results: SynthesizedDialogue['segments'] = [];
    let currentTime = 0;
    const silenceGap = 0.3;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const voiceId = this.voiceManager.getVoice(segment.characterId) ||
                      provider.config?.defaultVoice;

      onProgress?.(Math.round((i / segments.length) * 100), i);

      const audio = await this.synthesize(segment.text, voiceId);

      results.push({
        characterId: segment.characterId,
        audioPath: audio.path,
        duration: audio.duration,
        startTime: currentTime,
      });

      currentTime += audio.duration + silenceGap;
    }

    onProgress?.(100, segments.length);

    return {
      segments: results,
      totalDuration: currentTime - silenceGap,
    };
  }

  /**
   * 清理缓存
   */
  async clearCache(): Promise<void> {
    await this.cacheManager.clear();
  }

  private async resolveVoiceId(
    provider: NonNullable<Awaited<ReturnType<typeof getProjectTTSProvider>>>,
    preferredVoiceId?: string
  ): Promise<string> {
    if (preferredVoiceId) {
      return preferredVoiceId;
    }

    if (provider.config?.defaultVoice) {
      return provider.config.defaultVoice;
    }

    const voices = await provider.listVoices();
    return voices[0]?.id || 'default';
  }

  private async persistAudioResult(
    text: string,
    voiceId: string,
    result: AudioResult
  ): Promise<AudioResult> {
    if (!electronService.isElectron() || !this.projectId) {
      return result;
    }

    const needsPersistence = (
      isRemoteMediaUri(result.path) ||
      isDataUri(result.path) ||
      isBlobUri(result.path)
    );

    if (!needsPersistence) {
      const exists = await electronService.fs.exists(result.path);
      if (exists) {
        return result;
      }
    }

    const extension = result.format || (result.path.endsWith('.wav') ? 'wav' : 'mp3');
    const cachePath = this.cacheManager.getCachePath(text, voiceId, extension);

    const persisted = await persistMediaAsset({
      projectId: this.projectId,
      kind: 'audio',
      source: result.path,
      destPath: cachePath,
      mimeType: result.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      metadata: {
        sampleRate: result.sampleRate,
      },
    });

    return {
      ...result,
      path: persisted.localPath || result.path,
      format: result.format || extension,
    };
  }

  private async pollAsyncTTS(
    provider: NonNullable<Awaited<ReturnType<typeof getProjectTTSProvider>>>,
    taskId: string
  ): Promise<AudioResult> {
    if (!provider.getTaskSnapshot) {
      throw new Error('TTS Provider 不支持异步任务查询');
    }

    const startTime = Date.now();
    const maxMs = 5 * 60 * 1000;
    const intervalMs = 1500;

    while (Date.now() - startTime < maxMs) {
      const snapshot = await provider.getTaskSnapshot(taskId);
      if (snapshot.state === 'succeeded' && snapshot.output) {
        return snapshot.output;
      }
      if (snapshot.state === 'failed') {
        throw new Error(snapshot.error || '语音合成失败');
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('语音合成超时');
  }
}

// 导出单例
export const ttsService = new TTSService();

export default ttsService;
