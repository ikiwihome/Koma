/**
 * 项目资产总览组件
 * 显示项目中所有角色、场景、道具及其跨集使用情况
 */
import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Tabs, Avatar, Empty, Spin, Tooltip, Popconfirm, Button, message } from 'antd';
import { User, MapPin, Box, Link, Trash2 } from 'lucide-react';
import type { Character, Scene, Prop, EpisodeRef } from '../../types';
import { isBlobUri, isDataUri, isRemoteMediaUri } from '../../types';
import {
  loadCharacters,
  saveCharacters,
  loadScenes,
  saveScenes,
  loadProps,
  saveProps,
  getOrphanedAssets,
  repairAssetEpisodeRefs,
  listEpisodes,
  removeAssetFromAnalysis,
} from '../../store/projectStore';
import { electronService } from '../../services/electronService';
import { createLogger } from '../../store/logger';
import { useTaskTransitions } from '../../hooks';
import { getCharacterCostumePhotoSource } from '../../utils/mediaSelectors';

const logger = createLogger('ProjectAssetOverview');

type ProjectAssetType = 'character' | 'scene' | 'prop';
type ProjectAssetTabKey = 'characters' | 'scenes' | 'props';
type ProjectAsset = Character | Scene | Prop;

const assetTypeLabel: Record<ProjectAssetType, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
};

function isSkippableMediaUri(value?: string): boolean {
  const trimmed = value?.trim();
  return Boolean(
    trimmed && (
      isRemoteMediaUri(trimmed) ||
      isDataUri(trimmed) ||
      isBlobUri(trimmed) ||
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    )
  );
}

function isDeletableLocalPath(value?: string): value is string {
  const trimmed = value?.trim();
  return Boolean(trimmed && !isSkippableMediaUri(trimmed));
}

function getLocalMediaPaths(asset: ProjectAsset, type: ProjectAssetType): string[] {
  if (type === 'character') {
    const character = asset as Character;
    return [
      character.media?.costumePhoto?.localPath,
      character.media?.previewVideo?.localPath,
    ].filter(isDeletableLocalPath);
  }

  if (type === 'scene') {
    const scene = asset as Scene;
    return [scene.media?.previewImage?.localPath].filter(isDeletableLocalPath);
  }

  const prop = asset as Prop;
  return [
    prop.media?.previewImage?.localPath,
    prop.media?.previewVideo?.localPath,
  ].filter(isDeletableLocalPath);
}

async function removeLocalMediaFiles(paths: string[]): Promise<string[]> {
  const failures: string[] = [];
  const uniquePaths = Array.from(new Set(paths));

  await Promise.all(uniquePaths.map(async (path) => {
    try {
      await electronService.fs.remove(path);
    } catch (error) {
      failures.push(path);
      logger.warn('删除项目资产本地媒体失败', { path, error });
    }
  }));

  return failures;
}

interface ProjectAssetOverviewProps {
  projectId: string;
  onAssetClick?: (assetId: string, type: 'character' | 'scene' | 'prop') => void;
}

export interface ProjectAssetOverviewRef {
  refresh: () => void;
}

