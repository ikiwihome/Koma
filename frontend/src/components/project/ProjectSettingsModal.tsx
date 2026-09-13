/**
 * 项目设置侧边栏
 * 整合项目基本信息（项目名 / 题材 / 画面比例 / 风格）+ 媒体模型配置（LLM/TTI/ITV/TTS）
 * 通过抽屉形式从右侧滑出，作为项目工作台的统一配置入口
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer, Form, Input, Tabs, Select, Button, Space, Checkbox, Tooltip,
  Upload, Spin, Typography, Popconfirm, App as AntApp, Image as AntImage,
  Slider,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { UploadOutlined, EyeOutlined, ReloadOutlined, PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import {
  KOMA_TTS_VOICES,
  KOMA_TTS_VOICE_CATEGORY_LABEL,
  type KomaTTSVoiceMeta,
} from '../../providers/tts';
import { getKomaTTSVoiceSampleUrl } from '../../services/komaTTSVoiceSamples';
import type { MediaModelSelection, Project, ProjectStyleSnapshot, StoredMediaAsset } from '../../types';
import { ProjectMediaSelector } from './ProjectMediaSelector';
import type { ProjectMediaCategoryKey, ProjectMediaRequirement } from './projectMediaSelectionState';
import {
  DEFAULT_THEME_PRESET_ID,
  createProjectStyleSnapshot,
  getAllThemePresets,
  type ThemePresetCatalogItem,
} from '../../config/themePresets';
import { VIDEO_TEMPLATE_BUCKETS } from '../../services/ShotPromptService';
import {
  isAllowedDurationForSpec,
  type VideoDurationSpec,
} from '../../providers/itv/durationSpec';
import { ipc, ipcApiRoute } from '../../utils/ipcRenderer';
import { toKomaLocalUrl } from '../../utils/urlUtils';
import styles from './ProjectSettingsModal.module.scss';

// 项目级风格参考图上传：与全局栅格图同列表（svg 不能图生图）
const SUPPORTED_PROJECT_STYLE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const PROJECT_STYLE_ACCEPT = '.png,.jpg,.jpeg,.webp';

function readFileAsBase64Pair(file: File): Promise<{ base64: string; ext: string }> {
  return new Promise((resolve, reject) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!SUPPORTED_PROJECT_STYLE_EXTS.has(ext)) {
      reject(new Error(`不支持的图片格式: .${ext}（仅 png/jpg/webp）`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      const base64 = idx >= 0 ? result.slice(idx + 1) : result;
      resolve({ base64, ext: ext === 'jpeg' ? 'jpg' : ext });
    };
    reader.readAsDataURL(file);
  });
}

interface ProjectStyleReferenceSlotProps {
  /** 当前项目级覆盖图（来自 styleSnapshot.styleReferenceImage），优先级最高 */
  override?: StoredMediaAsset;
  /** 项目当前生效的预设默认图（项目无覆盖时显示这张做对照） */
  presetFallbackUrl?: string;
  busy: boolean;
  onUpload: (file: File) => Promise<void> | void;
  onClear: () => Promise<void> | void;
}

