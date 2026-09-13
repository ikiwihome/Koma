/**
 * Mention 上下文
 * 在应用中传递可用的角色、道具、场景列表
 */
import React, { createContext, useContext, useMemo } from 'react';
import type { MentionItem, MentionType } from './mentionTypes';
import type { Character, Scene, Prop } from '../types';
import {
  getCharacterCostumePhotoSource,
  getPropPreviewImageSource,
  getScenePreviewImageSource,
} from '../utils/mediaSelectors';

interface MentionContextValue {
  items: MentionItem[];
  characters: MentionItem[];
  scenes: MentionItem[];
  props: MentionItem[];
  getItem: (type: MentionType, id: string) => MentionItem | undefined;
}

const MentionContext = createContext<MentionContextValue>({
  items: [],
  characters: [],
  scenes: [],
  props: [],
  getItem: () => undefined,
});

interface MentionProviderProps {
  characters?: Character[];
  scenes?: Scene[];
  props?: Prop[];
  children: React.ReactNode;
}

/**
 * 将 Character 转换为 MentionItem
 */
function characterToMentionItem(char: Character): MentionItem {
  return {
    id: char.id,
    type: 'char',
    name: char.name,
    description: char.prompt,
    previewImage: getCharacterCostumePhotoSource(char),
  };
}

/**
 * 将 Scene 转换为 MentionItem
 */
function sceneToMentionItem(scene: Scene): MentionItem {
  return {
    id: scene.id,
    type: 'scene',
    name: scene.name,
    description: scene.prompt,
    previewImage: getScenePreviewImageSource(scene),
  };
}

/**
 * 将 Prop 转换为 MentionItem
 */
function propToMentionItem(prop: Prop): MentionItem {
  return {
    id: prop.id,
    type: 'prop',
    name: prop.name,
    description: prop.prompt,
    previewImage: getPropPreviewImageSource(prop),
  };
}

/**
 * Mention Provider
 */
export const MentionProvider: React.FC<MentionProviderProps> = ({
  characters = [],
  scenes = [],
  props = [],
  children,
}) => {
  const value = useMemo<MentionContextValue>(() => {
    const charItems = characters.map(characterToMentionItem);
    const sceneItems = scenes.map(sceneToMentionItem);
    const propItems = props.map(propToMentionItem);
    const allItems = [...charItems, ...sceneItems, ...propItems];

    return {
      items: allItems,
      characters: charItems,
      scenes: sceneItems,
      props: propItems,
      getItem: (type: MentionType, id: string) =>
        allItems.find((item) => item.type === type && item.id === id),
    };
  }, [characters, scenes, props]);

  return (
    <MentionContext.Provider value={value}>
      {children}
    </MentionContext.Provider>
  );
};

/**
 * 使用 Mention 上下文
 */
export function useMentionContext(): MentionContextValue {
  return useContext(MentionContext);
}

/**
 * 获取所有可用的 Mention 项
 */
export function useMentionItems(): MentionItem[] {
  const ctx = useContext(MentionContext);
  return ctx.items;
}

export default MentionContext;
