/**
 * 对话布局组件
 * 实现 Hero 模式（居中）到 Chat 模式（底部）的平滑过渡
 */
import React, { useState, useEffect, useRef } from 'react';
import { RobotOutlined } from '@ant-design/icons';
import styles from './ChatLayout.module.scss';

interface ChatLayoutProps {
  hasMessages: boolean;
  sidebar?: React.ReactNode;
  messageList: React.ReactNode;
  composer: React.ReactNode;
  toolbar?: React.ReactNode;
  settingsPanel?: React.ReactNode;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
}

export const ChatLayout: React.FC<ChatLayoutProps> = ({
  hasMessages,
  sidebar,
  messageList,
  composer,
  toolbar,
  settingsPanel,
  welcomeTitle = 'Koma AI',
  welcomeSubtitle = '有什么可以帮助你的？',
}) => {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const prevHasMessages = useRef(hasMessages);

  // 检测从无消息到有消息的过渡
  useEffect(() => {
    const wasEmpty = !prevHasMessages.current;
    prevHasMessages.current = hasMessages; // 始终更新 ref，避免后续过渡判断失效
    if (wasEmpty && hasMessages) {
      setIsTransitioning(true);
      const timer = setTimeout(() => setIsTransitioning(false), 500);
      return () => clearTimeout(timer);
    }
  }, [hasMessages]);

  return (
    <div className={styles.layout}>
      {/* 侧边栏 */}
      {sidebar && <aside className={styles.sidebar}>{sidebar}</aside>}

      {/* 主区域 */}
      <div className={styles.main}>
        {/* 工具栏 */}
        {toolbar && <div className={styles.toolbar}>{toolbar}</div>}

        {/* 内容区域 */}
        <div className={styles.content}>
          {/* 设置面板（独立于消息状态） */}
          {settingsPanel}

          {/* Hero 欢迎区域（无消息时显示） */}
          {!hasMessages && (
            <div className={styles.heroArea}>
              <div className={styles.heroContent}>
                <div className={styles.heroIcon}>
                  <RobotOutlined />
                </div>
                <h1 className={styles.heroTitle}>{welcomeTitle}</h1>
                <p className={styles.heroSubtitle}>{welcomeSubtitle}</p>
              </div>
            </div>
          )}

          {/* 消息列表（有消息时显示） */}
          {hasMessages && (
            <div className={styles.messageArea}>
              {messageList}
            </div>
          )}

          {/* 输入框容器 */}
          <div
            className={`${styles.composerContainer} ${
              hasMessages ? styles.composerBottom : styles.composerCenter
            } ${isTransitioning ? styles.composerTransitioning : ''}`}
          >
            {composer}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatLayout;
