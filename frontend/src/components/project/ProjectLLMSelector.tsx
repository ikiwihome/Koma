import React, { useState, useEffect } from 'react';
import { Select, Space, Tag, Typography, Alert } from 'antd';
import { RobotOutlined, StarFilled } from '@ant-design/icons';
import { loadSettings } from '../../store/globalStore';
import type { AppSettings } from '../../types';
import {
  buildLLMConfigFromContext,
  getDefaultMediaSelection,
  listConfiguredModelSelectOptions,
  resolveConfiguredChannelModel,
} from '../../providers/channel/resolver';
import styles from './ProjectLLMSelector.module.scss';

const { Text } = Typography;

interface ProjectLLMSelectorProps {
  projectId: string;
  currentSelection?: string;
  onChange: (selectionKey: string | null) => void;
  disabled?: boolean;
}

export const ProjectLLMSelector: React.FC<ProjectLLMSelectorProps> = ({
  projectId: _projectId,
  currentSelection,
  onChange,
  disabled = false,
}) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [configs, setConfigs] = useState<ReturnType<typeof listConfiguredModelSelectOptions>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConfig, setSelectedConfig] = useState<ReturnType<typeof buildLLMConfigFromContext> | null>(null);
  const [configDeleted, setConfigDeleted] = useState(false);

  useEffect(() => {
    loadConfigs();
  }, []);

  useEffect(() => {
    updateSelectedConfig();
  }, [currentSelection, configs, settings]);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const nextSettings = await loadSettings();
      setSettings(nextSettings);
      setConfigs(listConfiguredModelSelectOptions(nextSettings, 'llm', 'llm.chat'));
    } finally {
      setLoading(false);
    }
  };

  const updateSelectedConfig = async () => {
    if (!settings) return;

    const selectionKey = currentSelection || (() => {
      const selection = getDefaultMediaSelection(settings, 'llm', 'llm.chat');
      return selection ? `${selection.channelId}::${selection.modelId}` : '';
    })();

    const context = resolveConfiguredChannelModel(settings, 'llm', selectionKey, 'llm.chat');
    if (context) {
      setSelectedConfig(buildLLMConfigFromContext(context));
      setConfigDeleted(false);
      return;
    }

    if (configs.length > 0) {
      setSelectedConfig(null);
      setConfigDeleted(true);
    }
  };

  const handleChange = (value: string) => {
    if (value === '__default__') {
      onChange(null);
    } else {
      onChange(value);
    }
    setConfigDeleted(false);
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'gemini': return 'Gemini';
      case 'openai': return 'OpenAI';
      case 'openai-compatible': return '兼容';
      default: return provider;
    }
  };

  if (configs.length === 0 && !loading) {
    return (
      <Alert
        type="warning"
        message="未配置 LLM 模型"
        description="请先在全局设置中添加 LLM 模型配置"
        showIcon
      />
    );
  }

  return (
    <div>
      <Space orientation="vertical" className={styles.root} size="small">
        <Select
          className={styles.root}
          loading={loading}
          disabled={disabled || loading}
          value={currentSelection || '__default__'}
          onChange={handleChange}
          placeholder="选择 LLM 模型"
        >
          <Select.Option value="__default__">
            <Space>
              <StarFilled className={styles.defaultIcon} />
              <span>使用全局默认</span>
            </Space>
          </Select.Option>
          {configs.map(config => (
            <Select.Option key={config.value} value={config.value}>
              <Space>
                <RobotOutlined />
                <span>{config.channelLabel} / {config.modelLabel}</span>
                <Tag color="blue" className={styles.providerTag}>{getProviderLabel(config.channelName)}</Tag>
              </Space>
            </Select.Option>
          ))}
        </Select>

        {configDeleted && (
          <Alert
            type="error"
            message="配置已失效"
            description="项目关联的 LLM 配置已被删除，请重新选择"
            showIcon
            className={styles.deletedAlert}
          />
        )}

        {selectedConfig && !configDeleted && (
          <div className={styles.selectedMeta}>
            <Space split="·">
              <Text type="secondary">模型: {selectedConfig.modelName}</Text>
              {selectedConfig.baseUrl && (
                <Text type="secondary" className={styles.baseUrl} ellipsis>
                  {selectedConfig.baseUrl.replace(/https?:\/\//, '')}
                </Text>
              )}
            </Space>
          </div>
        )}
      </Space>
    </div>
  );
};
