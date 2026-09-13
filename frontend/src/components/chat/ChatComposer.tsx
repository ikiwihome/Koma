/**
 * 对话输入组件（仿即梦布局）
 * - 选图立即调图床上传
 * - 输入框左上叠加待发送缩略图 + "+"添加按钮
 * - "@" 按钮弹出 Popover 列出所有可引用图（含历史对话生成的）
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Button, Tooltip, message, Dropdown, Popover, Spin } from 'antd';
import type { MenuProps } from 'antd';
import { ChatPromptEditor, type ChatPromptEditorRef } from './ChatPromptEditor';
import {
  SendOutlined,
  StopOutlined,
  CloseOutlined,
  PlusOutlined,
  MessageOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  ColumnHeightOutlined,
  ClockCircleOutlined,
  DownOutlined,
  PaperClipOutlined,
} from '@ant-design/icons';
import {
  ASPECT_RATIO_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  IMAGE_COUNT_OPTIONS,
  videoSubModeToCapability,
  type ChatImageRef,
  type ChatMediaMode,
  type ChatMediaParams,
  type VideoSubMode,
} from './chatMediaGeneration';
import {
  clampDurationToSpec,
  isAllowedDurationForSpec,
  type VideoDurationSpec,
} from '../../providers/itv/durationSpec';

type ComposerMode = 'chat' | 'image' | 'video';

function toChatMediaMode(mode: ComposerMode, videoSub: VideoSubMode, hasImageInput: boolean): ChatMediaMode {
  if (mode === 'chat') return 'chat';
  if (mode === 'video') {
    return videoSubModeToCapability(videoSub);
  }
  return hasImageInput ? 'image-to-image' : 'text-to-image';
}

function fromChatMediaMode(mode: ChatMediaMode): { composer: ComposerMode; videoSub: VideoSubMode } {
  if (mode === 'chat') return { composer: 'chat', videoSub: 'image' };
  if (mode === 'text-to-video') return { composer: 'video', videoSub: 'text' };
  if (mode === 'image-to-video') return { composer: 'video', videoSub: 'image' };
  if (mode === 'start-end-to-video') return { composer: 'video', videoSub: 'first-last' };
  if (mode === 'reference-to-video') return { composer: 'video', videoSub: 'multi-ref' };
  return { composer: 'image', videoSub: 'image' };
}

const VIDEO_SUB_META: Record<VideoSubMode, { label: string; capability: string; minImages: number; maxImages: number; allowImage: boolean }> = {
  'text': { label: '文生视频', capability: 'video.text-to-video', minImages: 0, maxImages: 0, allowImage: false },
  'image': { label: '单图驱动', capability: 'video.image-to-video', minImages: 1, maxImages: 1, allowImage: true },
  'first-last': { label: '首尾帧', capability: 'video.start-end-to-video', minImages: 2, maxImages: 2, allowImage: true },
  'multi-ref': { label: '多参考', capability: 'video.reference-to-video', minImages: 1, maxImages: 12, allowImage: true },
};
import styles from './ChatComposer.module.scss';
import { cssVars } from '../../theme/runtime';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** 兼容旧 import - 实际不再使用 */
export interface AttachmentFile {
  id: string;
  file: File;
  type: 'image' | 'document' | 'code' | 'other';
  preview?: string;
}

interface ModelOption {
  value: string;
  label: string;
}

interface ChatComposerProps {
  /** 选了图片后立即上传到图床。失败由 ChatPage toast，组件不阻塞。 */
  onUploadImage: (file: File) => Promise<void>;
  onSend: (text: string, mode: ChatMediaMode, mediaParams: ChatMediaParams) => void;
  onStop?: () => void;
  isLoading?: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  maxRows?: number;

  /** 全部 imageRefs（pending=待跟随消息送出；其余=对话历史里可 @ 的） */
  imageRefs?: ChatImageRef[];
  /** 切换是否"待发送"——不删除，只取消选中 */
  onTogglePending?: (id: string) => void;
  /** 真正从池子移除（彻底删除引用） */
  onDeleteImageRef?: (id: string) => void;

