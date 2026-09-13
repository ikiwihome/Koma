/**
 * 道具详情弹窗
 * 支持编辑道具信息、生成/上传资产、道具提取
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  Button,
  Space,
  Progress,
  Spin,
  App,
  Row,
  Col,
  Divider,
  Typography,
  Popconfirm,
} from 'antd';
import {
  InboxOutlined,
  SaveOutlined,
  DeleteOutlined,
  UploadOutlined,
  ThunderboltOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { ProjectStyleSnapshot, Prop } from '../../types';
import {
  generatePropImage,
  generatePropPreviewVideo,
  extractAndBindProp,
} from '../../workflow/scenePropAssetWorkflow';
import { electronService, openFileDialog, fsCopy, fsMkdir, fsExists } from '../../services/electronService';
import { getStorageConfig, initStorageConfig } from '../../store/storageConfig';
import { saveProps, loadProps } from '../../store/projectStore';
import { createStoredMediaAsset, updatePropMedia } from '../../utils/mediaAssets';
import { mergeEpisodeRefs } from './assetEpisodeRefs';
import {
  getPropPreviewImageSource,
  getPropPreviewVideoSource,
} from '../../utils/mediaSelectors';
import styles from './DetailModal.module.scss';

const { TextArea } = Input;
const { Text } = Typography;

interface PropDetailModalProps {
  open: boolean;
  prop: Prop | null;
  projectId: string;
  theme?: string;
  stylePrompt?: string;
  styleSnapshot?: ProjectStyleSnapshot;
  ttiSelection?: string;
  itvSelection?: string;
  onClose: () => void;
  onUpdate: (prop: Prop) => void;
  onDelete: (propId: string) => void;
}

type GeneratingType = 'image' | 'video' | 'extract' | null;

export const PropDetailModal: React.FC<PropDetailModalProps> = ({
  open,
  prop,
  projectId,
  theme,
  stylePrompt,
  styleSnapshot,
  ttiSelection,
  itvSelection,
  onClose,
  onUpdate,
  onDelete,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  // 编辑状态
  const [editedProp, setEditedProp] = useState<Prop | null>(null);

  // 生成状态
  const [generating, setGenerating] = useState<GeneratingType>(null);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState('');

  // 预览弹窗
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 初始化表单
  useEffect(() => {
    if (prop && open) {
      setEditedProp({ ...prop, prompt: prop.prompt || '' });
      form.setFieldsValue({
        name: prop.name,
        type: prop.type,
        prompt: prop.prompt || '',
      });
    }
  }, [prop, open, form]);

  // 获取资产路径
  const getAssetPath = useCallback(async (subPath: string) => {
    if (!editedProp) return '';
    const config = getStorageConfig() || (await initStorageConfig());
    const basePath = `${config.rootPath}/projects/${projectId}/assets/props/${editedProp.id}`;
    const fullPath = `${basePath}/${subPath}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (!(await fsExists(dir))) {
      await fsMkdir(dir);
    }
    return fullPath;
  }, [projectId, editedProp?.id]);

  // 保存道具信息
  const handleSave = useCallback(async () => {
    if (!editedProp) return;

    try {
      const values = await form.validateFields();
      const props = await loadProps(projectId);
      const index = props.findIndex(p => p.id === editedProp.id);
      if (index === -1) {
        throw new Error('保存失败');
      }

      const storedProp = props[index];
      const updatedProp: Prop = {
        ...storedProp,
        ...editedProp,
        ...values,
        prompt: values.prompt || '',
        media: storedProp.media ?? editedProp.media,
        episodeRefs: mergeEpisodeRefs(storedProp.episodeRefs, editedProp.episodeRefs),
      };

      props[index] = updatedProp;
      await saveProps(projectId, props);

      setEditedProp(updatedProp);
      onUpdate(updatedProp);
      message.success('保存成功');
    } catch (err: any) {
      message.error(err.message || '保存失败');
    }
  }, [editedProp, form, projectId, onUpdate, message]);

  // 生成道具图片
  const handleGenerateImage = useCallback(async () => {
    if (!editedProp) return;

    setGenerating('image');
    setProgress(0);

    try {
      const currentValues = await form.getFieldsValue();
      const propWithPrompt: Prop = {
        ...editedProp,
        ...currentValues,
        prompt: currentValues.prompt || '',
      };
      const result = await generatePropImage({
        projectId,
        prop: propWithPrompt,
        theme,
        stylePrompt,
        styleSnapshot,
        ttiSelection,
        onProgress: (p, step) => {
          setProgress(p);
          setProgressStep(step);
        },
      });

      if (result.success && result.path) {
        const updated = updatePropMedia(propWithPrompt, {
          previewImage: createStoredMediaAsset('image', {
            localPath: result.path,
            remoteUrl: result.url,
          }),
        });
        setEditedProp(updated);
        onUpdate(updated);
        message.success('道具图片生成完成');
      } else {
        message.error(result.error || '生成失败');
      }
    } catch (err: any) {
      message.error(err.message || '生成失败');
    } finally {
      setGenerating(null);
    }
  }, [editedProp, form, projectId, theme, stylePrompt, styleSnapshot, ttiSelection, onUpdate, message]);

  // 上传道具图片
  const handleUploadImage = useCallback(async () => {
    if (!editedProp) return;

    try {
      const result = await openFileDialog({
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        title: '选择道具图片',
      });
      if (result.canceled || !result.filePaths[0]) return;

      const destPath = await getAssetPath('reference.png');
      await fsCopy(result.filePaths[0], destPath);

      const updated = updatePropMedia(editedProp, {
        previewImage: createStoredMediaAsset('image', { localPath: destPath }),
      });
      setEditedProp(updated);
      onUpdate(updated);

      const props = await loadProps(projectId);
      const index = props.findIndex(p => p.id === editedProp.id);
      if (index !== -1) {
        props[index] = updated;
        await saveProps(projectId, props);
      }

      message.success('上传成功');
    } catch (err: any) {
      message.error(`上传失败: ${err.message}`);
    }
  }, [editedProp, getAssetPath, projectId, onUpdate, message]);

  // 生成预览视频
  const handleGenerateVideo = useCallback(async () => {
    if (!editedProp) return;

    if (!getPropPreviewImageSource(editedProp)) {
      message.warning('请先生成或上传道具图片');
      return;
    }

    setGenerating('video');
    setProgress(0);

    try {
      const currentValues = await form.getFieldsValue();
      const propForVideo: Prop = {
        ...editedProp,
        ...currentValues,
        prompt: currentValues.prompt || '',
      };
      const result = await generatePropPreviewVideo({
        projectId,
        prop: propForVideo,
        theme,
        stylePrompt,
        styleSnapshot,
        itvSelection,
        onProgress: (p, step) => {
          setProgress(p);
          setProgressStep(step);
        },
      });

      if (result.success && result.path) {
        const updated = updatePropMedia(propForVideo, {
          previewVideo: createStoredMediaAsset('video', {
            localPath: result.path,
            providerTaskId: result.taskId,
          }),
        });
        setEditedProp(updated);
        onUpdate(updated);
        message.success('预览视频生成完成');
      } else {
        message.error(result.error || '生成失败');
      }
    } catch (err: any) {
      message.error(err.message || '生成失败');
    } finally {
      setGenerating(null);
    }
  }, [editedProp, form, projectId, theme, stylePrompt, styleSnapshot, itvSelection, onUpdate, message]);

  // 上传预览视频
  const handleUploadVideo = useCallback(async () => {
    if (!editedProp) return;

    try {
      const result = await openFileDialog({
        filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov'] }],
        title: '选择预览视频',
      });
      if (result.canceled || !result.filePaths[0]) return;

      const destPath = await getAssetPath('preview.mp4');
      await fsCopy(result.filePaths[0], destPath);

      const updated = updatePropMedia(editedProp, {
        previewVideo: createStoredMediaAsset('video', { localPath: destPath }),
      });
      setEditedProp(updated);
      onUpdate(updated);

      const props = await loadProps(projectId);
      const index = props.findIndex(p => p.id === editedProp.id);
      if (index !== -1) {
        props[index] = updated;
        await saveProps(projectId, props);
      }

      message.success('上传成功');
    } catch (err: any) {
      message.error(`上传失败: ${err.message}`);
    }
  }, [editedProp, getAssetPath, projectId, onUpdate, message]);

  // 提取道具
  const handleExtractProp = useCallback(async () => {
    if (!editedProp) return;

    if (!getPropPreviewVideoSource(editedProp)) {
      message.warning('请先生成或上传预览视频');
      return;
    }

    setGenerating('extract');
    setProgress(0);
    setProgressStep('提取道具中...');

    try {
      const result = await extractAndBindProp(projectId, editedProp, itvSelection);

      if (result.success && result.propId) {
        const updated = { ...editedProp, sora2PropId: result.propId };
        setEditedProp(updated);
        onUpdate(updated);

        const props = await loadProps(projectId);
        const index = props.findIndex(p => p.id === editedProp.id);
        if (index !== -1) {
          props[index] = updated;
          await saveProps(projectId, props);
        }

        message.success('道具提取成功');
      } else {
        message.error(result.error || '提取失败');
      }
    } catch (err: any) {
      message.error(err.message || '提取失败');
    } finally {
      setGenerating(null);
    }
  }, [editedProp, projectId, itvSelection, onUpdate, message]);

  // 删除道具
  const handleDelete = useCallback(async () => {
    if (!editedProp) return;
    onDelete(editedProp.id);
    onClose();
  }, [editedProp, onDelete, onClose]);

  // 转换本地路径为可显示URL
  const toLocalUrl = (path?: string) => path ? electronService.fs.toLocalUrl(path) : '';

  if (!editedProp) return null;

  const typeOptions = [
    { value: '武器', label: '武器' },
    { value: '日常', label: '日常' },
    { value: '关键线索', label: '关键线索' },
    { value: '其他', label: '其他' },
  ];

  return (
    <>
      <Modal
        title={
          <Space>
            <InboxOutlined />
            <span>道具详情: {editedProp.name}</span>
          </Space>
        }
        open={open}
        onCancel={onClose}
        width={900}
        footer={
          <div className={styles.footerActions}>
            <Popconfirm
              title="确定删除此道具？"
              description="删除后无法恢复"
              onConfirm={handleDelete}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除道具
              </Button>
            </Popconfirm>
            <Space>
              <Button onClick={onClose}>取消</Button>
              <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
                保存修改
              </Button>
            </Space>
          </div>
        }
      >
        {/* 生成进度 */}
        {generating && (
          <div className={styles.progressBlock}>
            <Space className={styles.progressLabel}>
              <Spin indicator={<LoadingOutlined spin />} size="small" />
              <Text>{progressStep}</Text>
            </Space>
            <Progress percent={Math.round(progress)} strokeColor="var(--token-status-success)" />
          </div>
        )}

        <Row gutter={24}>
          {/* 左侧：道具图片 */}
          <Col span={10}>
            <div className={styles.assetBlock}>
              <Text strong className={styles.sectionTitle}>道具图片</Text>
              <div
                className={`${styles.mediaFrame} ${styles.squareFrame} ${
                  getPropPreviewImageSource(editedProp) ? styles.clickable : ''
                }`}
                onClick={() => {
                  const previewImageSource = getPropPreviewImageSource(editedProp);
                  if (previewImageSource) setPreviewImage(toLocalUrl(previewImageSource));
                }}
              >
                {getPropPreviewImageSource(editedProp) ? (
                  <img
                    src={toLocalUrl(getPropPreviewImageSource(editedProp))}
                    alt="道具图"
                    className={`${styles.media} ${styles.paddedMedia}`}
                  />
                ) : (
                  <Text type="secondary">未生成</Text>
                )}
              </div>
              <Space className={styles.mediaActions} wrap>
                <Button
                  icon={generating === 'image' ? <LoadingOutlined /> : <ThunderboltOutlined />}
                  onClick={handleGenerateImage}
                  disabled={generating !== null}
                >
                  {getPropPreviewImageSource(editedProp) ? '重新生成' : '生成'}
                </Button>
                <Button icon={<UploadOutlined />} onClick={handleUploadImage} disabled={generating !== null}>
                  上传
                </Button>
              </Space>
            </div>
          </Col>

          {/* 右侧：基础信息 */}
          <Col span={14}>
            <Form form={form} layout="vertical" size="small">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="type" label="道具类型">
                    <Select options={typeOptions} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="prompt" label="视觉提示词">
                <TextArea rows={4} placeholder="只描述道具可见材质、形状、颜色、磨损、结构等客观视觉信息" />
              </Form.Item>
            </Form>
          </Col>
        </Row>

        <Divider />

        {/* 预览视频 & 道具提取 */}
        <Row gutter={24}>
          <Col span={12}>
            <Text strong className={styles.sectionTitle}>预览视频</Text>
            <div
              className={`${styles.mediaFrame} ${styles.videoFrame} ${styles.squareFrame}`}
            >
              {getPropPreviewVideoSource(editedProp) ? (
                <video
                  src={toLocalUrl(getPropPreviewVideoSource(editedProp))}
                  controls
                  className={styles.media}
                />
              ) : (
                <Text type="secondary">未生成</Text>
              )}
            </div>
            <Space className={styles.mediaActions}>
              <Button
                icon={generating === 'video' ? <LoadingOutlined /> : <PlayCircleOutlined />}
                onClick={handleGenerateVideo}
                disabled={generating !== null || !getPropPreviewImageSource(editedProp)}
              >
                {getPropPreviewVideoSource(editedProp) ? '重新生成' : '生成'}
              </Button>
              <Button icon={<UploadOutlined />} onClick={handleUploadVideo} disabled={generating !== null}>
                上传
              </Button>
            </Space>
          </Col>

          <Col span={12}>
            <Text strong className={styles.sectionTitle}>Sora2 道具绑定</Text>
            <div className={`${styles.bindingCard} ${styles.bindingCardCentered}`}>
              {editedProp.sora2PropId ? (
                <>
                  <CheckCircleOutlined className={styles.successIcon} />
                  <Text type="success">已绑定</Text>
                  <Text type="secondary" className={styles.smallCode}>
                    {editedProp.sora2PropId}
                  </Text>
                </>
              ) : (
                <>
                  <LinkOutlined className={styles.mutedIcon} />
                  <Text type="secondary">未绑定</Text>
                </>
              )}
            </div>
            <Button
              block
              className={styles.extractButton}
              icon={generating === 'extract' ? <LoadingOutlined /> : <LinkOutlined />}
              onClick={handleExtractProp}
              disabled={generating !== null || !getPropPreviewVideoSource(editedProp)}
            >
              {editedProp.sora2PropId ? '重新提取' : '提取道具'}
            </Button>
            <Text type="secondary" className={styles.smallHint}>
              需要先生成预览视频才能提取
            </Text>
          </Col>
        </Row>
      </Modal>

      {/* 图片预览弹窗 */}
      <Modal
        open={!!previewImage}
        onCancel={() => setPreviewImage(null)}
        footer={null}
        centered
        width="auto"
        className={styles.previewModal}
      >
        {previewImage && (
          <img src={previewImage} alt="Preview" className={styles.previewImage} />
        )}
      </Modal>
    </>
  );
};

export default PropDetailModal;
