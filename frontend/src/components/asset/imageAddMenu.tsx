/**
 * 通用"添加图片"下拉菜单 items 构建器
 *
 * 共享给 ImageCardGrid（默认模式）/ ShotCard（媒体行 header）等使用，
 * 避免每处都重写一份本地上传 + 角色 / 场景 / 道具子菜单。
 */
import { App, Space } from 'antd';
import type { MenuProps } from 'antd';
import {
  UploadOutlined,
  UserOutlined,
  EnvironmentOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import type { Character, Scene, Prop } from '../../types';
import { electronService } from '../../services/electronService';
import {
  getCharacterCostumePhotoSource,
  getPropPreviewImageSource,
  getScenePreviewImageSource,
} from '../../utils/mediaSelectors';

function toDisplayUrl(source: string): string {
  if (/^https?:\/\//i.test(source) || source.startsWith('data:') || source.startsWith('blob:') || source.startsWith('koma-local://')) {
    return source;
  }
  return electronService.fs.toLocalUrl(source);
}

interface BuildImageAddMenuOptions {
  onAdd: (imagePath: string) => void;
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
  /** 弹消息用的实例（不传时回退 console.warn） */
  message?: ReturnType<typeof App.useApp>['message'];
}

export function buildImageAddMenu({ onAdd, characters, scenes, props, message }: BuildImageAddMenuOptions): MenuProps['items'] {
  const handleLocalUpload = async () => {
    try {
      const result = await electronService.dialog.openFile({
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
        multiple: false,
      });
      if (!result.canceled && result.filePaths.length > 0) {
        onAdd(result.filePaths[0]);
      }
    } catch {
      message?.error('选择文件失败');
    }
  };

  const handleSelectAsset = (type: 'character' | 'scene' | 'prop', assetId: string) => {
    let imageUrl: string | undefined;
    if (type === 'character') {
      imageUrl = getCharacterCostumePhotoSource(characters.find(c => c.id === assetId));
    } else if (type === 'scene') {
      imageUrl = getScenePreviewImageSource(scenes.find(s => s.id === assetId));
    } else {
      imageUrl = getPropPreviewImageSource(props.find(p => p.id === assetId));
    }
    if (imageUrl) {
      onAdd(imageUrl);
    } else {
      message?.warning('该资产没有图片');
    }
  };

  const items: MenuProps['items'] = [
    { key: 'upload', icon: <UploadOutlined />, label: '本地上传', onClick: handleLocalUpload },
    { type: 'divider' },
  ];

  const charItems = characters
    .map(c => ({ asset: c, source: getCharacterCostumePhotoSource(c) }))
    .filter((entry): entry is { asset: Character; source: string } => Boolean(entry.source))
    .map(({ asset, source }) => ({
      key: `char-${asset.id}`,
      label: (
        <Space size={8}>
          <img src={toDisplayUrl(source)} alt={asset.name} className="assetMenuThumb" />
          <span>{asset.name}</span>
        </Space>
      ),
      onClick: () => handleSelectAsset('character', asset.id),
    }));
  if (charItems.length > 0) {
    items.push({ key: 'characters', icon: <UserOutlined />, label: '角色', children: charItems });
  }

  const sceneItems = scenes
    .map(s => ({ asset: s, source: getScenePreviewImageSource(s) }))
    .filter((entry): entry is { asset: Scene; source: string } => Boolean(entry.source))
    .map(({ asset, source }) => ({
      key: `scene-${asset.id}`,
      label: (
        <Space size={8}>
          <img src={toDisplayUrl(source)} alt={asset.name} className="assetMenuThumb" />
          <span>{asset.name}</span>
        </Space>
      ),
      onClick: () => handleSelectAsset('scene', asset.id),
    }));
  if (sceneItems.length > 0) {
    items.push({ key: 'scenes', icon: <EnvironmentOutlined />, label: '场景', children: sceneItems });
  }

  const propItems = props
    .map(p => ({ asset: p, source: getPropPreviewImageSource(p) }))
    .filter((entry): entry is { asset: Prop; source: string } => Boolean(entry.source))
    .map(({ asset, source }) => ({
      key: `prop-${asset.id}`,
      label: (
        <Space size={8}>
          <img src={toDisplayUrl(source)} alt={asset.name} className="assetMenuThumb" />
          <span>{asset.name}</span>
        </Space>
      ),
      onClick: () => handleSelectAsset('prop', asset.id),
    }));
  if (propItems.length > 0) {
    items.push({ key: 'props', icon: <AppstoreOutlined />, label: '道具', children: propItems });
  }

  return items;
}
