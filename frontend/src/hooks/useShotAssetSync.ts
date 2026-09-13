/**
 * 分镜资产同步 Hook
 * 实现提示词编辑器与资产选择器的双向同步
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Character, Scene, Prop } from '../types';
import { parseMentions, createMentionString, isAssetMentionType } from '../editor/mentionTypes';
import type { AssetMentionType, ParsedMention } from '../editor/mentionTypes';

export interface ShotAssetSyncState {
  selectedCharacters: string[];
  selectedScenes: string[];
  selectedProps: string[];
  mentionedAssets: ParsedMention[];
}

export interface ShotAssetSyncActions {
  // 从提示词解析并同步到资产选择
  syncFromPrompt: (prompt: string) => ShotAssetSyncState;
  // 当资产选择变更时，更新提示词
  handleAssetChange: (
    type: 'character' | 'scene' | 'prop',
    ids: string[],
    currentPrompt: string,
    assets: { characters: Character[]; scenes: Scene[]; props: Prop[] }
  ) => string;
  // 比较并获取差异
  getDiff: (
    prompt: string,
    selectedCharacters: string[],
    selectedScenes: string[],
    selectedProps: string[]
  ) => {
    toAdd: { type: AssetMentionType; id: string; name: string }[];
    toRemove: { type: AssetMentionType; id: string }[];
  };
}

/**
 * 资产ID映射到 Mention ID
 * 收口：统一使用资产自身 ID（项目内 ID），不再在提示词层混入 Provider 私有 ID。
 */
function getAssetMentionId(
  _type: 'character' | 'scene' | 'prop',
  assetId: string,
  _assets: { characters: Character[]; scenes: Scene[]; props: Prop[] }
): string {
  return assetId;
}

/**
 * 从 Mention ID 反查资产 ID
 */
function getAssetIdFromMention(
  type: AssetMentionType,
  mentionId: string,
  assets: { characters: Character[]; scenes: Scene[]; props: Prop[] }
): string | null {
  // 构建带前缀的完整 ID（regex 解析时 prefix 被拆到 group1）
  const fullId = `${type}_${mentionId}`;

  if (type === 'char') {
    const char = assets.characters.find(
      c => c.id === mentionId || c.id === fullId
    );
    return char?.id || null;
  }
  if (type === 'prop') {
    const prop = assets.props.find(
      p => p.id === mentionId || p.id === fullId
    );
    return prop?.id || null;
  }
  if (type === 'scene') {
    const scene = assets.scenes.find(s => s.id === mentionId || s.id === fullId);
    return scene?.id || null;
  }
  return null;
}

/**
 * 类型映射
 */
function assetTypeToMentionType(type: 'character' | 'scene' | 'prop'): AssetMentionType {
  const map: Record<string, AssetMentionType> = {
    character: 'char',
    scene: 'scene',
    prop: 'prop',
  };
  return map[type];
}

/**
 * 分镜资产同步 Hook
 */
