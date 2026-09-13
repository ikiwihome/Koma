/**
 * 参考图徽章组件
 * 显示参考图数量，点击弹出管理 Popover
 */
import React from 'react';
import { Badge, Popover } from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import { electronService } from '../../../services/electronService';

interface ReferenceBadgeProps {
  images: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onAdd: (path: string) => void;
  onDelete: (index: number) => void;
}

export const ReferenceBadge: React.FC<ReferenceBadgeProps> = ({
  images,
  selectedIndex,
  onSelect,
  onAdd,
  onDelete,
}) => {
  const count = images.length;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onAdd(URL.createObjectURL(file));
    }
    e.target.value = '';
  };

  const content = (
    <div className="w-[320px]">
      <div className="text-xs text-text-secondary mb-2">参考图用于 ControlNet 控制生成</div>
      {images.length > 0 ? (
        <div className="flex gap-2 flex-wrap">
          {images.map((img, idx) => (
            <div
              key={idx}
              className={`relative h-16 aspect-square rounded overflow-hidden cursor-pointer border-2 ${
                idx === selectedIndex ? 'border-status-info' : 'border-border hover:border-border'
              }`}
              onClick={() => onSelect(idx)}
            >
              <img
                src={electronService.fs.toLocalUrl(img)}
                className="w-full h-full object-cover"
                alt=""
              />
              <button
                className="absolute top-0 right-0 w-5 h-5 bg-status-error/80 text-on-status text-xs rounded-bl hover:bg-status-error transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(idx);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <label className="h-16 aspect-square border border-dashed border-border rounded flex items-center justify-center cursor-pointer hover:border-border transition-colors">
            <PictureOutlined className="text-text-tertiary" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        </div>
      ) : (
        <label className="w-full h-20 border border-dashed border-border rounded flex flex-col items-center justify-center cursor-pointer hover:border-border transition-colors gap-1">
          <PictureOutlined className="text-text-tertiary text-lg" />
          <span className="text-text-tertiary text-xs">点击添加参考图</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      title={<span className="text-sm">参考图管理</span>}
      overlayClassName="reference-badge-popover"
    >
      <div className="absolute top-2 right-2 z-10 cursor-pointer group">
        <Badge count={count} size="small" offset={[-2, 2]} color={count > 0 ? 'var(--token-status-info)' : undefined}>
          <div
            className={`h-6 px-2 rounded flex items-center gap-1.5 text-xs border transition-colors ${
              count > 0
                ? 'bg-status-info/15 border-status-info/50 text-status-info'
                : 'bg-bg-elevated/80 border-border text-text-tertiary group-hover:text-text-secondary'
            }`}
          >
            <PictureOutlined />
            {count > 0 ? '参考图' : '添加参考'}
          </div>
        </Badge>
      </div>
    </Popover>
  );
};
