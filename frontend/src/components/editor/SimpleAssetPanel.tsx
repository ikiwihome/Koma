/**
 * 素材面板组件
 * 仿照剪映/CapCut风格，支持分类浏览、拖拽到时间线、素材上传
 */
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Film, Image, Music, Upload, FolderOpen, Search, Plus } from 'lucide-react';
import { MediaType } from '../../types/editor';
import type { AssetItem, AssetSource, Asset } from '../../types/editor';
import { toKomaLocalUrl } from '../../utils/urlUtils';
import { App } from 'antd';

interface AssetPanelProps {
  assets: AssetItem[];
  onDragStart: (asset: Asset) => void;
  onDragEnd: () => void;
  onUpload?: (files: File[]) => void;
  onAddAsset?: (asset: AssetItem) => void;
}

type FilterTab = 'all' | 'video' | 'image' | 'audio';

const TAB_CONFIG: { id: FilterTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'all', label: '全部', icon: FolderOpen },
  { id: 'video', label: '视频', icon: Film },
  { id: 'image', label: '图片', icon: Image },
  { id: 'audio', label: '音频', icon: Music },
];

// 来源标签颜色：用 status 语义色族表达不同来源类型，跟随主题
// shot=info(蓝)/character=accent/scene=success(绿)/prop=warning(橙)/upload=中性
const SOURCE_COLORS: Record<AssetSource, string> = {
  shot: 'bg-status-info',
  character: 'bg-accent',
  scene: 'bg-status-success',
  prop: 'bg-status-warning',
  upload: 'bg-bg-hover',
};

const SOURCE_LABELS: Record<AssetSource, string> = {
  shot: '分镜',
  character: '角色',
  scene: '场景',
  prop: '道具',
  upload: '上传',
};

// 将 AssetItem 转换为 Asset（用于时间线）
function assetItemToAsset(item: AssetItem): Asset {
  // 使用 MediaType enum 值
  const typeMap: Record<AssetItem['type'], MediaType> = {
    video: MediaType.VIDEO,
    image: MediaType.IMAGE,
    audio: MediaType.AUDIO,
    text: MediaType.TEXT,
  };
  return {
    id: item.id,
    type: typeMap[item.type],
    src: item.src,
    thumbnail: item.thumbnailSrc,
    name: item.name,
    duration: item.duration,
    width: item.width,
    height: item.height,
  };
}