export function useShotAssetSync(
  assets: { characters: Character[]; scenes: Scene[]; props: Prop[] }
): ShotAssetSyncActions {
  /**
   * 从提示词解析出选中的资产
   */
  const syncFromPrompt = useCallback(
    (prompt: string): ShotAssetSyncState => {
      const mentions = parseMentions(prompt);

      const selectedCharacters: string[] = [];
      const selectedScenes: string[] = [];
      const selectedProps: string[] = [];

      for (const mention of mentions) {
        if (!isAssetMentionType(mention.type)) continue;
        const assetId = getAssetIdFromMention(mention.type, mention.id, assets);
        if (!assetId) continue;

        if (mention.type === 'char' && !selectedCharacters.includes(assetId)) {
          selectedCharacters.push(assetId);
        } else if (mention.type === 'scene' && !selectedScenes.includes(assetId)) {
          selectedScenes.push(assetId);
        } else if (mention.type === 'prop' && !selectedProps.includes(assetId)) {
          selectedProps.push(assetId);
        }
      }

      return {
        selectedCharacters,
        selectedScenes,
        selectedProps,
        mentionedAssets: mentions,
      };
    },
    [assets]
  );

  /**
   * 获取差异：提示词中的 mentions 与当前选中资产的差异
   */
  const getDiff = useCallback(
    (
      prompt: string,
      selectedCharacters: string[],
      selectedScenes: string[],
      selectedProps: string[]
    ) => {
      const mentions = parseMentions(prompt);
      const toAdd: { type: AssetMentionType; id: string; name: string }[] = [];
      const toRemove: { type: AssetMentionType; id: string }[] = [];

      // 检查是否有新增的资产（选中但不在提示词中）
      for (const charId of selectedCharacters) {
        const char = assets.characters.find(c => c.id === charId);
        if (!char) continue;
        const mentionId = charId;
        const inPrompt = mentions.some(m => m.type === 'char' && m.id === mentionId);
        if (!inPrompt) {
          toAdd.push({ type: 'char', id: charId, name: char.name });
        }
      }

      for (const sceneId of selectedScenes) {
        const scene = assets.scenes.find(s => s.id === sceneId);
        if (!scene) continue;
        const inPrompt = mentions.some(m => m.type === 'scene' && m.id === sceneId);
        if (!inPrompt) {
          toAdd.push({ type: 'scene', id: sceneId, name: scene.name });
        }
      }

      for (const propId of selectedProps) {
        const prop = assets.props.find(p => p.id === propId);
        if (!prop) continue;
        const mentionId = propId;
        const inPrompt = mentions.some(m => m.type === 'prop' && m.id === mentionId);
        if (!inPrompt) {
          toAdd.push({ type: 'prop', id: propId, name: prop.name });
        }
      }

      // 检查是否有需要移除的（在提示词中但未选中）
      for (const mention of mentions) {
        if (!isAssetMentionType(mention.type)) continue;
        const assetId = getAssetIdFromMention(mention.type, mention.id, assets);
        if (!assetId) continue;

        let isSelected = false;
        if (mention.type === 'char') {
          isSelected = selectedCharacters.includes(assetId);
        } else if (mention.type === 'scene') {
          isSelected = selectedScenes.includes(assetId);
        } else if (mention.type === 'prop') {
          isSelected = selectedProps.includes(assetId);
        }

        if (!isSelected) {
          toRemove.push({ type: mention.type, id: mention.id });
        }
      }

      return { toAdd, toRemove };
    },
    [assets]
  );

  /**
   * 当资产选择变更时，更新提示词
   */
  const handleAssetChange = useCallback(
    (
      type: 'character' | 'scene' | 'prop',
      newIds: string[],
      currentPrompt: string,
      currentAssets: { characters: Character[]; scenes: Scene[]; props: Prop[] }
    ): string => {
      let updatedPrompt = currentPrompt;
      const mentionType = assetTypeToMentionType(type);

      // 获取当前提示词中该类型的所有 mentions
      const mentions = parseMentions(currentPrompt);
      const currentMentions = mentions.filter(
        (m): m is ParsedMention & { type: AssetMentionType } =>
          isAssetMentionType(m.type) && m.type === mentionType,
      );

      // 获取当前提示词中已有的资产 ID
      const currentAssetIds = currentMentions
        .map(m => getAssetIdFromMention(m.type, m.id, currentAssets))
        .filter(Boolean) as string[];

      // 计算需要添加和移除的
      const toAdd = newIds.filter(id => !currentAssetIds.includes(id));
      const toRemove = currentAssetIds.filter(id => !newIds.includes(id));

      // 移除不再选中的 mentions
      for (const removeId of toRemove) {
        const mentionId = getAssetMentionId(type, removeId, currentAssets);
        const mentionStr = createMentionString(mentionType, mentionId);
        // 移除 mention 及其后面可能的空格
        updatedPrompt = updatedPrompt.replace(new RegExp(`${escapeRegex(mentionStr)}\\s*`, 'g'), '');
      }

      // 添加新选中的 mentions
      for (const addId of toAdd) {
        const mentionId = getAssetMentionId(type, addId, currentAssets);
        const mentionStr = createMentionString(mentionType, mentionId);
        // 在提示词末尾添加（带空格分隔）
        if (updatedPrompt.trim()) {
          updatedPrompt = `${updatedPrompt.trim()} ${mentionStr}`;
        } else {
          updatedPrompt = mentionStr;
        }
      }

      return updatedPrompt;
    },
    []
  );

  return {
    syncFromPrompt,
    handleAssetChange,
    getDiff,
  };
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 简化版 Hook：只关注提示词变化时的资产同步
 */
export function usePromptToAssetSync(
  prompt: string,
  assets: { characters: Character[]; scenes: Scene[]; props: Prop[] },
  onAssetChange?: (
    characters: string[],
    scenes: string[],
    props: string[]
  ) => void
) {
  const { syncFromPrompt } = useShotAssetSync(assets);
  const prevPromptRef = useRef(prompt);

  useEffect(() => {
    if (prompt !== prevPromptRef.current) {
      prevPromptRef.current = prompt;
      const state = syncFromPrompt(prompt);
      onAssetChange?.(
        state.selectedCharacters,
        state.selectedScenes,
        state.selectedProps
      );
    }
  }, [prompt, syncFromPrompt, onAssetChange]);
}
