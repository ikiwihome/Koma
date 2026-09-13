/**
 * 素材聚合 Hook
 * 从 shots, characters, scenes, props 聚合素材
 */
import { useState, useEffect, useCallback } from 'react';
import type { AssetItem } from '../../types/editor';
import type { Shot, Character, Scene, Prop } from '../../types';
import { getShotScriptText } from '../../types';
import { loadEpisodeShots, loadCharacters, loadScenes, loadProps } from '../../store/projectStore';
import { createLogger } from '../../store/logger';
import {
  getCharacterCostumePhotoSource,
  getCharacterPreviewVideoSource,
  getPropPreviewImageSource,
  getScenePreviewImageSource,
  getShotCurrentImageSource,
  getShotCurrentVideoSource,
  getShotCurrentAudioAsset,
  getShotCurrentAudioSource,
} from '../../utils/mediaSelectors';

const logger = createLogger('useAssets');

interface UseAssetsOptions {
  projectId: string;
  episodeId: string;
}

interface UseAssetsReturn {
  assets: AssetItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addUploadedAsset: (asset: AssetItem) => void;
}

// 默认视频时长（秒）
const DEFAULT_VIDEO_DURATION = 5;
// 默认图片时长（秒）
const DEFAULT_IMAGE_DURATION = 3;

export function useAssets({ projectId, episodeId }: UseAssetsOptions): UseAssetsReturn {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [uploadedAssets, setUploadedAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    if (!projectId || !episodeId) {
      setAssets([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 并行加载各类数据
      const [shots, characters, scenes, props] = await Promise.all([
        loadEpisodeShots(projectId, episodeId),
        loadCharacters(projectId),
        loadScenes(projectId),
        loadProps(projectId),
      ]);

      const aggregated: AssetItem[] = [];

      // 1. 从分镜提取素材
      shots.forEach((shot: Shot) => {
        const videoPath = getShotCurrentVideoSource(shot);
        const imagePath = getShotCurrentImageSource(shot);
        const audioAsset = getShotCurrentAudioAsset(shot);
        const audioPath = getShotCurrentAudioSource(shot);
        const shotName = getShotScriptText(shot).trim().slice(0, 24) || `分镜 ${shot.id.slice(0, 6)}`;

        // 视频
        if (videoPath) {
          aggregated.push({
            id: `shot-video-${shot.id}`,
            name: shotName,
            type: 'video',
            src: videoPath,
            thumbnailSrc: imagePath || videoPath,
            duration: shot.duration || DEFAULT_VIDEO_DURATION,
            source: 'shot',
            metadata: { shotId: shot.id },
          });
        }
        // 图片（如果没有视频）
        else if (imagePath) {
          aggregated.push({
            id: `shot-image-${shot.id}`,
            name: shotName,
            type: 'image',
            src: imagePath,
            thumbnailSrc: imagePath,
            duration: DEFAULT_IMAGE_DURATION,
            source: 'shot',
            metadata: { shotId: shot.id },
          });
        }
        // 配音（独立条目，与 video / image 并列；time line 可拖到音频轨）
        if (audioPath) {
          const audioDurationSec = audioAsset?.durationMs
            ? Math.max(1, audioAsset.durationMs / 1000)
            : (shot.duration || DEFAULT_VIDEO_DURATION);
          aggregated.push({
            id: `shot-audio-${shot.id}`,
            name: `${shotName} - 配音`,
            type: 'audio',
            src: audioPath,
            duration: audioDurationSec,
            source: 'shot',
            metadata: { shotId: shot.id },
          });
        }
      });

      // 2. 从角色提取素材
      characters.forEach((char: Character) => {
        const previewVideoPath = getCharacterPreviewVideoSource(char);
        const costumePhotoPath = getCharacterCostumePhotoSource(char);

        // 角色预览视频
        if (previewVideoPath) {
          aggregated.push({
            id: `char-video-${char.id}`,
            name: `${char.name} - 预览`,
            type: 'video',
            src: previewVideoPath,
            thumbnailSrc: costumePhotoPath || previewVideoPath,
            duration: DEFAULT_VIDEO_DURATION,
            source: 'character',
            metadata: { characterId: char.id },
          });
        }
        // 角色服装照
        if (costumePhotoPath) {
          aggregated.push({
            id: `char-image-${char.id}`,
            name: `${char.name} - 服装`,
            type: 'image',
            src: costumePhotoPath,
            thumbnailSrc: costumePhotoPath,
            duration: DEFAULT_IMAGE_DURATION,
            source: 'character',
            metadata: { characterId: char.id },
          });
        }
      });

      // 3. 从场景提取素材
      scenes.forEach((scene: Scene) => {
        const imagePath = getScenePreviewImageSource(scene);
        if (imagePath) {
          aggregated.push({
            id: `scene-image-${scene.id}`,
            name: scene.name,
            type: 'image',
            src: imagePath,
            thumbnailSrc: imagePath,
            duration: DEFAULT_IMAGE_DURATION,
            source: 'scene',
            metadata: { sceneId: scene.id },
          });
        }
      });

      // 4. 从道具提取素材
      props.forEach((prop: Prop) => {
        const imagePath = getPropPreviewImageSource(prop);
        if (imagePath) {
          aggregated.push({
            id: `prop-image-${prop.id}`,
            name: prop.name,
            type: 'image',
            src: imagePath,
            thumbnailSrc: imagePath,
            duration: DEFAULT_IMAGE_DURATION,
            source: 'prop',
            metadata: { propId: prop.id },
          });
        }
      });

      // 合并上传的素材
      setAssets([...aggregated, ...uploadedAssets]);
    } catch (err) {
      logger.error('Failed to load assets:', err);
      setError(err instanceof Error ? err.message : '加载素材失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, episodeId, uploadedAssets]);

  // 初始加载
  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // 添加上传的素材
  const addUploadedAsset = useCallback((asset: AssetItem) => {
    setUploadedAssets(prev => [...prev, asset]);
  }, []);

  return {
    assets,
    loading,
    error,
    refresh: loadAssets,
    addUploadedAsset,
  };
}