  chatModelOptions?: ModelOption[];
  chatModelValue?: string;
  onChatModelChange?: (value: string) => void;
  ttiModelOptions?: ModelOption[];
  ttiModelValue?: string;
  onTtiModelChange?: (value: string) => void;
  itvModelOptions?: ModelOption[];
  itvModelValue?: string;
  onItvModelChange?: (value: string) => void;
  /** 当前 ITV 模型的视频时长能力（来自渠道的 durationSpec：enum 枚举 / range 连续范围） */
  itvDurationSpec?: VideoDurationSpec;
  /** 当前 ITV 模型支持的 video.* capabilities（决定子模式 popover 列出哪几项） */
  itvCapabilities?: string[];
  /** "重新编辑"：seedAt 变化时把字段灌到内部 state */
  seed?: {
    seedAt: number;
    text: string;
    mode: ChatMediaMode;
    aspectRatio?: string;
    resolution?: string;
    duration?: number;
    count?: number;
  } | null;
}

const MODE_META: Record<ComposerMode, { label: string; icon: React.ReactNode }> = {
  chat: { label: '对话', icon: <MessageOutlined /> },
  image: { label: '图片创作', icon: <PictureOutlined /> },
  video: { label: '视频创作', icon: <VideoCameraOutlined /> },
};

