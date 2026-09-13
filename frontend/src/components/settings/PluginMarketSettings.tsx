/**
 * 插件市场设置子页 — 列表展示 + 安装 / 升级 / 卸载 操作。
 */
import React from 'react';
import { App, Card, Button, Tag, Typography, List, Tooltip, Empty, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useMarketplace } from '../../hooks/useMarketplace';

const { Text, Paragraph } = Typography;

export const PluginMarketSettings: React.FC = () => {
  const { message } = App.useApp();
  const { items, state, loading, error, isAvailable, refetch, installOrUpdate, uninstall } = useMarketplace();

  if (!isAvailable) {
    return (
      <div className="settings-manager">
        <Card size="small" title="插件市场">
          <Text>插件市场在浏览器/网页环境下不可用。</Text>
        </Card>
      </div>
    );
  }

  const installingSet = new Set(state?.installing ?? []);
  const uninstallingSet = new Set(state?.uninstalling ?? []);

  const handleInstallOrUpdate = async (id: string, label: string) => {
    try {
      await installOrUpdate(id);
      message.success(`${label}成功`);
    } catch (err) {
      message.error((err as Error)?.message ?? `${label}失败`);
    }
  };

  const handleUninstall = async (id: string, name: string) => {
    try {
      await uninstall(id);
      message.success(`已卸载 ${name}`);
    } catch (err) {
      message.error((err as Error)?.message ?? '卸载失败');
    }
  };

  return (
    <div className="settings-manager">
      <Card
        size="small"
        title="插件市场"
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void refetch()}
            loading={loading}
          >
            刷新
          </Button>
        }
      >
        {error && <Paragraph type="danger">注册表加载失败：{error}</Paragraph>}
        {state?.lastCheckedAt && (
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            上次刷新：{new Date(state.lastCheckedAt).toLocaleString()}
          </Paragraph>
        )}

        {items.length === 0 ? (
          <Empty description={loading ? '加载中…' : '暂无可用插件'} />
        ) : (
          <List
            itemLayout="horizontal"
            dataSource={items}
            renderItem={(item) => {
              const id = item.entry.id;
              const installing = installingSet.has(id);
              const uninstalling = uninstallingSet.has(id);
              const blocked = !!item.incompatibleReason;

              let primary = (
                <Button type="primary" loading={installing} disabled={blocked} onClick={() => void handleInstallOrUpdate(id, '安装')}>
                  安装
                </Button>
              );
              if (item.installed && item.hasUpdate && !blocked) {
                primary = (
                  <Button type="primary" loading={installing} onClick={() => void handleInstallOrUpdate(id, '升级')}>
                    升级到 {item.entry.latestVersion}
                  </Button>
                );
              } else if (item.installed && !item.hasUpdate) {
                primary = <Tag color="green">已最新</Tag>;
              }

              const actions: React.ReactNode[] = [];
              if (blocked) {
                actions.push(
                  <Tooltip title={item.incompatibleReason} key="incompat">
                    <Tag color="red">不兼容</Tag>
                  </Tooltip>
                );
              }
              actions.push(<span key="primary">{primary}</span>);
              if (item.installed) {
                actions.push(
                  <Button
                    key="uninstall"
                    danger
                    type="text"
                    loading={uninstalling}
                    onClick={() => void handleUninstall(id, item.entry.name)}
                  >
                    卸载
                  </Button>
                );
              }

              return (
                <List.Item actions={actions}>
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text strong>{item.entry.name}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.installedVersion
                            ? `已装 ${item.installedVersion}`
                            : `最新 ${item.entry.latestVersion}`}
                          {item.hasUpdate && item.installedVersion && ` → ${item.entry.latestVersion}`}
                        </Text>
                        {item.entry.category && <Tag>{item.entry.category}</Tag>}
                      </Space>
                    }
                    description={item.entry.description}
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </div>
  );
};