export const ProjectAssetOverview = forwardRef<ProjectAssetOverviewRef, ProjectAssetOverviewProps>(({
  projectId,
  onAssetClick,
}, ref) => {
  const [loading, setLoading] = useState(true);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [props, setProps] = useState<Prop[]>([]);
  const [orphanedCount, setOrphanedCount] = useState(0);
  const [deletingAssetIds, setDeletingAssetIds] = useState<Set<string>>(() => new Set());
  const [activeTab, setActiveTab] = useState<ProjectAssetTabKey>('characters');

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      // 先修复可能缺失的 episodeRefs
      await repairAssetEpisodeRefs(projectId);

      const [chars, scns, prps, orphaned] = await Promise.all([
        loadCharacters(projectId),
        loadScenes(projectId),
        loadProps(projectId),
        getOrphanedAssets(projectId),
      ]);
      setCharacters(chars);
      setScenes(scns);
      setProps(prps);
      setOrphanedCount(
        orphaned.characters.length + orphaned.scenes.length + orphaned.props.length
      );
    } catch (err) {
      logger.error('加载资产失败:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  useImperativeHandle(ref, () => ({ refresh: loadAssets }), [loadAssets]);

  useTaskTransitions(
    {
      scope: `project:${projectId}`,
      type: 'script-analysis',
      to: ['completed'],
    },
    () => loadAssets()
  );

  const setAssetDeleting = useCallback((assetKey: string, deleting: boolean) => {
    setDeletingAssetIds((prev) => {
      const next = new Set(prev);
      if (deleting) {
        next.add(assetKey);
      } else {
        next.delete(assetKey);
      }
      return next;
    });
  }, []);

  const handleDeleteAsset = useCallback(async (type: ProjectAssetType, assetId: string) => {
    const assetKey = `${type}:${assetId}`;
    setAssetDeleting(assetKey, true);

    try {
      let target: ProjectAsset | undefined;
      let nextCharacters: Character[] | undefined;
      let nextScenes: Scene[] | undefined;
      let nextProps: Prop[] | undefined;

      if (type === 'character') {
        const current = await loadCharacters(projectId);
        target = current.find((item) => item.id === assetId);
        nextCharacters = current.filter((item) => item.id !== assetId);
      } else if (type === 'scene') {
        const current = await loadScenes(projectId);
        target = current.find((item) => item.id === assetId);
        nextScenes = current.filter((item) => item.id !== assetId);
      } else {
        const current = await loadProps(projectId);
        target = current.find((item) => item.id === assetId);
        nextProps = current.filter((item) => item.id !== assetId);
      }

      if (!target) {
        message.warning('资产不存在或已被删除');
        await loadAssets();
        return;
      }

      const episodes = await listEpisodes(projectId);
      await Promise.all(episodes.map((episode) => (
        removeAssetFromAnalysis(projectId, episode.id, assetId, type)
      )));

      if (type === 'character' && nextCharacters) {
        await saveCharacters(projectId, nextCharacters);
      } else if (type === 'scene' && nextScenes) {
        await saveScenes(projectId, nextScenes);
      } else if (type === 'prop' && nextProps) {
        await saveProps(projectId, nextProps);
      }

      const mediaFailures = await removeLocalMediaFiles(getLocalMediaPaths(target, type));
      await loadAssets();

      if (mediaFailures.length > 0) {
        message.warning('资产已删除，部分本地媒体文件删除失败');
      } else {
        message.success(`${assetTypeLabel[type]}已删除`);
      }
    } catch (error) {
      logger.error('删除项目资产失败:', error);
      message.error(`删除${assetTypeLabel[type]}失败`);
    } finally {
      setAssetDeleting(assetKey, false);
    }
  }, [loadAssets, projectId, setAssetDeleting]);

  const renderDeleteButton = (type: ProjectAssetType, asset: ProjectAsset) => {
    const assetKey = `${type}:${asset.id}`;

    return (
      <Popconfirm
        title={`永久删除${assetTypeLabel[type]}？`}
        description={(
          <div className="max-w-[280px] text-xs leading-5">
            会从项目资产库永久删除，并移除所有剧集/分镜引用；
            关联本地媒体文件也会删除；无法恢复。远程媒体不会被本地删除。
          </div>
        )}
        okText="永久删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        placement="left"
        onConfirm={() => handleDeleteAsset(type, asset.id)}
      >
        <Button
          type="text"
          danger
          size="small"
          icon={<Trash2 className="w-3.5 h-3.5" />}
          loading={deletingAssetIds.has(assetKey)}
          onClick={(event) => event.stopPropagation()}
          className="flex-shrink-0 opacity-80 hover:opacity-100"
          aria-label={`删除${assetTypeLabel[type]} ${asset.name}`}
          title={`删除${assetTypeLabel[type]}`}
        />
      </Popconfirm>
    );
  };

  const renderEpisodeRefs = (refs?: EpisodeRef[]) => {
    if (!refs || refs.length === 0) {
      return <span className="text-[10px] px-1.5 py-0.5 bg-bg-elevated text-text-tertiary rounded">未使用</span>;
    }
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {refs.slice(0, 2).map((ref, idx) => (
          <Tooltip key={idx} title={ref.firstAppearance ? '首次出现' : '复用'}>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              ref.firstAppearance
                ? 'bg-status-success/15 text-status-success'
                : 'bg-status-info/15 text-status-info'
            }`}>
              {ref.episodeName || `E${idx + 1}`}
            </span>
          </Tooltip>
        ))}
        {refs.length > 2 && (
          <span className="text-[10px] px-1.5 py-0.5 bg-bg-elevated text-text-secondary rounded">
            +{refs.length - 2}
          </span>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 统计栏 */}
      <div className="px-4 py-3 border-b border-border-subtle/80">
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-lg font-semibold text-text-primary">{characters.length}</div>
            <div className="text-[10px] text-text-tertiary">角色</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-text-primary">{scenes.length}</div>
            <div className="text-[10px] text-text-tertiary">场景</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-text-primary">{props.length}</div>
            <div className="text-[10px] text-text-tertiary">道具</div>
          </div>
        </div>
        {orphanedCount > 0 && (
          <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-status-warning">
            <Link className="w-3 h-3" />
            {orphanedCount} 个未使用
          </div>
        )}
      </div>

      {/* Tab 内容 */}
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as ProjectAssetTabKey)}
        centered
        size="small"
        className="flex-1 overflow-hidden [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full"
        items={[
          {
            key: 'characters',
            label: (
              <span className="flex items-center gap-1 text-xs">
                <User className="w-3 h-3" />
                角色
              </span>
            ),
            children: (
              <div className="h-full overflow-y-auto p-2">
                {characters.length === 0 ? (
                  <Empty description="暂无角色" className="py-6" imageStyle={{ height: 40 }} />
                ) : (
                  <div className="flex flex-col gap-1">
                    {characters.map((char) => (
                      <div
                        key={char.id}
                        onClick={() => onAssetClick?.(char.id, 'character')}
                        className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-bg-elevated/50 transition-colors"
                      >
                        <Avatar
                          size={32}
                          src={(() => {
                            const source = getCharacterCostumePhotoSource(char);
                            if (!source) return undefined;
                            if (/^https?:\/\//i.test(source) || source.startsWith('data:')) return source;
                            return electronService.fs.toLocalUrl(source);
                          })()}
                          className="bg-accent-hover flex-shrink-0"
                        >
                          {char.name.charAt(0)}
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary truncate">{char.name}</div>
                          {renderEpisodeRefs(char.episodeRefs)}
                        </div>
                        {renderDeleteButton('character', char)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'scenes',
            label: (
              <span className="flex items-center gap-1 text-xs">
                <MapPin className="w-3 h-3" />
                场景
              </span>
            ),
            children: (
              <div className="h-full overflow-y-auto p-2">
                {scenes.length === 0 ? (
                  <Empty description="暂无场景" className="py-6" imageStyle={{ height: 40 }} />
                ) : (
                  <div className="flex flex-col gap-1">
                    {scenes.map((scene) => (
                      <div
                        key={scene.id}
                        onClick={() => onAssetClick?.(scene.id, 'scene')}
                        className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-bg-elevated/50 transition-colors"
                      >
                        <Avatar size={32} className="!bg-accent flex-shrink-0">
                          <MapPin className="w-4 h-4" />
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary truncate">{scene.name}</div>
                          {renderEpisodeRefs(scene.episodeRefs)}
                        </div>
                        {renderDeleteButton('scene', scene)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'props',
            label: (
              <span className="flex items-center gap-1 text-xs">
                <Box className="w-3 h-3" />
                道具
              </span>
            ),
            children: (
              <div className="h-full overflow-y-auto p-2">
                {props.length === 0 ? (
                  <Empty description="暂无道具" className="py-6" imageStyle={{ height: 40 }} />
                ) : (
                  <div className="flex flex-col gap-1">
                    {props.map((prop) => (
                      <div
                        key={prop.id}
                        onClick={() => onAssetClick?.(prop.id, 'prop')}
                        className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-bg-elevated/50 transition-colors"
                      >
                        <Avatar size={32} className="!bg-status-warning flex-shrink-0">
                          <Box className="w-4 h-4" />
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary truncate">{prop.name}</div>
                          {renderEpisodeRefs(prop.episodeRefs)}
                        </div>
                        {renderDeleteButton('prop', prop)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
});

ProjectAssetOverview.displayName = 'ProjectAssetOverview';

export default ProjectAssetOverview;
