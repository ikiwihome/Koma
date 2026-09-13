/**
 * 道具资产编辑器
 * 简化版：只显示名称、参考图和提示词
 */
import React, { useState, useCallback, useEffect } from 'react';
import { Button, Input, Space, Progress, Typography, App } from 'antd';
import { ThunderboltOutlined, UploadOutlined, EditOutlined, CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import type { Prop } from '../../types';
import { generatePropImage, getPropPrompt } from '../../workflow/scenePropAssetWorkflow';
import { openFileDialog, fsCopy, fsMkdir, fsExists, electronService } from '../../services/electronService';
import { getStorageConfig, initStorageConfig } from '../../store/storageConfig';
import { createStoredMediaAsset } from '../../utils/mediaAssets';
import { getPropPreviewImageSource } from '../../utils/mediaSelectors';
import styles from './AssetEditor.module.scss';

const { TextArea } = Input;
const { Text } = Typography;

interface PropAssetEditorProps {
  projectId: string;
  prop: Prop;
  theme?: string;
  stylePrompt?: string;
  ttiSelection?: string;
  onUpdate: (updates: Partial<Prop>) => void;
}

export const PropAssetEditor: React.FC<PropAssetEditorProps> = ({
  projectId,
  prop,
  theme,
  stylePrompt,
  ttiSelection,
  onUpdate,
}) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ value: 0, step: '' });
  const [isEditing, setIsEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState(prop.prompt || '');

  const autoPrompt = getPropPrompt(prop, theme, stylePrompt);
  const currentPrompt = promptDraft.trim() || autoPrompt;

  useEffect(() => {
    setPromptDraft(prop.prompt || '');
  }, [prop.id, prop.prompt]);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setProgress({ value: 0, step: '准备中...' });

    try {
      const propWithPrompt = { ...prop, prompt: currentPrompt };
      const result = await generatePropImage({
        projectId,
        prop: propWithPrompt,
        theme,
        stylePrompt,
        ttiSelection,
        onProgress: (value, step) => {
          setProgress({ value, step: step || '' });
        },
      });

      if (result.success && result.path) {
        onUpdate({
          media: {
            ...(prop.media || {}),
            previewImage: createStoredMediaAsset('image', {
              localPath: result.path,
              remoteUrl: result.url,
            }),
          },
          prompt: currentPrompt,
        });
        message.success('参考图生成完成');
      } else {
        message.error('参考图生成失败，请检查图像生成配置');
      }
    } catch {
      message.error('参考图生成失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [projectId, prop, theme, stylePrompt, ttiSelection, currentPrompt, onUpdate, message]);

  const handleUpload = useCallback(async () => {
    try {
      const result = await openFileDialog({
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        title: '选择道具参考图',
      });
      if (result.canceled || !result.filePaths[0]) return;

      const config = getStorageConfig() || (await initStorageConfig());
      const basePath = `${config.rootPath}/projects/${projectId}/assets/props/${prop.id}`;
      if (!(await fsExists(basePath))) {
        await fsMkdir(basePath);
      }
      const destPath = `${basePath}/reference.png`;
      await fsCopy(result.filePaths[0], destPath);
      onUpdate({
        media: {
          ...(prop.media || {}),
          previewImage: createStoredMediaAsset('image', { localPath: destPath }),
        },
      });
      message.success('上传成功');
    } catch {
      message.error('上传失败，请检查文件格式后重试');
    }
  }, [projectId, prop.id, onUpdate, message]);

  const handleSavePrompt = () => {
    onUpdate({ prompt: currentPrompt });
    setIsEditing(false);
    message.success('提示词已保存');
  };

  const toLocalUrl = (path?: string) => path ? electronService.fs.toLocalUrl(path) : '';

  return (
    <div className={styles.editorCard}>
      {/* 头部：名称 + 操作按钮 */}
      <div className={styles.editorHeader}>
        <Text strong className={styles.editorTitle}>{prop.name}</Text>
        <Space size="small">
          <Button
            size="small"
            icon={loading ? <LoadingOutlined /> : <ThunderboltOutlined />}
            onClick={handleGenerate}
            disabled={loading}
          >
            {getPropPreviewImageSource(prop) ? '重新生成' : '生成'}
          </Button>
          <Button size="small" icon={<UploadOutlined />} onClick={handleUpload} disabled={loading}>
            上传
          </Button>
        </Space>
      </div>

      {/* 进度条 */}
      {loading && (
        <div className={styles.progressBlock}>
          <Text type="secondary" className={styles.progressText}>{progress.step}</Text>
          <Progress percent={Math.round(progress.value)} size="small" strokeColor="var(--token-status-success)" />
        </div>
      )}

      {/* 参考图 */}
      <div className={`${styles.previewFrame} ${styles.propPreviewFrame}`}>
        {getPropPreviewImageSource(prop) ? (
          <img
            src={toLocalUrl(getPropPreviewImageSource(prop))}
            alt={prop.name}
            className={styles.propPreviewImage}
          />
        ) : (
          <Text type="secondary">未生成参考图</Text>
        )}
      </div>

      {/* 提示词编辑 */}
      <div>
        <div className={styles.promptHeader}>
          <Text type="secondary" className={styles.promptLabel}>生成提示词</Text>
          <Button
            type="text"
            size="small"
            icon={isEditing ? <CheckOutlined /> : <EditOutlined />}
            onClick={isEditing ? handleSavePrompt : () => setIsEditing(true)}
          >
            {isEditing ? '保存' : '编辑'}
          </Button>
        </div>
        <TextArea
          value={isEditing ? promptDraft : currentPrompt}
          onChange={(e) => setPromptDraft(e.target.value)}
          rows={2}
          placeholder="描述道具..."
          disabled={!isEditing}
          className={`${styles.promptInput} ${isEditing ? styles.promptInputEditing : ''}`}
        />
        {prop.prompt && (
          <Text type="secondary" className={styles.promptHint}>
            使用已保存提示词 · <a onClick={() => { setPromptDraft(autoPrompt); onUpdate({ prompt: autoPrompt }); }}>恢复自动模板</a>
          </Text>
        )}
      </div>
    </div>
  );
};

export default PropAssetEditor;
