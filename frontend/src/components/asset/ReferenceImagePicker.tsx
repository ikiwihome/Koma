/**
 * 参考图选择器
 * 支持从资产选择、本地上传、拖拽上传
 */
import React, { useState, useCallback, useRef } from 'react';
import { Dropdown, Button, Image, Space, Tooltip, App } from 'antd';
import type { MenuProps } from 'antd';
import {
  PictureOutlined,
  UploadOutlined,
  UserOutlined,
  EnvironmentOutlined,
  AppstoreOutlined,
  DeleteOutlined,
  PlusOutlined,
  ExpandOutlined,
} from '@ant-design/icons';
import type { Character, Scene, Prop } from '../../types';
import { electronService } from '../../services/electronService';
import {
  getCharacterCostumePhotoSource,
  getPropPreviewImageSource,
  getScenePreviewImageSource,
} from '../../utils/mediaSelectors';
import './ReferenceImagePicker.scss';

export interface ReferenceImagePickerProps {
  value?: string;  // 当前图片路径
  onChange?: (imagePath: string | undefined) => void;
  characters?: Character[];
  scenes?: Scene[];
  props?: Prop[];
  disabled?: boolean;
  size?: 'small' | 'default' | 'large';
  placeholder?: string;
}

export const ReferenceImagePicker: React.FC<ReferenceImagePickerProps> = ({
  value,
  onChange,
  characters = [],
  scenes = [],
  props = [],
  disabled = false,
  size = 'default',
  placeholder = '选择参考图',
}) => {
  const { message } = App.useApp();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const imageUrl = value ? electronService.fs.toLocalUrl(value) : undefined;

  const sizeClassName = `refImagePickerSize-${size}`;

  // 处理选择资产
  const handleSelectAsset = useCallback((type: 'character' | 'scene' | 'prop', assetId: string) => {
    let imagePath: string | undefined;

    if (type === 'character') {
      const char = characters.find(c => c.id === assetId);
      imagePath = getCharacterCostumePhotoSource(char);
    } else if (type === 'scene') {
      const scene = scenes.find(s => s.id === assetId);
      imagePath = getScenePreviewImageSource(scene);
    } else {
      const prop = props.find(p => p.id === assetId);
      imagePath = getPropPreviewImageSource(prop);
    }

    if (imagePath) {
      onChange?.(imagePath);
      setDropdownOpen(false);
    } else {
      message.warning('该资产没有图片');
    }
  }, [characters, scenes, props, onChange]);

  // 处理本地上传
  const handleLocalUpload = useCallback(async () => {
    try {
      const result = await electronService.dialog.openFile({
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
        ],
        multiple: false,
      });

      if (!result.canceled && result.filePaths.length > 0) {
        onChange?.(result.filePaths[0]);
        setDropdownOpen(false);
      }
    } catch {
      message.error('选择文件失败');
    }
  }, [onChange]);

  // 拖拽处理
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const isImage = file.type.startsWith('image/');

      if (!isImage) {
        message.error('请拖入图片文件');
        return;
      }

      // Electron 环境可以直接获取文件路径
      if (electronService.isElectron() && (file as any).path) {
        onChange?.((file as any).path);
      } else {
        // 浏览器环境：读取为 data URL（用于预览）
        const reader = new FileReader();
        reader.onload = () => {
          onChange?.(reader.result as string);
        };
        reader.readAsDataURL(file);
      }
    }
  }, [disabled, onChange]);

  // 清除图片
  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.(undefined);
  }, [onChange]);

  // 构建下拉菜单
  const buildMenuItems = (): MenuProps['items'] => {
    const items: MenuProps['items'] = [];

    // 本地上传
    items.push({
      key: 'upload',
      icon: <UploadOutlined />,
      label: '本地上传',
      onClick: handleLocalUpload,
    });

    items.push({ type: 'divider' });

    // 角色资产
    if (characters.length > 0) {
      const charItems = characters
        .map(c => ({ asset: c, source: getCharacterCostumePhotoSource(c) }))
        .filter((entry): entry is { asset: Character; source: string } => Boolean(entry.source))
        .map(({ asset, source }) => ({
          key: `char-${asset.id}`,
          label: (
            <Space size={8}>
              {source && (
                <img
                  src={electronService.fs.toLocalUrl(source)}
                  alt={asset.name}
                  className="refImageMenuThumb"
                />
              )}
              <span>{asset.name}</span>
            </Space>
          ),
          onClick: () => handleSelectAsset('character', asset.id),
        }));

      if (charItems.length > 0) {
        items.push({
          key: 'characters',
          icon: <UserOutlined />,
          label: '角色',
          children: charItems,
        });
      }
    }

    // 场景资产
    if (scenes.length > 0) {
      const sceneItems = scenes
        .map(s => ({ asset: s, source: getScenePreviewImageSource(s) }))
        .filter((entry): entry is { asset: Scene; source: string } => Boolean(entry.source))
        .map(({ asset, source }) => ({
          key: `scene-${asset.id}`,
          label: (
            <Space size={8}>
              {source && (
                <img
                  src={electronService.fs.toLocalUrl(source)}
                  alt={asset.name}
                  className="refImageMenuThumb"
                />
              )}
              <span>{asset.name}</span>
            </Space>
          ),
          onClick: () => handleSelectAsset('scene', asset.id),
        }));

      if (sceneItems.length > 0) {
        items.push({
          key: 'scenes',
          icon: <EnvironmentOutlined />,
          label: '场景',
          children: sceneItems,
        });
      }
    }

    // 道具资产
    if (props.length > 0) {
      const propItems = props
        .map(p => ({ asset: p, source: getPropPreviewImageSource(p) }))
        .filter((entry): entry is { asset: Prop; source: string } => Boolean(entry.source))
        .map(({ asset, source }) => ({
          key: `prop-${asset.id}`,
          label: (
            <Space size={8}>
              {source && (
                <img
                  src={electronService.fs.toLocalUrl(source)}
                  alt={asset.name}
                  className="refImageMenuThumb"
                />
              )}
              <span>{asset.name}</span>
            </Space>
          ),
          onClick: () => handleSelectAsset('prop', asset.id),
        }));

      if (propItems.length > 0) {
        items.push({
          key: 'props',
          icon: <AppstoreOutlined />,
          label: '道具',
          children: propItems,
        });
      }
    }

    return items;
  };

  return (
    <div
      ref={containerRef}
      className={`refImagePicker ${sizeClassName} ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {imageUrl ? (
        <div className="refImagePreview">
          <Image
            src={imageUrl}
            alt="参考图"
            className="refImage"
            preview={{
              open: previewVisible,
              onOpenChange: setPreviewVisible,
              mask: false,
            }}
          />
          <div className="refImageOverlay">
            <Tooltip title="预览">
              <Button
                type="text"
                size="small"
                icon={<ExpandOutlined />}
                onClick={() => setPreviewVisible(true)}
                className="overlayBtn"
              />
            </Tooltip>
            <Tooltip title="更换">
              <Dropdown
                menu={{ items: buildMenuItems() }}
                trigger={['click']}
                disabled={disabled}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<PictureOutlined />}
                  className="overlayBtn"
                />
              </Dropdown>
            </Tooltip>
            <Tooltip title="清除">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={handleClear}
                disabled={disabled}
                className="overlayBtn"
              />
            </Tooltip>
          </div>
        </div>
      ) : (
        <Dropdown
          menu={{ items: buildMenuItems() }}
          trigger={['click']}
          open={dropdownOpen}
          onOpenChange={setDropdownOpen}
          disabled={disabled}
        >
          <div className="refImageEmpty">
            {isDragging ? (
              <>
                <UploadOutlined className="refImageUploadIcon" />
                <span>放开上传</span>
              </>
            ) : (
              <>
                <PlusOutlined className="refImageAddIcon" />
                <span>{placeholder}</span>
              </>
            )}
          </div>
        </Dropdown>
      )}
    </div>
  );
};

export default ReferenceImagePicker;
