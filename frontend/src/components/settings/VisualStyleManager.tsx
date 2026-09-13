/**
 * 视觉风格管理组件
 * 管理用户自定义视觉风格预设
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Modal,
  Form,
  Input,
  Space,
  Tag,
  Tooltip,
  Empty,
  Popconfirm,
  Spin,
  App,
  Typography,
  Upload,
  Image as AntImage,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  BgColorsOutlined,
  EyeOutlined,
  UploadOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ThemePreset } from '../../types';
import {
  getCustomThemePresets,
  addCustomThemePreset,
  updateCustomThemePreset,
  deleteCustomThemePreset,
} from '../../store/globalStore';
import { THEME_PRESETS } from '../../config/themePresets';
import { ipc, ipcApiRoute } from '../../utils/ipcRenderer';
import { toKomaLocalUrl } from '../../utils/urlUtils';
import styles from './VisualStyleManager.module.scss';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

interface VisualStyleManagerProps {
  onStyleChange?: () => void;
}

// 仅支持栅格图。SVG 不能作为图生图的参考输入，前端就拦掉。
const SUPPORTED_STYLE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const STYLE_IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp';

interface ResolvedStyleImage {
  url: string;     // koma-local:// 形式，可直接喂给 <img>
  mtimeMs: number; // 用于缓存破坏
}

function readFileAsBase64(file: File): Promise<{ base64: string; ext: string }> {
  return new Promise((resolve, reject) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!SUPPORTED_STYLE_IMAGE_EXTS.has(ext)) {
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

interface StyleReferenceImageSlotProps {
  preset: ThemePreset;
  resolved: ResolvedStyleImage | null;
  loading: boolean;
  onUpload: (presetId: string, file: File) => Promise<void> | void;
  onClear: (presetId: string) => Promise<void> | void;
  hasUserOverride: boolean;
}

const StyleReferenceImageSlot: React.FC<StyleReferenceImageSlotProps> = ({
  preset,
  resolved,
  loading,
  onUpload,
  onClear,
  hasUserOverride,
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);

  const beforeUpload = useCallback((file: UploadFile) => {
    // antd 类型把 originFileObj 标 optional，这里 file 本身就是浏览器 File 实例
    const native = file as unknown as File;
    void onUpload(preset.id, native);
    return false; // 阻止 antd 自动 POST
  }, [onUpload, preset.id]);

  return (
    <div className={`settings-style-image-slot ${styles.styleImageSlot}`}>
      <div className={styles.imageFrame}>
        {loading ? (
          <Spin size="small" />
        ) : resolved ? (
          <img
            src={resolved.url}
            alt={`${preset.name} 风格参考图`}
            className={styles.image}
            draggable={false}
          />
        ) : (
          <Typography.Text type="secondary" className={styles.emptyText}>
            未设置风格参考图
          </Typography.Text>
        )}

        {/* 操作按钮：上传 + 预览放大；都覆盖在参考图区域内 */}
        <Space
          size={6}
          className={styles.overlayActions}
        >
          <Tooltip title={resolved ? '替换风格参考图' : '上传风格参考图'}>
            <Upload
              beforeUpload={beforeUpload}
              showUploadList={false}
              accept={STYLE_IMAGE_ACCEPT}
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
              disabled={!resolved}
              onClick={(e) => {
                e.stopPropagation();
                if (resolved) setPreviewVisible(true);
              }}
              className={`${styles.overlayButton} ${!resolved ? styles.overlayButtonDisabled : ''}`}
            />
          </Tooltip>
        </Space>

        {/* 用户覆盖时在左上角放一个轻量的"还原"入口；无覆盖时不展示，避免 UI 噪声。 */}
        {hasUserOverride && (
          <Tooltip title="还原为内置默认图">
            <Popconfirm
              title="还原为该风格的内置默认图？"
              onConfirm={() => onClear(preset.id)}
              okText="还原"
              cancelText="取消"
            >
              <Button
                size="small"
                shape="circle"
                icon={<ReloadOutlined />}
                className={`${styles.overlayButton} ${styles.restoreButton}`}
              />
            </Popconfirm>
          </Tooltip>
        )}
      </div>

      {/* 用 antd Image 的受控预览能力，渲染成 0×0 隐藏元素，由"预览放大"按钮触发显示。 */}
      {resolved && (
        <AntImage
          src={resolved.url}
          alt={`${preset.name} 风格参考图`}
          className={styles.hiddenImage}
          preview={{
            visible: previewVisible,
            src: resolved.url,
            onVisibleChange: setPreviewVisible,
          }}
        />
      )}
    </div>
  );
};

