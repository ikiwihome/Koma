/**
 * 保存状态指示器
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSaveStatus } from '../../hooks/useTaskNotifications';
import { saveProjectNow } from '../../store/autoSaveService';
import styles from './SaveStatusIndicator.module.scss';

interface SaveStatusIndicatorProps {
  projectId: string;
  className?: string;
}

export const SaveStatusIndicator: React.FC<SaveStatusIndicatorProps> = ({
  projectId,
  className = '',
}) => {
  const { t } = useTranslation();
  const saveState = useSaveStatus(projectId);

  const handleClick = async () => {
    if (saveState.status === 'dirty' || saveState.status === 'error') {
      await saveProjectNow(projectId);
    }
  };

  const getStatusIcon = () => {
    switch (saveState.status) {
      case 'saved':
        return '✓';
      case 'saving':
        return '...';
      case 'dirty':
        return '•';
      case 'error':
        return '!';
      default:
        return '';
    }
  };

  const getStatusText = () => {
    switch (saveState.status) {
      case 'saved':
        return t('common.saved');
      case 'saving':
        return t('common.saving');
      case 'dirty':
        return t('common.unsaved');
      case 'error':
        return saveState.error || t('common.saveFailed');
      default:
        return '';
    }
  };

  const getStatusClass = () => {
    switch (saveState.status) {
      case 'saved':
        return styles.saved;
      case 'saving':
        return styles.saving;
      case 'dirty':
        return styles.dirty;
      case 'error':
        return styles.error;
      default:
        return '';
    }
  };

  return (
    <div
      className={[
        styles.container,
        getStatusClass(),
        saveState.status === 'dirty' || saveState.status === 'error' ? styles.clickable : '',
        className,
      ].filter(Boolean).join(' ')}
      onClick={handleClick}
      title={saveState.status === 'dirty' ? t('common.clickToSave') : getStatusText()}
    >
      <span className={styles.icon}>{getStatusIcon()}</span>
      <span>{getStatusText()}</span>
    </div>
  );
};

export default SaveStatusIndicator;
