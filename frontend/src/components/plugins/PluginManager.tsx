/**
 * 插件管理页面
 */
import React, { useState } from 'react';
import { Tabs, Empty, Input, Select, Modal, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { PluginCategory } from '../../types/plugin';
import { usePluginStore } from '../../store/pluginStore';
import { PluginCard } from './PluginCard';
import { ProviderPluginModal } from './ProviderPluginModal';
import { PluginImporter } from './PluginImporter';
import { unloadPlugin } from '../../services/plugin/PluginLoader';
import { cleanupPluginResources } from '../../services/plugin/PluginAPI';
import { initializePlugin } from '../../services/plugin/PluginInitializer';
import { electronService } from '../../services/electronService';

export const PluginManager: React.FC = () => {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');
  const [configPluginId, setConfigPluginId] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<PluginCategory | 'all'>('all');

  const plugins = usePluginStore(state => state.plugins);
  const togglePlugin = usePluginStore(state => state.togglePlugin);
  const unregisterPlugin = usePluginStore(state => state.unregisterPlugin);

  // 过滤插件
  const filteredPlugins = plugins.filter(p => {
    const matchSearch = !searchText ||
      p.name.toLowerCase().includes(searchText.toLowerCase()) ||
      p.id.toLowerCase().includes(searchText.toLowerCase());
    const matchCategory = categoryFilter === 'all' || p.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  // 切换启用状态
  const handleToggle = async (id: string, enabled: boolean) => {
    togglePlugin(id, enabled);
    if (enabled) {
      // 启用时重新初始化插件（从 store 获取最新状态）
      const plugin = usePluginStore.getState().getPlugin(id);
      if (plugin) {
        const success = await initializePlugin(plugin);
        if (success) {
          message.success(t('common.enabled'));
        } else {
          message.warning(t('plugin.loadFailed'));
        }
      }
    } else {
      unloadPlugin(id);
      cleanupPluginResources(id);
      message.success(t('common.disabled'));
    }
  };

  // 卸载插件
  const handleRemove = (id: string) => {
    const plugin = plugins.find(p => p.id === id);
    if (!plugin) return;

    Modal.confirm({
      title: t('plugin.uninstallConfirm'),
      content: `${t('plugin.uninstallConfirm')} "${plugin.name}"`,
      okText: t('plugin.uninstall'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          // 清理运行时资源
          unloadPlugin(id);
          cleanupPluginResources(id);

          // 删除插件文件
          const result = await electronService.ipc.invoke('controller/plugin/uninstallById', { pluginId: id });
          if (!result?.success) {
            throw new Error(result?.error || t('error.deleteFailed'));
          }

          // 从 store 移除
          unregisterPlugin(id);

          message.success(t('plugin.uninstallSuccess'));
        } catch (err: any) {
          message.error(`${t('error.deleteFailed')}: ${err.message}`);
        }
      },
    });
  };

  // 打开插件目录
  const handleOpenFolder = async (id: string) => {
    const plugin = plugins.find(p => p.id === id);
    if (plugin) {
      await electronService.shell.openPath(plugin.rootPath);
    }
  };

  // 导入成功回调
  const handleImportSuccess = (_pluginId: string) => {
    // 导入后的处理（如刷新列表等）由 store 自动完成
  };

  // 已安装插件列表内容
  const installedContent = (
    <div className="settings-manager">
      {/* 搜索和筛选 */}
      <div className="settings-manager-toolbar">
        <Input
          placeholder={t('plugin.searchPlaceholder')}
          prefix={<SearchOutlined className="text-text-secondary" />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          size="small"
          className="w-[220px]"
          allowClear
        />
        <Select
          value={categoryFilter}
          onChange={setCategoryFilter}
          size="small"
          className="w-[136px]"
          options={[
            { value: 'all', label: t('plugin.categoryAll') },
            { value: 'global', label: t('plugin.categoryGlobal') },
            { value: 'provider', label: t('plugin.categoryProvider') },
            { value: 'tool', label: t('plugin.categoryTool') },
          ]}
        />
      </div>

      {/* 插件列表 */}
      {filteredPlugins.length === 0 ? (
        <Empty
          description={searchText ? t('error.notFound') : t('plugin.noPlugins')}
          className="settings-empty-state my-8"
        />
      ) : (
        <div className="grid gap-3">
          {filteredPlugins.map(plugin => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              onToggle={handleToggle}
              onRemove={handleRemove}
              onOpenFolder={handleOpenFolder}
              onConfigure={setConfigPluginId}
            />
          ))}
        </div>
      )}
    </div>
  );

  // 导入插件内容
  const importContent = (
    <div className="max-w-md mx-auto py-4">
      <PluginImporter onImportSuccess={handleImportSuccess} />

      <div className="mt-6 p-4 bg-bg-app rounded-lg">
        <h4 className="font-medium mb-2">Plugin Development</h4>
        <ul className="text-sm text-text-tertiary space-y-1">
          <li>• Plugin must include <code>manifest.json</code></li>
          <li>• Global plugins need to export React component as default</li>
          <li>• Dev mode supports folder import for debugging</li>
          <li>• See docs for manifest spec and API reference</li>
        </ul>
      </div>
    </div>
  );

  const tabItems = [
    { key: 'installed', label: t('plugin.installed'), children: installedContent },
    { key: 'import', label: t('plugin.import'), children: importContent },
  ];

  return (
    <div className="plugin-manager settings-manager">
      <h2 className="text-lg font-semibold mb-1">{t('plugin.plugins')}</h2>
      <Tabs defaultActiveKey="installed" items={tabItems} />
      {configPluginId && <ProviderPluginModal visible pluginId={configPluginId} onClose={() => setConfigPluginId('')} />}
    </div>
  );
};

export default PluginManager;
