/**
 * 视频版本列表组件
 * 支持版本切换、预览、删除
 */
import React, { useState, useEffect, useCallback } from 'react';
import { createLogger } from '../../store/logger';

const logger = createLogger('VideoVersionList');
import {
  Dropdown,
  Button,
  Tag,
  Tooltip,
  Modal,
  Space,
  Typography,
  Popconfirm,
  Spin,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  VideoCameraOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  CheckCircleFilled,
  HistoryOutlined,
  PlusOutlined,
  LoadingOutlined,
  DownOutlined,
} from '@ant-design/icons';
import type { ShotVersion } from '../../types';
import { loadShotMeta, switchShotVersion, deleteShotVersion } from '../../store/projectStore';
import { electronService } from '../../services/electronService';
import { getMediaAssetDisplaySource } from '../../types';
import './VideoVersionList.scss';

const { Text } = Typography;

export interface VideoVersionListProps {
  projectId: string;
  shotId: string;
  currentVersion?: number;
  onVersionChange?: (version: number) => void;
  onGenerateNew?: () => void;
  isGenerating?: boolean;
  compact?: boolean;  // 紧凑模式
}

export const VideoVersionList: React.FC<VideoVersionListProps> = ({
  projectId,
  shotId,
  currentVersion,
  onVersionChange,
  onGenerateNew,
  isGenerating = false,
  compact = false,
}) => {
  const [versions, setVersions] = useState<ShotVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [localCurrentVersion, setLocalCurrentVersion] = useState<number | undefined>(currentVersion);

  // 加载版本列表
  const loadVersions = useCallback(async () => {
    if (!projectId || !shotId) return;

    setLoading(true);
    try {
      const shotMeta = await loadShotMeta(projectId, shotId);
      if (shotMeta) {
        setVersions(shotMeta.versions.sort((a, b) => b.version - a.version));
        setLocalCurrentVersion(shotMeta.currentVersion);
      }
    } catch (err) {
      logger.error('加载版本列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, shotId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  // 同步外部 currentVersion
  useEffect(() => {
    if (currentVersion !== undefined) {
      setLocalCurrentVersion(currentVersion);
    }
  }, [currentVersion]);

  // 切换版本
  const handleSwitchVersion = useCallback(async (version: number) => {
    if (version === localCurrentVersion) return;

    try {
      await switchShotVersion(projectId, shotId, version);
      setLocalCurrentVersion(version);
      onVersionChange?.(version);
      message.success(`已切换到版本 ${version}`);
    } catch (err: any) {
      message.error(err.message || '切换版本失败');
    }
  }, [projectId, shotId, localCurrentVersion, onVersionChange]);

  // 删除版本
  const handleDeleteVersion = useCallback(async (version: number, e?: React.MouseEvent) => {
    e?.stopPropagation();

    if (versions.length <= 1) {
      message.warning('至少保留一个版本');
      return;
    }

    try {
      await deleteShotVersion(projectId, shotId, version);
      message.success(`已删除版本 ${version}`);
      loadVersions();
    } catch (err: any) {
      message.error(err.message || '删除失败');
    }
  }, [projectId, shotId, versions.length, loadVersions]);

  // 预览视频
  const handlePreview = useCallback((videoPath?: string) => {
    if (!videoPath) {
      message.warning('该版本没有视频');
      return;
    }
    const url = electronService.fs.toLocalUrl(videoPath);
    setPreviewUrl(url);
    setPreviewVisible(true);
  }, []);

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  // 构建下拉菜单
  const buildMenuItems = (): MenuProps['items'] => {
    if (versions.length === 0) {
      return [{
        key: 'empty',
        label: <Text type="secondary">暂无版本</Text>,
        disabled: true,
      }];
    }

    const items: MenuProps['items'] = versions.map(v => ({
      key: `v${v.version}`,
      label: (
        <div className="versionMenuItem">
          <Space>
            {v.version === localCurrentVersion && (
              <CheckCircleFilled className="versionMenuCheck" />
            )}
            <span>v{v.version}</span>
            <Text type="secondary" className="versionTime">
              {formatTime(v.createdAt)}
            </Text>
          </Space>
          <Space size={4}>
            {v.media?.video && (
              <Tooltip title="预览">
                <Button
                  type="text"
                  size="small"
                  icon={<PlayCircleOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(getMediaAssetDisplaySource(v.media?.video));
                  }}
                />
              </Tooltip>
            )}
            {versions.length > 1 && (
              <Popconfirm
                title="确定删除此版本？"
                onConfirm={(e) => handleDeleteVersion(v.version, e as any)}
                onCancel={(e) => e?.stopPropagation()}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Popconfirm>
            )}
          </Space>
        </div>
      ),
      onClick: () => handleSwitchVersion(v.version),
    }));

    // 添加生成新版本按钮
    if (onGenerateNew) {
      items.push({ type: 'divider' });
      items.push({
        key: 'generate',
        icon: isGenerating ? <LoadingOutlined /> : <PlusOutlined />,
        label: isGenerating ? '生成中...' : '生成新版本',
        disabled: isGenerating,
        onClick: onGenerateNew,
      });
    }

    return items;
  };

  // 紧凑模式渲染
  if (compact) {
    if (loading) {
      return <Spin size="small" />;
    }

    return (
      <>
        <Dropdown
          menu={{ items: buildMenuItems() }}
          trigger={['click']}
          placement="bottomRight"
        >
          <div className="versionCompact">
            {versions.length > 0 ? (
              <Tag className="versionCompactTag versionCompactTagCurrent">
                v{localCurrentVersion} <DownOutlined className="versionCompactIcon" />
              </Tag>
            ) : (
              <Tag className="versionCompactTag">
                无版本 <DownOutlined className="versionCompactIcon" />
              </Tag>
            )}
          </div>
        </Dropdown>

        <Modal
          title="视频预览"
          open={previewVisible}
          onCancel={() => setPreviewVisible(false)}
          footer={null}
          width={720}
          centered
          destroyOnHidden
        >
          <video
            src={previewUrl}
            controls
            autoPlay
            className="videoVersionPreviewPlayer"
          />
        </Modal>
      </>
    );
  }

  // 完整模式渲染
  return (
    <div className="videoVersionList">
      {loading ? (
        <Spin size="small" />
      ) : (
        <>
          <div className="versionHeader">
            <HistoryOutlined />
            <Text type="secondary" className="versionTime">
              {versions.length} 个版本
            </Text>
          </div>

          <div className="versionGrid">
            {versions.slice(0, 4).map(v => (
              <Tooltip
                key={v.version}
                title={`v${v.version} - ${formatTime(v.createdAt)}`}
              >
                <div
                  className={`versionThumb ${v.version === localCurrentVersion ? 'active' : ''}`}
                  onClick={() => handleSwitchVersion(v.version)}
                >
                  {v.media?.image ? (
                    <img
                      src={(() => {
                        const source = getMediaAssetDisplaySource(v.media?.image);
                        if (!source) return '';
                        if (/^https?:\/\//i.test(source) || source.startsWith('data:')) return source;
                        return electronService.fs.toLocalUrl(source);
                      })()}
                      alt={`v${v.version}`}
                    />
                  ) : (
                    <VideoCameraOutlined />
                  )}
                  <span className="versionLabel">v{v.version}</span>
                  {v.version === localCurrentVersion && (
                    <CheckCircleFilled className="versionCheck" />
                  )}
                </div>
              </Tooltip>
            ))}

            {versions.length > 4 && (
              <Dropdown menu={{ items: buildMenuItems() }} trigger={['click']}>
                <div className="versionMore">
                  +{versions.length - 4}
                </div>
              </Dropdown>
            )}
          </div>

          {onGenerateNew && (
            <Button
              type="text"
              size="small"
              icon={isGenerating ? <LoadingOutlined /> : <PlusOutlined />}
              onClick={onGenerateNew}
              disabled={isGenerating}
              className="generateBtn"
            >
              {isGenerating ? '生成中' : '新版本'}
            </Button>
          )}
        </>
      )}

      <Modal
        title="视频预览"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={720}
        centered
        destroyOnHidden
      >
        <video
          src={previewUrl}
          controls
          autoPlay
          className="videoVersionPreviewPlayer"
        />
      </Modal>
    </div>
  );
};

export default VideoVersionList;