const ProjectStyleReferenceSlot: React.FC<ProjectStyleReferenceSlotProps> = ({
  override,
  presetFallbackUrl,
  busy,
  onUpload,
  onClear,
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);

  const beforeUpload = useCallback((file: UploadFile) => {
    void onUpload(file as unknown as File);
    return false; // 阻止 antd 自动 POST
  }, [onUpload]);

  const overrideUrl = override?.localPath
    ? toKomaLocalUrl(override.localPath)
    : (override?.remoteUrl || undefined);
  const displayUrl = overrideUrl || presetFallbackUrl;
  const hasOverride = Boolean(overrideUrl);

  return (
    <div className={styles.styleReferenceRoot}>
      <div
        className={`${styles.styleReferenceFrame} ${
          hasOverride ? styles.styleReferenceFrameOverride : styles.styleReferenceFrameFallback
        }`}
      >
        {busy ? (
          <Spin size="small" />
        ) : displayUrl ? (
          <img
            src={displayUrl}
            alt="项目风格参考图"
            className={styles.styleReferenceImage}
            draggable={false}
          />
        ) : (
          <Typography.Text type="secondary" className={styles.styleReferenceEmpty}>
            未设置项目风格图（将沿用所选风格预设的默认图）
          </Typography.Text>
        )}

        <Space size={6} className={styles.styleReferenceActions}>
          <Tooltip title={hasOverride ? '替换项目风格参考图' : '上传项目风格参考图'}>
            <Upload
              beforeUpload={beforeUpload}
              showUploadList={false}
              accept={PROJECT_STYLE_ACCEPT}
            >
              <Button
                size="small"
                shape="circle"
                icon={<UploadOutlined />}
                className={styles.overlayButton}
              />
            </Upload>
          </Tooltip>
          <Tooltip title="预览放大">
            <Button
              size="small"
              shape="circle"
              icon={<EyeOutlined />}
              disabled={!displayUrl}
              onClick={(e) => {
                e.stopPropagation();
                if (displayUrl) setPreviewVisible(true);
              }}
              className={`${styles.overlayButton} ${!displayUrl ? styles.overlayButtonDisabled : ''}`}
            />
          </Tooltip>
        </Space>

        {hasOverride && (
          <Tooltip title="清除项目风格图，回退到预设默认图">
            <Popconfirm
              title="清除项目级风格参考图？"
              description="清除后将沿用项目所选风格预设的默认图。"
              onConfirm={() => onClear()}
              okText="清除"
              cancelText="取消"
            >
              <Button
                size="small"
                shape="circle"
                icon={<ReloadOutlined />}
                className={`${styles.overlayButton} ${styles.styleReferenceRestore}`}
              />
            </Popconfirm>
          </Tooltip>
        )}
      </div>

      {displayUrl && (
        <AntImage
          src={displayUrl}
          alt="项目风格参考图预览"
          className={styles.hiddenImage}
          preview={{
            visible: previewVisible,
            src: displayUrl,
            onVisibleChange: setPreviewVisible,
          }}
        />
      )}

      <Typography.Text type="secondary" className={styles.styleReferenceHint}>
        项目级风格图优先级最高，仅本项目生效；未上传时使用所选风格预设的默认图。
      </Typography.Text>
    </div>
  );
};

