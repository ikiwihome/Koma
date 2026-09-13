import type {
  Character,
  Prop,
  Scene,
  Shot,
  ShotVersion,
  StoredMediaAsset,
} from '../../types';
import { getMediaAssetSource } from '../../types';

function ensureCreatedAt(asset: StoredMediaAsset): StoredMediaAsset {
  if (asset.createdAt) return asset;
  return { ...asset, createdAt: Date.now() };
}

function compactAsset(asset?: StoredMediaAsset): StoredMediaAsset | undefined {
  if (!asset) return undefined;
  const source = getMediaAssetSource(asset);
  if (!source) return undefined;
  return ensureCreatedAt(asset);
}

function compactAssets(assets?: StoredMediaAsset[]): StoredMediaAsset[] | undefined {
  if (!assets?.length) return undefined;
  const compacted = assets.map(compactAsset).filter(Boolean) as StoredMediaAsset[];
  return compacted.length ? compacted : undefined;
}

function mergeLegacyGridImage(
  images: StoredMediaAsset[] | undefined,
  legacyGridImage?: StoredMediaAsset
): StoredMediaAsset[] | undefined {
  if (!legacyGridImage) return images;
  const next = images ? [...images] : [];
  const legacySource = getMediaAssetSource(legacyGridImage);
  const exists = next.some(asset => getMediaAssetSource(asset) === legacySource);
  if (!exists) {
    next.unshift(legacyGridImage);
  }
  return next.length ? next : undefined;
}

function clampIndex(index: number | undefined, length: number): number | undefined {
  if (!length) return undefined;
  if (index == null || Number.isNaN(index)) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function normalizeCharacterMediaState(character: Character): Character {
  const costumePhoto = compactAsset(character.media?.costumePhoto);
  const previewVideo = compactAsset(character.media?.previewVideo);
  const media = (costumePhoto || previewVideo)
    ? { costumePhoto, previewVideo }
    : undefined;
  return { ...character, media };
}

export function normalizeSceneMediaState(scene: Scene): Scene {
  const previewImage = compactAsset(scene.media?.previewImage);
  const media = previewImage ? { previewImage } : undefined;
  return { ...scene, media };
}

export function normalizePropMediaState(prop: Prop): Prop {
  const previewImage = compactAsset(prop.media?.previewImage);
  const previewVideo = compactAsset(prop.media?.previewVideo);
  const media = (previewImage || previewVideo)
    ? { previewImage, previewVideo }
    : undefined;
  return { ...prop, media };
}

export function normalizeShotVersionMediaState(version: ShotVersion): ShotVersion {
  const image = compactAsset(version.media?.image);
  const video = compactAsset(version.media?.video);
  const audio = compactAsset(version.media?.audio);
  const media = (image || video || audio) ? { image, video, audio } : undefined;
  return { ...version, media };
}

export function normalizeShotMediaState(shot: Shot): Shot {
  const references = compactAssets(shot.media?.references);
  const legacyGridImage = compactAsset(shot.media?.gridImage);
  const images = mergeLegacyGridImage(compactAssets(shot.media?.images), legacyGridImage);
  const videos = compactAssets(shot.media?.videos);
  // 修 bug: 这里之前漏处理 audios → saveEpisodeShots → normalize 把内存里的配音
  // 给抹掉了 → DB 覆盖 → 切回分镜后语音消失，最终剪辑也读不到音频资源。
  const audios = compactAssets(shot.media?.audios);

  const selectedReferenceIndex = clampIndex(
    shot.media?.selectedReferenceIndex,
    references?.length || 0
  );
  const currentImageIndex = clampIndex(
    shot.media?.currentImageIndex,
    images?.length || 0
  );
  const currentVideoIndex = clampIndex(
    shot.media?.currentVideoIndex,
    videos?.length || 0
  );
  const currentAudioIndex = clampIndex(
    shot.media?.currentAudioIndex,
    audios?.length || 0
  );

  const media = (references || images || videos || audios)
    ? {
      references,
      images,
      videos,
      audios,
      selectedReferenceIndex,
      currentImageIndex,
      currentVideoIndex,
      currentAudioIndex,
    }
    : undefined;

  return { ...shot, media };
}

export function normalizeCharactersMediaState(characters: Character[]): Character[] {
  return characters.map(normalizeCharacterMediaState);
}

export function normalizeScenesMediaState(scenes: Scene[]): Scene[] {
  return scenes.map(normalizeSceneMediaState);
}

export function normalizePropsMediaState(props: Prop[]): Prop[] {
  return props.map(normalizePropMediaState);
}

export function normalizeShotsMediaState(shots: Shot[]): Shot[] {
  return shots.map(normalizeShotMediaState);
}

export function normalizeShotVersionsMediaState(versions: ShotVersion[]): ShotVersion[] {
  return versions.map(normalizeShotVersionMediaState);
}
