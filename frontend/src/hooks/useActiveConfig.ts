import { useState, useEffect } from 'react';
import { loadSettings } from '../store/globalStore';
import { getActiveTTIConfig, getActiveITVConfig } from '../store/settings/mediaConfig';
import {
  resolveConfiguredChannelModel,
  type ResolvedChannelModelContext,
} from '../providers/channel/resolver';
import type { ModelCapability } from '../providers/channel/types';
import type { TTIModelConfig, ITVModelConfig } from '../types';
import { createLogger } from '../store/logger';

const logger = createLogger('useActiveConfig');

type ConfigType = 'tti' | 'itv';

interface ActiveModelState {
  capabilities: ModelCapability[];
  channelLabel?: string;
  modelLabel?: string;
  context?: ResolvedChannelModelContext;
}

interface UseActiveConfigResult<T> {
  config: T | null;
  activeModel: ActiveModelState | null;
  loading: boolean;
  refresh: () => void;
}

export function useActiveConfig(type: 'tti', selectionKey?: string): UseActiveConfigResult<TTIModelConfig>;
export function useActiveConfig(type: 'itv', selectionKey?: string): UseActiveConfigResult<ITVModelConfig>;
export function useActiveConfig(type: ConfigType, selectionKey?: string): UseActiveConfigResult<any> {
  const [config, setConfig] = useState<any>(null);
  const [activeModel, setActiveModel] = useState<ActiveModelState | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let mounted = true;
    const fetchConfig = async () => {
      setLoading(true);
      try {
        const getter = type === 'tti' ? getActiveTTIConfig : getActiveITVConfig;
        const [result, settings] = await Promise.all([
          getter(selectionKey),
          loadSettings(),
        ]);
        const context = resolveConfiguredChannelModel(settings, type, selectionKey);
        if (mounted) {
          setConfig(result);
          setActiveModel(context ? {
            capabilities: context.model.capabilities,
            channelLabel: context.definition.name,
            modelLabel: context.model.label,
            context,
          } : null);
        }
      } catch (err) {
        logger.error(`Failed to load ${type} config`, err);
        if (mounted) {
          setConfig(null);
          setActiveModel(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchConfig();
    return () => { mounted = false; };
  }, [type, selectionKey, version]);

  const refresh = () => setVersion(v => v + 1);

  return { config, activeModel, loading, refresh };
}
