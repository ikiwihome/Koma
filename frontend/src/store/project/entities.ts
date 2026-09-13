/**
 * 角色/场景/道具/分镜 加载和保存（通过 IPC 调后端 SQLite）
 */
import { batchApi } from '../../services/electronService';
import { electronService } from '../../services/electronService';
import type { Character, Scene, Shot } from '../../types';
import {
  normalizeCharactersMediaState,
  normalizeScenesMediaState,
  normalizeShotsMediaState,
} from './mediaState';
import { createLogger } from '../logger';

const logger = createLogger('ProjectEntities');

export async function loadCharacters(projectId: string): Promise<Character[]> {
  if (!electronService.isElectron()) return [];
  try {
    const raw = await batchApi.loadAllCharacters(projectId);
    return Array.isArray(raw) ? normalizeCharactersMediaState(raw.filter(Boolean)) : [];
  } catch (err) {
    logger.warn('加载角色数据失败', err);
    return [];
  }
}

export async function saveCharacters(projectId: string, characters: Character[]): Promise<void> {
  if (!electronService.isElectron()) return;
  await batchApi.saveAllCharacters(projectId, normalizeCharactersMediaState(characters));
}

export async function loadScenes(projectId: string): Promise<Scene[]> {
  if (!electronService.isElectron()) return [];
  try {
    const raw = await batchApi.loadAllScenes(projectId);
    return Array.isArray(raw) ? normalizeScenesMediaState(raw.filter(Boolean)) : [];
  } catch (err) {
    logger.warn('加载场景数据失败', err);
    return [];
  }
}

export async function saveScenes(projectId: string, scenes: Scene[]): Promise<void> {
  if (!electronService.isElectron()) return;
  await batchApi.saveAllScenes(projectId, normalizeScenesMediaState(scenes));
}

export async function loadShots(projectId: string): Promise<Shot[]> {
  if (!electronService.isElectron()) return [];
  try {
    const raw = await batchApi.loadAllShots(projectId);
    return Array.isArray(raw) ? normalizeShotsMediaState(raw.filter(Boolean)) : [];
  } catch (err) {
    logger.warn('加载分镜数据失败', err);
    return [];
  }
}

export async function saveShots(projectId: string, shots: Shot[]): Promise<void> {
  if (!electronService.isElectron()) return;
  await batchApi.saveAllShots(projectId, normalizeShotsMediaState(shots));
}
