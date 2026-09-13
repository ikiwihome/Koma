/**
 * 模型预设常量
 *
 * 重构（P0#1 阶段 B/C）：所有渠道预设完全从 ProviderRegistry 派生，
 * frontend/src/providers/{llm,tti,itv,tts}/index.ts 中注册的 def 是唯一真源。
 * 添加新渠道厂商只需在对应 index.ts 加 def，下拉自动出现。
 */
import type { LLMChannelPreset, ProviderPreset } from '../../types';
import { listPresets, getRegistry } from '../../providers/registry';

// 触发内置 Provider 注册副作用
import '../../providers/llm';
import '../../providers/tti';
import '../../providers/itv';
import '../../providers/tts';

// LLM 渠道预设：仅展示 OpenAI 兼容协议的渠道（gemini/claude 走专属配置 UI，由 catalog 直出）
export const LLM_CHANNEL_PRESETS: LLMChannelPreset[] = getRegistry('llm')
  .list()
  .filter(def => def.runtimeProviderType === 'openai-compatible')
  .map(def => ({
    id: def.type,
    name: def.name,
    baseUrl: def.presetBaseUrl ?? '',
  }));

function fromRegistry(kind: 'tti' | 'itv' | 'tts'): ProviderPreset[] {
  return listPresets(kind).map(p => ({ id: p.id, name: p.name, baseUrl: p.baseUrl }));
}

export const TTI_PRESETS: ProviderPreset[] = fromRegistry('tti');
export const ITV_PRESETS: ProviderPreset[] = fromRegistry('itv');
export const TTS_PRESETS: ProviderPreset[] = fromRegistry('tts');
