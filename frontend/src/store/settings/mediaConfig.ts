/**
 * 媒体配置读取 (TTI/ITV/TTS)
 * 新架构下只保留基于 channelConfigs + mediaDefaults 的解析入口。
 */
import { loadSettings } from './core';
import type { ITVModelConfig, ResolvedITVConfig, ResolvedTTIConfig, TTIModelConfig, TTSModelConfig } from '../../types';
import type { ChannelConfig } from '../../providers/channel/types';
import {
  buildITVConfigFromContext,
  buildTTIConfigFromContext,
  buildTTSConfigFromContext,
  getDefaultMediaSelection,
  parseMediaSelectionKey,
  resolveConfiguredChannelModel,
} from '../../providers/channel/resolver';

function resolveChannelTTIConfig(channel: ChannelConfig, config: TTIModelConfig): ResolvedTTIConfig {
  return {
    ...config,
    source: 'channel',
    channelConfig: channel,
  };
}

function resolveChannelITVConfig(channel: ChannelConfig, config: ITVModelConfig): ResolvedITVConfig {
  return {
    ...config,
    source: 'channel',
    channelConfig: channel,
  };
}

export async function getDefaultTTIConfig(): Promise<TTIModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'tti',
    getDefaultMediaSelection(settings, 'tti'),
    'image.text-to-image',
  );
  return context ? buildTTIConfigFromContext(context) : null;
}

export async function getTTIConfigById(id: string): Promise<TTIModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'tti',
    parseMediaSelectionKey(id),
    'image.text-to-image',
  );
  return context ? buildTTIConfigFromContext(context) : null;
}

export async function getActiveTTIConfig(projectTTISelection?: string): Promise<ResolvedTTIConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'tti',
    parseMediaSelectionKey(projectTTISelection),
    'image.text-to-image',
  );
  if (!context) {
    return null;
  }
  return resolveChannelTTIConfig(context.channelConfig, buildTTIConfigFromContext(context));
}

export async function getDefaultITVConfig(): Promise<ITVModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'itv',
    getDefaultMediaSelection(settings, 'itv'),
    'video.image-to-video',
  );
  return context ? buildITVConfigFromContext(context) : null;
}

export async function getITVConfigById(id: string): Promise<ITVModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'itv',
    parseMediaSelectionKey(id),
    'video.image-to-video',
  );
  return context ? buildITVConfigFromContext(context) : null;
}

export async function getActiveITVConfig(projectITVSelection?: string): Promise<ResolvedITVConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'itv',
    parseMediaSelectionKey(projectITVSelection),
    'video.image-to-video',
  );
  if (!context) {
    return null;
  }
  return resolveChannelITVConfig(context.channelConfig, buildITVConfigFromContext(context));
}

export async function getDefaultTTSConfig(): Promise<TTSModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'tts',
    getDefaultMediaSelection(settings, 'tts'),
    'speech.text-to-speech',
  );
  return context ? buildTTSConfigFromContext(context) : null;
}

export async function getTTSConfigById(id: string): Promise<TTSModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'tts',
    parseMediaSelectionKey(id),
    'speech.text-to-speech',
  );
  return context ? buildTTSConfigFromContext(context) : null;
}

export async function getActiveTTSConfig(projectTTSSelection?: string): Promise<TTSModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'tts',
    parseMediaSelectionKey(projectTTSSelection),
    'speech.text-to-speech',
  );
  return context ? buildTTSConfigFromContext(context) : null;
}
