/**
 * 资产生成向导
 * 分步引导生成项目所有资产：角色 → 场景 → 道具 → 预览视频
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Steps,
  Button,
  Card,
  Flex,
  Progress,
  Typography,
  Space,
  Checkbox,
  Tag,
  Image,
  Spin,
  App,
  Result,
} from 'antd';
import {
  UserOutlined,
  EnvironmentOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import type { Project } from '../../types';
import { loadCharacters, loadScenes, loadProps } from '../../store/projectStore';
import { electronService } from '../../services/electronService';
import { serializeMediaSelection } from '../../providers/channel/resolver';
import {
  generateCostumePhoto,
  generateCharacterPreviewVideo,
} from '../../workflow/characterAssetWorkflow';
import { generateSceneImage, generatePropImage, generatePropPreviewVideo } from '../../workflow/scenePropAssetWorkflow';
import { runWithTask } from '../../services/taskRunner';
import { runBatchWithConcurrency } from '../../utils/batchRunner';
import {
  getCharacterCostumePhotoSource,
  getCharacterPreviewVideoSource,
  getPropPreviewImageSource,
  getPropPreviewVideoSource,
  getScenePreviewImageSource,
} from '../../utils/mediaSelectors';
import styles from './AssetGenerationWizard.module.scss';

const { Text } = Typography;

interface AssetGenerationWizardProps {
  project: Project;
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

type WizardStep = 'characters' | 'scenes' | 'props' | 'videos' | 'complete';

interface ItemStatus {
  id: string;
  name: string;
  selected: boolean;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  progress: number;
  error?: string;
  imagePath?: string;
  /**
   * 缓存绕过键。同名文件被覆盖（再次抽卡/重试）后 imagePath 不变但内容变了，
   * 浏览器按 URL 缓存仍然显示旧图。每次刷新 imagePath 时同步 bump 这个键，
   * 渲染时拼到 `?t=` 上让 koma-local 协议返回新内容。
   */
  imageCacheKey?: number;
  sourceType?: 'character' | 'prop'; // 视频步骤区分角色/道具
}

/** 把 cacheKey 拼到 koma-local URL 末尾。protocol.handle 仅消费 pathname，query 字符串安全忽略。*/
function appendImageCacheBust(url: string, key?: number): string {
  if (!url || !key) return url;
  return `${url}${url.includes('?') ? '&' : '?'}t=${key}`;
}

const stepConfig = [
  { key: 'characters', title: '角色定妆照', icon: <UserOutlined /> },
  { key: 'scenes', title: '场景预览图', icon: <EnvironmentOutlined /> },
  { key: 'props', title: '道具参考图', icon: <AppstoreOutlined /> },
  // 预览视频步骤暂时隐藏（功能保留，未来恢复时取消注释）
  // { key: 'videos', title: '预览视频', icon: <VideoCameraOutlined /> },
];

