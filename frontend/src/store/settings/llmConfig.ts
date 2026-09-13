/**
 * LLM 配置读取
 * 新架构下只保留基于 channelConfigs + mediaDefaults 的解析入口。
 */
import { loadSettings } from './core';
import type { LLMModelConfig } from '../../types';
import {
  buildLLMConfigFromContext,
  getDefaultMediaSelection,
  parseMediaSelectionKey,
  resolveConfiguredChannelModel,
} from '../../providers/channel/resolver';

export async function getDefaultLLMConfig(): Promise<LLMModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'llm',
    getDefaultMediaSelection(settings, 'llm'),
    'llm.chat',
  );
  return context ? buildLLMConfigFromContext(context) : null;
}

export async function getLLMConfigById(id: string): Promise<LLMModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'llm',
    parseMediaSelectionKey(id),
    'llm.chat',
  );
  return context ? buildLLMConfigFromContext(context) : null;
}

export async function getActiveLLMConfig(projectLLMSelection?: string): Promise<LLMModelConfig | null> {
  const settings = await loadSettings();
  const context = resolveConfiguredChannelModel(
    settings,
    'llm',
    parseMediaSelectionKey(projectLLMSelection),
    'llm.chat',
  );
  return context ? buildLLMConfigFromContext(context) : null;
}
