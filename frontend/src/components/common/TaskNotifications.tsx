/**
 * 任务通知组件
 * 显示任务状态通知
 */
import React, { useState } from 'react';
import { useTaskNotifications } from '../../hooks/useTaskNotifications';
import type { TaskNotification } from '../../hooks/useTaskNotifications';
import styles from './TaskNotifications.module.scss';

interface NotificationItemProps {
  notification: TaskNotification;
  onClose: () => void;
  onNavigate?: (notification: TaskNotification) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notification, onClose, onNavigate }) => {
  const [retrying, setRetrying] = useState(false);
  const isClickable = !!(notification.onClick || notification.targetId);
  const hasRetry = notification.type === 'error' && !!notification.onRetry;

  const getTypeClass = () => {
    switch (notification.type) {
      case 'success':
        return styles.success;
      case 'error':
        return styles.error;
      case 'warning':
        return styles.warning;
      case 'info':
      default:
        return styles.info;
    }
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '!';
      case 'info':
      default:
        return 'i';
    }
  };

  const handleClick = () => {
    if (notification.onClick) {
      notification.onClick();
      onClose();
    } else if (onNavigate && notification.targetId) {
      onNavigate(notification);
      onClose();
    }
  };

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!notification.onRetry || retrying) return;

    setRetrying(true);
    try {
      await notification.onRetry();
      onClose();
    } catch {
      // 重试失败，保持通知可见
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className={[
        styles.item,
        getTypeClass(),
        isClickable ? styles.clickable : '',
      ].filter(Boolean).join(' ')}
      onClick={isClickable ? handleClick : undefined}
    >
      <div className={styles.icon}>{getIcon()}</div>
      <div className={styles.content}>
        <div className={isClickable ? styles.messageClickable : undefined}>{notification.message}</div>
        {isClickable && (
          <div className={styles.hint}>点击查看详情 →</div>
        )}
        {hasRetry && (
          <button
            className={styles.retryButton}
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? '重试中...' : '重试'}
          </button>
        )}
      </div>
      <span
        className={styles.close}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </span>
    </div>
  );
};

interface TaskNotificationsProps {
  className?: string;
  onNavigate?: (notification: TaskNotification) => void;
}

export const TaskNotifications: React.FC<TaskNotificationsProps> = ({ className, onNavigate }) => {
  const { notifications, removeNotification } = useTaskNotifications();

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')}>
      {notifications.map(notification => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onClose={() => removeNotification(notification.id)}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
};

export default TaskNotifications;
