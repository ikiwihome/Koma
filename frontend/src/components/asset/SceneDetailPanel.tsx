/**
 * 场景详情面板 - Creator Layout
 * 左侧输入控制区 + 右侧画布预览区
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createLogger } from '../../store/logger';

const logger = createLogger('SceneDetailPanel');
import {
  Form,
  Input,
  Button,
  Space,
  Progress,
  App,
  Typography,
  Popconfirm,
  Modal,
  Tooltip,
} from 'antd';
import {
  EnvironmentOutlined,
  SaveOutlined,
  DeleteOutlined,
  UploadOutlined,
  ThunderboltOutlined,
  LoadingOutlined,
  ExpandOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ProjectStyleSnapshot, Scene } from '../../types';
import { isRemoteMediaUri } from '../../types';
import { generateSceneImage } from '../../workflow/scenePropAssetWorkflow';
import { electronService, openFileDialog, fsCopy, fsMkdir, fsExists, fsRemove } from '../../services/electronService';
import { getStorageConfig, initStorageConfig } from '../../store/storageConfig';
import { saveScenes, loadScenes } from '../../store/projectStore';
import { useActiveConfig } from '../../hooks/useActiveConfig';
import { uploadLocalFileToImageHosting, isImageHostingEnabled } from '../../services/imageHostingService';
import { ensureRemoteUrlForImageAsset } from '../../services/mediaRemoteUrlService';
import { createStoredMediaAsset, updateSceneMedia } from '../../utils/mediaAssets';
import { mergeEpisodeRefs } from './assetEpisodeRefs';
import { getScenePreviewImageSource } from '../../utils/mediaSelectors';
import AssetImageDrawModal, {
  cleanupImageDrawCandidates,
  createImageDrawSessionId,
  generateImageDrawCandidates,
  getImageDrawVariation,
  isImageDrawCandidateForOwner,
  IMAGE_DRAW_CANDIDATE_COUNT,
  type AssetImageDrawCandidate,
} from './AssetImageDrawModal';

const { TextArea } = Input;
const { Text } = Typography;

interface SceneDetailPanelProps {
  scene: Scene;
  projectId: string;
  /** 项目全局比例 — 透传给 generateSceneImage，让场景预览图与项目比例一致 */
  aspectRatio?: '16:9' | '9:16';
  theme?: string;
  stylePrompt?: string;
  styleSnapshot?: ProjectStyleSnapshot;
  ttiSelection?: string;
  onUpdate: (scene: Scene) => void;
  onDelete: (sceneId: string) => void;
}