export const ChatComposer: React.FC<ChatComposerProps> = ({
  onUploadImage,
  onSend,
  onStop,
  isLoading = false,
  isStreaming = false,
  disabled = false,
  placeholder = '上传参考图、输入文字或 @ 主体，描述你想生成的内容...',
  maxRows = 6,
  imageRefs = [],
  onTogglePending,
  onDeleteImageRef,
  chatModelOptions = [],
  chatModelValue,
  onChatModelChange,
  ttiModelOptions = [],
  ttiModelValue,
  onTtiModelChange,
  itvModelOptions = [],
  itvModelValue,
  onItvModelChange,
  itvDurationSpec,
  itvCapabilities,
  seed,
}) => {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ComposerMode>('chat');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [resolution, setResolution] = useState<string>('2K');
  const [duration, setDuration] = useState<number>(5);
  const [count, setCount] = useState<number>(1);
  const [videoSubMode, setVideoSubMode] = useState<VideoSubMode>('multi-ref');
  const textareaRef = useRef<ChatPromptEditorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  // 把 spec 展开成可选时长按钮列表（enum 直接用 values；range 按 step 展开）
  const durationButtonValues = useMemo<number[]>(() => {
    if (!itvDurationSpec) return [5, 8, 10];
    if (itvDurationSpec.kind === 'enum') return itvDurationSpec.values;
    const out: number[] = [];
    const step = itvDurationSpec.step > 0 ? itvDurationSpec.step : 1;
    for (let v = itvDurationSpec.min; v <= itvDurationSpec.max + 1e-6; v += step) {
      out.push(Math.round(v * 100) / 100);
    }
    return out;
  }, [itvDurationSpec]);

  // "重新编辑"：seed 变化时把字段灌进内部 state
  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    const { composer, videoSub } = fromChatMediaMode(seed.mode);
    setMode(composer);
    setVideoSubMode(videoSub);
    if (seed.aspectRatio) setAspectRatio(seed.aspectRatio);
    if (seed.resolution) setResolution(seed.resolution);
    if (seed.duration) setDuration(seed.duration);
    if (seed.count) setCount(seed.count);
    textareaRef.current?.focus();
  }, [seed?.seedAt]); // 仅在 seedAt 变化时应用

  // 切换模型导致 duration 不在 spec 内 → 自动 clamp 到合法值
  useEffect(() => {
    if (!itvDurationSpec) return;
    if (!isAllowedDurationForSpec(duration, itvDurationSpec)) {
      setDuration(clampDurationToSpec(duration, itvDurationSpec));
    }
  }, [itvDurationSpec, duration]);

  // Mentions 用 autoSize，不需要手动调整高度

  const pendingImageRefs = useMemo(() => imageRefs.filter(r => r.pending), [imageRefs]);

  // ChatPromptEditor 内部处理 @ 自动补全 + inline chip 高亮（带缩略图）

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    // 先做类型 / 大小过滤
    const valid: File[] = [];
    for (const file of files) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        message.warning(`不支持的文件类型：${file.name}`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        message.warning(`文件 ${file.name} 超过 10MB 限制`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length === 0) return;

    setIsUploading(true);
    try {
      // 并行上传：每张图独立调图床；失败的单独 toast，不阻塞其他
      await Promise.allSettled(valid.map(file => onUploadImage(file)));
    } finally {
      setIsUploading(false);
    }
  }, [onUploadImage]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    void uploadFiles(files);
    e.target.value = ''; // 允许同名文件重新选
  }, [uploadFiles]);

  const triggerFilePick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && pendingImageRefs.length === 0) return;
    if (disabled || isLoading) return;
    const hasImageInput = pendingImageRefs.length > 0 || /@图片\d+/.test(trimmed);
    const chatMediaMode = toChatMediaMode(mode, videoSubMode, hasImageInput);
    const payload: ChatMediaParams = {
      aspectRatio,
      resolution,
      duration,
      count: mode === 'image' ? count : undefined,
    };
    // 诊断：把组件实际派发的参数打到 console，便于排查"参数被吃掉"问题
    console.info('[ChatComposer] send', {
      composerMode: mode,
      videoSubMode,
      chatMediaMode,
      pendingImageCount: pendingImageRefs.length,
      pendingImageLabels: pendingImageRefs.map(r => r.label),
      payload,
    });
    onSend(trimmed, chatMediaMode, payload);
    setText('');
    textareaRef.current?.focus();
  }, [text, pendingImageRefs, disabled, isLoading, onSend, mode, videoSubMode, aspectRatio, resolution, duration, count]);

  // Enter 提交由 ChatPromptEditor 内部处理（autocomplete 打开时不会触发）

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void uploadFiles(files);
  }, [uploadFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void uploadFiles(files);
    }
  }, [uploadFiles]);

  const insertMention = useCallback((label: string) => {
    setText(prev => `${prev}${prev.endsWith(' ') || prev.length === 0 ? '' : ' '}@${label} `);
    textareaRef.current?.focus();
  }, []);

  const canSend = (text.trim() || pendingImageRefs.length > 0) && !disabled && !isLoading;

  // 模式菜单
  const modeMenuItems: MenuProps['items'] = (Object.keys(MODE_META) as ComposerMode[]).map(key => ({
    key,
    label: <span className={styles.modeMenuItem}>{MODE_META[key].icon}<span>{MODE_META[key].label}</span></span>,
  }));

  // 模型菜单按当前 mode 切换
  const { activeModelOptions, activeModelValue, onActiveModelChange, modelLabel } = useMemo(() => {
    if (mode === 'video') {
      return { activeModelOptions: itvModelOptions, activeModelValue: itvModelValue, onActiveModelChange: onItvModelChange, modelLabel: '选择视频模型' };
    }
    if (mode === 'image') {
      return { activeModelOptions: ttiModelOptions, activeModelValue: ttiModelValue, onActiveModelChange: onTtiModelChange, modelLabel: '选择生图模型' };
    }
    return { activeModelOptions: chatModelOptions, activeModelValue: chatModelValue, onActiveModelChange: onChatModelChange, modelLabel: '选择对话模型' };
  }, [mode, chatModelOptions, chatModelValue, onChatModelChange, ttiModelOptions, ttiModelValue, onTtiModelChange, itvModelOptions, itvModelValue, onItvModelChange]);

  const activeModelDisplay = activeModelOptions.find(o => o.value === activeModelValue)?.label || modelLabel;
  const modelMenuItems: MenuProps['items'] = activeModelOptions.map(opt => ({
    key: opt.value,
    label: <span className={styles.modeMenuItem}>{opt.label}</span>,
  }));

  // 比例 popover
  const ratioPopoverContent = (
    <div className={styles.ratioPopover}>
      <div className={styles.popoverSectionLabel}>选择比例</div>
      <div className={styles.ratioGrid}>
        {ASPECT_RATIO_OPTIONS.map(r => (
          <button key={r} type="button"
            className={`${styles.ratioOption} ${aspectRatio === r ? styles.ratioOptionActive : ''}`}
            onClick={() => setAspectRatio(r)}>
            <div className={styles.ratioBox} style={ratioBoxStyle(r)} />
            <span>{r}</span>
          </button>
        ))}
      </div>
      {mode === 'image' && (
        <>
          <div className={styles.popoverSectionLabel}>选择分辨率</div>
          <div className={styles.resolutionRow}>
            {IMAGE_RESOLUTION_OPTIONS.map(r => (
              <button key={r} type="button"
                className={`${styles.resolutionOption} ${resolution === r ? styles.resolutionOptionActive : ''}`}
                onClick={() => setResolution(r)}>
                {r === '2K' ? '高清 2K' : r === '4K' ? '超清 4K' : '标清 1K'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  // 时长 popover
  const durationPopoverContent = (
    <div className={styles.durationPopover}>
      <div className={styles.popoverSectionLabel}>选择视频生成时长</div>
      <div className={styles.durationList}>
        {durationButtonValues.map(d => (
          <button key={d} type="button"
            className={`${styles.durationOption} ${duration === d ? styles.durationOptionActive : ''}`}
            onClick={() => setDuration(d)}>
            <ClockCircleOutlined />
            <span>{d}s</span>
          </button>
        ))}
      </div>
    </div>
  );

  // @ popover：列出所有 imageRefs（pending + 已发送）
  const mentionPopoverContent = (
    <div className={styles.mentionPopover}>
      <div className={styles.popoverSectionLabel}>可能 @ 的内容</div>
      {imageRefs.length === 0 ? (
        <div className={styles.mentionEmpty}>还没有可引用的图片，先上传或生成一张</div>
      ) : (
        <div className={styles.mentionList}>
          {imageRefs.map(ref => (
            <button
              key={ref.id}
              type="button"
              className={styles.mentionItem}
              onClick={() => insertMention(ref.label)}
            >
              <img src={ref.source} alt={ref.label} />
              <span className={styles.mentionItemLabel}>{ref.label}</span>
              <span className={styles.mentionItemBadge}>
                {ref.origin === 'upload' ? '已上传' : '历史生成'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const showRatioChip = mode !== 'chat';
  const showDurationChip = mode === 'video';
  const showCountChip = mode === 'image';
  const showVideoSubChip = mode === 'video';

  // 当前 ITV 模型支持的子模式（按 capability 过滤）
  const availableVideoSubModes = useMemo<VideoSubMode[]>(() => {
    const caps = new Set(itvCapabilities ?? []);
    // 所有 4 个子模式都展示，让用户能自由选择。
    // 模型如果实际不支持某个 capability，由 provider 在 start() 抛错，UI 不预先过滤。
    // （之前过滤导致渠道 model.capabilities 声明不全时 multi-ref 被隐藏，看起来"多参考无效"）
    const allSubModes: VideoSubMode[] = ['text', 'image', 'first-last', 'multi-ref'];
    if (caps.size === 0) return allSubModes;
    // 渠道有声明：仅在声明的能力上加视觉标注（不过滤），保留所有选项可见
    return allSubModes;
  }, [itvCapabilities]);

  // 不再自动切换 sub-mode（之前会把用户选的 multi-ref 在某些模型下偷偷切到 image，
  // 导致以为"选了多参考但没生效"）

  return (
    <div
      ref={composerRef}
      className={`${styles.composer} ${isDragging ? styles.dragging : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className={styles.dropOverlay}>
          <PaperClipOutlined />
          <span>拖放图片到这里</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        multiple
        className={styles.fileInput}
        onChange={handleFileSelect}
      />

      {/* 输入主区：左上缩略图（所有 @ 池中的图） + 编辑器 */}
      <div className={styles.mainRow}>
        <div className={styles.thumbStack}>
          {imageRefs.map((ref) => (
            <div
              key={ref.id}
              className={`${styles.thumbItem} ${ref.pending ? styles.thumbPending : styles.thumbDimmed}`}
              onClick={(e) => {
                // 排除按钮区点击
                if ((e.target as HTMLElement).closest(`.${styles.thumbRemove}`)) return;
                onTogglePending?.(ref.id);
              }}
              title={ref.pending ? `${ref.label} · 点击取消，下次不带` : `${ref.label} · 点击选中带到下次发送`}
            >
              <img src={ref.source} alt={ref.label} />
              <span className={styles.thumbLabel}>{ref.label}</span>
              {onDeleteImageRef && (
                <button
                  type="button"
                  className={styles.thumbRemove}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteImageRef(ref.id);
                  }}
                  aria-label={`彻底删除 ${ref.label}`}
                  title="彻底删除（不可恢复）"
                >
                  <CloseOutlined />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className={styles.thumbAdd}
            onClick={triggerFilePick}
            disabled={disabled || isUploading}
            aria-label="上传图片"
            title="上传图片"
          >
            {isUploading ? <Spin size="small" /> : <PlusOutlined />}
          </button>
        </div>

        <div className={styles.editorWrap} onPaste={handlePaste}>
          <ChatPromptEditor
            ref={textareaRef}
            value={text}
            onChange={setText}
            onSubmit={handleSend}
            references={imageRefs.map(ref => ({
              id: ref.id,
              label: ref.label,
              source: ref.source,
              origin: ref.origin,
              badge: ref.pending ? '待发送' : (ref.origin === 'upload' ? '已上传' : '历史生成'),
            }))}
            placeholder={placeholder}
            disabled={disabled || isLoading}
            minRows={1}
            maxRows={maxRows}
          />
        </div>
      </div>

      {/* 底部控件栏 */}
      <div className={styles.controlsRow}>
        <Dropdown
          menu={{ items: modeMenuItems, onClick: ({ key }) => setMode(key as ComposerMode), selectedKeys: [mode] }}
          trigger={['click']}
          placement="topLeft"
        >
          <button type="button" className={`${styles.chip} ${styles.chipPrimary}`}>
            {MODE_META[mode].icon}
            <span>{MODE_META[mode].label}</span>
            <DownOutlined className={styles.chipCaret} />
          </button>
        </Dropdown>

        <Dropdown
          menu={{
            items: modelMenuItems,
            onClick: ({ key }) => onActiveModelChange?.(key as string),
            selectedKeys: activeModelValue ? [activeModelValue] : [],
          }}
          trigger={['click']}
          placement="topLeft"
          disabled={!onActiveModelChange || activeModelOptions.length === 0}
        >
          <button
            type="button"
            className={styles.chip}
            disabled={!onActiveModelChange || activeModelOptions.length === 0}
          >
            <span className={styles.chipModelLabel}>{activeModelDisplay}</span>
            <DownOutlined className={styles.chipCaret} />
          </button>
        </Dropdown>

        {showRatioChip && (
          <Popover content={ratioPopoverContent} trigger="click" placement="topLeft" arrow={false}>
            <button type="button" className={styles.chip}>
              <ColumnHeightOutlined className={styles.chipIconRotated} />
              <span>{aspectRatio}</span>
              {mode === 'image' && (
                <>
                  <span className={styles.chipDivider}>|</span>
                  <span>{resolution === '2K' ? '高清 2K' : resolution === '4K' ? '超清 4K' : '1K'}</span>
                </>
              )}
            </button>
          </Popover>
        )}

        {showVideoSubChip && (
          <Dropdown
            menu={{
              items: availableVideoSubModes.map(sub => ({
                key: sub,
                label: <span className={styles.modeMenuItem}>{VIDEO_SUB_META[sub].label}</span>,
              })),
              onClick: ({ key }) => setVideoSubMode(key as VideoSubMode),
              selectedKeys: [videoSubMode],
            }}
            trigger={['click']}
            placement="topLeft"
          >
            <button type="button" className={styles.chip}>
              <span>{VIDEO_SUB_META[videoSubMode].label}</span>
              <DownOutlined className={styles.chipCaret} />
            </button>
          </Dropdown>
        )}

        {showDurationChip && (
          <Popover content={durationPopoverContent} trigger="click" placement="topLeft" arrow={false}>
            <button type="button" className={styles.chip}>
              <ClockCircleOutlined />
              <span>{duration}s</span>
            </button>
          </Popover>
        )}

        {showCountChip && (
          <Popover
            content={
              <div className={styles.countPopover}>
                <div className={styles.popoverSectionLabel}>生成数量</div>
                <div className={styles.countGrid}>
                  {IMAGE_COUNT_OPTIONS.map(n => (
                    <button
                      key={n}
                      type="button"
                      className={`${styles.countOption} ${count === n ? styles.countOptionActive : ''}`}
                      onClick={() => setCount(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            }
            trigger="click"
            placement="topLeft"
            arrow={false}
          >
            <button type="button" className={styles.chip}>
              <span>×{count}</span>
            </button>
          </Popover>
        )}

        <Popover content={mentionPopoverContent} trigger="click" placement="topLeft" arrow={false}>
          <Tooltip title="引用已上传/历史生成的图">
            <button type="button" className={styles.chipIcon} disabled={disabled}>
              <span className={styles.mentionGlyph}>@</span>
            </button>
          </Tooltip>
        </Popover>

        <div className={styles.controlsSpacer} />

        {isStreaming ? (
          <Tooltip title="停止生成">
            <Button type="primary" danger shape="circle" icon={<StopOutlined />} onClick={onStop} className={styles.sendButton} />
          </Tooltip>
        ) : (
          <Tooltip title="发送 (Enter)">
            <Button
              type="primary"
              shape="circle"
              icon={<SendOutlined />}
              onClick={handleSend}
              disabled={!canSend}
              loading={isLoading}
              className={styles.sendButton}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
};

function ratioBoxStyle(ratio: string) {
  const [w, h] = ratio.split(':').map(Number);
  if (!w || !h) return {};
  const max = 18;
  if (w >= h) {
    return cssVars({
      '--ratio-box-width': `${max}px`,
      '--ratio-box-height': `${(max * h) / w}px`,
    });
  }
  return cssVars({
    '--ratio-box-width': `${(max * w) / h}px`,
    '--ratio-box-height': `${max}px`,
  });
}

export default ChatComposer;
