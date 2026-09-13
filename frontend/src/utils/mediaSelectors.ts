import type {
  Character,
  Prop,
  Scene,
  Shot,
  ShotVersion,
  StoredMediaAsset,
} from '../types';
import { getMediaAssetDisplaySource } from '../types';

export function getAssetDisplaySource(asset?: StoredMediaAsset): string | undefined {
  // Delegates to the shared selector; Electron prefers localPath to avoid CORS.
  // Kept as a wrapper so callers can stay consistent in this module.
  return getMediaAssetDisplaySource(asset);
}

export function getCharacterCostumePhotoSource(character?: Character): string | undefined {
  return getMediaAssetDisplaySource(character?.media?.costumePhoto);
}

export function getCharacterPreviewVideoSource(character?: Character): string | undefined {
  return getMediaAssetDisplaySource(character?.media?.previewVideo);
}

export function getCharacterPreviewVideoTaskId(character?: Character): string | undefined {
  return character?.media?.previewVideo?.providerTaskId;
}

export function getScenePreviewImageSource(scene?: Scene): string | undefined {
  return getMediaAssetDisplaySource(scene?.media?.previewImage);
}

export function getPropPreviewImageSource(prop?: Prop): string | undefined {
  return getMediaAssetDisplaySource(prop?.media?.previewImage);
}

export function getPropPreviewVideoSource(prop?: Prop): string | undefined {
  return getMediaAssetDisplaySource(prop?.media?.previewVideo);
}

export function getPropPreviewVideoTaskId(prop?: Prop): string | undefined {
  return prop?.media?.previewVideo?.providerTaskId;
}

export function getShotReferenceAssets(shot?: Shot): StoredMediaAsset[] {
  return shot?.media?.references || [];
}

export function getShotImageAssets(shot?: Shot): StoredMediaAsset[] {
  return shot?.media?.images || [];
}

export function getShotVideoAssets(shot?: Shot): StoredMediaAsset[] {
  return shot?.media?.videos || [];
}

export function getShotAudioAssets(shot?: Shot): StoredMediaAsset[] {
  return shot?.media?.audios || [];
}

export function getShotCurrentImageAsset(shot?: Shot): StoredMediaAsset | undefined {
  const images = getShotImageAssets(shot);
  const index = shot?.media?.currentImageIndex ?? 0;
  return images[index];
}

export function getShotCurrentVideoAsset(shot?: Shot): StoredMediaAsset | undefined {
  const videos = getShotVideoAssets(shot);
  const index = shot?.media?.currentVideoIndex ?? 0;
  return videos[index];
}

export function getShotCurrentAudioAsset(shot?: Shot): StoredMediaAsset | undefined {
  const audios = getShotAudioAssets(shot);
  if (!audios.length) return undefined;
  const idx = shot?.media?.currentAudioIndex ?? audios.length - 1;
  return audios[idx] || audios[audios.length - 1];
}

export function getShotCurrentImageSource(shot?: Shot): string | undefined {
  return getMediaAssetDisplaySource(getShotCurrentImageAsset(shot));
}

export function getShotCurrentVideoSource(shot?: Shot): string | undefined {
  return getMediaAssetDisplaySource(getShotCurrentVideoAsset(shot));
}

export function getShotCurrentAudioSource(shot?: Shot): string | undefined {
  return getMediaAssetDisplaySource(getShotCurrentAudioAsset(shot));
}

export function getShotVersionImageSource(version?: ShotVersion): string | undefined {
  return getMediaAssetDisplaySource(version?.media?.image);
}

export function getShotVersionVideoSource(version?: ShotVersion): string | undefined {
  return getMediaAssetDisplaySource(version?.media?.video);
}

export function getShotVersionAudioSource(version?: ShotVersion): string | undefined {
  return getMediaAssetDisplaySource(version?.media?.audio);
}
