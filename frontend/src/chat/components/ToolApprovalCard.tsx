/**
 * 工具调用审批卡片
 * 用于展示需要用户批准的工具调用
 */
import React from 'react';
import { Card, Button, Space, Typography, Tag, Collapse } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  ToolOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { ToolCallState } from '../../types/mcp';
import styles from './ToolApprovalCard.module.scss';

const { Text, Paragraph } = Typography;

interface ToolApprovalCardProps {
  calls: ToolCallState[];
  onApprove: (id: string) => void;
  onApproveAll: () => void;
  onReject: (id: string) => void;
  onRejectAll: () => void;
}

export const ToolApprovalCard: React.FC<ToolApprovalCardProps> = ({
  calls,
  onApprove,
  onApproveAll,
  onReject,
  onRejectAll,
}) => {
  const pendingCalls = calls.filter(c => c.status === 'pending_approval');

  if (pendingCalls.length === 0) return null;

  const parseToolName = (toolName: string) => {
    if (toolName.includes(':')) {
      const [namespace, ...rest] = toolName.split(':');
      return { namespace, name: rest.join(':') };
    }
    return { namespace: undefined, name: toolName };
  };

  return (
    <Card
      className={styles.card}
      title={
        <Space>
          <ExclamationCircleOutlined className={styles.warningIcon} />
          <span>工具调用请求</span>
          <Tag color="orange">{pendingCalls.length} 个待批准</Tag>
        </Space>
      }
      extra={
        pendingCalls.length > 1 && (
          <Space>
            <Button size="small" onClick={onRejectAll}>
              全部拒绝
            </Button>
            <Button type="primary" size="small" onClick={onApproveAll}>
              全部批准
            </Button>
          </Space>
        )
      }
    >
      <div className={styles.callList}>
        {pendingCalls.map((call) => {
          const { namespace, name } = parseToolName(call.toolName);
          return (
            <div key={call.id} className={styles.callItem}>
              <div className={styles.callHeader}>
                <div className={styles.toolInfo}>
                  <ToolOutlined className={styles.toolIcon} />
                  <Text strong>{name}</Text>
                  {namespace && <Tag className={styles.namespace}>{namespace}</Tag>}
                </div>
                <Space>
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => onReject(call.id)}
                  >
                    拒绝
                  </Button>
                  <Button
                    type="primary"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={() => onApprove(call.id)}
                  >
                    批准
                  </Button>
                </Space>
              </div>

              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: 'args',
                    label: <Text type="secondary">查看参数</Text>,
                    children: (
                      <pre className={styles.args}>
                        {JSON.stringify(call.args, null, 2)}
                      </pre>
                    ),
                  },
                ]}
              />
            </div>
          );
        })}
      </div>

      <Paragraph type="secondary" className={styles.hint}>
        批准后将执行上述工具调用。请确认参数是否安全。
      </Paragraph>
    </Card>
  );
};

export default ToolApprovalCard;