// 素材卡片
const AssetCard: React.FC<{
  item: AssetItem;
  onDragStart: (asset: Asset) => void;
  onDragEnd: () => void;
}> = ({ item, onDragStart, onDragEnd }) => {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copy';
    const data = JSON.stringify(assetItemToAsset(item));
    e.dataTransfer.setData('application/json', data);
    e.dataTransfer.setData('text/plain', data);
    onDragStart(assetItemToAsset(item));
  };

  const thumbnailSrc = toKomaLocalUrl(item.thumbnailSrc || item.src);
  const isVideo = item.type === 'video';
  const isAudio = item.type === 'audio';

  return (
    <div
      className="group relative bg-bg-elevated rounded-lg overflow-hidden cursor-grab hover:ring-2 hover:ring-status-info transition-all"
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
    >
      {/* 缩略图区域 */}
      <div className="aspect-video bg-bg-surface relative">
        {isAudio ? (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-status-success/30 to-status-success/15">
            <Music className="w-8 h-8 text-status-success" />
          </div>
        ) : (
          <img
            src={thumbnailSrc}
            alt={item.name}
            className="w-full h-full object-cover"
            draggable={false}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}

        {/* 时长标签 */}
        {item.duration > 0 && (
          <span className="absolute bottom-1 right-1 text-[10px] bg-black/70 text-white px-1 rounded">
            {formatDuration(item.duration)}
          </span>
        )}

        {/* 类型图标 */}
        {isVideo && (
          <div className="absolute top-1 left-1">
            <Film className="w-4 h-4 text-white drop-shadow" />
          </div>
        )}
      </div>

      {/* 信息区域 */}
      <div className="p-2">
        <p className="text-xs text-text-secondary truncate" title={item.name}>
          {item.name}
        </p>
        <div className="flex items-center gap-1 mt-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_COLORS[item.source]} ${
            item.source === 'upload'
              ? 'text-text-primary'   // upload 用中性 bg-bg-hover，配主文字
              : item.source === 'character'
                ? 'text-on-accent'    // character 用 bg-accent，配 onAccent
                : 'text-on-status'    // 其它 (shot/scene/prop) 用 status 色，配 onStatus
          }`}>
            {SOURCE_LABELS[item.source]}
          </span>
        </div>
      </div>

      {/* hover 蒙层 */}
      <div className="absolute inset-0 bg-accent/0 group-hover:bg-accent/10 transition-colors pointer-events-none" />
    </div>
  );
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) {
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  return `${s}s`;
}

const SUPPORTED_TYPES = {
  video: ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
};

const ACCEPT_STRING = [...SUPPORTED_TYPES.video, ...SUPPORTED_TYPES.image, ...SUPPORTED_TYPES.audio].join(',');

function getFileType(file: File): 'video' | 'image' | 'audio' | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (SUPPORTED_TYPES.video.includes(ext)) return 'video';
  if (SUPPORTED_TYPES.image.includes(ext)) return 'image';
  if (SUPPORTED_TYPES.audio.includes(ext)) return 'audio';
  return null;
}

export const SimpleAssetPanel: React.FC<AssetPanelProps> = ({
  assets,
  onDragStart,
  onDragEnd,
  onUpload,
  onAddAsset: _onAddAsset,
}) => {
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (files: FileList | File[]) => {
    const validFiles: File[] = [];

    for (const file of Array.from(files)) {
      const type = getFileType(file);
      if (type) {
        validFiles.push(file);
      } else {
        message.warning(`不支持的文件类型: ${file.name}`);
      }
    }

    if (validFiles.length > 0 && onUpload) {
      onUpload(validFiles);
    }
  }, [onUpload, message]);

  // 点击上传按钮
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 文件输入变化
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files);
      e.target.value = ''; // 清空以允许重复选择同一文件
    }
  }, [handleFileSelect]);

  // 拖放事件
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
  }, [handleFileSelect]);

  // 过滤素材
  const filteredAssets = useMemo(() => {
    let result = assets;

    // 按类型过滤
    if (activeTab !== 'all') {
      result = result.filter(a => a.type === activeTab);
    }

    // 按搜索词过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(query) ||
        SOURCE_LABELS[a.source].includes(query)
      );
    }

    return result;
  }, [assets, activeTab, searchQuery]);

  // 统计各类型数量
  const counts = useMemo(() => ({
    all: assets.length,
    video: assets.filter(a => a.type === 'video').length,
    image: assets.filter(a => a.type === 'image').length,
    audio: assets.filter(a => a.type === 'audio').length,
  }), [assets]);

  return (
    <div
      className={`flex flex-col h-full bg-bg-surface text-text-primary ${isDragOver ? 'ring-2 ring-status-info ring-inset' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_STRING}
        multiple
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* 头部 */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">素材库</h3>
          <button
            onClick={handleUploadClick}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-accent hover:bg-accent-hover text-on-accent rounded transition-colors"
          >
            <Upload className="w-3 h-3" />
            上传
          </button>
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            placeholder="搜索素材..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-elevated border border-border rounded focus:outline-none focus:border-status-info"
          />
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex border-b border-border">
        {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition-colors ${
              activeTab === id
                ? 'text-status-info border-b-2 border-status-info'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
            <span className="text-[10px] text-text-tertiary">({counts[id]})</span>
          </button>
        ))}
      </div>

      {/* 素材网格 */}
      <div className="flex-1 overflow-y-auto p-2 relative">
        {/* 拖放遮罩 */}
        {isDragOver && (
          <div className="absolute inset-0 bg-status-info/20 flex items-center justify-center z-10 border-2 border-dashed border-status-info rounded m-2">
            <div className="text-center">
              <Plus className="w-8 h-8 text-status-info mx-auto mb-2" />
              <p className="text-sm text-status-info">释放以上传文件</p>
            </div>
          </div>
        )}

        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-tertiary">
            {assets.length === 0 ? (
              <>
                <FolderOpen className="w-12 h-12 mb-2 opacity-50" />
                <p className="text-sm">暂无素材</p>
                <p className="text-xs mt-1">拖拽文件或点击上传</p>
              </>
            ) : (
              <>
                <Search className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm">未找到匹配素材</p>
                <p className="text-xs mt-1">尝试更换搜索关键词或分类</p>
                <button
                  onClick={() => { setSearchQuery(''); setActiveTab('all'); }}
                  className="mt-3 text-xs text-status-info hover:text-status-info underline"
                >
                  清除筛选
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredAssets.map(item => (
              <AssetCard
                key={item.id}
                item={item}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SimpleAssetPanel;
