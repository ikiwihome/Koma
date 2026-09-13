/**
 * 分镜时长控件 —— 与"批量按钮"视觉对齐的 text-button 风格。
 *
 * 两种工作模式（按 durationSpec.kind 自动切换）：
 *  - enum  : 点击展开 Dropdown 菜单选数值（Koma 即梦即梦等枚举档位 provider）
 *  - range : 点击进入"行内编辑"（数字 → InputNumber → blur/Enter 退出）
 *  - 未提供 spec：兜底用 ALLOWED_VIDEO_DURATIONS 当 range
 *
 * 设计动机：
 *  - 之前用 antd Select / InputNumber 都自带边框 + 一直可见的输入框，
 *    与左侧操作列其它 text 按钮视觉不统一；
 *  - 用户要求"和批量按钮一样的下拉按钮形式 + 点击才进入编辑（同 ShotScriptLines）"。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, InputNumber, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import type { InputNumberRef } from '@rc-component/input-number';
import { DownOutlined } from '@ant-design/icons';
import { ALLOWED_VIDEO_DURATIONS, normalizeVideoDurationSeconds } from '../../utils/videoDuration';
import { clampDurationToSpec, type VideoDurationSpec } from '../../providers/itv/durationSpec';

interface ShotDurationControlProps {
  value: number;
  onChange: (next: number) => void;
  durationSpec?: VideoDurationSpec;
}

const BUTTON_CLASS = 'h-5 px-1.5 text-[10px] leading-none !text-text-secondary hover:!text-status-info';

export const ShotDurationControl: React.FC<ShotDurationControlProps> = ({
  value,
  onChange,
  durationSpec,
}) => {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<InputNumberRef>(null);

  // 进入编辑态后聚焦 + 全选，便于直接覆盖输入
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // 枚举档位：Dropdown 菜单
  if (durationSpec?.kind === 'enum') {
    const items: MenuProps['items'] = durationSpec.values.map((v) => ({
      key: String(v),
      label: `${v}s`,
      onClick: () => {
        const next = clampDurationToSpec(v, durationSpec);
        if (next !== value) onChange(next);
      },
    }));
    return (
      <Tooltip title="分镜时长（秒）" placement="right">
        <Dropdown menu={{ items, selectedKeys: [String(value)] }} trigger={['click']} placement="bottomLeft">
          <Button
            type="text"
            size="small"
            className={BUTTON_CLASS}
            onClick={(e) => e.stopPropagation()}
          >
            {value}s <DownOutlined className="text-[8px]" />
          </Button>
        </Dropdown>
      </Tooltip>
    );
  }

  // range / 兜底：点击进入行内编辑
  const min = durationSpec?.kind === 'range' ? durationSpec.min : ALLOWED_VIDEO_DURATIONS[0];
  const max = durationSpec?.kind === 'range' ? durationSpec.max : ALLOWED_VIDEO_DURATIONS[ALLOWED_VIDEO_DURATIONS.length - 1];
  const step = durationSpec?.kind === 'range' ? durationSpec.step : 1;

  const commit = (raw: number | null) => {
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : value;
    const next = durationSpec?.kind === 'range'
      ? clampDurationToSpec(n, durationSpec)
      : normalizeVideoDurationSeconds(n, value);
    if (next !== value) onChange(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <InputNumber
        size="small"
        ref={inputRef}
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        controls={false}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          const v = Number(e.target.value);
          commit(Number.isFinite(v) ? v : null);
        }}
        onPressEnter={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          commit(Number.isFinite(v) ? v : null);
        }}
        // 仍走 .shot-duration-input 的 SCSS 紧凑样式
        className="shot-duration-input"
      />
    );
  }

  return (
    <Tooltip title="点击编辑分镜时长（秒）" placement="right">
      <Button
        type="text"
        size="small"
        className={BUTTON_CLASS}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {value}s
      </Button>
    </Tooltip>
  );
};

export default ShotDurationControl;