export const SceneDetailPanel: React.FC<SceneDetailPanelProps> = ({
  scene,
  projectId,
  aspectRatio,
  theme,
  stylePrompt,
  styleSnapshot,
  ttiSelection,
  onUpdate,
  onDelete,
}) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const { config: activeTTI, activeModel: activeTTIModel } = useActiveConfig('tti', ttiSelection);
  const supportsTextToImage = activeTTIModel?.capabilities.includes('image.text-to-image') ?? false;

  const [editedScene, setEditedScene] = useState<Scene>(scene);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [imageDrawOpen, setImageDrawOpen] = useState(false);
  const [imageDrawCandidates, setImageDrawCandidates] = useState<AssetImageDrawCandidate[]>([]);
  const [imageDrawApplying, setImageDrawApplying] = useState(false);
  const imageDrawCandidatesRef = useRef<AssetImageDrawCandidate[]>([]);
  const activeImageDrawSessionRef = useRef<string | null>(null);
  const runningImageDrawSessionRef = useRef<string | null>(null);
  const currentSceneIdRef = useRef(scene.id);
  currentSceneIdRef.current = scene.id;

  const setImageDrawCandidateList = useCallback((candidates: AssetImageDrawCandidate[]) => {
    imageDrawCandidatesRef.current = candidates;
    setImageDrawCandidates(candidates);
  }, []);

  // 初始化
  useEffect(() => {
    const initialPrompt = scene.prompt || '';
    setEditedScene({ ...scene, prompt: initialPrompt });
    form.setFieldsValue({
      name: scene.name,
      prompt: initialPrompt,
    });
  }, [scene, form]);

  useEffect(() => {
    const staleCandidates = imageDrawCandidatesRef.current;
    activeImageDrawSessionRef.current = null;
    runningImageDrawSessionRef.current = null;
    setImageDrawOpen(false);
    setImageDrawCandidateList([]);
    setImageDrawApplying(false);
    setGenerating(false);
    if (staleCandidates.length > 0) {
      void cleanupImageDrawCandidates(staleCandidates);
    }

    return () => {
      const unmountedCandidates = imageDrawCandidatesRef.current;
      activeImageDrawSessionRef.current = null;
      runningImageDrawSessionRef.current = null;
      imageDrawCandidatesRef.current = [];
      if (unmountedCandidates.length > 0) {
        void cleanupImageDrawCandidates(unmountedCandidates);
      }
    };
  }, [scene.id, setImageDrawCandidateList]);

  const getAssetPath = useCallback(async (subPath: string) => {
    const config = getStorageConfig() || (await initStorageConfig());
    const basePath = `${config.rootPath}/projects/${projectId}/assets/scenes/${editedScene.id}`;
    const fullPath = `${basePath}/${subPath}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (!(await fsExists(dir))) {
      await fsMkdir(dir);
    }
    return fullPath;
  }, [projectId, editedScene.id]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const scenes = await loadScenes(projectId);
      const index = scenes.findIndex(s => s.id === editedScene.id);
      if (index === -1) {
        throw new Error(t('asset.saveFailed'));
      }

      const storedScene = scenes[index];
      const updatedScene: Scene = {
        ...storedScene,
        ...editedScene,
        ...values,
        prompt: values.prompt,
        media: storedScene.media ?? editedScene.media,
        episodeRefs: mergeEpisodeRefs(storedScene.episodeRefs, editedScene.episodeRefs),
      };

      scenes[index] = updatedScene;
      await saveScenes(projectId, scenes);

      setEditedScene(updatedScene);
      onUpdate(updatedScene);
      message.success(t('asset.saveSuccess'));
    } catch (err: any) {
      message.error(err.message || t('asset.saveFailed'));
    }
  }, [editedScene, form, projectId, onUpdate, message, t]);

  const formatDrawProgressStep = useCallback((index: number, step?: string) => {
    const drawStep = t('asset.drawGenerating', {
      current: index + 1,
      total: IMAGE_DRAW_CANDIDATE_COUNT,
    });
    return step ? `${drawStep} · ${step}` : drawStep;
  }, [t]);

  const runSceneImageDraw = useCallback(async (
    previousCandidates: AssetImageDrawCandidate[] = imageDrawCandidatesRef.current,
  ) => {
    const ownerType = 'scene' as const;
    const ownerId = editedScene.id;
    const previousSessionId = activeImageDrawSessionRef.current;
    const reusablePrevious = previousSessionId
      ? previousCandidates.filter((candidate) => isImageDrawCandidateForOwner(candidate, {
          projectId,
          ownerType,
          ownerId,
          sessionId: previousSessionId,
        }))
      : [];
    const reusableIds = new Set(reusablePrevious.map((candidate) => candidate.id));
    const stalePrevious = previousCandidates.filter((candidate) => !reusableIds.has(candidate.id));

    if (stalePrevious.length > 0) {
      await cleanupImageDrawCandidates(stalePrevious);
    }

    if (reusablePrevious.length > 0) {
      setImageDrawCandidateList(reusablePrevious);
      setImageDrawOpen(true);
    } else {
      activeImageDrawSessionRef.current = null;
      setImageDrawCandidateList([]);
      setImageDrawOpen(false);
    }

    const sessionId = createImageDrawSessionId({ ownerType, ownerId });
    runningImageDrawSessionRef.current = sessionId;
    setGenerating(true);
    setProgress(0);
    setProgressStep(formatDrawProgressStep(0));

    const isCurrentSession = () => (
      runningImageDrawSessionRef.current === sessionId &&
      currentSceneIdRef.current === ownerId
    );

    try {
      const currentValues = await form.getFieldsValue();
      const sceneWithPrompt = { ...editedScene, ...currentValues };

      const result = await generateImageDrawCandidates({
        count: IMAGE_DRAW_CANDIDATE_COUNT,
        sessionId,
        projectId,
        ownerType,
        ownerId,
        shouldContinue: isCurrentSession,
        getVariation: (index) => getImageDrawVariation(ownerType, index),
        getCandidatePath: (seed, index) => getAssetPath(`draw/scene-${sessionId}-${index + 1}-${seed}.png`),
        generate: (seed, index, destPath, variation) => generateSceneImage({
          projectId,
          scene: sceneWithPrompt,
          aspectRatio,
          theme,
          stylePrompt,
          styleSnapshot,
          ttiSelection,
          seed,
          ...(variation?.prompt ? { variationPrompt: variation.prompt } : {}),
          destPath,
          bindOwner: false,
          normalizeRemoteUrl: false,
          onProgress: (p, step) => {
            if (!isCurrentSession()) return;
            setProgress(((index + p / 100) / IMAGE_DRAW_CANDIDATE_COUNT) * 100);
            setProgressStep(formatDrawProgressStep(index, step));
          },
        }),
        onCandidateProgress: (p, index, step) => {
          if (!isCurrentSession()) return;
          setProgress(p);
          setProgressStep(formatDrawProgressStep(index, step));
        },
      });

      if (!isCurrentSession()) {
        await cleanupImageDrawCandidates(result.candidates);
        return;
      }

      if (result.candidates.length > 0) {
        if (reusablePrevious.length > 0) {
          await cleanupImageDrawCandidates(reusablePrevious);
        }
        activeImageDrawSessionRef.current = sessionId;
        setImageDrawCandidateList(result.candidates);
        setImageDrawOpen(true);
        if (result.failed > 0) {
          message.warning(t('asset.imageDrawPartialFailed', {
            failed: result.failed,
            total: IMAGE_DRAW_CANDIDATE_COUNT,
          }));
        }
      } else {
        if (previousSessionId && reusablePrevious.length > 0) {
          activeImageDrawSessionRef.current = previousSessionId;
          setImageDrawCandidateList(reusablePrevious);
          setImageDrawOpen(true);
          message.error(result.errors[0] ? `${t('asset.imageDrawFailedKeepingPrevious')}: ${result.errors[0]}` : t('asset.imageDrawFailedKeepingPrevious'));
        } else {
          activeImageDrawSessionRef.current = null;
          setImageDrawCandidateList([]);
          setImageDrawOpen(false);
          message.error(result.errors[0] || t('asset.generateFailed'));
        }
      }
    } catch (err: any) {
      if (!isCurrentSession()) return;
      if (previousSessionId && reusablePrevious.length > 0) {
        activeImageDrawSessionRef.current = previousSessionId;
        setImageDrawCandidateList(reusablePrevious);
        setImageDrawOpen(true);
        message.error(err.message ? `${t('asset.imageDrawFailedKeepingPrevious')}: ${err.message}` : t('asset.imageDrawFailedKeepingPrevious'));
      } else {
        activeImageDrawSessionRef.current = null;
        setImageDrawCandidateList([]);
        setImageDrawOpen(false);
        message.error(err.message || t('asset.generateFailed'));
      }
    } finally {
      if (runningImageDrawSessionRef.current === sessionId) {
        runningImageDrawSessionRef.current = null;
        setGenerating(false);
      }
    }
  }, [editedScene, form, formatDrawProgressStep, getAssetPath, message, projectId, setImageDrawCandidateList, stylePrompt, styleSnapshot, theme, t, ttiSelection]);

  const handleGenerateImage = useCallback(async () => {
    await runSceneImageDraw(imageDrawCandidatesRef.current);
  }, [runSceneImageDraw]);

  const handleRedrawImageDraw = useCallback(async () => {
    await runSceneImageDraw(imageDrawCandidatesRef.current);
  }, [runSceneImageDraw]);

  const handleCancelImageDraw = useCallback(async () => {
    const staleCandidates = imageDrawCandidatesRef.current;
    activeImageDrawSessionRef.current = null;
    runningImageDrawSessionRef.current = null;
    setImageDrawOpen(false);
    setImageDrawCandidateList([]);
    setImageDrawApplying(false);
    await cleanupImageDrawCandidates(staleCandidates);
    message.info(t('asset.imageCandidatesDiscarded'));
  }, [message, setImageDrawCandidateList, t]);

  const handleUseSelectedImageDraw = useCallback(async (candidate: AssetImageDrawCandidate) => {
    if (imageDrawApplying) return;

    const activeSessionId = activeImageDrawSessionRef.current;
    const currentCandidates = imageDrawCandidatesRef.current;
    const selectedCandidate = currentCandidates.find((item) => item.id === candidate.id);
    const owner = {
      projectId,
      ownerType: 'scene' as const,
      ownerId: currentSceneIdRef.current,
      sessionId: activeSessionId,
    };

    if (
      !activeSessionId ||
      !selectedCandidate ||
      !isImageDrawCandidateForOwner(selectedCandidate, owner)
    ) {
      activeImageDrawSessionRef.current = null;
      setImageDrawOpen(false);
      setImageDrawCandidateList([]);
      await cleanupImageDrawCandidates(currentCandidates);
      message.warning(t('asset.imageDrawCandidateExpired'));
      return;
    }

    if (!selectedCandidate.localPath && !selectedCandidate.remoteUrl) {
      message.warning(t('asset.pleaseSelectImageCandidate'));
      return;
    }

    setImageDrawApplying(true);
    try {
      const currentValues = await form.getFieldsValue();
      let selectedImage = createStoredMediaAsset('image', {
        localPath: selectedCandidate.localPath,
        remoteUrl: selectedCandidate.remoteUrl,
        metadata: selectedCandidate.seed !== undefined ? { seed: selectedCandidate.seed } : undefined,
      });
      try {
        selectedImage = await ensureRemoteUrlForImageAsset({
          projectId,
          asset: selectedImage,
          policy: 'best-effort',
        });
      } catch (error) {
        logger.warn('抽卡选中场景图 remoteUrl 归一化失败', { error: error instanceof Error ? error.message : String(error) });
      }

      if (
        activeImageDrawSessionRef.current !== activeSessionId ||
        currentSceneIdRef.current !== selectedCandidate.ownerId ||
        !isImageDrawCandidateForOwner(selectedCandidate, {
          projectId,
          ownerType: 'scene',
          ownerId: currentSceneIdRef.current,
          sessionId: activeSessionId,
        })
      ) {
        activeImageDrawSessionRef.current = null;
        setImageDrawOpen(false);
        setImageDrawCandidateList([]);
        await cleanupImageDrawCandidates(currentCandidates);
        message.warning(t('asset.imageDrawCandidateExpired'));
        return;
      }

      const updated = updateSceneMedia(
        {
          ...editedScene,
          ...currentValues,
        },
        { previewImage: selectedImage }
      );
      setEditedScene(updated);
      onUpdate(updated);
      const scenes = await loadScenes(projectId);
      const index = scenes.findIndex(s => s.id === updated.id);
      if (index !== -1) {
        scenes[index] = updated;
        await saveScenes(projectId, scenes);
      }

      await cleanupImageDrawCandidates(currentCandidates, selectedCandidate.id);
      activeImageDrawSessionRef.current = null;
      setImageDrawCandidateList([]);
      setImageDrawOpen(false);
      message.success(t('asset.sceneImageGenerated'));
    } catch (err: any) {
      message.error(err.message || t('asset.generateFailed'));
    } finally {
      setImageDrawApplying(false);
    }
  }, [editedScene, form, imageDrawApplying, message, onUpdate, projectId, setImageDrawCandidateList, t]);

  const handleUploadImage = useCallback(async () => {
    try {
      const result = await openFileDialog({
        filters: [{ name: t('storyboard.image'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        title: t('asset.selectSceneImage'),
      });
      if (result.canceled || !result.filePaths[0]) return;

      const destPath = await getAssetPath('scene.png');
      await fsCopy(result.filePaths[0], destPath);

      let updated: Scene = updateSceneMedia(editedScene, {
        previewImage: createStoredMediaAsset('image', { localPath: destPath }),
      });

      // 检测图床配置，自动上传
      const hostingEnabled = await isImageHostingEnabled();
      if (hostingEnabled) {
        message.loading({ content: t('asset.uploadToHosting'), key: 'imageHosting' });
        const uploadResult = await uploadLocalFileToImageHosting(destPath);
        if (uploadResult.success && uploadResult.url) {
          updated = updateSceneMedia(updated, {
            previewImage: createStoredMediaAsset('image', {
              localPath: destPath,
              remoteUrl: uploadResult.url,
              createdAt: updated.media?.previewImage?.createdAt,
            }),
          });
          message.success({ content: t('asset.uploadHostingSuccess'), key: 'imageHosting' });
        } else {
          logger.warn('图床上传失败:', uploadResult.error);
          message.warning({ content: `${t('asset.uploadHostingFailed')}: ${uploadResult.error}`, key: 'imageHosting' });
        }
      }

      setEditedScene(updated);
      onUpdate(updated);

      const scenes = await loadScenes(projectId);
      const index = scenes.findIndex(s => s.id === editedScene.id);
      if (index !== -1) {
        scenes[index] = updated;
        await saveScenes(projectId, scenes);
      }

      message.success(t('asset.uploadSuccess'));
    } catch (err: any) {
      message.error(`${t('asset.uploadFailed')}: ${err.message}`);
    }
  }, [editedScene, getAssetPath, projectId, onUpdate, message, t]);

  const handleRemoveSceneImage = useCallback(async () => {
    try {
      const previewImage = editedScene.media?.previewImage;
      const localPath = previewImage?.localPath;
      const shouldDeleteLocalFile = Boolean(localPath && !isRemoteMediaUri(localPath));

      const scenes = await loadScenes(projectId);
      const index = scenes.findIndex(s => s.id === editedScene.id);
      if (index === -1) {
        throw new Error(t('asset.saveFailed'));
      }

      if (shouldDeleteLocalFile && localPath) {
        await fsRemove(localPath);
      }

      const updated = updateSceneMedia(editedScene, { previewImage: undefined });
      scenes[index] = updated;
      await saveScenes(projectId, scenes);

      setEditedScene(updated);
      onUpdate(updated);
      setPreviewImage(null);

      if (shouldDeleteLocalFile) {
        message.success(t('asset.imageDeleted'));
      } else {
        message.warning(t('asset.remoteImageReferenceRemoved'));
      }
    } catch (err: any) {
      message.error(err.message || t('asset.saveFailed'));
    }
  }, [editedScene, projectId, onUpdate, message, t]);

  const handleDelete = useCallback(async () => {
    onDelete(editedScene.id);
  }, [editedScene.id, onDelete]);

  const toLocalUrl = (path?: string) => path ? electronService.fs.toLocalUrl(path) : '';

  return (
    <div className="assetDetailPanel">
      {/* 左侧 Sidebar */}
      <div className="creatorSidebar">
        <div className="creatorSidebarHeader">
          <Space>
            <EnvironmentOutlined />
            <Text strong className="creatorSidebarTitle">{editedScene.name}</Text>
          </Space>
          <Space>
            <Tooltip title={t('common.save')}>
              <Button type="text" size="small" icon={<SaveOutlined />} onClick={handleSave} />
            </Tooltip>
            <Popconfirm
              title={t('asset.confirmRemoveSceneFromEpisode')}
              description={t('asset.removeFromEpisodeDescription')}
              onConfirm={handleDelete}
              okButtonProps={{ danger: true }}
            >
              <Tooltip title={t('asset.removeFromEpisode')}>
                <Button type="text" danger size="small" icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        </div>

        <div className="creatorSidebarContent">
          <Form form={form} layout="vertical" size="small">
            <Form.Item name="name" label={t('asset.name')} rules={[{ required: true, message: t('asset.pleaseEnterName') }]}>
              <Input />
            </Form.Item>

            <Form.Item name="prompt" label={t('asset.visualPrompt')}>
              <TextArea
                autoSize={{ minRows: 12, maxRows: 20 }}
                placeholder={t('asset.scenePromptPlaceholder')}
              />
            </Form.Item>
          </Form>

          {/* 生成操作区 */}
          <div className="creatorSidebarActions">
            {generating && (
              <div className="creatorProgress">
                <div className="creatorProgressHeader">
                  <Space>
                    <LoadingOutlined />
                    <Text className="creatorProgressText">{progressStep}</Text>
                  </Space>
                  <Text type="secondary" className="creatorProgressText">{Math.round(progress)}%</Text>
                </div>
                <Progress percent={Math.round(progress)} strokeColor="var(--token-status-success)" size="small" showInfo={false} />
              </div>
            )}

            <Tooltip title={
              !activeTTI ? t('asset.noGenerateService') :
              !supportsTextToImage ? '当前模型不支持文生图能力' :
              `${t('asset.useService')}: ${activeTTIModel?.channelLabel || activeTTI.name} / ${activeTTIModel?.modelLabel || activeTTI.modelName || ''}`
            }>
              <Button
                type={!getScenePreviewImageSource(editedScene) ? 'primary' : 'default'}
                block
                icon={<ThunderboltOutlined />}
                onClick={handleGenerateImage}
                loading={generating}
                disabled={generating || !supportsTextToImage}
              >
                {getScenePreviewImageSource(editedScene) ? t('asset.redrawSceneImageCandidates') : t('asset.drawSceneImageCandidates')}
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* 右侧 Canvas */}
      <div className="creatorCanvas">
        <div className="creatorCanvasToolbar">
          <Space>
            <EnvironmentOutlined />
            <Text>{t('asset.scenePreview')}</Text>
          </Space>

          <Space>
            <Tooltip title={t('asset.uploadSceneImage')}>
              <Button type="text" icon={<UploadOutlined />} onClick={handleUploadImage} aria-label={t('asset.uploadSceneImage')} />
            </Tooltip>
            {getScenePreviewImageSource(editedScene) && (
              <Popconfirm
                title={t('asset.removeSceneImage')}
                description={t('asset.removeImageOnlyDescription')}
                onConfirm={handleRemoveSceneImage}
                okButtonProps={{ danger: true }}
              >
                <Tooltip title={t('asset.removeSceneImage')}>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t('asset.removeSceneImage')}
                  />
                </Tooltip>
              </Popconfirm>
            )}
            <Tooltip title={t('asset.enlargePreview')}>
              <Button
                type="text"
                icon={<ExpandOutlined />}
                onClick={() => {
                  const source = getScenePreviewImageSource(editedScene);
                  if (source) setPreviewImage(toLocalUrl(source));
                }}
                disabled={!getScenePreviewImageSource(editedScene)}
                aria-label={t('asset.enlargePreview')}
              />
            </Tooltip>
          </Space>
        </div>

        <div className="creatorCanvasBody">
          <div className="creatorMediaViewer">
            {getScenePreviewImageSource(editedScene) ? (
              <img
                  src={toLocalUrl(getScenePreviewImageSource(editedScene))}
                  alt={t('asset.sceneImage')}
                  className="creatorMediaPreview"
                  onDoubleClick={() => setPreviewImage(toLocalUrl(getScenePreviewImageSource(editedScene)))}
                />
            ) : (
              <div className="creatorMediaPlaceholder">
                <EnvironmentOutlined />
                <div>{t('asset.noSceneImage')}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AssetImageDrawModal
        open={imageDrawOpen}
        candidates={imageDrawCandidates}
        generating={generating}
        progress={progress}
        progressStep={progressStep}
        applying={imageDrawApplying}
        onCancel={handleCancelImageDraw}
        onRedraw={handleRedrawImageDraw}
        onUseSelected={handleUseSelectedImageDraw}
      />

      {/* 大图预览 Modal */}
      <Modal
        open={!!previewImage}
        onCancel={() => setPreviewImage(null)}
        footer={null}
        centered
        width="auto"
        className="transparent-modal"
        closeIcon={null}
      >
        {previewImage && (
          <img
            src={previewImage}
            alt="Preview"
            className="transparentPreviewImage"
            onClick={() => setPreviewImage(null)}
          />
        )}
      </Modal>
    </div>
  );
};

export default SceneDetailPanel;
