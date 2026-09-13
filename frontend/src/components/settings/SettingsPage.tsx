import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Button,
  App,
  Statistic,
  Typography,
  Card,
} from 'antd';
import {
  ExperimentOutlined,
  FolderOutlined,
  DeleteOutlined,
  BgColorsOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  SoundOutlined,
  CodeOutlined,
  BlockOutlined,
  ApiOutlined,
  SkinOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../../types';
import { loadSettings } from '../../store/globalStore';
import {
  getStorageConfig,
  updateStoragePath,
} from '../../store/storageConfig';
import { electronService, normalizePath } from '../../services/electronService';
import { LLMConfigManager } from './LLMConfigManager';
import { TTIConfigManager } from './TTIConfigManager';
import { ITVConfigManager } from './ITVConfigManager';
import { TTSConfigManager } from './TTSConfigManager';
import { VisualStyleManager } from './VisualStyleManager';
import { PromptStudio } from './PromptStudio';
import { PluginManager } from '../plugins';
import { MCPConfigManager } from './MCPConfigManager';
import { AppearanceThemeSettings } from './AppearanceThemeSettings';
import { LogDiagnosticsSettings } from './LogDiagnosticsSettings';
import { AboutSettings } from './AboutSettings';
// PluginMarketSettings 本期不挂载（入口已在 sections 中注释）；
// 文件保留在 ./PluginMarketSettings.tsx，等开放插件市场时一行切回。

const { Text } = Typography;

interface SettingsPageProps {
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
}

interface SectionDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  group: string;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onSave,
}) => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [storagePath, setStoragePath] = useState('');
  const [storageSize, setStorageSize] = useState(t('common.calculating'));
  const [clearingCache, setClearingCache] = useState(false);
  const [activeKey, setActiveKey] = useState('models-llm');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isClickScrolling = useRef(false);

  const sections: SectionDef[] = [
    { key: 'appearance-theme', icon: <SkinOutlined />, label: '外观/主题', group: '外观' },
    { key: 'models-llm', icon: <ExperimentOutlined />, label: t('settings.llm'), group: t('settings.modelConfig') },
    { key: 'models-tti', icon: <PictureOutlined />, label: t('settings.tti'), group: t('settings.modelConfig') },
    { key: 'models-itv', icon: <VideoCameraOutlined />, label: t('settings.itv'), group: t('settings.modelConfig') },
    { key: 'models-tts', icon: <SoundOutlined />, label: t('settings.tts'), group: t('settings.modelConfig') },
    { key: 'workflow-visual', icon: <BgColorsOutlined />, label: t('settings.visualStyle'), group: t('settings.workflow') },
    { key: 'workflow-prompts', icon: <CodeOutlined />, label: t('settings.promptTemplate'), group: t('settings.workflow') },
    { key: 'system-storage', icon: <FolderOutlined />, label: t('settings.storageAndCache'), group: t('settings.system') },
    { key: 'system-logs', icon: <FileTextOutlined />, label: '日志/诊断', group: t('settings.system') },
    { key: 'system-plugins', icon: <BlockOutlined />, label: t('settings.pluginManage'), group: t('settings.system') },
    // 插件市场入口本期隐藏（等真有插件再开启）：组件与后端服务都保留，仅不暴露入口
    // { key: 'system-plugin-market', icon: <BlockOutlined />, label: '插件市场', group: t('settings.system') },
    { key: 'system-mcp', icon: <ApiOutlined />, label: t('settings.mcpTools'), group: t('settings.system') },
    { key: 'system-about', icon: <FileTextOutlined />, label: '关于', group: t('settings.system') },
  ];

  // Group sections for anchor display
  const groups = sections.reduce<{ group: string; items: SectionDef[] }[]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && last.group === s.group) {
      last.items.push(s);
    } else {
      acc.push({ group: s.group, items: [s] });
    }
    return acc;
  }, []);

  const calcStorageSize = async (path?: string) => {
    const targetPath = path || getStorageConfig()?.rootPath;
    if (!targetPath || !electronService.isElectron()) {
      setStorageSize('N/A');
      return;
    }
    setStorageSize(t('common.calculating'));
    try {
      const size = await electronService.fs.dirSize(targetPath);
      setStorageSize(formatBytes(size));
    } catch {
      setStorageSize(t('common.calcFailed'));
    }
  };

  useEffect(() => {
    const config = getStorageConfig();
    if (config) {
      setStoragePath(normalizePath(config.rootPath) || '~/.koma');
    }
    calcStorageSize();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleChangeStoragePath = async () => {
    if (!electronService.isElectron()) {
      message.warning(t('common.desktopOnly'));
      return;
    }

    const result = await electronService.dialog.openDirectory();
    if (result.filePaths && result.filePaths.length > 0) {
      const newPath = result.filePaths[0];

      modal.confirm({
        title: t('settings.changeStorageTitle'),
        content: (
          <div>
            <p>{t('settings.newLocation')}: {newPath}</p>
            <p>{t('settings.migrateDataQuestion')}</p>
          </div>
        ),
        okText: t('settings.migrateAndChange'),
        cancelText: t('settings.onlyChange'),
        onOk: async () => {
          try {
            await updateStoragePath(newPath, true);
            setStoragePath(newPath);
            calcStorageSize(newPath);
            message.success(t('settings.storageChangedMigrated'));
          } catch {
            message.error(t('settings.migrateFailed'));
          }
        },
        onCancel: async () => {
          try {
            await updateStoragePath(newPath, false);
            setStoragePath(newPath);
            calcStorageSize(newPath);
            message.success(t('settings.storageChanged'));
          } catch {
            message.error(t('settings.changeFailed'));
          }
        },
      });
    }
  };

  const handleClearCache = async () => {
    modal.confirm({
      title: t('settings.confirmClearCache'),
      content: t('settings.clearCacheContent'),
      okText: t('common.clearCache'),
      okType: 'danger',
      onOk: async () => {
        setClearingCache(true);
        try {
          message.success(t('settings.cacheCleared'));
        } catch {
          message.error(t('settings.clearFailed'));
        } finally {
          setClearingCache(false);
        }
      },
    });
  };

  const handleConfigChange = async () => {
    const newSettings = await loadSettings();
    onSave(newSettings);
  };

  // Scroll spy: track which section is in view
  const handleScroll = useCallback(() => {
    if (isClickScrolling.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const scrollTop = container.scrollTop;
    const offset = 120;

    let current = sections[0].key;
    for (const section of sections) {
      const el = sectionRefs.current[section.key];
      if (el) {
        const top = el.offsetTop - offset;
        if (scrollTop >= top) {
          current = section.key;
        }
      }
    }
    setActiveKey(current);
  }, [sections]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const scrollToSection = (key: string) => {
    const el = sectionRefs.current[key];
    const container = scrollRef.current;
    if (!el || !container) return;

    isClickScrolling.current = true;
    setActiveKey(key);

    const top = el.offsetTop - 80;
    container.scrollTo({ top, behavior: 'smooth' });

    setTimeout(() => {
      isClickScrolling.current = false;
    }, 600);
  };

  const setSectionRef = (key: string) => (el: HTMLDivElement | null) => {
    sectionRefs.current[key] = el;
  };

  const renderSectionContent = (key: string) => {
    switch (key) {
      case 'appearance-theme':
        return <AppearanceThemeSettings settings={settings} onSave={onSave} />;
      case 'models-llm':
        return <LLMConfigManager onConfigChange={handleConfigChange} />;
      case 'models-tti':
        return <TTIConfigManager onConfigChange={handleConfigChange} />;
      case 'models-itv':
        return <ITVConfigManager onConfigChange={handleConfigChange} />;
      case 'models-tts':
        return <TTSConfigManager onConfigChange={handleConfigChange} />;
      case 'workflow-visual':
        return <VisualStyleManager onStyleChange={handleConfigChange} />;
      case 'workflow-prompts':
        return <PromptStudio />;
      case 'system-storage':
        return (
          <div className="settings-manager settings-appearance-theme">
            <Card
              size="small"
              title={t('settings.storageOverview')}
              className="settings-config-card settings-summary-card"
            >
              <div className="settings-summary-metrics">
                <Statistic
                  title={t('settings.storageLocation')}
                  value={storagePath || '~/.koma'}
                  className="settings-card-code settings-stat-value-lg"
                />
                <Statistic title={t('settings.usedSpace')} value={storageSize} />
              </div>
            </Card>
            <Card size="small" title={t('settings.storageOps')} className="settings-config-card">
              <div className="settings-action-list">
                <div className="settings-action-row">
                  <div className="settings-action-copy">
                    <span className="settings-action-title">{t('settings.changeStoragePath')}</span>
                    <span className="settings-action-desc">
                      {t('settings.storageMoveDesc', { defaultValue: '选择新的存储根目录，统一管理缓存与生成素材' })}
                    </span>
                  </div>
                  <Button icon={<FolderOutlined />} onClick={handleChangeStoragePath}>
                    {t('common.changeLocation')}
                  </Button>
                </div>
                <div className="settings-action-row">
                  <div className="settings-action-copy">
                    <span className="settings-action-title is-muted-danger">
                      {t('common.clearCache')}
                    </span>
                    <span className="settings-action-desc">{t('settings.clearCacheDesc')}</span>
                  </div>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    loading={clearingCache}
                    onClick={handleClearCache}
                  >
                    {t('common.clearCache')}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        );
      case 'system-logs':
        return <LogDiagnosticsSettings />;
      case 'system-plugins':
        return <PluginManager />;
      // case 'system-plugin-market':
      //   return <PluginMarketSettings />;
      case 'system-mcp':
        return <MCPConfigManager onConfigChange={handleConfigChange} />;
      case 'system-about':
        return <AboutSettings />;
      default:
        return null;
    }
  };

  return (
    <div className="settings-page-shell h-full relative flex">
      {/* Main scrollable content */}
      <div
        ref={scrollRef}
        className="settings-page-scroll flex-1 h-full overflow-auto"
      >
        <div className="settings-page-content">
          {/* Page title */}
          <div className="settings-page-hero">
            <h1 className="settings-page-hero-title">
              {t('settings.globalSettings')}
            </h1>
            <Text className="settings-page-hero-desc">
              {t('settings.allSettingsDesc', { defaultValue: 'Manage all application settings in one place' })}
            </Text>
          </div>

          {/* All sections */}
          {sections.map((section, idx) => {
            const prevSection = idx > 0 ? sections[idx - 1] : null;
            const showGroupHeader = !prevSection || prevSection.group !== section.group;

            return (
              <div key={section.key}>
                {/* Group divider */}
                {showGroupHeader && idx > 0 && (
                  <div className="settings-group-divider" />
                )}

                {/* Group label */}
                {showGroupHeader && (
                  <Text className="settings-group-label">
                    {section.group}
                  </Text>
                )}

                {/* Section */}
                <div
                  ref={setSectionRef(section.key)}
                  id={`section-${section.key}`}
                  className="settings-section-shell"
                >
                  <div className="settings-section-card">
                    {/* Section header */}
                    <div className="settings-section-header">
                      <span className="settings-section-icon">{section.icon}</span>
                      <h2 className="settings-section-title">
                        {section.label}
                      </h2>
                    </div>
                    {/* Section content */}
                    <div className="settings-section-content">
                      {renderSectionContent(section.key)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right floating anchor nav */}
      <div className="settings-anchor-nav">
        <div className="settings-anchor-inner">
          <div className="settings-anchor-title">
            {t('settings.navigation', { defaultValue: 'Navigation' })}
          </div>
          <nav>
            {groups.map((group) => (
              <div key={group.group} className="settings-anchor-cluster">
                <div className="settings-anchor-group">
                  {group.group}
                </div>
                <div className="settings-anchor-list">
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => scrollToSection(item.key)}
                      className={`settings-anchor-button${activeKey === item.key ? ' is-active' : ''}`}
                    >
                      <span className="settings-anchor-button-icon">{item.icon}</span>
                      <span className="settings-anchor-button-label">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
};
