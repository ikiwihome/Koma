import React, { useEffect, useMemo, useState } from 'react';
import { Button, Select, Space, Tag, Tooltip } from 'antd';
import {
  ExperimentOutlined,
  PictureOutlined,
  SettingOutlined,
  SoundOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { AppSettings, MediaModelSelection } from '../../types';
import { loadSettings } from '../../store/globalStore';
import {
  parseMediaSelectionKey,
} from '../../providers/channel/resolver';
import type { MediaCategory } from '../../providers/channel/types';
import {
  buildProjectMediaCategoryState,
  PROJECT_MEDIA_BASE_REQUIREMENTS,
  PROJECT_MEDIA_CAPABILITY_LABELS,
  type ProjectMediaCategoryKey,
  type ProjectMediaRequirement,
} from './projectMediaSelectionState';
import styles from './ProjectMediaSelector.module.scss';

type ProjectMediaSelections = Partial<Record<'llm' | 'tti' | 'itv' | 'tts', MediaModelSelection>>;

interface ProjectMediaSelectorProps {
  mediaSelections?: ProjectMediaSelections;
  onChange: (selections: ProjectMediaSelections) => void;
  onGoToSettings?: () => void;
  requirements?: Partial<Record<ProjectMediaCategoryKey, ProjectMediaRequirement>>;
}

function categoryLabel(category: MediaCategory): string {
  switch (category) {
    case 'llm':
      return 'LLM 大模型';
    case 'tti':
      return '文生图';
    case 'itv':
      return '视频生成';
    case 'tts':
      return '语音合成';
    default:
      return category;
  }
}

function categoryIcon(category: MediaCategory) {
  switch (category) {
    case 'llm':
      return <ExperimentOutlined />;
    case 'tti':
      return <PictureOutlined />;
    case 'itv':
      return <VideoCameraOutlined />;
    case 'tts':
      return <SoundOutlined />;
    default:
      return null;
  }
}

function renderOptionLabel(option: ReturnType<typeof buildProjectMediaCategoryState>['options'][number]) {
  return (
    <div className={styles.optionLabel}>
      <Space size={6} wrap>
        <span>{option.modelLabel}</span>
        <Tag color="blue">{option.channelLabel}</Tag>
      </Space>
      <Space size={4} wrap>
        {option.capabilities.map((capability) => (
          <Tag key={capability} variant="filled" color={capability.startsWith('video.') ? 'magenta' : 'default'}>
            {PROJECT_MEDIA_CAPABILITY_LABELS[capability] || capability}
          </Tag>
        ))}
      </Space>
    </div>
  );
}

export const ProjectMediaSelector: React.FC<ProjectMediaSelectorProps> = ({
  mediaSelections,
  onChange,
  onGoToSettings,
  requirements,
}) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const value = await loadSettings();
      if (!cancelled) {
        setSettings(value);
        setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const optionMap = useMemo(() => {
    if (!settings) {
      return {
        llm: buildProjectMediaCategoryState({ settings: { channelConfigs: [], promptTemplates: {} }, category: 'llm' }),
        tti: buildProjectMediaCategoryState({ settings: { channelConfigs: [], promptTemplates: {} }, category: 'tti' }),
        itv: buildProjectMediaCategoryState({ settings: { channelConfigs: [], promptTemplates: {} }, category: 'itv' }),
        tts: buildProjectMediaCategoryState({ settings: { channelConfigs: [], promptTemplates: {} }, category: 'tts' }),
      };
    }
    return {
      llm: buildProjectMediaCategoryState({
        settings,
        category: 'llm',
        explicitSelection: mediaSelections?.llm,
        requirement: requirements?.llm || PROJECT_MEDIA_BASE_REQUIREMENTS.llm,
      }),
      tti: buildProjectMediaCategoryState({
        settings,
        category: 'tti',
        explicitSelection: mediaSelections?.tti,
        requirement: requirements?.tti || PROJECT_MEDIA_BASE_REQUIREMENTS.tti,
      }),
      itv: buildProjectMediaCategoryState({
        settings,
        category: 'itv',
        explicitSelection: mediaSelections?.itv,
        requirement: requirements?.itv || PROJECT_MEDIA_BASE_REQUIREMENTS.itv,
      }),
      tts: buildProjectMediaCategoryState({
        settings,
        category: 'tts',
        explicitSelection: mediaSelections?.tts,
        requirement: requirements?.tts || PROJECT_MEDIA_BASE_REQUIREMENTS.tts,
      }),
    };
  }, [settings, mediaSelections, requirements]);

  const updateCategory = (category: keyof ProjectMediaSelections, value?: string) => {
    const nextSelection = parseMediaSelectionKey(value);
    const next: ProjectMediaSelections = {
      ...(mediaSelections || {}),
    };
    if (nextSelection) {
      next[category] = nextSelection;
    } else {
      delete next[category];
    }
    onChange(next);
  };

  const renderCategory = (category: ProjectMediaCategoryKey) => {
    const state = optionMap[category];
    const selectValue = state.explicitSupported ? state.explicitValue : undefined;
    const fallbackText = state.fallbackLabel
      ? (state.usingFallback ? `当前使用全局默认: ${state.fallbackLabel}` : `留空时回退到全局默认: ${state.fallbackLabel}`)
      : '当前未配置全局默认模型';

    return (
      <div key={category}>
        <div className={styles.categoryHeader}>
          {categoryIcon(category)}
          <span className={styles.categoryTitle}>{categoryLabel(category)}</span>
          {state.requirement?.label && <Tag color="cyan">{state.requirement.label}</Tag>}
          {state.options.length === 0 && <Tag color="orange">未配置</Tag>}
          {state.usingFallback && state.fallbackLabel && <Tag color="gold">默认回退</Tag>}
        </div>
        <Select
          allowClear
          showSearch
          value={selectValue}
          placeholder={state.fallbackLabel ? `使用全局默认: ${state.fallbackLabel}` : '使用全局默认'}
          optionLabelProp="label"
          className={styles.select}
          loading={loading}
          disabled={state.options.length === 0}
          onChange={(value) => updateCategory(category, value)}
          status={state.warning ? 'warning' : undefined}
          options={state.options.map((option) => ({
            value: option.value,
            label: `${option.channelLabel} / ${option.modelLabel}`,
          }))}
          optionRender={({ value }) => {
            const option = state.options.find((item) => item.value === value);
            return option ? renderOptionLabel(option) : value;
          }}
        />
        <div className={styles.categoryMeta}>
          <span className={styles.metaText}>{fallbackText}</span>
          {state.requirement?.description && (
            <span className={styles.metaText}>{state.requirement.description}</span>
          )}
          {state.warning && (
            <span className={styles.warningText}>{state.warning}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.root}>
      {renderCategory('llm')}
      {renderCategory('tti')}
      {renderCategory('itv')}
      {renderCategory('tts')}
      {onGoToSettings && (
        <div className={styles.settingsLinkRow}>
          <Tooltip title="在全局设置中管理渠道与默认模型">
            <Button
              type="link"
              icon={<SettingOutlined />}
              onClick={onGoToSettings}
              className={styles.linkButton}
            >
              前往全局设置
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
};
