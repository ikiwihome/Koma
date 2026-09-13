/**
 * 插件权限确认弹窗
 */
import React from 'react';
import { Modal, List, Tag, Space, Typography } from 'antd';
import {
  SafetyOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { PluginManifest, PluginScope } from '../../types/plugin';
import { SCOPE_DESCRIPTIONS } from '../../services/plugin/PluginSandbox';

const { Text } = Typography;

interface PluginPermissionsProps {
  visible: boolean;
  manifest: PluginManifest;
  onConfirm: () => void;
  onCancel: () => void;
}

const levelIcons = {
  safe: <SafetyOutlined className="text-accent" />,
  warning: <WarningOutlined className="text-status-warning" />,
  danger: <ExclamationCircleOutlined className="text-status-error" />,
};

const levelColors = {
  safe: 'success',
  warning: 'warning',
  danger: 'error',
} as const;

export const PluginPermissions: React.FC<PluginPermissionsProps> = ({
  visible,
  manifest,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();

  const hasDangerScope = manifest.scopes.some(
    scope => SCOPE_DESCRIPTIONS[scope as PluginScope]?.level === 'danger'
  );

  return (
    <Modal
      title={
        <Space>
          <span>{t('plugin.installPlugin')}</span>
          <Tag color="blue">{manifest.name}</Tag>
        </Space>
      }
      open={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={hasDangerScope ? t('plugin.understandRiskContinue') : t('plugin.install')}
      okButtonProps={{ danger: hasDangerScope }}
      cancelText={t('common.cancel')}
      width={500}
    >
      <div className="mb-4">
        <Text type="secondary">
          {t('plugin.version')}: {manifest.version}
          {manifest.author && ` · ${t('plugin.author')}: ${manifest.author.name}`}
        </Text>
      </div>

      {manifest.description && (
        <div className="mb-4">
          <Text>{manifest.description}</Text>
        </div>
      )}

      <div className="mb-2">
        <Text strong>{t('plugin.requestPermissions')}</Text>
      </div>

      <List
        size="small"
        bordered
        dataSource={manifest.scopes}
        renderItem={(scope) => {
          const info = SCOPE_DESCRIPTIONS[scope as PluginScope];
          if (!info) return null;

          return (
            <List.Item>
              <Space>
                {levelIcons[info.level]}
                <div>
                  <Tag color={levelColors[info.level]}>{info.label}</Tag>
                  <Text type="secondary" className="text-xs">
                    {info.description}
                  </Text>
                </div>
              </Space>
            </List.Item>
          );
        }}
      />

      {hasDangerScope && (
        <div className="mt-4 rounded border border-status-error/40 bg-status-error/10 p-3">
          <Space>
            <ExclamationCircleOutlined className="text-status-error" />
            <Text type="danger">
              {t('plugin.dangerPermissionWarning')}
            </Text>
          </Space>
        </div>
      )}
    </Modal>
  );
};

export default PluginPermissions;
