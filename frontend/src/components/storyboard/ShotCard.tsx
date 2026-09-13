/**
 * 分镜卡片 - Compact Grid 布局
 * 操作按钮在左侧列直接显示，参考图使用引用样式
 */
import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Tag,
  Checkbox,
  Tooltip,
  Button,
  Popconfirm,
  Modal,
  Progress,
  Segmented,
  Dropdown,
  App,
} from 'antd';
import {
  DeleteOutlined,
  InsertRowAboveOutlined,
  InsertRowBelowOutlined,
  MergeCellsOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlayCircleFilled,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CloseOutlined,
  PlusOutlined,
  AudioOutlined,
  DownOutlined,
} from '@ant-design/icons';
import type { Shot, ShotImageMode, ShotScriptLine, Character, Scene, Prop, StoredMediaAsset } from '../../types';
import { ShotScriptLines } from './ShotScriptLines';
import {
  getMediaAssetDisplaySource,
  getMediaAssetEditingSource,
  isRemoteMediaUri,
} from '../../types';
import { ScriptEditor } from '../../editor';
import type { MentionItem } from '../../editor';
import { useTheme } from '../../theme/runtime';
import { ImageCardGrid } from '../asset/ImageCardGrid';
import { buildImageAddMenu } from '../asset/imageAddMenu';
import { VideoCardGrid } from '../asset/VideoCardGrid';
import { StagePlayer } from '../video/StagePlayer';
import { electronService, fsRemove } from '../../services/electronService';
import { ffmpegManager } from '../../services/ffmpegManager';
import { persistMediaAsset } from '../../services/mediaPersistenceService';
import { ensureRemoteUrlForImageAsset } from '../../services/mediaRemoteUrlService';
import { getProjectPath } from '../../store/projectStore';
import { SHOT_LAYOUT, COL_ACTION_WIDTH } from '../../constants/storyboardConstants';
import { AssetSelector } from './components/AssetSelector';
import { createStoredMediaAsset } from '../../utils/mediaAssets';
import { type VideoDurationSpec } from '../../providers/itv/durationSpec';
import { ShotDurationControl } from './ShotDurationControl';
import './ShotCard.scss';
import { cssVars } from '../../theme/runtime';

function toCssUrl(value?: string): string {
  if (!value) return 'none';
  return `url("${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}")`;
}

/**
 * 判断 imageMode 是否为任一网格变体（grid / grid-9 / grid-4）。'grid' 是老数据值，
 * 等价于 grid-9。
 */
function isGridImageMode(mode?: Shot['imageMode']): boolean {
  return mode === 'grid' || mode === 'grid-9' || mode === 'grid-4';
}

function isStoryboardImageMode(mode?: Shot['imageMode']): boolean {
  return mode === 'storyboard';
}

function isMultiPanelImageMode(mode?: Shot['imageMode']): boolean {
  return isGridImageMode(mode) || isStoryboardImageMode(mode);
}

// Phase 3: 旧 ShotScriptInput textarea 已被 ShotScriptLines 块列表组件取代

export interface ShotCardProps {
  projectId: string;
  shot: Shot;
  index: number;
  totalCount: number;
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
  mentionItems: MentionItem[];
  previousStoryboardMention?: MentionItem;
  isSelected: boolean;
  isActive?: boolean;
  // 状态拆分：图片/视频提示词生成分离
  isGeneratingImagePrompt: boolean;
  isGeneratingVideoPrompt: boolean;
  isGeneratingImage: boolean;
  isGeneratingVideo: boolean;
  onSelectChange: (shotId: string, selected: boolean) => void;
  onActivate?: (shotId: string | null) => void;
  /** 单分镜内字幕行变更（编辑 / 添加 / 删除 / 同分镜内排序 / 任意位置插入） */
  onScriptLinesChange: (shotId: string, lines: ShotScriptLine[]) => void;
  onImagePromptChange: (shotId: string, imagePrompt: string) => void;
  onVideoPromptChange: (shotId: string, videoPrompt: string) => void;
  onDurationChange?: (shotId: string, duration: number) => void;
  onImageModeChange: (shotId: string, mode: Exclude<ShotImageMode, 'grid'>) => void;
  onStoryboardInheritPreviousChange?: (shotId: string, enabled: boolean) => void;
  onVideoModeChange?: (shotId: string, mode: 'multi-ref' | 'first-frame') => void;
  onCharactersChange: (shotId: string, characterIds: string[]) => void;
  onScenesChange?: (shotId: string, sceneIds: string[]) => void;
  onPropsChange?: (shotId: string, propIds: string[]) => void;
  onReferenceImagesChange?: (shotId: string, assets: StoredMediaAsset[], selectedIndex: number) => void;
  onImagesChange: (shotId: string, assets: StoredMediaAsset[], selectedIndex: number) => void;
  onVideosChange: (shotId: string, assets: StoredMediaAsset[], selectedIndex: number) => void;
  // 回调拆分：生成 vs 优化，图片 vs 视频
  onGenerateImagePrompt: (shotId: string) => void;
  onGenerateVideoPrompt: (shotId: string) => void;
  onOptimizeImagePrompt: (shotId: string, currentPrompt: string) => void;
  onOptimizeVideoPrompt: (shotId: string, currentPrompt: string) => void;
  onGenerateImage: (shotId: string) => void;
  onGenerateVideo: (shotId: string) => void;
  /** 单分镜配音 — 调用 TTS 渠道，结果落入 shot.media.audios */
  onGenerateAudio?: (shotId: string) => void;
  videoCapabilityLabel?: string;
  videoGenerateDisabledReason?: string;
  onDelete: (shotId: string) => void;
  onMergeUp: (shotId: string) => void;
  onMergeDown: (shotId: string) => void;
  onMoveUp: (shotId: string) => void;
  onMoveDown: (shotId: string) => void;
  onInsertAbove: (shotId: string) => void;
  onInsertBelow: (shotId: string) => void;
  /**
   * 当前项目选择的 ITV 渠道支持的时长规格。
   * - enum：渲染 Select（如 grok 6/12/16/20）
   * - range：渲染 InputNumber min/max/step（如 即梦 4-16）
   * 不传则用 ALLOWED_VIDEO_DURATIONS 兜底（向后兼容）。
   */
  durationSpec?: VideoDurationSpec;
  /**
   * 单镜头视频生成进度。父组件按 shotId 维护一个 Map，传当前 shot 对应的项；
   * 不在生成中时为 undefined。用于在视频结果区域渲染百分比 + 阶段文本。
   */
  videoProgress?: { progress: number; step: string };
}

