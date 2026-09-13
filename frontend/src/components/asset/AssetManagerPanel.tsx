/**
 * 资产管理面板
 * 左侧列表 + 右侧详情面板布局
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createLogger } from '../../store/logger';

const logger = createLogger('AssetManagerPanel');
import { App, Spin, Button, Space, Switch, Tooltip } from 'antd';
import {
  ArrowRightOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { Character, Scene, Prop, EpisodeAnalysis, ProjectStyleSnapshot } from '../../types';
import {
  loadCharacters,
  loadScenes,
  loadProps,
  loadEpisodeAnalysis,
  saveEpisodeAnalysis,
  loadEpisodeShots,
  removeAssetFromAnalysis,
  addCharacterEpisodeRef,
  addSceneEpisodeRef,
  addPropEpisodeRef,
  removeCharacterEpisodeRef,
  removeSceneEpisodeRef,
  removePropEpisodeRef,
} from '../../store/projectStore';
import { submitShotAnalysisTask } from '../../services/analysisTaskClient';
import { AssetListPanel, AssetType } from './AssetListPanel';
import { CharacterDetailPanel } from './CharacterDetailPanel';
import { SceneDetailPanel } from './SceneDetailPanel';
import { PropDetailPanel } from './PropDetailPanel';
import { AssetGenerationWizard } from './AssetGenerationWizard';
import {
  addAssetIdToEpisodeAnalysisRefs,
  filterAssetsForEpisode,
  getUnboundAssetsForEpisode,
  withEpisodeRef,
  withoutEpisodeRef,
} from './assetEpisodeRefs';
import type { EpisodeRefsKey } from './assetEpisodeRefs';
import { parseMediaSelectionKey } from '../../providers/channel/resolver';
import type { Project } from '../../types';
import './AssetManager.scss';


function upsertAssetById<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some(existing => existing.id === item.id)
    ? items.map(existing => existing.id === item.id ? item : existing)
    : [...items, item];
}

interface AssetManagerPanelProps {
  projectId: string;
  /** 项目全局比例 — 透传给角色/场景/道具的生图调用，让参考图与项目比例一致 */
  aspectRatio?: '16:9' | '9:16';
  ttiSelection?: string;
  itvSelection?: string;
  theme?: string;
  styleSnapshot?: ProjectStyleSnapshot;
  stylePrompt?: string;
  episodeId?: string;
  episodeName?: string;
  script?: string;
  llmSelection?: string;
  onNext: () => void;
}