export const AssetGenerationWizard: React.FC<AssetGenerationWizardProps> = ({
  project,
  open,
  onClose,
  onComplete,
}) => {
  const { message } = App.useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [currentItem, setCurrentItem] = useState('');

  // 各步骤数据
  const [characters, setCharacters] = useState<ItemStatus[]>([]);
  const [scenes, setScenes] = useState<ItemStatus[]>([]);
  const [props, setProps] = useState<ItemStatus[]>([]);
  const [videoItems, setVideoItems] = useState<ItemStatus[]>([]);

  // 加载项目资产数据
  useEffect(() => {
    if (!open || !project) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [chars, scns, prps] = await Promise.all([
          loadCharacters(project.id),
          loadScenes(project.id),
          loadProps(project.id),
        ]);

        // 每次打开向导时打一个共享时间戳作为 cacheKey 起点，让上次抽卡之后磁盘被覆盖的同路径图能重新拉取
        const reopenCacheKey = Date.now();

        setCharacters(chars.map(c => ({
          id: c.id,
          name: c.name,
          selected: !getCharacterCostumePhotoSource(c),
          status: getCharacterCostumePhotoSource(c) ? 'completed' : 'pending',
          progress: getCharacterCostumePhotoSource(c) ? 100 : 0,
          imagePath: getCharacterCostumePhotoSource(c),
          imageCacheKey: reopenCacheKey,
        })));

        setScenes(scns.map(s => ({
          id: s.id,
          name: s.name,
          selected: !getScenePreviewImageSource(s),
          status: getScenePreviewImageSource(s) ? 'completed' : 'pending',
          progress: getScenePreviewImageSource(s) ? 100 : 0,
          imagePath: getScenePreviewImageSource(s),
          imageCacheKey: reopenCacheKey,
        })));

        setProps(prps.map(p => ({
          id: p.id,
          name: p.name,
          selected: !getPropPreviewImageSource(p),
          status: getPropPreviewImageSource(p) ? 'completed' : 'pending',
          progress: getPropPreviewImageSource(p) ? 100 : 0,
          imagePath: getPropPreviewImageSource(p),
          imageCacheKey: reopenCacheKey,
        })));

        // 视频步骤：有定妆照的角色 + 有参考图的道具
        const charVideos: ItemStatus[] = chars
          .filter(c => getCharacterCostumePhotoSource(c))
          .map(c => ({
          id: c.id,
          name: `[角色] ${c.name}`,
          selected: !getCharacterPreviewVideoSource(c),
          status: getCharacterPreviewVideoSource(c) ? 'completed' : 'pending',
          progress: getCharacterPreviewVideoSource(c) ? 100 : 0,
          imagePath: getCharacterPreviewVideoSource(c),
          imageCacheKey: reopenCacheKey,
          sourceType: 'character' as const,
        }));
        const propVideos: ItemStatus[] = prps
          .filter(p => getPropPreviewImageSource(p))
          .map(p => ({
          id: p.id,
          name: `[道具] ${p.name}`,
          selected: !getPropPreviewVideoSource(p),
          status: getPropPreviewVideoSource(p) ? 'completed' : 'pending',
          progress: getPropPreviewVideoSource(p) ? 100 : 0,
          imagePath: getPropPreviewVideoSource(p),
          imageCacheKey: reopenCacheKey,
          sourceType: 'prop' as const,
        }));
        setVideoItems([...charVideos, ...propVideos]);
      } catch (err: any) {
        message.error(`加载数据失败: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [open, project, message]);

  // 切换选中状态
  const toggleSelect = useCallback((type: WizardStep, id: string) => {
    const updateList = (list: ItemStatus[], setter: React.Dispatch<React.SetStateAction<ItemStatus[]>>) => {
      setter(list.map(item =>
        item.id === id ? { ...item, selected: !item.selected } : item
      ));
    };

    switch (type) {
      case 'characters':
        updateList(characters, setCharacters);
        break;
      case 'scenes':
        updateList(scenes, setScenes);
        break;
      case 'props':
        updateList(props, setProps);
        break;
      case 'videos':
        updateList(videoItems, setVideoItems);
        break;
    }
  }, [characters, scenes, props, videoItems]);

  // 全选/取消全选
  const toggleSelectAll = useCallback((type: WizardStep, selected: boolean) => {
    const updateList = (list: ItemStatus[], setter: React.Dispatch<React.SetStateAction<ItemStatus[]>>) => {
      setter(list.map(item => ({ ...item, selected })));
    };

    switch (type) {
      case 'characters':
        updateList(characters, setCharacters);
        break;
      case 'scenes':
        updateList(scenes, setScenes);
        break;
      case 'props':
        updateList(props, setProps);
        break;
      case 'videos':
        updateList(videoItems, setVideoItems);
        break;
    }
  }, [characters, scenes, props, videoItems]);

  // 生成单个资产
  const generateOneItem = async (
    item: ItemStatus,
    stepKey: WizardStep,
    _setter: React.Dispatch<React.SetStateAction<ItemStatus[]>>,
    onProgress: (progress: number, step: string) => void,
    /** 在批量场景下传 true：让单 item 不创建独立 task（外层批量 task 已包装） */
    disableTask = false,
  ): Promise<{ success: boolean; path?: string; error?: string }> => {
    const ttiSelection = serializeMediaSelection(project.mediaSelections?.tti);
    const itvSelection = serializeMediaSelection(project.mediaSelections?.itv);
    // 项目全局比例 — 角色 / 场景 / 道具的参考图必须落在这个比例上，
    // 否则下游分镜走 image-to-image 时输出比例会被参考图带跑。
    const aspectRatio = project.aspectRatio || '16:9';
    switch (stepKey) {
      case 'characters': {
        const chars = await loadCharacters(project.id);
        const char = chars.find(c => c.id === item.id);
        if (!char) return { success: false, error: '角色不存在' };
        return generateCostumePhoto({
          projectId: project.id,
          character: char,
          aspectRatio,
          styleSnapshot: project.styleSnapshot,
          ttiSelection,
          onProgress,
          disableTask,
        });
      }
      case 'scenes': {
        const scns = await loadScenes(project.id);
        const scene = scns.find(s => s.id === item.id);
        if (!scene) return { success: false, error: '场景不存在' };
        return generateSceneImage({
          projectId: project.id,
          scene,
          aspectRatio,
          styleSnapshot: project.styleSnapshot,
          ttiSelection,
          onProgress,
          disableTask,
        });
      }
      case 'props': {
        const prps = await loadProps(project.id);
        const prop = prps.find(p => p.id === item.id);
        if (!prop) return { success: false, error: '道具不存在' };
        return generatePropImage({
          projectId: project.id,
          prop,
          aspectRatio,
          styleSnapshot: project.styleSnapshot,
          ttiSelection,
          onProgress,
          disableTask,
        });
      }
      case 'videos': {
        if (item.sourceType === 'prop') {
          const prps = await loadProps(project.id);
          const prop = prps.find(p => p.id === item.id);
          if (!prop) return { success: false, error: '道具不存在' };
          return generatePropPreviewVideo({
            projectId: project.id,
            prop,
            styleSnapshot: project.styleSnapshot,
            itvSelection,
            onProgress,
            disableTask,
          });
        } else {
          const chars = await loadCharacters(project.id);
          const char = chars.find(c => c.id === item.id);
          if (!char) return { success: false, error: '角色不存在' };
          return generateCharacterPreviewVideo({
            projectId: project.id,
            character: char,
            styleSnapshot: project.styleSnapshot,
            itvSelection,
            onProgress,
            disableTask,
          });
        }
      }
      default:
        return { success: false, error: '未知步骤' };
    }
  };

  // 获取当前步骤的 setter
  const getStepSetter = (stepKey: WizardStep): React.Dispatch<React.SetStateAction<ItemStatus[]>> => {
    switch (stepKey) {
      case 'characters': return setCharacters;
      case 'scenes': return setScenes;
      case 'props': return setProps;
      case 'videos': return setVideoItems;
      default: return setCharacters;
    }
  };

  // 开始生成当前步骤
  const startGeneration = async () => {
    setGenerating(true);
    setOverallProgress(0);

    const stepKey = stepConfig[currentStep].key as WizardStep;
    const setter = getStepSetter(stepKey);
    let items: ItemStatus[] = [];

    switch (stepKey) {
      case 'characters':
        items = characters.filter(c => c.selected);
        break;
      case 'scenes':
        items = scenes.filter(s => s.selected);
        break;
      case 'props':
        items = props.filter(p => p.selected);
        break;
      case 'videos':
        items = videoItems.filter(c => c.selected);
        break;
    }

    if (items.length === 0) {
      setGenerating(false);
      return;
    }

    // 批量任务名（用于任务面板）
    const stepLabel = stepConfig[currentStep].title || stepKey;
    const targetType: 'character' | 'scene' | 'prop' = stepKey === 'scenes'
      ? 'scene'
      : stepKey === 'props'
        ? 'prop'
        : 'character';

    // 用 runWithTask 包"批量"操作，子 generateOneItem 传 disableTask=true 避免任务面板被 N 个独立任务刷屏
    // 并发 + 自动重试：每 item 进度独立，整体进度按"已完成 + 进行中加权"汇总
    const itemProgressMap = new Map<string, number>();
    const updateOverallProgress = (taskProgress: (p: number, msg: string) => void, currentName: string, stage: string) => {
      let acc = 0;
      items.forEach(it => { acc += itemProgressMap.get(it.id) ?? 0; });
      const overall = (acc / items.length);
      setOverallProgress(overall);
      taskProgress(overall, `${currentName}: ${stage}`);
    };

    try {
      await runWithTask({
        projectId: project.id,
        category: 'asset',
        subType: 'asset-generation',
        targetType,
        targetId: items[0].id,
        targetName: `批量${stepLabel}（${items.length} 个）`,
        type: 'asset-generation',
        metadata: { batchCount: items.length, stepKey },
        execute: async (taskCtx) => {
          await runBatchWithConcurrency<ItemStatus, { success: boolean; path?: string; error?: string }>({
            items,
            concurrency: 3,
            maxRetries: 2,
            retryBaseDelayMs: 800,
            onAttemptStart: (item, _idx, attempt) => {
              setCurrentItem(item.name);
              setter(prev => prev.map(it =>
                it.id === item.id
                  ? { ...it, status: 'generating', progress: 0, error: attempt > 1 ? `重试中（第 ${attempt} 次）` : undefined }
                  : it
              ));
              itemProgressMap.set(item.id, 0);
              updateOverallProgress(taskCtx.progress, item.name, attempt > 1 ? `重试 ${attempt}` : '开始');
            },
            onAttemptEnd: (item, _idx, _attempt, ok, error) => {
              if (!ok) {
                // 重试中临时进度回 0；最终失败由外层结果遍历落地
                itemProgressMap.set(item.id, 0);
                setter(prev => prev.map(it =>
                  it.id === item.id ? { ...it, progress: 0, error: error instanceof Error ? error.message : String(error || '') } : it
                ));
                updateOverallProgress(taskCtx.progress, item.name, '重试中');
              }
            },
            worker: async (item) => {
              const onProgress = (progress: number, step: string) => {
                itemProgressMap.set(item.id, progress);
                setter(prev => prev.map(it =>
                  it.id === item.id ? { ...it, progress } : it
                ));
                updateOverallProgress(taskCtx.progress, item.name, step);
              };
              // disableTask=true：批量场景不为每个 item 单独建 task
              const r = await generateOneItem(item, stepKey, setter, onProgress, true);
              if (!r.success) {
                // 让 batchRunner 走 retry：抛出真实错误，shouldRetry 默认对瞬时错误重试
                throw new Error(r.error || '生成失败');
              }
              return r;
            },
          }).then(results => {
            // 结果落地：覆盖每个 item 的最终状态（成功 / 用尽重试后失败）
            results.forEach(({ item, result, error, attempts }) => {
              const ok = Boolean(result?.success);
              itemProgressMap.set(item.id, ok ? 100 : 0);
              setter(prev => prev.map(it =>
                it.id === item.id
                  ? {
                      ...it,
                      status: ok ? 'completed' : 'failed',
                      progress: ok ? 100 : 0,
                      error: ok
                        ? undefined
                        : (result?.error
                            || (error instanceof Error ? error.message : String(error || ''))
                            || `失败（已重试 ${attempts} 次）`),
                      imagePath: result?.path || it.imagePath,
                      // 同名文件被覆盖也要拉新内容，bump 缓存键
                      imageCacheKey: ok ? Date.now() : it.imageCacheKey,
                    }
                  : it
              ));
            });
            updateOverallProgress(taskCtx.progress, '完成', '所有任务结束');
          });
        },
      });
    } catch (err: any) {
      // 单 item 失败已记录在 setter 状态里；这里捕获是为了防止整个批量崩
      message.error(`批量生成异常: ${err.message || err}`);
    }

    setGenerating(false);
    setCurrentItem('');
    setOverallProgress(100);
    message.success(`${stepConfig[currentStep].title}生成完成`);
  };

  // 重试单个失败项
  const retryItem = async (item: ItemStatus) => {
    const stepKey = stepConfig[currentStep].key as WizardStep;
    const setter = getStepSetter(stepKey);

    setGenerating(true);
    setCurrentItem(item.name);
    setOverallProgress(0);

    setter(prev => prev.map(it =>
      it.id === item.id ? { ...it, status: 'generating', progress: 0, error: undefined } : it
    ));

    let result: { success: boolean; path?: string; error?: string };
    try {
      const onProgress = (progress: number, _step: string) => {
        setter(prev => prev.map(it =>
          it.id === item.id ? { ...it, progress } : it
        ));
        setOverallProgress(progress);
      };

      result = await generateOneItem(item, stepKey, setter, onProgress);
    } catch (err: any) {
      result = { success: false, error: err.message };
    }

    setter(prev => prev.map(it =>
      it.id === item.id
        ? {
            ...it,
            status: result.success ? 'completed' : 'failed',
            progress: result.success ? 100 : 0,
            error: result.error,
            imagePath: result.path || it.imagePath,
            imageCacheKey: result.success ? Date.now() : it.imageCacheKey,
          }
        : it
    ));

    setGenerating(false);
    setCurrentItem('');
    setOverallProgress(100);
    if (result.success) {
      message.success(`${item.name} 生成完成`);
    }
  };

  // 下一步
  const handleNext = async () => {
    if (currentStep < stepConfig.length - 1) {
      const nextStep = currentStep + 1;

      // 跳转到视频步骤时，重新加载数据（定妆照/参考图可能刚生成）
      if (stepConfig[nextStep].key === 'videos') {
        const [chars, prps] = await Promise.all([
          loadCharacters(project.id),
          loadProps(project.id),
        ]);
        const charVideos: ItemStatus[] = chars
          .filter(c => getCharacterCostumePhotoSource(c))
          .map(c => ({
          id: c.id,
          name: `[角色] ${c.name}`,
          selected: !getCharacterPreviewVideoSource(c),
          status: getCharacterPreviewVideoSource(c) ? 'completed' : 'pending',
          progress: getCharacterPreviewVideoSource(c) ? 100 : 0,
          imagePath: getCharacterPreviewVideoSource(c),
          sourceType: 'character' as const,
        }));
        const propVideos: ItemStatus[] = prps
          .filter(p => getPropPreviewImageSource(p))
          .map(p => ({
          id: p.id,
          name: `[道具] ${p.name}`,
          selected: !getPropPreviewVideoSource(p),
          status: getPropPreviewVideoSource(p) ? 'completed' : 'pending',
          progress: getPropPreviewVideoSource(p) ? 100 : 0,
          imagePath: getPropPreviewVideoSource(p),
          sourceType: 'prop' as const,
        }));
        setVideoItems([...charVideos, ...propVideos]);
      }

      setCurrentStep(nextStep);
      setOverallProgress(0);
    } else {
      // 完成
      onComplete?.();
      onClose();
    }
  };

  // 获取当前列表
  const getCurrentList = (): ItemStatus[] => {
    const stepKey = stepConfig[currentStep]?.key as WizardStep;
    switch (stepKey) {
      case 'characters': return characters;
      case 'scenes': return scenes;
      case 'props': return props;
      case 'videos': return videoItems;
      default: return [];
    }
  };

  const currentList = getCurrentList();
  const selectedCount = currentList.filter(i => i.selected).length;
  const completedCount = currentList.filter(i => i.status === 'completed').length;

  const toLocalUrl = (path?: string) => path ? electronService.fs.toLocalUrl(path) : '';

  // 渲染列表项
  const renderListItem = (item: ItemStatus, type: WizardStep) => {
    const statusIcon = item.status === 'completed' ? <CheckCircleOutlined className={styles.statusSuccess} /> :
      item.status === 'failed' ? <CloseCircleOutlined className={styles.statusError} /> :
      item.status === 'generating' ? <LoadingOutlined className={styles.statusInfo} /> :
      null;

    return (
      <div key={item.id} className={styles.listItem}>
        <Checkbox
          checked={item.selected}
          onChange={() => toggleSelect(type, item.id)}
          disabled={generating || item.status === 'generating'}
          className={styles.itemCheckbox}
        />
        <div className={styles.itemContent}>
          <Space>
            {item.name}
            {statusIcon}
            {item.status === 'generating' && (
              <Text type="secondary">{item.progress}%</Text>
            )}
          </Space>
          {item.error && <div><Text type="danger">{item.error}</Text></div>}
        </div>
        {item.imagePath && (
          <div className={styles.thumbnailFrame}>
            {type === 'videos' ? (
              <video
                src={appendImageCacheBust(toLocalUrl(item.imagePath), item.imageCacheKey)}
                className={styles.thumbnail}
              />
            ) : (
              <Image
                src={appendImageCacheBust(toLocalUrl(item.imagePath), item.imageCacheKey)}
                className={styles.thumbnail}
                preview={{ mask: null }}
              />
            )}
          </div>
        )}
        {item.status === 'failed' && (
          <Button
            type="link"
            icon={<ReloadOutlined />}
            onClick={() => retryItem(item)}
            disabled={generating}
            className={styles.retryButton}
          >
            重试
          </Button>
        )}
      </div>
    );
  };

  return (
    <Modal
      title="资产生成向导"
      open={open}
      onCancel={() => !generating && onClose()}
      width={720}
      footer={null}
      mask={{ closable: !generating }}
      closable={!generating}
    >
      {loading ? (
        <div className={styles.loadingState}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          <Steps
            current={currentStep}
            items={stepConfig.map(s => ({ title: s.title, icon: s.icon }))}
            className={styles.steps}
          />

          {generating && (
            <Card size="small" className={styles.progressCard}>
              <Space orientation="vertical" className={styles.fullWidth}>
                <Text>正在生成: {currentItem}</Text>
                <Progress percent={Math.round(overallProgress)} status="active" />
              </Space>
            </Card>
          )}

          <Card
            title={
              <Space>
                <span>{stepConfig[currentStep].title}</span>
                <Tag>{completedCount}/{currentList.length} 已完成</Tag>
              </Space>
            }
            extra={
              <Space>
                <Button
                  size="small"
                  onClick={() => toggleSelectAll(stepConfig[currentStep].key as WizardStep, true)}
                  disabled={generating}
                >
                  全选
                </Button>
                <Button
                  size="small"
                  onClick={() => toggleSelectAll(stepConfig[currentStep].key as WizardStep, false)}
                  disabled={generating}
                >
                  取消全选
                </Button>
              </Space>
            }
            classNames={{ body: styles.assetListBody }}
          >
            {currentList.length === 0 ? (
              <Result
                status="info"
                title="暂无数据"
                subTitle={`请先在剧本分析中提取${stepConfig[currentStep].title.replace(/预览图|参考图|定妆照|视频/g, '')}`}
              />
            ) : (
              <Flex vertical>
                {currentList.map((item) => renderListItem(item, stepConfig[currentStep].key as WizardStep))}
              </Flex>
            )}
          </Card>

          <div className={styles.footerActions}>
            <Space>
              <Button onClick={onClose} disabled={generating}>
                取消
              </Button>
              {currentStep > 0 && (
                <Button onClick={() => setCurrentStep(currentStep - 1)} disabled={generating}>
                  上一步
                </Button>
              )}
              <Button
                type="primary"
                onClick={startGeneration}
                disabled={generating || selectedCount === 0}
                loading={generating}
                icon={<PlayCircleOutlined />}
              >
                开始生成 ({selectedCount})
              </Button>
              <Button onClick={handleNext} disabled={generating}>
                {currentStep === stepConfig.length - 1 ? '完成' : '下一步'}
              </Button>
            </Space>
          </div>
        </>
      )}
    </Modal>
  );
};

export default AssetGenerationWizard;
