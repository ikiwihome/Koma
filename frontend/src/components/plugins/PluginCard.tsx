/**
 * 插件卡片组件
 */
import React from 'react';
import { Card, Switch, Button, Tag, Typography, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  DeleteOutlined,
  FolderOpenOutlined,
  MoreOutlined,
  GlobalOutlined,
  ApiOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { InstalledPlugin, PluginCategory } from '../../types/plugin';

const { Text, Paragraph } = Typography;

interface PluginCardProps {
  plugin: InstalledPlugin;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  onOpenFolder?: (id: string) => void;
  onConfigure?: (id: string) => void;
}

const categoryIcons: Record<PluginCategory, React.ReactNode> = {
  global: <GlobalOutlined />,
  provider: <ApiOutlined />,
  tool: <ToolOutlined />,
  mcp: <ApiOutlined />,
  agent: <ToolOutlined />,
};

const categoryColors: Record<PluginCategory, string> = {
  global: 'purple',
  provider: 'blue',
  tool: 'green',
  mcp: 'cyan',
  agent: 'orange',
};

export const PluginCard: React.FC<PluginCardProps> = ({
  plugin,
  onToggle,
  onRemove,
  onOpenFolder,
  onConfigure,
}) => {
  const { t } = useTranslation();

  const categoryLabels: Record<PluginCategory, string> = {
    global: t('plugin.categoryGlobal'),
    provider: t('plugin.categoryProvider'),
    tool: t('plugin.categoryTool'),
    mcp: t('plugin.categoryMcp', 'MCP'),
    agent: t('plugin.categoryAgent', 'Agent'),
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'folder',
      icon: <FolderOpenOutlined />,
      label: t('plugin.openFolder'),
      onClick: () => onOpenFolder?.(plugin.id),
    },
    ...(plugin.isBuiltin
      ? []
      : [
          { type: 'divider' as const },
          {
            key: 'remove',
            icon: <DeleteOutlined />,
            label: t('plugin.uninstallPlugin'),
            danger: true,
            onClick: () => onRemove(plugin.id),
          },
        ]),
  ];

  return (
    <Card
      size="small"
      className={`plugin-card ${!plugin.isEnabled ? 'opacity-60' : ''}`}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Text strong className="truncate">{plugin.name}</Text>
            {plugin.isEnabled && plugin.providerMeta?.configPanel && onConfigure && (
              <Button size="small" onClick={() => onConfigure(plugin.id)}>配置</Button>
            )}
            <Tag
              icon={categoryIcons[plugin.category]}
              color={categoryColors[plugin.category]}
              className="text-xs"
            >
              {categoryLabels[plugin.category]}
            </Tag>
            {plugin.isBuiltin && (
              <Tag color="gold" className="text-xs">
                {t('plugin.builtin', '内置')}
              </Tag>
            )}
          </div>

          <Paragraph
            type="secondary"
            className="text-xs mb-2 !mb-1"
            ellipsis={{ rows: 2 }}
          >
            {plugin.description || t('plugin.noDescription')}
          </Paragraph>

          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span>v{plugin.version}</span>
            {plugin.author && (
              <>
                <span>·</span>
                <span>{plugin.author.name}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-3">
          <Switch
            size="small"
            checked={plugin.isEnabled}
            onChange={(checked) => onToggle(plugin.id, checked)}
          />
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button type="text" size="small" icon={<MoreOutlined />} />
          </Dropdown>
        </div>
      </div>
    </Card>
  );
};

export default PluginCard;