export const VisualStyleManager: React.FC<VisualStyleManagerProps> = ({ onStyleChange }) => {
  const { message } = App.useApp();
  const [customPresets, setCustomPresets] = useState<ThemePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ThemePreset | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewPreset, setPreviewPreset] = useState<ThemePreset | null>(null);
  const [form] = Form.useForm();
  // 每个 preset 的当前生效风格图（用户上传 > 内置默认）。key=presetId
  const [styleImages, setStyleImages] = useState<Record<string, ResolvedStyleImage | null>>({});
  const [styleImageLoading, setStyleImageLoading] = useState<Record<string, boolean>>({});
  // 标记某 preset 是否走了用户覆盖（决定要不要展示"还原"按钮）。
  const [styleImageHasOverride, setStyleImageHasOverride] = useState<Record<string, boolean>>({});

  const loadPresets = async () => {
    setLoading(true);
    try {
      const presets = await getCustomThemePresets();
      setCustomPresets(presets);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPresets();
  }, []);

  // ====== 每个 preset 的生效风格图：拉取 + 上传 + 还原 ======

  const refreshStyleImage = useCallback(async (preset: ThemePreset) => {
    setStyleImageLoading(prev => ({ ...prev, [preset.id]: true }));
    try {
      const resp = await ipc.invoke(
        ipcApiRoute.app.getActiveStyleReferenceImagePath,
        { presetId: preset.id, fallbackFilename: preset.defaultStyleReferenceFile },
      ) as { localPath: string | null; mtimeMs?: number } | null;

      if (!resp?.localPath) {
        setStyleImages(prev => ({ ...prev, [preset.id]: null }));
        setStyleImageHasOverride(prev => ({ ...prev, [preset.id]: false }));
        return;
      }
      const mtimeMs = resp.mtimeMs ?? 0;
      // koma-local:// 不支持 query string；用 mtime 触发组件 key 变化即可破缓存
      const url = toKomaLocalUrl(resp.localPath);
      setStyleImages(prev => ({ ...prev, [preset.id]: { url, mtimeMs } }));

      // 是否是用户覆盖：文件名以 `-user.` 结尾
      const isOverride = /\/[^/]+-user\.[^./\\]+$/.test(resp.localPath);
      setStyleImageHasOverride(prev => ({ ...prev, [preset.id]: isOverride }));
    } catch (err: any) {
      // 主进程未实现等场景下静默回退（电池模式 / 早期版本）
      // eslint-disable-next-line no-console
      console.warn('[VisualStyleManager] refreshStyleImage failed', preset.id, err?.message);
      setStyleImages(prev => ({ ...prev, [preset.id]: null }));
      setStyleImageHasOverride(prev => ({ ...prev, [preset.id]: false }));
    } finally {
      setStyleImageLoading(prev => ({ ...prev, [preset.id]: false }));
    }
  }, []);

  const allPresetsForImageState = React.useMemo(() => {
    const builtins = THEME_PRESETS.filter(t => t.id !== 'custom');
    return [...builtins, ...customPresets];
  }, [customPresets]);

  useEffect(() => {
    // 每当列表变化（首次加载 / 自定义预设 CRUD），刷新所有缩略图
    allPresetsForImageState.forEach(preset => {
      void refreshStyleImage(preset);
    });
  }, [allPresetsForImageState, refreshStyleImage]);

  const handleUploadStyleImage = useCallback(async (presetId: string, file: File) => {
    const preset = allPresetsForImageState.find(p => p.id === presetId);
    if (!preset) return;
    try {
      const { base64, ext } = await readFileAsBase64(file);
      await ipc.invoke(ipcApiRoute.app.saveStyleReferenceImage, {
        presetId,
        dataBase64: base64,
        ext,
      });
      message.success(`已为「${preset.name}」更新风格参考图`);
      await refreshStyleImage(preset);
      onStyleChange?.();
    } catch (err: any) {
      message.error(`上传失败: ${err?.message || err}`);
    }
  }, [allPresetsForImageState, message, onStyleChange, refreshStyleImage]);

  const handleClearStyleImage = useCallback(async (presetId: string) => {
    const preset = allPresetsForImageState.find(p => p.id === presetId);
    if (!preset) return;
    try {
      await ipc.invoke(ipcApiRoute.app.clearStyleReferenceImage, { presetId });
      message.success(`已还原「${preset.name}」的风格参考图`);
      await refreshStyleImage(preset);
      onStyleChange?.();
    } catch (err: any) {
      message.error(`还原失败: ${err?.message || err}`);
    }
  }, [allPresetsForImageState, message, onStyleChange, refreshStyleImage]);

  const openModal = (preset?: ThemePreset) => {
    if (preset) {
      setEditingPreset(preset);
      form.setFieldsValue({
        name: preset.name,
        description: preset.description,
        ttiStylePrefix: preset.ttiStylePrefix,
        llmPromptSuffix: preset.llmPromptSuffix,
      });
    } else {
      setEditingPreset(null);
      form.resetFields();
    }
    setModalVisible(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const presetData = {
        name: values.name,
        description: values.description || '',
        ttiStylePrefix: values.ttiStylePrefix || '',
        llmPromptSuffix: values.llmPromptSuffix || '',
      };

      if (editingPreset) {
        await updateCustomThemePreset(editingPreset.id, presetData);
        message.success('风格预设已更新');
      } else {
        await addCustomThemePreset(presetData);
        message.success('风格预设已添加');
      }

      setModalVisible(false);
      await loadPresets();
      onStyleChange?.();
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(`保存失败: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCustomThemePreset(id);
      message.success('风格预设已删除');
      await loadPresets();
      onStyleChange?.();
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`);
    }
  };

  const handlePreview = (preset: ThemePreset) => {
    setPreviewPreset(preset);
    setPreviewVisible(true);
  };

  // 系统预设（只读展示）
  const systemPresets = THEME_PRESETS.filter(t => t.id !== 'custom');

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="settings-manager">
      {/* 自定义预设区 */}
      <Card
        title="自定义风格预设"
        size="small"
        className={`settings-config-card ${styles.cardSpacing}`}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
            添加风格
          </Button>
        }
      >
        {customPresets.length === 0 ? (
          <Empty
            description="暂无自定义风格预设"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            className="settings-empty-state"
          >
            <Button type="primary" onClick={() => openModal()}>
              创建第一个风格预设
            </Button>
          </Empty>
        ) : (
          <Row gutter={[12, 12]}>
            {customPresets.map((preset) => (
              <Col key={preset.id} xs={24} sm={12} lg={8}>
                <Card
                  size="small"
                  className="settings-config-card"
                  hoverable
                  actions={[
                    <Tooltip key="preview" title="预览">
                      <EyeOutlined onClick={() => handlePreview(preset)} />
                    </Tooltip>,
                    <Tooltip key="edit" title="编辑">
                      <EditOutlined onClick={() => openModal(preset)} />
                    </Tooltip>,
                    <Popconfirm
                      key="delete"
                      title="确定删除此风格预设吗？"
                      onConfirm={() => handleDelete(preset.id)}
                      okText="删除"
                      cancelText="取消"
                    >
                      <DeleteOutlined className={styles.dangerIcon} />
                    </Popconfirm>,
                  ]}
                >
                  <Card.Meta
                    avatar={<BgColorsOutlined className={styles.systemIcon} />}
                    title={preset.name}
                    description={
                      <Text type="secondary" ellipsis>
                        {preset.description || '无描述'}
                      </Text>
                    }
                  />
                  <StyleReferenceImageSlot
                    preset={preset}
                    resolved={styleImages[preset.id] ?? null}
                    loading={Boolean(styleImageLoading[preset.id])}
                    onUpload={handleUploadStyleImage}
                    onClear={handleClearStyleImage}
                    hasUserOverride={Boolean(styleImageHasOverride[preset.id])}
                  />
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>

      {/* 系统预设区（只读） */}
      <Card title="系统内置风格" size="small" className="settings-config-card">
        <Row gutter={[12, 12]}>
          {systemPresets.map((preset) => (
            <Col key={preset.id} xs={24} sm={12} lg={8}>
              <Card
                size="small"
                className="settings-config-card"
                hoverable
              >
                <div onClick={() => handlePreview(preset)} className={styles.clickablePreset}>
                  <Card.Meta
                    avatar={<BgColorsOutlined className={styles.builtinIcon} />}
                    title={
                      <Space>
                        {preset.name}
                        <Tag color="green">内置</Tag>
                      </Space>
                    }
                    description={
                      <Text type="secondary" ellipsis>
                        {preset.description}
                      </Text>
                    }
                  />
                </div>
                <StyleReferenceImageSlot
                  preset={preset}
                  resolved={styleImages[preset.id] ?? null}
                  loading={Boolean(styleImageLoading[preset.id])}
                  onUpload={handleUploadStyleImage}
                  onClear={handleClearStyleImage}
                  hasUserOverride={Boolean(styleImageHasOverride[preset.id])}
                />
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 编辑弹窗 */}
      <Modal
        title={editingPreset ? '编辑风格预设' : '添加风格预设'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={780}
        mask={{ closable: false }}
        className="dark-modal settings-compact-modal"
      >
        <Form form={form} layout="vertical" className="settings-modal-form">
          <div className="settings-form-section">
            <div className="settings-form-section-title">基础信息</div>
            <div className="settings-modal-grid">
              <Form.Item
                name="name"
                label="风格名称"
                rules={[{ required: true, message: '请输入风格名称' }]}
              >
                <Input placeholder="如：水彩画风、3D 渲染、复古胶片等" />
              </Form.Item>

              <Form.Item
                name="description"
                label="风格描述"
                className={styles.compactItem}
              >
                <Input placeholder="简要描述这个风格的特点" />
              </Form.Item>
            </div>
          </div>

          <div className="settings-form-section">
            <div className="settings-form-section-title">生成提示词</div>
            <div className="settings-modal-grid">
              <Form.Item
                name="ttiStylePrefix"
                label="图片生成提示词前缀"
                tooltip="生成图片时会自动添加到提示词开头"
                className={styles.compactItem}
              >
                <TextArea
                  rows={3}
                  placeholder="如：watercolor painting style, soft colors, artistic brushstrokes"
                />
              </Form.Item>

              <Form.Item
                name="llmPromptSuffix"
                label="LLM 风格后缀"
                tooltip="生成剧本/描述时会添加到提示词中，引导 AI 使用这种风格"
                className={styles.compactItem}
              >
                <TextArea
                  rows={3}
                  placeholder="如：以水彩画的视觉风格呈现，色彩柔和，富有艺术感。"
                />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>

      {/* 预览弹窗 */}
      <Modal
        title={`风格预览：${previewPreset?.name}`}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={760}
        className="dark-modal settings-compact-modal settings-slim-preview"
      >
        {previewPreset && (
          <div className="settings-card-content">
            <Paragraph className={styles.previewParagraph}>
              <Text strong>描述：</Text>
              <Text>{previewPreset.description || '无描述'}</Text>
            </Paragraph>
            <Paragraph className={styles.previewParagraph}>
              <Text strong>图片生成提示词前缀：</Text>
              <br />
              <Text code className={styles.breakCode}>
                {previewPreset.ttiStylePrefix || '（无）'}
              </Text>
            </Paragraph>
            <Paragraph className={styles.previewParagraphLast}>
              <Text strong>LLM 风格后缀：</Text>
              <br />
              <Text code className={styles.breakCode}>
                {previewPreset.llmPromptSuffix || '（无）'}
              </Text>
            </Paragraph>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default VisualStyleManager;
