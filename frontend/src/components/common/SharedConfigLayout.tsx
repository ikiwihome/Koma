/**
 * SharedConfigLayout - 统一配置页面/弹窗布局
 * 确保所有设置界面样式一致
 */
import React from 'react';
import { Button, Space, Spin, Typography } from 'antd';
import { SaveOutlined, CloseOutlined } from '@ant-design/icons';
import styles from './SharedConfigLayout.module.scss';

const { Title, Text } = Typography;

interface SharedConfigLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  loading?: boolean;
  onSave?: () => void;
  onCancel?: () => void;
  saveText?: string;
  cancelText?: string;
  showFooter?: boolean;
  extra?: React.ReactNode;
  footerExtra?: React.ReactNode;
  className?: string;
}

export const SharedConfigLayout: React.FC<SharedConfigLayoutProps> = ({
  title,
  description,
  children,
  loading = false,
  onSave,
  onCancel,
  saveText = '保存',
  cancelText = '取消',
  showFooter = true,
  extra,
  footerExtra,
  className,
}) => {
  return (
    <div
      className={[styles.layout, 'sharedConfigLayout', className].filter(Boolean).join(' ')}
    >
      {/* Header */}
      <div className={styles.header}>
        <div>
          <Title
            level={4}
            className={styles.title}
          >
            {title}
          </Title>
          {description && (
            <Text
              className={styles.description}
            >
              {description}
            </Text>
          )}
        </div>
        {extra && <div>{extra}</div>}
      </div>

      {/* Content */}
      <div className={styles.content}>
        <Spin spinning={loading}>{children}</Spin>
      </div>

      {/* Footer */}
      {showFooter && (onSave || onCancel) && (
        <div className={styles.footer}>
          <div>{footerExtra}</div>
          <Space className="btnGroupRight">
            {onCancel && (
              <Button icon={<CloseOutlined />} onClick={onCancel}>
                {cancelText}
              </Button>
            )}
            {onSave && (
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={onSave}
                loading={loading}
              >
                {saveText}
              </Button>
            )}
          </Space>
        </div>
      )}
    </div>
  );
};

export default SharedConfigLayout;
