import React, { useState, useEffect } from 'react';
import { Minus, Square, X, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { electronService } from '../../services/electronService';
import { createLogger } from '../../store/logger';
import { AppLogo } from './AppLogo';
import { UpdateButton } from './UpdateButton';

const logger = createLogger('WindowControls');

export const WindowControls: React.FC = () => {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const maximized = await electronService.window.isMaximized();
        setIsMaximized(maximized);
      } catch {
        // 非 Electron 环境
      }
    };
    checkMaximized();
  }, []);

  const handleMinimize = async () => {
    try {
      await electronService.window.minimize();
    } catch (e) {
      logger.error('Minimize failed', e);
    }
  };

  const handleMaximize = async () => {
    try {
      await electronService.window.maximize();
      const maximized = await electronService.window.isMaximized();
      setIsMaximized(maximized);
    } catch (e) {
      logger.error('Maximize failed', e);
    }
  };

  const handleClose = async () => {
    try {
      await electronService.window.close();
    } catch (e) {
      logger.error('Close failed', e);
    }
  };

  return (
    <div className="h-8 bg-bg-app flex items-center justify-between select-none drag-region">
      {/* 左侧 Logo */}
      <div className="flex items-center h-full px-3 no-drag">
        <AppLogo variant="titlebar" />
        <span className="ml-2 text-xs text-text-secondary font-medium">AI短剧生成工具</span>
      </div>

      {/* 右侧：更新按钮 + 窗口控制按钮 */}
      <div className="flex h-full no-drag">
        <UpdateButton />
        <button
          onClick={handleMinimize}
          className="w-12 h-full flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title={t('window.minimize')}
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-12 h-full flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title={isMaximized ? t('window.restore') : t('window.maximize')}
        >
          {isMaximized ? <Square className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="w-12 h-full flex items-center justify-center text-text-secondary hover:bg-status-error hover:text-on-status transition-colors"
          title={t('window.close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
