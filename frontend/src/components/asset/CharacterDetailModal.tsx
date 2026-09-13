/**
 * 角色详情弹窗
 * 支持编辑角色信息、生成/上传资产、角色提取
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  Button,
  Space,
  Popconfirm,
  Progress,
  Spin,
  App,
  Row,
  Col,
  Divider,
  Typography,
} from 'antd';
import {
  UserOutlined,
  SaveOutlined,
  DeleteOutlined,
  UploadOutlined,
  ThunderboltOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { Character, CharacterGender, ProjectStyleSnapshot } from '../../types';
import {
  generateCostumePhoto,
  generateCharacterPreviewVideo,
  extractAndBindCharacter,
} from '../../workflow/characterAssetWorkflow';
import { electronService, openFileDialog, fsCopy, fsMkdir, fsExists } from '../../services/electronService';
import { getStorageConfig, initStorageConfig } from '../../store/storageConfig';
import { saveCharacters, loadCharacters } from '../../store/projectStore';
import { createStoredMediaAsset, updateCharacterMedia } from '../../utils/mediaAssets';
import { mergeEpisodeRefs } from './assetEpisodeRefs';
import {
  getCharacterCostumePhotoSource,
  getCharacterPreviewVideoSource,
} from '../../utils/mediaSelectors';
import styles from './DetailModal.module.scss';

const { TextArea } = Input;
const { Text } = Typography;

interface CharacterDetailModalProps {
  open: boolean;
  character: Character | null;
  projectId: string;
  theme?: string;
  stylePrompt?: string;
  styleSnapshot?: ProjectStyleSnapshot;
  ttiSelection?: string;
  itvSelection?: string;
  onClose: () => void;
  onUpdate: (character: Character) => void;
  onDelete: (characterId: string) => void;
}

type GeneratingType = 'costume' | 'video' | 'extract' | null;

export const CharacterDetailModal: React.FC<CharacterDetailModalProps> = ({
  open,
  character,
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
  const [editedCharacter, setEditedCharacter] = useState<Character | null>(null);

  // 生成状态
  const [generating, setGenerating] = useState<GeneratingType>(null);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState('');

  // 预览弹窗
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 初始化表单
  useEffect(() => {
    if (character && open) {
      setEditedCharacter({ ...character, prompt: character.prompt || '' });
      form.setFieldsValue({
        name: character.name,
        role: character.role,
        age: character.age,
        gender: character.gender || 'unknown',
        prompt: character.prompt || '',
      });
    }
  }, [character, open, form]);

  // 获取资产路径
  const getAssetPath = useCallback(async (subPath: string) => {
    if (!editedCharacter) return '';
    const config = getStorageConfig() || (await initStorageConfig());
    const basePath = `${config.rootPath}/projects/${projectId}/assets/characters/${editedCharacter.id}`;
    const fullPath = `${basePath}/${subPath}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (!(await fsExists(dir))) {
      await fsMkdir(dir);
    }
    return fullPath;
  }, [projectId, editedCharacter?.id]);

  // 保存角色信息
  const handleSave = useCallback(async () => {
    if (!editedCharacter) return;

    try {
      const values = await form.validateFields();

      // 更新存储
      const characters = await loadCharacters(projectId);
      const index = characters.findIndex(c => c.id === editedCharacter.id);
      if (index === -1) {
        throw new Error('保存失败');
      }

      const storedCharacter = characters[index];
      const updatedCharacter: Character = {
        ...storedCharacter,
        ...editedCharacter,
        ...values,
        prompt: values.prompt || '',
        media: storedCharacter.media ?? editedCharacter.media,
        episodeRefs: mergeEpisodeRefs(storedCharacter.episodeRefs, editedCharacter.episodeRefs),
      };

      characters[index] = updatedCharacter;
      await saveCharacters(projectId, characters);

      setEditedCharacter(updatedCharacter);
      onUpdate(updatedCharacter);
      message.success('保存成功');
    } catch (err: any) {
      message.error(err.message || '保存失败');
    }
  }, [editedCharacter, form, projectId, onUpdate, message]);

  // 生成定妆照
  const handleGenerateCostume = useCallback(async () => {
    if (!editedCharacter) return;

    setGenerating('costume');
    setProgress(0);

    try {
      const currentValues = await form.getFieldsValue();
      const charWithPrompt: Character = {
        ...editedCharacter,
        ...currentValues,
        prompt: currentValues.prompt || '',
      };
      const result = await generateCostumePhoto({
        projectId,
        character: charWithPrompt,
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
        const updated = updateCharacterMedia(charWithPrompt, {
          costumePhoto: createStoredMediaAsset('image', {
            localPath: result.path,
            remoteUrl: result.url,
          }),
        });
        setEditedCharacter(updated);
        onUpdate(updated);
        message.success('定妆照生成完成');
      } else {
        message.error(result.error || '生成失败');
      }
    } catch (err: any) {
      message.error(err.message || '生成失败');
    } finally {
      setGenerating(null);
    }
  }, [editedCharacter, form, projectId, theme, stylePrompt, styleSnapshot, ttiSelection, onUpdate, message]);

  // 上传定妆照
  const handleUploadCostume = useCallback(async () => {
    if (!editedCharacter) return;

    try {
      const result = await openFileDialog({
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        title: '选择定妆照',
      });
      if (result.canceled || !result.filePaths[0]) return;

      const destPath = await getAssetPath('costume.png');
      await fsCopy(result.filePaths[0], destPath);

      const updated = updateCharacterMedia(editedCharacter, {
        costumePhoto: createStoredMediaAsset('image', { localPath: destPath }),
      });
      setEditedCharacter(updated);
      onUpdate(updated);

      // 同步保存
      const characters = await loadCharacters(projectId);
      const index = characters.findIndex(c => c.id === editedCharacter.id);
      if (index !== -1) {
        characters[index] = updated;
        await saveCharacters(projectId, characters);
      }

      message.success('上传成功');
    } catch (err: any) {
      message.error(`上传失败: ${err.message}`);
    }
  }, [editedCharacter, getAssetPath, projectId, onUpdate, message]);

  // 生成预览视频
  const handleGenerateVideo = useCallback(async () => {
    if (!editedCharacter) return;

    if (!getCharacterCostumePhotoSource(editedCharacter)) {
      message.warning('请先生成或上传定妆照');
      return;
    }

    setGenerating('video');
    setProgress(0);

    try {
      const currentValues = await form.getFieldsValue();
      const characterForVideo: Character = {
        ...editedCharacter,
        ...currentValues,
        prompt: currentValues.prompt || '',
      };
      const result = await generateCharacterPreviewVideo({
        projectId,
        character: characterForVideo,
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
        const updated = updateCharacterMedia(characterForVideo, {
          previewVideo: createStoredMediaAsset('video', {
            localPath: result.path,
            providerTaskId: result.taskId,
          }),
        });
        setEditedCharacter(updated);
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
  }, [editedCharacter, form, projectId, theme, stylePrompt, styleSnapshot, itvSelection, onUpdate, message]);

  // 上传预览视频
  const handleUploadVideo = useCallback(async () => {
    if (!editedCharacter) return;

    try {
      const result = await openFileDialog({
        filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov'] }],
        title: '选择预览视频',
      });
      if (result.canceled || !result.filePaths[0]) return;

      const destPath = await getAssetPath('preview.mp4');
      await fsCopy(result.filePaths[0], destPath);

      const updated = updateCharacterMedia(editedCharacter, {
        previewVideo: createStoredMediaAsset('video', { localPath: destPath }),
      });
      setEditedCharacter(updated);
      onUpdate(updated);

      // 同步保存
      const characters = await loadCharacters(projectId);
      const index = characters.findIndex(c => c.id === editedCharacter.id);
      if (index !== -1) {
        characters[index] = updated;
        await saveCharacters(projectId, characters);
      }

      message.success('上传成功');
    } catch (err: any) {
      message.error(`上传失败: ${err.message}`);
    }
  }, [editedCharacter, getAssetPath, projectId, onUpdate, message]);

  // 提取角色
  const handleExtractCharacter = useCallback(async () => {
    if (!editedCharacter) return;

    if (!getCharacterPreviewVideoSource(editedCharacter)) {
      message.warning('请先生成或上传预览视频');
      return;
    }

    setGenerating('extract');
    setProgress(0);
    setProgressStep('提取角色中...');

    try {
      const result = await extractAndBindCharacter(projectId, editedCharacter, itvSelection);

      if (result.success && result.characterId) {
        const updated = { ...editedCharacter, sora2CharacterId: result.characterId };
        setEditedCharacter(updated);
        onUpdate(updated);

        // 同步保存
        const characters = await loadCharacters(projectId);
        const index = characters.findIndex(c => c.id === editedCharacter.id);
        if (index !== -1) {
          characters[index] = updated;
          await saveCharacters(projectId, characters);
        }

        message.success('角色提取成功');
      } else {
        message.error(result.error || '提取失败');
      }
    } catch (err: any) {
      message.error(err.message || '提取失败');
    } finally {
      setGenerating(null);
    }
  }, [editedCharacter, projectId, itvSelection, onUpdate, message]);

  // 删除角色
  const handleDelete = useCallback(async () => {
    if (!editedCharacter) return;
    onDelete(editedCharacter.id);
    onClose();
  }, [editedCharacter, onDelete, onClose]);

  // 转换本地路径为可显示URL
  const toLocalUrl = (path?: string) => path ? electronService.fs.toLocalUrl(path) : '';

  if (!editedCharacter) return null;

  const roleOptions = [
    { value: 'protagonist', label: '主角' },
    { value: 'antagonist', label: '反派' },
    { value: 'supporting', label: '配角' },
  ];
  const genderOptions: Array<{ value: CharacterGender; label: string }> = [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
    { value: 'neutral', label: '中性' },
    { value: 'unknown', label: '未知' },
  ];

  return (
    <>
      <Modal
        title={
          <Space>
            <UserOutlined />
            <span>角色详情: {editedCharacter.name}</span>
          </Space>
        }
        open={open}
        onCancel={onClose}
        width={900}
        footer={
          <div className={styles.footerActions}>
            <Popconfirm
              title="确定删除此角色？"
              description="删除后无法恢复"
              onConfirm={handleDelete}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除角色
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
          {/* 左侧：定妆照（三视图） */}
          <Col span={10}>
            <div className={styles.assetBlock}>
              <Text strong className={styles.sectionTitle}>定妆照（三视图）</Text>
              <div
                className={`${styles.mediaFrame} ${styles.costumeFrame} ${
                  getCharacterCostumePhotoSource(editedCharacter) ? styles.clickable : ''
                }`}
                onClick={() => {
                  const costumePhotoSource = getCharacterCostumePhotoSource(editedCharacter);
                  if (costumePhotoSource) setPreviewImage(toLocalUrl(costumePhotoSource));
                }}
              >
                {getCharacterCostumePhotoSource(editedCharacter) ? (
                  <img
                    src={toLocalUrl(getCharacterCostumePhotoSource(editedCharacter))}
                    alt="定妆照"
                    className={styles.media}
                  />
                ) : (
                  <Text type="secondary">未生成（正面/侧面/背面）</Text>
                )}
              </div>
              <Space className={styles.mediaActions} wrap>
                <Button
                  icon={generating === 'costume' ? <LoadingOutlined /> : <ThunderboltOutlined />}
                  onClick={handleGenerateCostume}
                  disabled={generating !== null}
                >
                  {getCharacterCostumePhotoSource(editedCharacter) ? '重新生成' : '生成'}
                </Button>
                <Button icon={<UploadOutlined />} onClick={handleUploadCostume} disabled={generating !== null}>
                  上传
                </Button>
              </Space>
            </div>
          </Col>

          {/* 右侧：基础信息（精简版） */}
          <Col span={14}>
            <Form form={form} layout="vertical" size="small">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="role" label="角色类型">
                    <Select options={roleOptions} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="age" label="年龄">
                    <Input placeholder="如：28岁" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="gender" label="性别">
                    <Select options={genderOptions} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="prompt" label="视觉提示词">
                <TextArea
                  rows={4}
                  placeholder="只描述角色可见外貌、服装、材质、配色、体态等客观视觉信息"
                  className={styles.themedTextArea}
                />
              </Form.Item>
            </Form>
          </Col>
        </Row>

        <Divider />

        {/* 预览视频 & 角色提取 */}
        <Row gutter={24}>
          <Col span={12}>
            <Text strong className={styles.sectionTitle}>预览视频</Text>
            <div
              className={`${styles.mediaFrame} ${styles.videoFrame} ${styles.portraitFrame}`}
            >
              {getCharacterPreviewVideoSource(editedCharacter) ? (
                <video
                  src={toLocalUrl(getCharacterPreviewVideoSource(editedCharacter))}
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
                disabled={generating !== null || !getCharacterCostumePhotoSource(editedCharacter)}
              >
                {getCharacterPreviewVideoSource(editedCharacter) ? '重新生成' : '生成'}
              </Button>
              <Button icon={<UploadOutlined />} onClick={handleUploadVideo} disabled={generating !== null}>
                上传
              </Button>
            </Space>
          </Col>

          <Col span={12}>
            <Text strong className={styles.sectionTitle}>Sora2 角色绑定</Text>
            <div className={styles.bindingCard}>
              {editedCharacter.sora2CharacterId ? (
                <div className={styles.centered}>
                  <CheckCircleOutlined className={styles.successIcon} />
                  <div><Text type="success">已绑定</Text></div>
                  <Text type="secondary" className={styles.smallCode}>
                    {editedCharacter.sora2CharacterId}
                  </Text>
                </div>
              ) : (
                <div className={styles.centered}>
                  <LinkOutlined className={styles.mutedIcon} />
                  <div><Text type="secondary">未绑定</Text></div>
                </div>
              )}

              {/* 提取时间范围设置 */}
              <div className={styles.extractSettings}>
                <Text type="secondary" className={styles.extractLabel}>
                  提取时间范围（秒）
                </Text>
                <Space size="small">
                  <Input
                    type="number"
                    size="small"
                    className={styles.timeInput}
                    min={0}
                    max={10}
                    step={0.5}
                    placeholder="起始"
                    value={editedCharacter.timestampRange?.start ?? 1}
                    onChange={(e) => {
                      const start = parseFloat(e.target.value) || 0;
                      const currentEnd = editedCharacter.timestampRange?.end ?? 3;
                      setEditedCharacter(prev => prev ? {
                        ...prev,
                        timestampRange: { start, end: Math.max(currentEnd, start + 0.5) }
                      } : null);
                    }}
                  />
                  <Text type="secondary">-</Text>
                  <Input
                    type="number"
                    size="small"
                    className={styles.timeInput}
                    min={0}
                    max={10}
                    step={0.5}
                    placeholder="结束"
                    value={editedCharacter.timestampRange?.end ?? 3}
                    onChange={(e) => {
                      const end = parseFloat(e.target.value) || 3;
                      const start = editedCharacter.timestampRange?.start ?? 1;
                      if (end - start > 3) {
                        message.warning('时间范围不能超过3秒');
                        return;
                      }
                      setEditedCharacter(prev => prev ? {
                        ...prev,
                        timestampRange: { start, end }
                      } : null);
                    }}
                  />
                  <Text type="secondary" className={styles.limitHint}>最多3秒</Text>
                </Space>
              </div>
            </div>
            <Button
              block
              className={styles.extractButton}
              icon={generating === 'extract' ? <LoadingOutlined /> : <LinkOutlined />}
              onClick={handleExtractCharacter}
              disabled={generating !== null || !getCharacterPreviewVideoSource(editedCharacter)}
            >
              {editedCharacter.sora2CharacterId ? '重新提取' : '提取角色'}
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

export default CharacterDetailModal;
