import type {
  Character,
  CharacterMediaSlots,
  MediaKind,
  Prop,
  PropMediaSlots,
  Scene,
  SceneMediaSlots,
  StoredMediaAsset,
} from '../types';

interface CreateStoredMediaAssetOptions {
  localPath?: string;
  remoteUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  fps?: number;
  provider?: string;
  providerTaskId?: string;
  channelId?: string;
  modelId?: string;
  capability?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
}

export function createStoredMediaAsset(
  kind: MediaKind,
  options: CreateStoredMediaAssetOptions
): StoredMediaAsset {
  return {
    kind,
    ...options,
    createdAt: options.createdAt ?? Date.now(),
  };
}

export function updateCharacterMedia(
  character: Character,
  patch: Partial<CharacterMediaSlots>
): Character {
  return {
    ...character,
    media: {
      ...(character.media || {}),
      ...patch,
    },
  };
}

export function updateSceneMedia(
  scene: Scene,
  patch: Partial<SceneMediaSlots>
): Scene {
  return {
    ...scene,
    media: {
      ...(scene.media || {}),
      ...patch,
    },
  };
}

export function updatePropMedia(
  prop: Prop,
  patch: Partial<PropMediaSlots>
): Prop {
  return {
    ...prop,
    media: {
      ...(prop.media || {}),
      ...patch,
    },
  };
}