const ShotCardImpl: React.FC<ShotCardProps> = ({
  projectId,
  shot,
  index,
  totalCount,
  characters,
  scenes,
  props,
  mentionItems,
  previousStoryboardMention,
  isSelected,
  isActive,
  isGeneratingImagePrompt,
  isGeneratingVideoPrompt,
  isGeneratingImage,
  isGeneratingVideo,
  onSelectChange,
  onActivate,
  onScriptLinesChange,
  onImagePromptChange,
  onVideoPromptChange,
  onDurationChange,
  onImageModeChange,
  onStoryboardInheritPreviousChange,
  onVideoModeChange,
  onCharactersChange,
  onScenesChange,
  onPropsChange,
  onReferenceImagesChange,
  onImagesChange,
  onVideosChange,
  onGenerateImagePrompt,
  onGenerateVideoPrompt,
  onOptimizeImagePrompt,
  onOptimizeVideoPrompt,
  onGenerateImage,
  onGenerateVideo,
  onGenerateAudio,
  videoCapabilityLabel,
  videoGenerateDisabledReason,
  onDelete,
  onMergeUp,
  onMergeDown: _onMergeDown,
  onMoveUp,
  onMoveDown,
  onInsertAbove,
  onInsertBelow,
  durationSpec,
  videoProgress,
}) => {
  const { message } = App.useApp();
  const { theme } = useTheme();
  const isDarkTheme = theme.meta.mode === 'dark';
  const { t } = useTranslation();
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [isSplittingGridImage, setIsSplittingGridImage] = useState(false);
  const [gridSplitModalOpen, setGridSplitModalOpen] = useState(false);
  const [gridSplitTargetIndex, setGridSplitTargetIndex] = useState<number | null>(null);
  const [gridSplitImageSize, setGridSplitImageSize] = useState<{ w: number; h: number } | null>(null);
  // 配音预览：HTMLAudioElement 持有播放状态，UI 用 isPlayingAudio 同步按钮 icon
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // 使用 useMemo 缓存计算值，避免不必要的重渲染
  const hasImagePrompt = useMemo(
    () => !!shot.imagePrompt?.trim(),
    [shot.imagePrompt]
  );
  const hasVideoPrompt = useMemo(
    () => !!shot.videoPrompt?.trim(),
    [shot.videoPrompt]
  );
  const isFirst = index === 0;
  const isLast = index === totalCount - 1;

  // 图片提示词按钮点击处理
  const handleImagePromptClick = useCallback(() => {
    if (hasImagePrompt) {
      onOptimizeImagePrompt(shot.id, shot.imagePrompt || '');
    } else {
      onGenerateImagePrompt(shot.id);
    }
  }, [shot.id, shot.imagePrompt, hasImagePrompt, onOptimizeImagePrompt, onGenerateImagePrompt]);

  // 视频提示词按钮点击处理
  const handleVideoPromptClick = useCallback(() => {
    if (hasVideoPrompt) {
      onOptimizeVideoPrompt(shot.id, shot.videoPrompt || '');
    } else {
      onGenerateVideoPrompt(shot.id);
    }
  }, [shot.id, shot.videoPrompt, hasVideoPrompt, onOptimizeVideoPrompt, onGenerateVideoPrompt]);

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.ant-btn, .ant-checkbox, .ant-input, .ant-select, .ant-tabs, .cm-editor, .ant-modal, .ant-popover')) {
      return;
    }
    onActivate?.(shot.id);
  }, [shot.id, onActivate]);

  const images = shot.media?.images || [];
  const referenceImages = shot.media?.references || [];
  const videos = shot.media?.videos || [];

  const imageSources = useMemo(
    () => images.map(a => getMediaAssetDisplaySource(a) || '').filter(Boolean),
    [images]
  );

  const currentVideo = useMemo(() => {
    if (!videos.length) return null;
    const idx = shot.media?.currentVideoIndex ?? videos.length - 1;
    return videos[idx] || videos[videos.length - 1];
  }, [videos, shot.media?.currentVideoIndex]);

  const currentVideoSource = useMemo(
    () => getMediaAssetEditingSource(currentVideo || undefined) || currentVideo?.remoteUrl || '',
    [currentVideo],
  );
  const currentVideoKey = useMemo(
    () => [
      shot.id,
      shot.media?.currentVideoIndex ?? -1,
      currentVideo?.localPath || '',
      currentVideo?.remoteUrl || '',
      currentVideo?.providerTaskId || '',
      currentVideo?.createdAt || '',
    ].join('|'),
    [
      shot.id,
      shot.media?.currentVideoIndex,
      currentVideo?.localPath,
      currentVideo?.remoteUrl,
      currentVideo?.providerTaskId,
      currentVideo?.createdAt,
    ],
  );

  const selectedImageIndex = useMemo(() => {
    const rawIndex = shot.media?.currentImageIndex;
    if (!Number.isInteger(rawIndex)) return 0;
    return Math.min(Math.max(rawIndex as number, 0), Math.max(images.length - 1, 0));
  }, [images.length, shot.media?.currentImageIndex]);

  const currentImage = useMemo(() => {
    if (!images.length) return null;
    return images[selectedImageIndex] || null;
  }, [images, selectedImageIndex]);

  const promptMentionItems = useMemo<MentionItem[]>(() => {
    const extraItems: MentionItem[] = [];
    if (previousStoryboardMention) {
      extraItems.push({
        ...previousStoryboardMention,
        name: previousStoryboardMention.name || '上一故事板',
        description: previousStoryboardMention.description || '上一分镜生成的故事板图，用于继承场景、人物、光影和情绪连续性。',
      });
    }

    const anchorPreview = currentImage ? getMediaAssetDisplaySource(currentImage) : undefined;
    if (anchorPreview) {
      const isGridMode = isGridImageMode(shot.imageMode);
      const isStoryboardMode = isStoryboardImageMode(shot.imageMode);
      extraItems.push({
        id: 'anchor',
        type: isGridMode ? 'grid' : isStoryboardMode ? 'storyboard' : 'shot',
        name: isGridMode ? '网格锚定图' : isStoryboardMode ? '故事板锚定图' : '分镜锚定图',
        description: isGridMode
          ? '当前分镜已生成的四宫格/九宫格时序锚定图。'
          : isStoryboardMode
            ? '当前分镜已生成的电影故事板/制作方案板。'
          : '当前分镜已生成的首帧锚定图。',
        previewImage: anchorPreview,
      });
    } else if (isStoryboardImageMode(shot.imageMode)) {
      extraItems.push({
        id: 'anchor',
        type: 'storyboard',
        name: '当前故事板',
        description: '当前分镜故事板锚点。首次生成前不会编译成真实图片引用；生成故事板后会绑定到当前选中的故事板版本。',
      });
    }

    if (!extraItems.length) return mentionItems;
    const extraKeys = new Set(extraItems.map(item => `${item.type}:${item.id}`));

    return [
      ...mentionItems.filter(item => !extraKeys.has(`${item.type}:${item.id}`)),
      ...extraItems,
    ];
  }, [currentImage, mentionItems, previousStoryboardMention, shot.imageMode]);

  /** 当前选中的配音资产（默认指向最新一条）。
      currentAudioSrc / handleToggleAudio / useEffect 因为依赖 getDisplaySrc
      （声明在更下方），都挪到 getDisplaySrc 之后避免 TDZ。 */
  const currentAudio = useMemo(() => {
    const audios = shot.media?.audios;
    if (!audios?.length) return null;
    const idx = shot.media?.currentAudioIndex ?? audios.length - 1;
    return audios[idx] || audios[audios.length - 1];
  }, [shot.media?.audios, shot.media?.currentAudioIndex]);

  const gridSplitAsset = useMemo(() => {
    if (gridSplitTargetIndex == null) return null;
    return images[gridSplitTargetIndex] || null;
  }, [images, gridSplitTargetIndex]);

  // grid-4 → 2×2（4 子图）；其它 grid 变体（grid / grid-9）→ 3×3（9 子图）。
  // 这一份 gridSize 同步驱动预览 modal 的分割线 / 网格 / 缩放计算 / 拆分调用，
  // 保证 UI 选了四宫格时拆分一定按 2×2 走，不会再硬切成 9 张。
  const gridSize: 2 | 3 = shot.imageMode === 'grid-4' ? 2 : 3;
  const gridCellCount = gridSize * gridSize;

  const gridSplitAspectStyle = useMemo(() => {
    const w = gridSplitImageSize?.w || gridSplitAsset?.width || 0;
    const h = gridSplitImageSize?.h || gridSplitAsset?.height || 0;
    if (w > 0 && h > 0) return `${w} / ${h}`;
    return '16 / 9';
  }, [gridSplitAsset, gridSplitImageSize]);

  const gridSplitPreviewMeta = useMemo(() => {
    const w = gridSplitImageSize?.w || gridSplitAsset?.width || 0;
    const h = gridSplitImageSize?.h || gridSplitAsset?.height || 0;
    if (!w || !h) return null;

    const aspect = h > w ? '9:16' : '16:9';
    const defaultCell = aspect === '16:9'
      ? { w: 1280, h: 720 }
      : { w: 720, h: 1280 };
    const minW = defaultCell.w * gridSize;
    const minH = defaultCell.h * gridSize;
    const scaleFactor = Math.max(minW / w, minH / h, 1);
    const scaledW = Math.round(w * scaleFactor);
    const scaledH = Math.round(h * scaleFactor);
    const finalW = Math.ceil(scaledW / gridSize) * gridSize;
    const finalH = Math.ceil(scaledH / gridSize) * gridSize;
    const padRight = finalW - scaledW;
    const padBottom = finalH - scaledH;
    const cellW = Math.floor(finalW / gridSize);
    const cellH = Math.floor(finalH / gridSize);

    return {
      aspect,
      scaleFactor,
      finalW,
      finalH,
      padRight,
      padBottom,
      cellW,
      cellH,
    };
  }, [gridSplitAsset, gridSplitImageSize, gridSize]);

  // 图片操作
  const handleImageSelect = (idx: number) => onImagesChange(shot.id, images, idx);
  const handleImageAdd = (path: string) => {
    const asset = createStoredMediaAsset('image', isRemoteMediaUri(path)
      ? { remoteUrl: path }
      : { localPath: path });
    const newImages: StoredMediaAsset[] = [
      ...images,
      asset,
    ];
    onImagesChange(shot.id, newImages, newImages.length - 1);
  };
  const handleImageDelete = async (idx: number) => {
    const target = images[idx];
    if (!target) return;

    const localPath = target.localPath;
    const shouldDeleteLocalFile = Boolean(localPath && !isRemoteMediaUri(localPath));

    try {
      if (shouldDeleteLocalFile && localPath) {
        await fsRemove(localPath);
      }

      const newImages = images.filter((_, i) => i !== idx);
      const newIdx = Math.min(shot.media?.currentImageIndex || 0, newImages.length - 1);
      onImagesChange(shot.id, newImages, Math.max(0, newIdx));

      if (shouldDeleteLocalFile) {
        message.success(t('asset.imageDeleted'));
      } else {
        message.warning(t('asset.remoteImageReferenceRemoved'));
      }
    } catch (err: any) {
      message.error(err.message || t('error.deleteFailed'));
    }
  };

  const handleOpenGridSplitPreview = useCallback((idx: number) => {
    setGridSplitTargetIndex(idx);
    setGridSplitImageSize(null);
    setGridSplitModalOpen(true);
  }, []);

  const handleCloseGridSplitPreview = useCallback(() => {
    if (isSplittingGridImage) return;
    setGridSplitModalOpen(false);
    setGridSplitTargetIndex(null);
    setGridSplitImageSize(null);
  }, [isSplittingGridImage]);

  const handleConfirmGridSplit = useCallback(async () => {
    if (!electronService.isElectron()) {
      message.error('仅支持 Electron 环境');
      return;
    }
    if (!isGridImageMode(shot.imageMode)) {
      message.info('当前分镜不是网格模式');
      return;
    }
    if (gridSplitTargetIndex == null) {
      message.info('未选择要拆分的图片');
      return;
    }
    const targetAsset = images[gridSplitTargetIndex];
    if (!targetAsset) {
      message.info('没有可拆分的图片');
      return;
    }
    if (isSplittingGridImage) return;

    setIsSplittingGridImage(true);
    try {
      const available = await ffmpegManager.isAvailable();
      if (!available) {
        throw new Error('FFmpeg 不可用');
      }

      const w = gridSplitImageSize?.w || targetAsset.width || 0;
      const h = gridSplitImageSize?.h || targetAsset.height || 0;
      const aspectRatio: '16:9' | '9:16' = (w > 0 && h > 0 && h > w) ? '9:16' : '16:9';

      let inputAsset: StoredMediaAsset = targetAsset;
      let baseImages: StoredMediaAsset[] = images;

      const isUsableLocalPath = Boolean(
        inputAsset.localPath &&
        !isRemoteMediaUri(inputAsset.localPath)
      );

      // If the selected image is remote-only, download it into the project so ffmpeg can access it.
      if (!isUsableLocalPath) {
        const projectPath = await getProjectPath(projectId);
        const sourceHint = getMediaAssetEditingSource(inputAsset) || inputAsset.remoteUrl || '';
        const ext = (() => {
          const clean = sourceHint.split('?')[0].split('#')[0];
          const dot = clean.lastIndexOf('.');
          const raw = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
          if (raw === 'jpeg') return 'jpg';
          if (raw === 'png' || raw === 'jpg' || raw === 'webp') return raw;
          return 'png';
        })();
        const destPath = `${projectPath}/assets/shots/${shot.id}/images/grid_source_${Date.now()}.${ext}`;

        const persisted = await persistMediaAsset({
          projectId,
          kind: 'image',
          source: inputAsset,
          destPath,
        });

        inputAsset = persisted;
        baseImages = images.map((a, i) => (i === gridSplitTargetIndex ? persisted : a));
      }

      const inputPath = inputAsset.localPath;
      if (!inputPath || isRemoteMediaUri(inputPath)) {
        throw new Error('缺少可用的本地图片路径');
      }

      const projectPath = await getProjectPath(projectId);
      const outputDir = `${projectPath}/assets/shots/${shot.id}/grid-splits/${Date.now()}`;
      const outputs = await ffmpegManager.splitGridImage({
        input: inputPath,
        outputDir,
        aspectRatio,
        format: 'png',
        sharpenAmount: 0.9,
        gridSize,
      });

      if (!Array.isArray(outputs) || outputs.length !== gridCellCount) {
        throw new Error(`网格拆分失败：期望 ${gridCellCount} 张，实际 ${outputs?.length ?? 0} 张`);
      }

      const newAssets = outputs.map((p, i) => createStoredMediaAsset('image', {
        localPath: p,
        metadata: {
          gridCell: i + 1,
          gridSource: inputPath,
        },
      }));

      const nextImages = [...baseImages, ...newAssets];
      onImagesChange(shot.id, nextImages, baseImages.length);
      const gridLabel = gridSize === 2 ? '四宫格' : '九宫格';
      message.success(`${gridLabel}已拆分为 ${gridCellCount} 张图片`);
      setGridSplitModalOpen(false);
      setGridSplitTargetIndex(null);
      setGridSplitImageSize(null);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const gridLabel = gridSize === 2 ? '四宫格' : '九宫格';
      message.error(errorMessage || `${gridLabel}拆分失败`);
    } finally {
      setIsSplittingGridImage(false);
    }
  }, [
    gridSplitImageSize,
    gridSplitTargetIndex,
    images,
    isSplittingGridImage,
    message,
    onImagesChange,
    projectId,
    shot.id,
    shot.imageMode,
  ]);

  // 参考图操作
  const handleRefImageSelect = (idx: number) => onReferenceImagesChange?.(shot.id, referenceImages, idx);
  const handleRefImageAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!electronService.isElectron()) {
        e.target.value = '';
        return;
      }

      const blobUrl = URL.createObjectURL(file);
      try {
        const projectPath = await getProjectPath(projectId);
        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        const destPath = `${projectPath}/assets/shots/${shot.id}/references/${Date.now()}.${ext}`;

        const stored = await persistMediaAsset({
          projectId,
          kind: 'image',
          source: blobUrl,
          destPath,
          ownerRef: {
            projectId,
            ownerType: 'shot',
            ownerId: shot.id,
            slot: 'referenceImage',
          },
        });

        const finalized = await ensureRemoteUrlForImageAsset({
          projectId,
          asset: stored,
          policy: 'best-effort',
          filenameHint: file.name,
        });

        const newRefs: StoredMediaAsset[] = [...referenceImages, finalized];
        onReferenceImagesChange?.(shot.id, newRefs, newRefs.length - 1);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }
    e.target.value = '';
  };
  const handleRefImageDelete = (idx: number) => {
    const newRefs = referenceImages.filter((_, i) => i !== idx);
    const newIdx = Math.min(shot.media?.selectedReferenceIndex || 0, newRefs.length - 1);
    onReferenceImagesChange?.(shot.id, newRefs, Math.max(0, newIdx));
  };

  // 视频操作
  const handleVideoSelect = (idx: number) => onVideosChange(shot.id, videos, idx);
  const handleVideoDelete = (idx: number) => {
    const newVideos = videos.filter((_, i) => i !== idx);
    const newIdx = Math.min(shot.media?.currentVideoIndex || 0, newVideos.length - 1);
    onVideosChange(shot.id, newVideos, Math.max(0, newIdx));
  };

  // 统一按钮样式
  // 行高 480px 后操作列纵向空间充裕：按钮加大到 28×28，icon 12px，间距更舒服
  const actionBtnClass = "!w-7 !h-7 !p-0 !text-[12px]";

  const getDisplaySrc = useCallback((asset?: StoredMediaAsset | null): string => {
    const source = asset ? getMediaAssetDisplaySource(asset) : undefined;
    if (!source) return '';
    if (source.startsWith('http') || source.startsWith('data:')) {
      return source;
    }
    if (electronService.isElectron()) {
      return electronService.fs.toLocalUrl(source);
    }
    return source;
  }, []);

  const gridSplitSrc = gridSplitAsset ? getDisplaySrc(gridSplitAsset) : '';

  // 配音预览（依赖 getDisplaySrc / currentAudio，必须放在它们之后避免 TDZ）
  const currentAudioSrc = useMemo(
    () => (currentAudio ? getDisplaySrc(currentAudio) : ''),
    [currentAudio, getDisplaySrc],
  );

  // 切换配音：没在播 → 从头播；正在播 → 暂停
  const handleToggleAudio = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused || el.ended) {
      el.currentTime = 0;
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => setIsPlayingAudio(false));
      }
      setIsPlayingAudio(true);
    } else {
      el.pause();
      setIsPlayingAudio(false);
    }
  }, []);

  // 音频换源（重新生成）→ 立即停老的、reload 新的
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setIsPlayingAudio(false);
    if (currentAudioSrc) el.load();
  }, [currentAudioSrc]);

  return (
    <div
      className={`shot-card ${isSelected ? 'selected' : ''} ${shot.confirmed ? 'confirmed' : ''} ${isActive ? 'active' : ''}`}
      onClick={handleCardClick}
    >
      {/* 分镜行固定高度：480px ——
          媒体列改 2×2 grid 后每格 ~240px 高度，资产 3 段每段 ~150px 容纳标题 + 4-5 行条目 */}
      <div className="flex items-stretch h-[480px] bg-bg-app">
        {/* 左侧操作列 - 全部显示（行高变 480 后给更舒服的间距 + 大一号按钮） */}
        <div className={`${COL_ACTION_WIDTH} shrink-0 border-r border-border-subtle flex flex-col items-center py-2 gap-1 bg-bg-surface/30`}>
          <Checkbox
            checked={isSelected}
            onChange={(e) => onSelectChange(shot.id, e.target.checked)}
          />
          <span className="text-[12px] font-semibold text-text-primary tracking-tight">#{index + 1}</span>
          {onDurationChange ? (
            <ShotDurationControl
              value={shot.duration}
              onChange={(next) => onDurationChange(shot.id, next)}
              durationSpec={durationSpec}
            />
          ) : (
            <Tag className="m-0 text-[9px] px-1" color="blue">{shot.duration}s</Tag>
          )}

          {/* 操作按钮 - 直接显示（gap 加大、与 #N / 时长视觉区隔） */}
          <div className="flex flex-col gap-1 mt-1.5">
            <Tooltip title="上移" placement="right">
              <Button size="small" type="text" className={actionBtnClass} icon={<ArrowUpOutlined />} disabled={isFirst} onClick={() => onMoveUp(shot.id)} />
            </Tooltip>
            <Tooltip title="下移" placement="right">
              <Button size="small" type="text" className={actionBtnClass} icon={<ArrowDownOutlined />} disabled={isLast} onClick={() => onMoveDown(shot.id)} />
            </Tooltip>
            <Tooltip title="上方插入" placement="right">
              <Button size="small" type="text" className={actionBtnClass} icon={<InsertRowAboveOutlined />} onClick={() => onInsertAbove(shot.id)} />
            </Tooltip>
            <Tooltip title="下方插入" placement="right">
              <Button size="small" type="text" className={actionBtnClass} icon={<InsertRowBelowOutlined />} onClick={() => onInsertBelow(shot.id)} />
            </Tooltip>
            <Tooltip title="向上合并" placement="right">
              <Button size="small" type="text" className={actionBtnClass} icon={<MergeCellsOutlined />} disabled={isFirst} onClick={() => onMergeUp(shot.id)} />
            </Tooltip>
            {onGenerateAudio && (
              <Tooltip title={currentAudio ? '重新生成配音 (TTS)' : '生成配音 (TTS)'} placement="right">
                <Button
                  size="small"
                  type="text"
                  className={actionBtnClass}
                  icon={<AudioOutlined />}
                  onClick={() => onGenerateAudio(shot.id)}
                />
              </Tooltip>
            )}
            {currentAudio && (
              <Tooltip title={isPlayingAudio ? '暂停试听' : '试听配音'} placement="right">
                <Button
                  size="small"
                  type="text"
                  className={actionBtnClass}
                  icon={isPlayingAudio ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                  onClick={handleToggleAudio}
                />
              </Tooltip>
            )}
            <Popconfirm title="确定删除？" onConfirm={() => onDelete(shot.id)} placement="right">
              <Button size="small" type="text" danger className={actionBtnClass} icon={<DeleteOutlined />} />
            </Popconfirm>
            {/* 隐藏的 audio 元素 — 持久化播放状态，由上方 ▶️ 按钮控制 */}
            {currentAudioSrc && (
              <audio
                ref={audioRef}
                src={currentAudioSrc}
                preload="none"
                onPlay={() => setIsPlayingAudio(true)}
                onPause={() => setIsPlayingAudio(false)}
                onEnded={() => setIsPlayingAudio(false)}
                onError={() => setIsPlayingAudio(false)}
                style={{ display: 'none' }}
              />
            )}
          </div>
        </div>

        {/* 列1: 剧本（min-h-0 让 ShotScriptLines 内部滚动条生效，行多了不撑高分镜） */}
        <div className={`${SHOT_LAYOUT.colScript} border-r border-border-subtle flex flex-col min-h-0`}>
          <div className="flex-1 min-h-0 p-1">
            <ShotScriptLines
              shotId={shot.id}
              lines={shot.scriptLines || []}
              onLinesChange={onScriptLinesChange}
            />
          </div>
        </div>

        {/* 列2: 资产（角色 / 场景 / 道具 三段等高）
            - 父容器 flex-col + min-h-0：把分镜行的 360px 等分给三段，每段 ~110px 容纳标题 + 至少 3 行条目
            - 每段 flex-1 min-h-0：AssetSelector 内部自己处理"标题固定 + 条目滚动" */}
        <div className={`${SHOT_LAYOUT.colAssets} border-r border-border-subtle flex flex-col bg-bg-surface/10 p-1 gap-1 min-h-0`}>
          <div className="flex-1 min-h-0">
            <AssetSelector
              type="character"
              selectedIds={shot.characters || []}
              allAssets={characters}
              onChange={(ids) => onCharactersChange(shot.id, ids)}
            />
          </div>
          <div className="flex-1 min-h-0">
            <AssetSelector
              type="scene"
              selectedIds={shot.scenes || []}
              allAssets={scenes}
              onChange={(ids) => onScenesChange?.(shot.id, ids)}
            />
          </div>
          <div className="flex-1 min-h-0">
            <AssetSelector
              type="prop"
              selectedIds={shot.props || []}
              allAssets={props}
              onChange={(ids) => onPropsChange?.(shot.id, ids)}
            />
          </div>
        </div>

        {/* 列3: 媒体（垂直 2 行 — 图像 / 视频；每行 = 统一 header + 下方 2 列 prompt | result） */}
        <div className={`${SHOT_LAYOUT.colMedia} flex flex-col min-h-0`}>
          {/* === 图像行 === */}
          <div className="flex-1 flex flex-col min-h-0 border-b border-border-subtle">
            {/* 统一 header：模式 + 操作按钮跨左右两列同一行 */}
            <div className="flex items-center justify-between gap-2 px-2 py-1 bg-bg-surface/30">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-secondary">图片模式</span>
                <Segmented
                  size="small"
                  value={shot.imageMode === 'grid' ? 'grid-9' : (shot.imageMode || 'normal')}
                  onChange={(value) => onImageModeChange(shot.id, value as Exclude<ShotImageMode, 'grid'>)}
                  options={[
                    { value: 'normal', label: '普通' },
                    { value: 'grid-4', label: '四宫格' },
                    { value: 'grid-9', label: '九宫格' },
                    { value: 'storyboard', label: '故事板' },
                  ]}
                  className="shot-mode-seg"
                />
                {isStoryboardImageMode(shot.imageMode) && (
                  <Tooltip title="生成故事板时把上一张故事板作为连续性参考">
                    <label className={`shot-storyboard-inherit ${!onStoryboardInheritPreviousChange ? 'disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={shot.inheritPreviousStoryboard !== false}
                        onChange={(e) => onStoryboardInheritPreviousChange?.(shot.id, e.target.checked)}
                        disabled={!onStoryboardInheritPreviousChange}
                      />
                      <span className="shot-storyboard-inherit-switch" aria-hidden="true" />
                      <span className="shot-storyboard-inherit-label">续上板</span>
                    </label>
                  </Tooltip>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-status-info hover:opacity-80 text-[11px] font-medium cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleImagePromptClick}
                  disabled={isGeneratingImagePrompt}
                  title={hasImagePrompt ? '优化提示词' : 'AI 生成提示词'}
                >
                  {isGeneratingImagePrompt ? '生成中...' : (hasImagePrompt ? '优化提示词' : 'AI生成提示词')}
                </button>
                <Dropdown
                  menu={{ items: buildImageAddMenu({ onAdd: handleImageAdd, characters, scenes, props, message }) }}
                  trigger={['click']}
                >
                  <button className="text-text-secondary hover:text-text-primary text-[11px] flex items-center gap-0.5 cursor-pointer transition-colors">
                    添加 <DownOutlined className="text-[8px]" />
                  </button>
                </Dropdown>
                <button
                  className="text-status-info hover:opacity-80 text-[11px] font-medium cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => onGenerateImage(shot.id)}
                  disabled={isGeneratingImage || !hasImagePrompt}
                  title={!hasImagePrompt ? '先编写提示词再生成图片' : (imageSources.length ? '追加新版本' : '生成首版图片')}
                >
                  {isGeneratingImage ? '生成中...' : (imageSources.length ? '再生成一版' : 'AI生成图')}
                </button>
              </div>
            </div>
            {/* 下方 2 列：prompt | result，中间 border 收薄不再造成割裂 */}
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 min-w-0 p-1 relative">
                <ScriptEditor
                  value={shot.imagePrompt || ''}
                  onChange={(value) => onImagePromptChange(shot.id, value)}
                  placeholder="画面描述提示词..."
                  mentionItems={promptMentionItems}
                  enableCameraCommands={true}
                  showLineNumbers={false}
                  darkTheme={isDarkTheme}
                  className="shot-prompt-editor shot-prompt-editor-fill"
                />
                {/* 参考图浮在右下角（AI 生成相关按钮已上提到 header） */}
                <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                  {referenceImages.map((img, idx) => (
                    <div
                      key={idx}
                      className={`relative h-7 w-7 rounded overflow-hidden cursor-pointer border ${
                        idx === (shot.media?.selectedReferenceIndex || 0) ? 'border-status-info' : 'border-border'
                      } shadow-lg`}
                      onClick={() => handleRefImageSelect(idx)}
                    >
                      <img src={getDisplaySrc(img)} className="w-full h-full object-cover" alt="" />
                      <button
                        className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-status-error text-on-status text-[7px] rounded-full flex items-center justify-center hover:bg-status-error"
                        onClick={(e) => { e.stopPropagation(); handleRefImageDelete(idx); }}
                      >
                        <CloseOutlined />
                      </button>
                    </div>
                  ))}
                  <Tooltip title="添加参考图" placement="top">
                    <label className="h-7 w-7 bg-bg-elevated/90 border border-dashed border-border rounded flex items-center justify-center cursor-pointer hover:border-border hover:bg-bg-hover/90 text-text-secondary shadow-lg">
                      <PlusOutlined className="text-[11px]" />
                      <input type="file" accept="image/*" className="hidden" onChange={handleRefImageAdd} />
                    </label>
                  </Tooltip>
                </div>
              </div>
              {/* result：去掉边框 + 浅淡背景做轻微区隔，不再形成强割裂 */}
              <div className="flex-1 min-w-0 p-1 bg-bg-surface/15 relative">
                <ImageCardGrid
                  images={imageSources}
                  selectedIndex={selectedImageIndex}
                  onSelect={handleImageSelect}
                  onAdd={handleImageAdd}
                  onDelete={handleImageDelete}
                  onSplitGrid={isGridImageMode(shot.imageMode) && electronService.isElectron()
                    ? handleOpenGridSplitPreview
                    : undefined}
                  isGenerating={isGeneratingImage}
                  disabled={!hasImagePrompt}
                  characters={characters}
                  scenes={scenes}
                  props={props}
                  compact
                />
              </div>
            </div>
          </div>

          {/* === 视频行 === */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-2 px-2 py-1 bg-bg-surface/30">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-secondary">视频模式</span>
                <Tooltip
                  title={isMultiPanelImageMode(shot.imageMode)
                    ? '多面板图片模式下视频自动走"多参"——把整张网格/故事板当作参考锚点；切回普通模式才能选"首帧"。'
                    : ''}
                  placement="top"
                >
                  <Segmented
                    size="small"
                    value={shot.videoMode || 'multi-ref'}
                    onChange={(value) => onVideoModeChange?.(shot.id, value as 'multi-ref' | 'first-frame')}
                    options={[
                      { value: 'multi-ref', label: '多参' },
                      { value: 'first-frame', label: '首帧', disabled: isMultiPanelImageMode(shot.imageMode) },
                    ]}
                    className="shot-mode-seg"
                    disabled={!onVideoModeChange}
                  />
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-status-info hover:opacity-80 text-[11px] font-medium cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleVideoPromptClick}
                  disabled={isGeneratingVideoPrompt}
                  title={hasVideoPrompt ? '优化提示词' : 'AI 生成提示词'}
                >
                  {isGeneratingVideoPrompt ? '生成中...' : (hasVideoPrompt ? '优化提示词' : 'AI生成提示词')}
                </button>
                <Tooltip title={videoGenerateDisabledReason || (videoCapabilityLabel ? `当前将生成${videoCapabilityLabel}` : '')}>
                  <button
                    className="text-status-info hover:opacity-80 text-[11px] font-medium cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => onGenerateVideo(shot.id)}
                    disabled={isGeneratingVideo || Boolean(videoGenerateDisabledReason)}
                  >
                    {isGeneratingVideo ? '生成中...' : (videos.length ? '再生成一版' : 'AI生成视频')}
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 min-w-0 p-1 relative">
                <ScriptEditor
                  value={shot.videoPrompt || ''}
                  onChange={(value) => onVideoPromptChange(shot.id, value)}
                  placeholder="运动/转场描述..."
                  mentionItems={promptMentionItems}
                  enableCameraCommands={true}
                  showLineNumbers={false}
                  darkTheme={isDarkTheme}
                  className="shot-prompt-editor shot-prompt-editor-fill"
                />
              </div>
              <div className="flex-1 min-w-0 p-1 bg-bg-surface/15 relative">
                <VideoCardGrid
                  videos={videos.map(a => ({
                    path: getMediaAssetDisplaySource(a) || '',
                    url: a.remoteUrl,
                    thumbnailPath: typeof a.metadata?.thumbnailPath === 'string' ? a.metadata.thumbnailPath : undefined,
                    prompt: typeof a.metadata?.prompt === 'string' ? a.metadata.prompt : undefined,
                    seed: typeof a.metadata?.seed === 'number' ? a.metadata.seed : undefined,
                    model: typeof a.metadata?.model === 'string' ? a.metadata.model : undefined,
                    createdAt: a.createdAt,
                  }))}
                  selectedIndex={shot.media?.currentVideoIndex || 0}
                  onSelect={handleVideoSelect}
                  onDelete={handleVideoDelete}
                  isGenerating={isGeneratingVideo}
                  disabled={Boolean(videoGenerateDisabledReason)}
                  compact
                />
                {currentVideo && (
                  <Button
                    type="text"
                    size="small"
                    className="absolute top-1 right-1 h-5 w-5 p-0 z-10"
                    icon={<PlayCircleFilled />}
                    onClick={() => setVideoModalOpen(true)}
                  />
                )}
                {isGeneratingVideo && videoProgress && (
                  <div className="shot-video-progress-overlay">
                    <Progress
                      percent={Math.max(0, Math.min(100, videoProgress.progress))}
                      size="small"
                      showInfo={false}
                      strokeColor="var(--token-accent-base)"
                      trailColor="var(--token-border-base)"
                    />
                    <div className="shot-video-progress-meta">
                      <span className="truncate flex-1" title={videoProgress.step}>
                        {videoProgress.step || '处理中...'}
                      </span>
                      <span className="tabular-nums shrink-0">
                        {Math.round(videoProgress.progress)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>{/* /flex items-stretch h-[480px] */}

      {/* 网格拆分预览 Modal — gridSize=2 走 2×2 / 4 张，gridSize=3 走 3×3 / 9 张 */}
      <Modal
        title={`分镜 #${index + 1} - ${gridSize === 2 ? '四宫格' : '九宫格'}拆分预览`}
        open={gridSplitModalOpen}
        onCancel={handleCloseGridSplitPreview}
        onOk={handleConfirmGridSplit}
        okText={isSplittingGridImage ? '拆分中...' : '确定拆分'}
        cancelText="取消"
        okButtonProps={{
          disabled: !electronService.isElectron() || isSplittingGridImage || !gridSplitAsset,
        }}
        cancelButtonProps={{
          disabled: isSplittingGridImage,
        }}
        width={920}
        centered
        destroyOnHidden
        mask={{ closable: !isSplittingGridImage }}
        closable={!isSplittingGridImage}
      >
        {!gridSplitAsset ? (
          <div className="text-sm text-text-secondary">未找到要拆分的图片</div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="text-[12px] text-text-secondary">
              <div>将把所选图片平均切成 {gridCellCount} 张（{gridSize}×{gridSize}）。确认后才会真正落盘拆分。</div>
              {gridSplitPreviewMeta && (
                <div className="mt-1">
                  预计输出单格分辨率约 {gridSplitPreviewMeta.cellW}×{gridSplitPreviewMeta.cellH}，
                  右/下补像素 {gridSplitPreviewMeta.padRight}/{gridSplitPreviewMeta.padBottom}px，
                  放大倍率 {gridSplitPreviewMeta.scaleFactor.toFixed(2)}×
                </div>
              )}
            </div>

            <div className="flex flex-col md:flex-row gap-3">
              {/* 分割线预览 */}
              <div className="flex-1">
                <div className="text-[12px] text-text-tertiary mb-1">分割线预览</div>
                <div
                  className="grid-split-frame relative w-full rounded overflow-hidden bg-black border border-border-subtle"
                  style={cssVars({ '--grid-split-aspect-ratio': gridSplitAspectStyle })}
                >
                  {gridSplitSrc && (
                    <img
                      src={gridSplitSrc}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                      onLoad={(e) => {
                        const w = e.currentTarget.naturalWidth || 0;
                        const h = e.currentTarget.naturalHeight || 0;
                        if (w && h) setGridSplitImageSize({ w, h });
                      }}
                    />
                  )}

                  {/* gridSize×gridSize 分割线（gridSize-1 条线，按等分位置） */}
                  <div className="absolute inset-0 pointer-events-none">
                    {Array.from({ length: gridSize - 1 }).map((_, i) => {
                      const pct = `${((i + 1) / gridSize) * 100}%`;
                      return (
                        <div
                          key={`v-${i}`}
                          className="grid-split-line-v absolute top-0 bottom-0 w-px"
                          style={cssVars({ '--grid-line-left': pct })}
                        />
                      );
                    })}
                    {Array.from({ length: gridSize - 1 }).map((_, i) => {
                      const pct = `${((i + 1) / gridSize) * 100}%`;
                      return (
                        <div
                          key={`h-${i}`}
                          className="grid-split-line-h absolute left-0 right-0 h-px"
                          style={cssVars({ '--grid-line-top': pct })}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 结果预览 — 用 inline gridTemplateColumns 避免 Tailwind purge 干掉动态类名 */}
              <div className="flex-1">
                <div className="text-[12px] text-text-tertiary mb-1">生成结果预览</div>
                <div
                  className="grid-split-result-grid grid gap-2"
                  style={cssVars({ '--grid-size': gridSize })}
                >
                  {Array.from({ length: gridCellCount }).map((_, i) => {
                    const row = Math.floor(i / gridSize);
                    const col = i % gridSize;
                    // gridSize=2 时 backgroundSize 200% 200%，每格步进 100%；
                    // gridSize=3 时 300% 300%，每格步进 50%。通用公式：步进 = 100/(gridSize-1)
                    const stepPct = 100 / (gridSize - 1);
                    const bgPosX = `${col * stepPct}%`;
                    const bgPosY = `${row * stepPct}%`;
                    const bgSizePct = `${gridSize * 100}%`;
                    return (
                      <div
                        key={i}
                        className="grid-split-cell relative rounded overflow-hidden border border-border-subtle bg-black"
                        style={cssVars({
                          '--grid-split-aspect-ratio': gridSplitAspectStyle,
                          '--grid-cell-bg-image': toCssUrl(gridSplitSrc),
                          '--grid-cell-bg-size': `${bgSizePct} ${bgSizePct}`,
                          '--grid-cell-bg-position': `${bgPosX} ${bgPosY}`,
                        })}
                      >
                        <div className="grid-split-cell-index absolute left-1 top-1 text-[10px] px-1 rounded">
                          {String(i + 1).padStart(2, '0')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 视频播放 Modal */}
      <Modal
        title={`分镜 #${index + 1} - 视频预览`}
        open={videoModalOpen}
        onCancel={() => setVideoModalOpen(false)}
        footer={null}
        width={800}
        centered
        destroyOnHidden
      >
        <div className="aspect-video bg-black rounded overflow-hidden">
          <StagePlayer
            key={currentVideoKey}
            videoPath={currentVideoSource}
            videoUrl={currentVideo?.remoteUrl}
            poster={currentImage ? getDisplaySrc(currentImage) : undefined}
          />
        </div>
      </Modal>
    </div>
  );
};

/** 用 React.memo 减少虚拟滚动场景下的无关重渲染：
 *  父组件（ShotListEditor / Storyboard）每次 selectedIds / generatingXxx Set 变化都会重建
 *  renderShotRow 的闭包，但只有"真正状态变化的那一镜"应当重渲染。memo 走默认浅比较即可——
 *  ShotCardProps 里的回调来自父级 useCallback，引用稳定；其余 prop 只有真正变化时引用才换新。 */
export const ShotCard = React.memo(ShotCardImpl);
ShotCard.displayName = 'ShotCard';