export const AssetManagerPanel: React.FC<AssetManagerPanelProps> = ({
  projectId,
  aspectRatio,
  ttiSelection,
  itvSelection,
  theme,
  styleSnapshot,
  stylePrompt: legacyStylePrompt,
  episodeId,
  episodeName,
  script,
  llmSelection,
  onNext,
}) => {
  const { t } = useTranslation();
  const { message } = App.useApp();

  // 资产数据
  const [characters, setCharacters] = useState<Character[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [props, setProps] = useState<Prop[]>([]);
  const [loading, setLoading] = useState(true);

  // 选中状态
  const [selectedType, setSelectedType] = useState<AssetType>('character');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 剧集筛选
  const [showCurrentEpisodeOnly, setShowCurrentEpisodeOnly] = useState(true);
  const [episodeAnalysis, setEpisodeAnalysis] = useState<EpisodeAnalysis | null>(null);

  // 分镜生成状态
  const [isGeneratingShots, setIsGeneratingShots] = useState(false);
  // 批量生成向导
  const [wizardOpen, setWizardOpen] = useState(false);
  const stylePrompt = useMemo(
    () => styleSnapshot?.ttiStylePrefix?.trim() || legacyStylePrompt?.trim() || '',
    [styleSnapshot, legacyStylePrompt]
  );
  const currentEpisodeRef = useMemo(() => {
    if (!episodeId) return null;
    return {
      episodeId,
      episodeName: episodeName || `${t('editor.episode')} ${episodeId}`,
      firstAppearance: true,
    };
  }, [episodeId, episodeName, t]);

  // 加载资产数据
  const loadAssets = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [chars, scns, prps] = await Promise.all([
        loadCharacters(projectId),
        loadScenes(projectId),
        loadProps(projectId),
      ]);
      setCharacters(chars);
      setScenes(scns);
      setProps(prps);

      if (episodeId) {
        const analysis = await loadEpisodeAnalysis(projectId, episodeId);
        setEpisodeAnalysis(analysis);
      }
    } catch (err) {
      logger.error('加载资产失败:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, episodeId]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // 筛选后的资产
  const filteredCharacters = useMemo(() => {
    if (!showCurrentEpisodeOnly || !episodeAnalysis) return characters;
    return filterAssetsForEpisode(characters, episodeAnalysis.characterRefs, episodeId);
  }, [characters, showCurrentEpisodeOnly, episodeAnalysis, episodeId]);

  const filteredScenes = useMemo(() => {
    if (!showCurrentEpisodeOnly || !episodeAnalysis) return scenes;
    return filterAssetsForEpisode(scenes, episodeAnalysis.sceneRefs, episodeId);
  }, [scenes, showCurrentEpisodeOnly, episodeAnalysis, episodeId]);

  const filteredProps = useMemo(() => {
    if (!showCurrentEpisodeOnly || !episodeAnalysis) return props;
    return filterAssetsForEpisode(props, episodeAnalysis.propRefs, episodeId);
  }, [props, showCurrentEpisodeOnly, episodeAnalysis, episodeId]);

  // 获取当前选中的资产
  const selectedCharacter = useMemo(
    () => characters.find(c => c.id === selectedId) || null,
    [characters, selectedId]
  );
  const selectedScene = useMemo(
    () => scenes.find(s => s.id === selectedId) || null,
    [scenes, selectedId]
  );
  const selectedProp = useMemo(
    () => props.find(p => p.id === selectedId) || null,
    [props, selectedId]
  );

  const characterBindCandidates = useMemo(() => (
    getUnboundAssetsForEpisode(characters, episodeAnalysis?.characterRefs, episodeId)
  ), [characters, episodeAnalysis?.characterRefs, episodeId]);

  const sceneBindCandidates = useMemo(() => (
    getUnboundAssetsForEpisode(scenes, episodeAnalysis?.sceneRefs, episodeId)
  ), [scenes, episodeAnalysis?.sceneRefs, episodeId]);

  const propBindCandidates = useMemo(() => (
    getUnboundAssetsForEpisode(props, episodeAnalysis?.propRefs, episodeId)
  ), [props, episodeAnalysis?.propRefs, episodeId]);

  const syncAssetWithCurrentEpisode = useCallback(async <T extends Character | Scene | Prop,>(
    asset: T,
    refsKey: EpisodeRefsKey,
    addEpisodeRef: (projectId: string, assetId: string, episodeRef: NonNullable<typeof currentEpisodeRef>) => Promise<void>
  ): Promise<T> => {
    if (!episodeId || !episodeAnalysis || !currentEpisodeRef) return asset;

    const latestAnalysis = await loadEpisodeAnalysis(projectId, episodeId);
    const baseAnalysis = latestAnalysis || episodeAnalysis;
    const updatedAnalysis = addAssetIdToEpisodeAnalysisRefs(baseAnalysis, refsKey, asset.id);

    const [savedAnalysis] = await Promise.all([
      saveEpisodeAnalysis(projectId, episodeId, {
        characterRefs: updatedAnalysis.characterRefs,
        sceneRefs: updatedAnalysis.sceneRefs,
        propRefs: updatedAnalysis.propRefs,
        completedStages: updatedAnalysis.completedStages,
        shots: updatedAnalysis.shots,
      }),
      addEpisodeRef(projectId, asset.id, currentEpisodeRef),
    ]);

    setEpisodeAnalysis(savedAnalysis);
    return withEpisodeRef(asset, currentEpisodeRef);
  }, [currentEpisodeRef, episodeAnalysis, episodeId, projectId]);

  const handleBindExistingCharacter = useCallback(async (character: Character) => {
    try {
      const syncedChar = await syncAssetWithCurrentEpisode(
        character,
        'characterRefs',
        addCharacterEpisodeRef
      );
      setCharacters(prev => upsertAssetById(prev, syncedChar));
      setSelectedType('character');
      setSelectedId(character.id);
      message.success(t('asset.addedToEpisode'));
    } catch (err) {
      logger.error('绑定已有角色到当前集失败:', err);
      message.error(t('asset.saveFailed'));
    }
  }, [message, syncAssetWithCurrentEpisode, t]);

  const handleBindExistingScene = useCallback(async (scene: Scene) => {
    try {
      const syncedScene = await syncAssetWithCurrentEpisode(
        scene,
        'sceneRefs',
        addSceneEpisodeRef
      );
      setScenes(prev => upsertAssetById(prev, syncedScene));
      setSelectedType('scene');
      setSelectedId(scene.id);
      message.success(t('asset.addedToEpisode'));
    } catch (err) {
      logger.error('绑定已有场景到当前集失败:', err);
      message.error(t('asset.saveFailed'));
    }
  }, [message, syncAssetWithCurrentEpisode, t]);

  const handleBindExistingProp = useCallback(async (prop: Prop) => {
    try {
      const syncedProp = await syncAssetWithCurrentEpisode(
        prop,
        'propRefs',
        addPropEpisodeRef
      );
      setProps(prev => upsertAssetById(prev, syncedProp));
      setSelectedType('prop');
      setSelectedId(prop.id);
      message.success(t('asset.addedToEpisode'));
    } catch (err) {
      logger.error('绑定已有道具到当前集失败:', err);
      message.error(t('asset.saveFailed'));
    }
  }, [message, syncAssetWithCurrentEpisode, t]);

  const updateAssetWithCurrentEpisode = useCallback(<T extends Character | Scene | Prop,>(
    updated: T,
    refsKey: EpisodeRefsKey,
    addEpisodeRef: (projectId: string, assetId: string, episodeRef: NonNullable<typeof currentEpisodeRef>) => Promise<void>,
    setAssets: React.Dispatch<React.SetStateAction<T[]>>,
    errorMessage: string
  ) => {
    setAssets(prev => upsertAssetById(prev, updated));

    if (!showCurrentEpisodeOnly || !episodeId || !episodeAnalysis || !currentEpisodeRef) return;

    void (async () => {
      try {
        const syncedAsset = await syncAssetWithCurrentEpisode(updated, refsKey, addEpisodeRef);
        setAssets(prev => upsertAssetById(prev, syncedAsset));
      } catch (err) {
        logger.error(errorMessage, err);
      }
    })();
  }, [currentEpisodeRef, episodeAnalysis, episodeId, showCurrentEpisodeOnly, syncAssetWithCurrentEpisode]);

  // 资产更新回调
  const handleCharacterUpdate = useCallback((updated: Character) => {
    updateAssetWithCurrentEpisode(
      updated,
      'characterRefs',
      addCharacterEpisodeRef,
      setCharacters,
      '同步角色剧集引用失败:'
    );
  }, [updateAssetWithCurrentEpisode]);

  const handleSceneUpdate = useCallback((updated: Scene) => {
    updateAssetWithCurrentEpisode(
      updated,
      'sceneRefs',
      addSceneEpisodeRef,
      setScenes,
      '同步场景剧集引用失败:'
    );
  }, [updateAssetWithCurrentEpisode]);

  const handlePropUpdate = useCallback((updated: Prop) => {
    updateAssetWithCurrentEpisode(
      updated,
      'propRefs',
      addPropEpisodeRef,
      setProps,
      '同步道具剧集引用失败:'
    );
  }, [updateAssetWithCurrentEpisode]);

  // 从当前集移除资产绑定，不删除项目公共资产本体
  const removeAssetFromCurrentEpisode = useCallback(async <T extends Character | Scene | Prop,>(
    id: string,
    type: AssetType,
    removeEpisodeRef: (projectId: string, assetId: string, episodeId: string) => Promise<void>,
    setAssets: React.Dispatch<React.SetStateAction<T[]>>
  ) => {
    if (!episodeId) {
      if (selectedId === id) setSelectedId(null);
      message.warning(t('asset.cannotRemoveWithoutEpisode'));
      return;
    }

    try {
      await Promise.all([
        removeAssetFromAnalysis(projectId, episodeId, id, type),
        removeEpisodeRef(projectId, id, episodeId),
      ]);

      const latestAnalysis = await loadEpisodeAnalysis(projectId, episodeId);
      setEpisodeAnalysis(latestAnalysis);
      setAssets(prev => prev.map(asset => (
        asset.id === id ? withoutEpisodeRef(asset, episodeId) : asset
      )));
      if (selectedId === id) setSelectedId(null);
      message.success(t('asset.removedFromEpisode'));
    } catch (err) {
      logger.error('从当前集移除资产失败:', err);
      message.error(t('asset.saveFailed'));
    }
  }, [episodeId, message, projectId, selectedId, t]);

  const handleCharacterDelete = useCallback(async (id: string) => {
    await removeAssetFromCurrentEpisode(id, 'character', removeCharacterEpisodeRef, setCharacters);
  }, [removeAssetFromCurrentEpisode]);

  const handleSceneDelete = useCallback(async (id: string) => {
    await removeAssetFromCurrentEpisode(id, 'scene', removeSceneEpisodeRef, setScenes);
  }, [removeAssetFromCurrentEpisode]);

  const handlePropDelete = useCallback(async (id: string) => {
    await removeAssetFromCurrentEpisode(id, 'prop', removePropEpisodeRef, setProps);
  }, [removeAssetFromCurrentEpisode]);

  // 新建资产回调
  const handleCharacterCreate = useCallback((newChar: Character) => {
    void (async () => {
      try {
        const syncedChar = await syncAssetWithCurrentEpisode(
          newChar,
          'characterRefs',
          addCharacterEpisodeRef
        );
        setCharacters(prev => upsertAssetById(prev, syncedChar));
      } catch (err) {
        logger.error('同步新角色剧集引用失败:', err);
        message.error(t('asset.saveFailed'));
        setCharacters(prev => upsertAssetById(prev, newChar));
      } finally {
        setSelectedType('character');
        setSelectedId(newChar.id);
      }
    })();
  }, [message, syncAssetWithCurrentEpisode, t]);

  const handleSceneCreate = useCallback((newScene: Scene) => {
    void (async () => {
      try {
        const syncedScene = await syncAssetWithCurrentEpisode(
          newScene,
          'sceneRefs',
          addSceneEpisodeRef
        );
        setScenes(prev => upsertAssetById(prev, syncedScene));
      } catch (err) {
        logger.error('同步新场景剧集引用失败:', err);
        message.error(t('asset.saveFailed'));
        setScenes(prev => upsertAssetById(prev, newScene));
      } finally {
        setSelectedType('scene');
        setSelectedId(newScene.id);
      }
    })();
  }, [message, syncAssetWithCurrentEpisode, t]);

  const handlePropCreate = useCallback((newProp: Prop) => {
    void (async () => {
      try {
        const syncedProp = await syncAssetWithCurrentEpisode(
          newProp,
          'propRefs',
          addPropEpisodeRef
        );
        setProps(prev => upsertAssetById(prev, syncedProp));
      } catch (err) {
        logger.error('同步新道具剧集引用失败:', err);
        message.error(t('asset.saveFailed'));
        setProps(prev => upsertAssetById(prev, newProp));
      } finally {
        setSelectedType('prop');
        setSelectedId(newProp.id);
      }
    })();
  }, [message, syncAssetWithCurrentEpisode, t]);

  // 选择资产
  const handleSelect = useCallback((type: AssetType, id: string | null) => {
    setSelectedType(type);
    setSelectedId(id);
  }, []);

  // 下一步
  const handleNextAndGenerateShots = async () => {
    if (!episodeId || !script) {
      message.warning(t('asset.missingEpisodeOrScript'));
      onNext();
      return;
    }

    // 检查是否已有分镜数据，避免重复生成
    try {
      const existingShots = await loadEpisodeShots(projectId, episodeId);
      if (existingShots.length > 0) {
        onNext();
        return;
      }
    } catch {
      // 加载失败时继续生成
    }

    setIsGeneratingShots(true);
    try {
      const { deduped } = await submitShotAnalysisTask({
        projectId,
        episodeId,
        episodeName: episodeName || `${t('editor.episode')} ${episodeId}`,
        script,
        llmSelection,
        styleSnapshot,
      });
      if (deduped) {
        message.info('当前剧集已在后台生成中，请等待完成后再试。');
      } else {
        message.info(t('asset.aiShotStarted'));
      }
      onNext();
    } catch (err: any) {
      message.error(err.message || t('asset.startShotFailed'));
    } finally {
      setIsGeneratingShots(false);
    }
  };

  if (loading) {
    return (
      <div className="assetManagerPanel assetManagerPanelLoading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="assetManagerPanel">
      {/* 左侧列表 */}
      <div className="assetListSection">
        <AssetListPanel
          characters={filteredCharacters}
          scenes={filteredScenes}
          props={filteredProps}
          selectedType={selectedType}
          selectedId={selectedId}
          onSelect={handleSelect}
          onCreateCharacter={handleCharacterCreate}
          onCreateScene={handleSceneCreate}
          onCreateProp={handlePropCreate}
          canBindExisting={!!episodeId && !!episodeAnalysis}
          existingCharacterCandidates={characterBindCandidates}
          existingSceneCandidates={sceneBindCandidates}
          existingPropCandidates={propBindCandidates}
          onBindExistingCharacter={handleBindExistingCharacter}
          onBindExistingScene={handleBindExistingScene}
          onBindExistingProp={handleBindExistingProp}
          projectId={projectId}
        />
        {/* 筛选开关 */}
        {episodeId && (
          <div className="assetListFilter">
            <Space size="small">
              <FilterOutlined />
              <span>{t('asset.currentEpisodeOnly')}</span>
              <Tooltip title={!episodeAnalysis ? t('asset.needAnalysisFirst') : ''}>
                <Switch
                  size="small"
                  checked={showCurrentEpisodeOnly}
                  onChange={setShowCurrentEpisodeOnly}
                  disabled={!episodeAnalysis}
                />
              </Tooltip>
            </Space>
          </div>
        )}
      </div>

      {/* 右侧详情面板 */}
      <div className="assetDetailSection">
        {selectedType === 'character' && selectedCharacter && (
          <CharacterDetailPanel
            key={selectedCharacter.id}
            character={selectedCharacter}
            projectId={projectId}
            aspectRatio={aspectRatio}
            theme={theme}
            stylePrompt={stylePrompt}
            styleSnapshot={styleSnapshot}
            ttiSelection={ttiSelection}
            itvSelection={itvSelection}
            onUpdate={handleCharacterUpdate}
            onDelete={handleCharacterDelete}
          />
        )}
        {selectedType === 'scene' && selectedScene && (
          <SceneDetailPanel
            key={selectedScene.id}
            scene={selectedScene}
            projectId={projectId}
            aspectRatio={aspectRatio}
            theme={theme}
            stylePrompt={stylePrompt}
            styleSnapshot={styleSnapshot}
            ttiSelection={ttiSelection}
            onUpdate={handleSceneUpdate}
            onDelete={handleSceneDelete}
          />
        )}
        {selectedType === 'prop' && selectedProp && (
          <PropDetailPanel
            key={selectedProp.id}
            prop={selectedProp}
            projectId={projectId}
            aspectRatio={aspectRatio}
            theme={theme}
            stylePrompt={stylePrompt}
            styleSnapshot={styleSnapshot}
            ttiSelection={ttiSelection}
            itvSelection={itvSelection}
            onUpdate={handlePropUpdate}
            onDelete={handlePropDelete}
          />
        )}
        {!selectedId && (
          <div className="assetDetailEmpty">
            <span>{t('asset.selectToView')}</span>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="assetFooter">
        <Space>
          <Tooltip title={t('asset.batchGenerateMaterials')}>
            <Button icon={<ThunderboltOutlined />} onClick={() => setWizardOpen(true)}>{t('asset.batchGenerate')}</Button>
          </Tooltip>
        </Space>
        <Button
          type="primary"
          size="large"
          icon={isGeneratingShots ? <LoadingOutlined /> : <ArrowRightOutlined />}
          onClick={handleNextAndGenerateShots}
          loading={isGeneratingShots}
        >
          {isGeneratingShots ? t('asset.generatingAIShots') : t('asset.nextGenerateShots')}
        </Button>
      </div>

      {/* 批量生成向导 */}
      <AssetGenerationWizard
        project={{
          id: projectId,
          title: '',
          genre: '',
          episodes: 0,
          lastEdited: '',
          thumbnail: '',
          status: 'script',
          aspectRatio,
          mediaSelections: {
            ...(ttiSelection ? { tti: parseMediaSelectionKey(ttiSelection) } : undefined),
            ...(itvSelection ? { itv: parseMediaSelectionKey(itvSelection) } : undefined),
          },
          styleSnapshot,
        } as Project}
        open={wizardOpen}
        // 关闭时无条件重载父级资产 — wizard.onComplete 只在用户点完最后一步才触发，
        // 期间用户中途关掉（X / 取消 / ESC）会导致左侧资产列表停留在旧数据。
        onClose={() => { setWizardOpen(false); loadAssets(); }}
        onComplete={loadAssets}
      />
    </div>
  );
};

export default AssetManagerPanel;