interface ProjectSettingsModalProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  onSave: (updates: Partial<Project>) => void;
  onGoToGlobalSettings?: () => void;
  /**
   * 当前项目选择的 ITV 渠道时长规格（如 grok enum 6/10/12/16/20、即梦 range 4-15）。
   * 用于在"提示词模板"档位 checkbox 上把不在 spec 范围内的档位标灰 + 提示。
   * 不传则不灰显（视为不限制）。
   */
  itvDurationSpec?: VideoDurationSpec;
}

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  project,
  open,
  onClose,
  onSave,
  onGoToGlobalSettings,
  itvDurationSpec,
}) => {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('basic');
  const [mediaSelections, setMediaSelections] = useState<
    Partial<Record<'llm' | 'tti' | 'itv' | 'tts', MediaModelSelection>>
  >({});
  const [themePresets, setThemePresets] = useState<ThemePresetCatalogItem[]>([]);
  // 项目级风格参考图：本地态用 StoredMediaAsset 表达，保存时塞回 styleSnapshot.styleReferenceImage
  const [projectStyleImage, setProjectStyleImage] = useState<StoredMediaAsset | undefined>(undefined);
  const [projectStyleBusy, setProjectStyleBusy] = useState(false);
  // 当前所选风格预设的默认图（用于无覆盖时显示对照），随 stylePresetId 切换时重新解析
  const [presetFallbackUrl, setPresetFallbackUrl] = useState<string | undefined>(undefined);
  // 触发"重新解析预设默认图"，依赖 form 里 stylePresetId 的当前值
  const [presetFallbackTick, setPresetFallbackTick] = useState(0);

  // 视频提示词档位勾选：默认全选；nullable 表示"未配置"（保存时也按全选写回）
  const [multiRefSelections, setMultiRefSelections] = useState<number[]>(
    VIDEO_TEMPLATE_BUCKETS['multi-ref'].map((b) => b.duration),
  );
  const [firstFrameSelections, setFirstFrameSelections] = useState<number[]>(
    VIDEO_TEMPLATE_BUCKETS['first-frame'].map((b) => b.duration),
  );
  // TTS 项目级偏好（音色 + 语速）。默认 cherry / 1.2 倍速。
  const [ttsVoiceId, setTtsVoiceId] = useState<string>('cherry');
  const [ttsSpeed, setTtsSpeed] = useState<number>(1.2);
  const mediaRequirements: Partial<Record<ProjectMediaCategoryKey, ProjectMediaRequirement>> = {
    itv: {
      description: '项目视频链路会按文生视频、图生视频、参考生视频、首尾帧视频等实际能力继续校验；这里用于设置项目默认视频模型。',
    },
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const loadThemePresets = async () => {
      const presets = await getAllThemePresets();
      if (!cancelled) {
        setThemePresets(presets);
      }
    };

    loadThemePresets();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (project && open) {
      form.setFieldsValue({
        title: project.title,
        genre: project.genre,
        stylePresetId: project.stylePresetId || project.styleSnapshot?.sourcePresetId || DEFAULT_THEME_PRESET_ID,
      });
      setMediaSelections(project.mediaSelections || {});
      setProjectStyleImage(project.styleSnapshot?.styleReferenceImage);
      // 触发预设默认图解析
      setPresetFallbackTick(t => t + 1);
      // 视频提示词档位：取项目已配置；缺省 = 全选
      const cfg = (project as { videoPromptDurationSelections?: { multiRef?: number[]; firstFrame?: number[] } })
        .videoPromptDurationSelections;
      setMultiRefSelections(
        cfg?.multiRef && cfg.multiRef.length > 0
          ? cfg.multiRef
          : VIDEO_TEMPLATE_BUCKETS['multi-ref'].map((b) => b.duration),
      );
      setFirstFrameSelections(
        cfg?.firstFrame && cfg.firstFrame.length > 0
          ? cfg.firstFrame
          : VIDEO_TEMPLATE_BUCKETS['first-frame'].map((b) => b.duration),
      );
      // TTS 偏好：项目里有就用项目里的；缺省 cherry + 1.2 倍速
      setTtsVoiceId(typeof project.ttsVoiceId === 'string' && project.ttsVoiceId.trim()
        ? project.ttsVoiceId.trim()
        : 'cherry');
      setTtsSpeed(typeof project.ttsSpeed === 'number' && Number.isFinite(project.ttsSpeed)
        ? project.ttsSpeed
        : 1.2);
    }
  }, [project, open, form]);

  // 当 stylePresetId 切换或抽屉重开时，向主进程问"该 preset 当前生效的图是哪张"，
  // 用作"未上传项目级覆盖时"的对照预览。
  useEffect(() => {
    if (!open) return;
    const stylePresetId = form.getFieldValue('stylePresetId') as string | undefined;
    if (!stylePresetId) {
      setPresetFallbackUrl(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      const preset = themePresets.find(p => p.id === stylePresetId);
      const fallbackFilename = preset?.defaultStyleReferenceFile;
      try {
        const resp = await ipc.invoke(
          ipcApiRoute.app.getActiveStyleReferenceImagePath,
          { presetId: stylePresetId, fallbackFilename },
        ) as { localPath: string | null } | null;
        if (!cancelled) {
          setPresetFallbackUrl(resp?.localPath ? toKomaLocalUrl(resp.localPath) : undefined);
        }
      } catch {
        if (!cancelled) setPresetFallbackUrl(undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [open, themePresets, presetFallbackTick, form]);

  const handleProjectStyleUpload = useCallback(async (file: File) => {
    if (!project) return;
    setProjectStyleBusy(true);
    try {
      const { base64, ext } = await readFileAsBase64Pair(file);
      const resp = await ipc.invoke(ipcApiRoute.app.saveProjectStyleReferenceImage, {
        projectId: project.id,
        dataBase64: base64,
        ext,
      }) as { localPath: string; mtimeMs: number };
      const asset: StoredMediaAsset = {
        kind: 'image',
        localPath: resp.localPath,
        createdAt: resp.mtimeMs || Date.now(),
        metadata: { source: 'project-style-reference' },
      };
      setProjectStyleImage(asset);
      message.success('项目风格参考图已更新（保存项目设置后生效）');
    } catch (err: any) {
      message.error(`上传失败: ${err?.message || err}`);
    } finally {
      setProjectStyleBusy(false);
    }
  }, [message, project]);

  const handleProjectStyleClear = useCallback(async () => {
    if (!project) return;
    setProjectStyleBusy(true);
    try {
      await ipc.invoke(ipcApiRoute.app.clearProjectStyleReferenceImage, {
        projectId: project.id,
      });
      setProjectStyleImage(undefined);
      message.success('已清除项目风格图，回退到预设默认（保存项目设置后生效）');
    } catch (err: any) {
      message.error(`清除失败: ${err?.message || err}`);
    } finally {
      setProjectStyleBusy(false);
    }
  }, [message, project]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const stylePresetId = values.stylePresetId || DEFAULT_THEME_PRESET_ID;
      const baseSnapshot = await createProjectStyleSnapshot(stylePresetId);
      const styleSnapshot: ProjectStyleSnapshot = projectStyleImage
        ? { ...baseSnapshot, styleReferenceImage: projectStyleImage }
        : baseSnapshot;
      onSave({
        title: values.title,
        genre: values.genre,
        stylePresetId,
        styleSnapshot,
        theme: undefined,
        stylePrompt: undefined,
        mediaSelections,
        videoPromptDurationSelections: {
          multiRef: multiRefSelections,
          firstFrame: firstFrameSelections,
        },
        ttsVoiceId,
        ttsSpeed,
      } as Partial<Project>);
      onClose();
    } catch {
      // 验证失败
    }
  };

  const tabItems = [
    {
      key: 'basic',
      label: '基本信息',
      children: (
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label="项目名称"
            required
            rules={[{ required: true, message: '请输入项目名称' }]}
          >
            <Input placeholder="请输入项目名称" />
          </Form.Item>

          <Form.Item name="genre" label="题材类型">
            <Input placeholder="如: 悬疑、爱情、科幻" />
          </Form.Item>

          <Form.Item label="画面比例">
            <Input
              value={project?.aspectRatio === '9:16' ? '9:16 竖屏' : '16:9 横屏'}
              disabled
              className={styles.disabledInput}
            />
          </Form.Item>

          <Form.Item
            name="stylePresetId"
            label="项目风格"
            rules={[{ required: true, message: '请选择项目风格' }]}
            extra="风格来源统一使用全局风格目录；如果要新增或编辑自定义风格，请前往全局设置。"
          >
            <Select
              placeholder="请选择项目风格"
              options={themePresets.map((preset) => ({
                value: preset.id,
                label: preset.name,
              }))}
              onChange={() => setPresetFallbackTick(t => t + 1)}
            />
          </Form.Item>

          <Form.Item label="项目风格参考图">
            <ProjectStyleReferenceSlot
              override={projectStyleImage}
              presetFallbackUrl={presetFallbackUrl}
              busy={projectStyleBusy}
              onUpload={handleProjectStyleUpload}
              onClear={handleProjectStyleClear}
            />
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'media',
      label: '媒体配置',
      children: (
        <>
          <div className={styles.tabIntro}>
            选择此项目使用的媒体生成服务，留空则使用全局默认配置。
          </div>
          <ProjectMediaSelector
            mediaSelections={mediaSelections}
            onChange={setMediaSelections}
            onGoToSettings={onGoToGlobalSettings}
            requirements={mediaRequirements}
          />
        </>
      ),
    },
    {
      key: 'video-prompt',
      label: '视频提示词',
      children: (
        <VideoPromptSelectionTab
          multiRefSelections={multiRefSelections}
          firstFrameSelections={firstFrameSelections}
          onMultiRefChange={setMultiRefSelections}
          onFirstFrameChange={setFirstFrameSelections}
          itvDurationSpec={itvDurationSpec}
        />
      ),
    },
    {
      key: 'tts',
      label: '配音',
      children: (
        <TTSPreferenceTab
          voiceId={ttsVoiceId}
          speed={ttsSpeed}
          onVoiceChange={setTtsVoiceId}
          onSpeedChange={setTtsSpeed}
        />
      ),
    },
  ];

  return (
    <Drawer
      title="项目设置"
      open={open}
      onClose={onClose}
      size={520}
      destroyOnHidden
      placement="right"
      mask={{ closable: false }}
      footer={
        <div className={styles.drawerFooter}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleSave}>保存</Button>
          </Space>
        </div>
      }
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />
    </Drawer>
  );
};

// ================================================================
// 视频提示词档位选择 Tab
// ================================================================

/* ========== TTS 偏好 Tab ========== */

interface TTSPreferenceTabProps {
  voiceId: string;
  speed: number;
  onVoiceChange: (id: string) => void;
  onSpeedChange: (speed: number) => void;
}

/** 按 category 分组生成 Select options（带分组标题） */
function buildVoiceGroups(): Array<{ label: string; options: Array<{ value: string; label: string; meta: KomaTTSVoiceMeta }> }> {
  const groups = new Map<string, KomaTTSVoiceMeta[]>();
  KOMA_TTS_VOICES.forEach((v) => {
    const arr = groups.get(v.category) || [];
    arr.push(v);
    groups.set(v.category, arr);
  });
  // 顺序固定：通用 → 多语种 → 精品 → 方言
  const order: KomaTTSVoiceMeta['category'][] = ['common', 'multilang', 'premium', 'dialect'];
  return order
    .filter((cat) => groups.has(cat))
    .map((cat) => ({
      label: KOMA_TTS_VOICE_CATEGORY_LABEL[cat],
      options: (groups.get(cat) || []).map((v) => ({
        value: v.id,
        label: v.name,
        meta: v,
      })),
    }));
}

const TTSPreferenceTab: React.FC<TTSPreferenceTabProps> = ({ voiceId, speed, onVoiceChange, onSpeedChange }) => {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string>('');
  /** 等待 onCanPlay 触发后真正开始播放的目标 voice id —— 修"切音色后第一次点击不响"的核心。 */
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null);
  const groups = React.useMemo(() => buildVoiceGroups(), []);

  const stopPreview = useCallback(() => {
    const el = audioRef.current;
    if (el) { el.pause(); el.currentTime = 0; }
    setPreviewingId(null);
    setPendingPlayId(null);
  }, []);

  // 卸载组件 → 立刻停掉（试听独立于 voiceId 选择，不再因切音色而 stop）
  useEffect(() => () => stopPreview(), [stopPreview]);

  /** 试听：解析 url → 写 state → audio canplay 后自动播放。
      之前用 rAF + 立刻 play() 的方案：第一次点（src 从空切到 url）时 audio 还在加载，
      play() 实际拿不到数据；第二次点时 audio 已 buffered，play() 立即工作 → 表现为"双击才响"。
      改成 onCanPlay 触发：src 加载就绪 → 同步 play()。 */
  const handlePreview = useCallback(async (sampleFile: string, id: string) => {
    if (previewingId === id) { stopPreview(); return; }
    const url = await getKomaTTSVoiceSampleUrl(sampleFile);
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn('[TTSPreview] 无法解析音色样本路径', { sampleFile, id });
      return;
    }
    // 切换试听对象：标记 pending → 写新 src → audio 重新 load → onCanPlay 里 play
    setPendingPlayId(id);
    if (url === previewSrc) {
      // 同一 src 不会触发 onCanPlay（已在 buffer 里），手动 play
      const el = audioRef.current;
      if (el) {
        el.currentTime = 0;
        el.play()
          .then(() => setPreviewingId(id))
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('[TTSPreview] play() 失败', err);
            setPreviewingId(null);
          })
          .finally(() => setPendingPlayId(null));
      }
    } else {
      setPreviewSrc(url);
    }
  }, [previewingId, previewSrc, stopPreview]);

  /** audio 元素发出 canplay：检查 pendingPlayId 是不是给我们的播放任务。 */
  const handleAudioCanPlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !pendingPlayId) return;
    const targetId = pendingPlayId;
    el.currentTime = 0;
    el.play()
      .then(() => setPreviewingId(targetId))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[TTSPreview] canplay 后 play() 失败', err);
        setPreviewingId(null);
      })
      .finally(() => setPendingPlayId(null));
  }, [pendingPlayId]);

  /** 单条 voice option 渲染：左边名字（搜索匹配的），右边▶ / ⏸。
      onMouseDown stopPropagation —— antd Select 用 mousedown 触发选中，
      没拦住的话点试听会同时被识别成"选中这个 voice"。 */
  const renderOption = useCallback((meta: KomaTTSVoiceMeta) => {
    const isThisPlaying = previewingId === meta.id;
    return (
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="truncate flex-1 min-w-0">{meta.name}</span>
        <Button
          type="text"
          size="small"
          icon={isThisPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handlePreview(meta.sampleFile, meta.id);
          }}
        />
      </div>
    );
  }, [previewingId, handlePreview]);

  return (
    <div className={styles.tabIntro ? styles.tabIntro : ''}>
      <Form layout="vertical">
        <Form.Item label="默认配音音色" extra="生成分镜配音时使用的默认音色；下拉里每条右侧 ▶ 可独立试听">
          <Select
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            value={voiceId}
            onChange={onVoiceChange}
            placeholder="请选择音色"
            options={groups.map((g) => ({
              label: g.label,
              title: g.label,
              options: g.options.map((o) => ({
                value: o.value,
                label: o.label,        // 仍提供文字 label 给搜索 / 收起态显示
                voiceMeta: o.meta,
              })),
            }))}
            optionRender={(option) => {
              const meta = (option.data as { voiceMeta?: KomaTTSVoiceMeta }).voiceMeta;
              return meta ? renderOption(meta) : <span>{option.label}</span>;
            }}
          />
        </Form.Item>

        <Form.Item label={`语速倍数：${speed.toFixed(2)}x`} extra="OpenAI 兼容 speed 字段，建议 0.5-2.0；新项目默认 1.2x">
          <Slider
            min={0.5}
            max={2}
            step={0.05}
            value={speed}
            onChange={onSpeedChange}
            marks={{ 0.5: '0.5x', 1: '1x', 1.2: '1.2x', 1.5: '1.5x', 2: '2x' }}
          />
        </Form.Item>

        <div style={{ fontSize: 12, color: 'var(--token-text-secondary)' }}>
          内置 {KOMA_TTS_VOICES.length} 种音色（通用 / 多语种 / 精品角色 / 中文方言），点选后右侧 ▶ 可试听样本。
        </div>

        {/* in-DOM <audio> — 用 React state 同步 src，避免 new Audio() 在 Electron koma-local 下
            "src 设置后 play() 拿不到数据" 的时序问题。preload="auto" 让 src 一变就开始拉流。
            onCanPlay 是关键：data 准备好后由我们驱动 play()，避免"切音色后必须双击"。 */}
        <audio
          ref={audioRef}
          src={previewSrc || undefined}
          preload="auto"
          onCanPlay={handleAudioCanPlay}
          onEnded={() => setPreviewingId(null)}
          onError={() => { setPreviewingId(null); setPendingPlayId(null); }}
          style={{ display: 'none' }}
        />
      </Form>
    </div>
  );
};

