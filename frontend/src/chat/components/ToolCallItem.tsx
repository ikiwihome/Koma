/**
 * 工具调用状态显示组件
 */
import React from 'react';
import { Tag, Typography, Collapse, Spin } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { ToolCallState, ToolCallStatus } from '../../types/mcp';
import styles from './ToolCallItem.module.scss';

const { Text, Paragraph } = Typography;

interface ToolCallItemProps {
  state: ToolCallState;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  showResult?: boolean;
}

const statusConfig: Record<ToolCallStatus, { color: string; icon: React.ReactNode; text: string }> = {
  pending_approval: { color: 'orange', icon: <ClockCircleOutlined />, text: '待批准' },
  calling: { color: 'processing', icon: <LoadingOutlined spin />, text: '调用中' },
  running: { color: 'processing', icon: <Spin size="small" />, text: '执行中' },
  success: { color: 'success', icon: <CheckCircleOutlined />, text: '成功' },
  error: { color: 'error', icon: <CloseCircleOutlined />, text: '失败' },
};

export const ToolCallItem: React.FC<ToolCallItemProps> = ({
  state,
  showResult = true,
}) => {
  const { toolName, args, status, result, error, startTime, endTime } = state;
  const config = statusConfig[status];
  const duration = endTime ? endTime - startTime : 0;

  // 解析命名空间
  const [namespace, name] = toolName.includes(':')
    ? [toolName.split(':')[0], toolName.split(':').slice(1).join(':')]
    : [undefined, toolName];

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const renderResult = () => {
    if (!showResult) return null;
    if (status === 'error' && error) {
      return (
        <Paragraph type="danger" className={styles.error}>
          {error}
        </Paragraph>
      );
    }
    if (status === 'success' && result !== undefined) {
      const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return (
        <pre className={styles.result}>
          {content.length > 500 ? content.slice(0, 500) + '...' : content}
        </pre>
      );
    }
    return null;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.toolInfo}>
          <ToolOutlined className={styles.toolIcon} />
          <Text strong className={styles.toolName}>{name}</Text>
          {namespace && (
            <Tag className={styles.namespace}>{namespace}</Tag>
          )}
        </div>
        <div className={styles.statusInfo}>
          <Tag color={config.color} icon={config.icon}>
            {config.text}
          </Tag>
          {duration > 0 && (
            <Text type="secondary" className={styles.duration}>
              {formatDuration(duration)}
            </Text>
          )}
        </div>
      </div>

      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'args',
            label: <Text type="secondary">参数</Text>,
            children: (
              <pre className={styles.args}>
                {JSON.stringify(args, null, 2)}
              </pre>
            ),
          },
        ]}
      />

      {renderResult()}
    </div>
  );
};

export default ToolCallItem;
