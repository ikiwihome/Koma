/**
 * 资产引用管理
 */
import type { EpisodeRef, Character, Scene, Prop } from '../../types';
import { loadCharacters, saveCharacters } from './entities';
import { loadScenes, saveScenes } from './entities';
import { loadProps, saveProps } from './assetStorage';
import { listEpisodes } from './episodes';
import { loadEpisodeAnalysis } from './analysis';

export function calculateAssetFingerprint(asset: { name: string; description?: string; type?: string }): string {
  const normalizeText = (text: string): string => {
    return text.toLowerCase().replace(/[\s\W_]/g, '').trim();
  };

  const features = [
    normalizeText(asset.name),
    asset.description ? normalizeText(asset.description) : '',
    asset.type || ''
  ].filter(Boolean);

  let hash = 0;
  const str = features.join('|');
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export async function addCharacterEpisodeRef(
  projectId: string,
  characterId: string,
  episodeRef: EpisodeRef
): Promise<void> {
  const characters = await loadCharacters(projectId);
  const character = characters.find(c => c.id === characterId);
  if (!character) return;

  if (!character.episodeRefs) {
    character.episodeRefs = [];
  }

  const exists = character.episodeRefs.some(r => r.episodeId === episodeRef.episodeId);
  if (!exists) {
    character.episodeRefs.push(episodeRef);
    await saveCharacters(projectId, characters);
  }
}

export async function removeCharacterEpisodeRef(
  projectId: string,
  characterId: string,
  episodeId: string
): Promise<void> {
  const characters = await loadCharacters(projectId);
  const character = characters.find(c => c.id === characterId);
  if (!character || !character.episodeRefs) return;

  character.episodeRefs = character.episodeRefs.filter(r => r.episodeId !== episodeId);
  await saveCharacters(projectId, characters);
}

export async function addSceneEpisodeRef(
  projectId: string,
  sceneId: string,
  episodeRef: EpisodeRef
): Promise<void> {
  const scenes = await loadScenes(projectId);
  const scene = scenes.find(s => s.id === sceneId);
  if (!scene) return;

  if (!scene.episodeRefs) {
    scene.episodeRefs = [];
  }

  const exists = scene.episodeRefs.some(r => r.episodeId === episodeRef.episodeId);
  if (!exists) {
    scene.episodeRefs.push(episodeRef);
    await saveScenes(projectId, scenes);
  }
}

export async function removeSceneEpisodeRef(
  projectId: string,
  sceneId: string,
  episodeId: string
): Promise<void> {
  const scenes = await loadScenes(projectId);
  const scene = scenes.find(s => s.id === sceneId);
  if (!scene || !scene.episodeRefs) return;

  scene.episodeRefs = scene.episodeRefs.filter(r => r.episodeId !== episodeId);
  await saveScenes(projectId, scenes);
}

export async function addPropEpisodeRef(
  projectId: string,
  propId: string,
  episodeRef: EpisodeRef
): Promise<void> {
  const props = await loadProps(projectId);
  const prop = props.find(p => p.id === propId);
  if (!prop) return;

  if (!prop.episodeRefs) {
    prop.episodeRefs = [];
  }

  const exists = prop.episodeRefs.some(r => r.episodeId === episodeRef.episodeId);
  if (!exists) {
    prop.episodeRefs.push(episodeRef);
    await saveProps(projectId, props);
  }
}

export async function removePropEpisodeRef(
  projectId: string,
  propId: string,
  episodeId: string
): Promise<void> {
  const props = await loadProps(projectId);
  const prop = props.find(p => p.id === propId);
  if (!prop || !prop.episodeRefs) return;

  prop.episodeRefs = prop.episodeRefs.filter(r => r.episodeId !== episodeId);
  await saveProps(projectId, props);
}

export async function findCharacterByName(
  projectId: string,
  name: string
): Promise<Character | null> {
  const characters = await loadCharacters(projectId);
  const normalized = name.toLowerCase().trim();
  return characters.find(c => c.name.toLowerCase().trim() === normalized) || null;
}

export async function findSceneByName(
  projectId: string,
  name: string
): Promise<Scene | null> {
  const scenes = await loadScenes(projectId);
  const normalized = name.toLowerCase().trim();
  return scenes.find(s => s.name.toLowerCase().trim() === normalized) || null;
}

export async function findPropByName(
  projectId: string,
  name: string
): Promise<Prop | null> {
  const props = await loadProps(projectId);
  const normalized = name.toLowerCase().trim();
  return props.find(p => p.name.toLowerCase().trim() === normalized) || null;
}

export async function getOrphanedAssets(projectId: string): Promise<{
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
}> {
  const [characters, scenes, props] = await Promise.all([
    loadCharacters(projectId),
    loadScenes(projectId),
    loadProps(projectId),
  ]);

  return {
    characters: characters.filter(c => !c.episodeRefs || c.episodeRefs.length === 0),
    scenes: scenes.filter(s => !s.episodeRefs || s.episodeRefs.length === 0),
    props: props.filter(p => !p.episodeRefs || p.episodeRefs.length === 0),
  };
}

/**
 * 从 episodeAnalysis 数据修复缺失的 episodeRefs
 * 遍历所有剧集的 analysis，确保被引用的资产都有对应的 episodeRef
 */
export async function repairAssetEpisodeRefs(projectId: string): Promise<boolean> {
  const episodes = await listEpisodes(projectId);
  if (episodes.length === 0) return false;

  const [characters, scenes, props] = await Promise.all([
    loadCharacters(projectId),
    loadScenes(projectId),
    loadProps(projectId),
  ]);

  const charMap = new Map(characters.map(c => [c.id, c]));
  const sceneMap = new Map(scenes.map(s => [s.id, s]));
  const propMap = new Map(props.map(p => [p.id, p]));

  let charsModified = false;
  let scenesModified = false;
  let propsModified = false;

  for (const episode of episodes) {
    const analysis = await loadEpisodeAnalysis(projectId, episode.id);
    if (!analysis) continue;

    const ref: EpisodeRef = {
      episodeId: episode.id,
      episodeName: episode.title || `第${episode.number}集`,
      firstAppearance: true,
    };

    for (const charId of analysis.characterRefs) {
      const char = charMap.get(charId);
      if (!char) continue;
      if (!char.episodeRefs) char.episodeRefs = [];
      const exists = char.episodeRefs.some(r => r.episodeId === episode.id);
      if (!exists) {
        char.episodeRefs.push(ref);
        charsModified = true;
      }
    }

    for (const sceneId of analysis.sceneRefs) {
      const scene = sceneMap.get(sceneId);
      if (!scene) continue;
      if (!scene.episodeRefs) scene.episodeRefs = [];
      const exists = scene.episodeRefs.some(r => r.episodeId === episode.id);
      if (!exists) {
        scene.episodeRefs.push(ref);
        scenesModified = true;
      }
    }

    for (const propId of analysis.propRefs) {
      const prop = propMap.get(propId);
      if (!prop) continue;
      if (!prop.episodeRefs) prop.episodeRefs = [];
      const exists = prop.episodeRefs.some(r => r.episodeId === episode.id);
      if (!exists) {
        prop.episodeRefs.push(ref);
        propsModified = true;
      }
    }
  }

  const saves: Promise<void>[] = [];
  if (charsModified) saves.push(saveCharacters(projectId, characters));
  if (scenesModified) saves.push(saveScenes(projectId, scenes));
  if (propsModified) saves.push(saveProps(projectId, props));

  if (saves.length > 0) {
    await Promise.all(saves);
    return true;
  }
  return false;
}
