/**
 * Provider 插件配置弹窗
 * 用于在渠道管理页面加载和显示 provider 插件的配置 UI
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Modal, Spin, Result, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { InstalledPlugin, PluginExports, PluginAPI } from '../../types/plugin';
import { createPluginAPI } from '../../services/plugin/PluginAPI';
import { usePluginStore } from '../../store/pluginStore';
import { loadUMDModule } from '../../services/plugin/PluginLoader';
import { createLogger } from '../../store/logger';

const logger = createLogger('ProviderPluginModal');

interface ProviderPluginModalProps {
  visible: boolean;
  pluginId: string;
  onClose: () => void;
  onConfigSaved?: () => void;
}

// 加载 Provider 插件前端组件
async function loadProviderPluginComponent(plugin: InstalledPlugin): Promise<PluginExports | null> {
  if (!plugin.entry.frontend) {
    logger.warn(`插件 ${plugin.id} 无前端入口`);
    return null;
  }

  // 规范化路径
  const frontendEntry = plugin.entry.frontend.replace(/^\.\//, '');
  const entryPath = `${plugin.rootPath}/${frontendEntry}`.replace(/\\/g, '/');

  // 与常规插件加载共用已获 CSP 允许的 koma-local: 脚本标签路径。
  return loadUMDModule(entryPath, plugin.id);
}

export const ProviderPluginModal: React.FC<ProviderPluginModalProps> = ({
  visible,
  pluginId,
  onClose,
  onConfigSaved: _onConfigSaved,
}) => {
  const { t } = useTranslation();
  const plugin = usePluginStore(state => state.getPlugin(pluginId));

  const [Component, setComponent] = useState<React.ComponentType<{ api: PluginAPI }> | null>(null);
  const [api, setApi] = useState<PluginAPI | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlugin = useCallback(async () => {
    if (!plugin) {
      setError(t('plugin.pluginNotExist'));
      setLoading(false);
      return;
    }

    if (!plugin.entry.frontend) {
      setError(t('plugin.noConfigUI'));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const exports = await loadProviderPluginComponent(plugin);

      if (!exports || !exports.default) {
        setError(t('plugin.noValidComponent'));
        return;
      }

      // 创建 API 实例
      const pluginApi = createPluginAPI(plugin);
      setApi(pluginApi);

      // 调用 onActivate
      if (exports.onActivate) {
        await exports.onActivate(pluginApi);
      }

      setComponent(() => exports.default);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [plugin, t]);

  useEffect(() => {
    if (visible && pluginId) {
      loadPlugin();
    }
  }, [visible, pluginId, loadPlugin]);

  // 关闭时清理
  const handleClose = () => {
    setComponent(null);
    setApi(null);
    setError(null);
    onClose();
  };

  return (
    <Modal
      title={plugin?.name || t('plugin.pluginConfig')}
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={800}
      destroyOnClose
      className="dark-modal settings-compact-modal"
      styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
    >
      {loading && (
        <div className="settings-loading-block">
          <Spin size="large" description={t('plugin.loadingPlugin')} />
        </div>
      )}

      {error && (
        <Result
          status="error"
          title={t('plugin.loadFailed')}
          subTitle={error}
          extra={
            <Button icon={<ReloadOutlined />} onClick={loadPlugin}>
              {t('common.retry')}
            </Button>
          }
        />
      )}

      {!loading && !error && Component && api && (
        <Component api={api} />
      )}
    </Modal>
  );
};

export default ProviderPluginModal;
