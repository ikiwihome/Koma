/**
 * 资产管理器
 * 使用左侧列表 + 右侧详情面板布局
 */
import React from 'react';
import { AssetManagerPanel } from './AssetManagerPanel';
import type { Character, Scene, Prop, ProjectStyleSnapshot } from '../../types';
import './AssetManager.scss';

interface AssetManagerProps {
  projectId: string;
  aspectRatio?: '16:9' | '9:16';
  ttiSelection?: string;
  itvSelection?: string;
  theme?: string;
  styleSnapshot?: ProjectStyleSnapshot;
  stylePrompt?: string;
  episodeId?: string;
  episodeName?: string;
  script?: string;
  llmSelection?: string;
  characters?: Character[];
  scenes?: Scene[];
  props?: Prop[];
  onNext: () => void;
}

export const AssetManager: React.FC<AssetManagerProps> = (props) => {
  return <AssetManagerPanel {...props} />;
};

export default AssetManager;