interface VideoPromptSelectionTabProps {
  multiRefSelections: number[];
  firstFrameSelections: number[];
  onMultiRefChange: (next: number[]) => void;
  onFirstFrameChange: (next: number[]) => void;
  itvDurationSpec?: VideoDurationSpec;
}

const VideoPromptSelectionTab: React.FC<VideoPromptSelectionTabProps> = ({
  multiRefSelections,
  firstFrameSelections,
  onMultiRefChange,
  onFirstFrameChange,
  itvDurationSpec,
}) => {
  const renderMode = (
    label: string,
    description: string,
    bucket: ReadonlyArray<{ duration: number; key: string }>,
    selected: number[],
    onChange: (next: number[]) => void,
  ) => {
    const toggle = (duration: number, checked: boolean) => {
      const set = new Set(selected);
      if (checked) set.add(duration);
      else set.delete(duration);
      // 全空时回退到全选，避免运行时落空
      const next = Array.from(set).sort((a, b) => a - b);
      onChange(next.length > 0 ? next : bucket.map((b) => b.duration));
    };
    return (
      <div className={styles.modeBlock}>
        <div className={styles.modeTitle}>{label}</div>
        <div className={styles.modeDescription}>{description}</div>
        <Space wrap>
          {bucket.map(({ duration }) => {
            const isSelected = selected.includes(duration);
            const inSpec = itvDurationSpec ? isAllowedDurationForSpec(duration, itvDurationSpec) : true;
            const checkbox = (
              <Checkbox
                checked={isSelected}
                onChange={(e) => toggle(duration, e.target.checked)}
                className={inSpec ? undefined : styles.disabledDuration}
              >
                {duration}s
              </Checkbox>
            );
            if (!inSpec) {
              return (
                <Tooltip
                  key={duration}
                  title="当前 ITV 渠道的时长规格不包含该档位；选中后该档位仍会用于推理，但实际镜头时长可能被模型规范化"
                >
                  {checkbox}
                </Tooltip>
              );
            }
            return <span key={duration}>{checkbox}</span>;
          })}
        </Space>
      </div>
    );
  };

  return (
    <>
      <div className={styles.tabIntro}>
        勾选每种模式启用的时长档位（默认全选）。运行时按分镜时长在勾选档位中找<strong>最近</strong>的档位匹配模板，
        不要求严格相等。<strong>清空所有勾选会自动回退到全选</strong>避免落空。
      </div>
      {renderMode(
        '参考模式（multi-ref）',
        '使用 @角色 / @场景 / @道具 映射，适合需要多张参考图的分镜。模板池：6 / 10 / 15 / 20s。',
        VIDEO_TEMPLATE_BUCKETS['multi-ref'],
        multiRefSelections,
        onMultiRefChange,
      )}
      {renderMode(
        '首帧延展模式（first-frame）',
        '以单图为锚做微动延展，适合不需要多图引导的稳态镜头。模板池：6 / 10 / 16 / 20s。',
        VIDEO_TEMPLATE_BUCKETS['first-frame'],
        firstFrameSelections,
        onFirstFrameChange,
      )}
    </>
  );
};
