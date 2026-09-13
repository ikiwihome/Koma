import { useCallback, useEffect, useState } from 'react';
import { Form } from 'antd';
import type { AppSettings } from '../../types';
import type {
  ChannelConfig,
  MediaCategory,
} from '../../providers/channel/types';
import { loadSettings } from '../../store/globalStore';
import type { ManagedChannelCard } from './channelManagerShared';

export function useMediaConfigManager<TConfig>(
  category: MediaCategory,
  loadBuiltins: (settings: AppSettings) => ManagedChannelCard<TConfig>[],
  onConfigChange?: () => void,
) {
  const [configs, setConfigs] = useState<ManagedChannelCard<TConfig>[]>([]);
  const [pluginChannels, setPluginChannels] = useState<ChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ChannelConfig | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [pluginModalVisible, setPluginModalVisible] = useState(false);
  const [activePluginId, setActivePluginId] = useState<string>('');
  const [form] = Form.useForm();

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const nextSettings = await loadSettings();
      setSettings(nextSettings);
      setConfigs(loadBuiltins(nextSettings));
      setPluginChannels(
        (nextSettings.channelConfigs || []).filter((channel) => (
          channel.category === category && channel.source === 'plugin'
        )),
      );
    } finally {
      setLoading(false);
    }
  }, [category, loadBuiltins]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const openPluginModal = useCallback((pluginId: string) => {
    setActivePluginId(pluginId);
    setPluginModalVisible(true);
  }, []);

  const closePluginModal = useCallback(() => {
    setPluginModalVisible(false);
    setActivePluginId('');
  }, []);

  const handlePluginConfigSaved = useCallback(async () => {
    await loadConfigs();
    onConfigChange?.();
  }, [loadConfigs, onConfigChange]);

  return {
    configs,
    pluginChannels,
    settings,
    loading,
    modalVisible,
    setModalVisible,
    editingChannel,
    setEditingChannel,
    testingId,
    setTestingId,
    pluginModalVisible,
    activePluginId,
    form,
    loadConfigs,
    openPluginModal,
    closePluginModal,
    handlePluginConfigSaved,
  };
}
