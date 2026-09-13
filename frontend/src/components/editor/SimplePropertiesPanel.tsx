/**
 * 属性编辑面板
 * 迁移自 electron-egg，支持字幕编辑
 */
import React, { useMemo } from 'react';
import {
  Clip, Keyframe, AnimatableProperty, MediaType, ClipAnimation, AudioFade, ClipMask, MaskType
} from '../../types/editor';
import { getAnimatedProperties, hasKeyframes, getKeyframeAtTime } from '../../engine/simpleKeyframe';
import { Trash2, Type, Sparkles, Play, Volume2, Square } from 'lucide-react';
import styles from './SimplePropertiesPanel.module.scss';

// 预设滤镜列表
const FILTER_PRESETS: { id: string; name: string; resourceId: string }[] = [
  { id: 'none', name: '无', resourceId: '' },
  { id: 'warm', name: '暖色', resourceId: '7082737037045217799' },
  { id: 'cool', name: '冷色', resourceId: '7082737037045217800' },
  { id: 'vintage', name: '复古', resourceId: '7082737037045217801' },
  { id: 'blackwhite', name: '黑白', resourceId: '7082737037045217802' },
  { id: 'vivid', name: '鲜艳', resourceId: '7082737037045217803' },
];

// 预设动画列表
const ANIMATION_PRESETS: { effectId: string; name: string; type: 'in' | 'out' }[] = [
  { effectId: 'fade_in', name: '淡入', type: 'in' },
  { effectId: 'slide_in_left', name: '左滑入', type: 'in' },
  { effectId: 'slide_in_right', name: '右滑入', type: 'in' },
  { effectId: 'zoom_in', name: '放大入', type: 'in' },
  { effectId: 'fade_out', name: '淡出', type: 'out' },
  { effectId: 'slide_out_left', name: '左滑出', type: 'out' },
  { effectId: 'slide_out_right', name: '右滑出', type: 'out' },
  { effectId: 'zoom_out', name: '缩小出', type: 'out' },
];

// 蒙版类型
const MASK_TYPES: { type: MaskType; name: string }[] = [
  { type: 'linear', name: '线性' },
  { type: 'mirror', name: '镜像' },
  { type: 'circle', name: '圆形' },
  { type: 'rectangle', name: '矩形' },
  { type: 'heart', name: '心形' },
  { type: 'star', name: '星形' },
];

// 预设字体
const FONT_FAMILIES = [
  { label: '默认', value: 'Arial, sans-serif' },
  { label: '黑体', value: 'SimHei, sans-serif' },
  { label: '宋体', value: 'SimSun, serif' },
  { label: '微软雅黑', value: 'Microsoft YaHei, sans-serif' },
  { label: '楷体', value: 'KaiTi, serif' },
];

// 预设字号
const FONT_SIZES = [24, 32, 40, 48, 56, 64, 72, 96];
const HEX_PREFIX = String.fromCharCode(35);
const DEFAULT_FONT_COLOR = `${HEX_PREFIX}FFFFFF`;
const DEFAULT_BACKGROUND_COLOR = `${HEX_PREFIX}000000`;

interface PropertiesPanelProps {
  selectedClip: Clip | null;
  selectedKeyframeId: string | null;
  currentTime: number;
  onUpdateClip: (clipId: string, updates: Partial<Clip>) => void;
  onDeleteClip: () => void;
  onAddKeyframe: (clipId: string, clipLocalTime: number) => void;
  onUpdateKeyframe: (clipId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
}

export const SimplePropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedClip,
  selectedKeyframeId,
  currentTime,
  onUpdateClip,
  onDeleteClip,
  onAddKeyframe,
  onUpdateKeyframe
}) => {
  const clipLocalTime = selectedClip ? currentTime - selectedClip.start : 0;
  const isInClipRange = selectedClip && clipLocalTime >= 0 && clipLocalTime <= selectedClip.duration;

  const selectedKeyframe = useMemo(() => {
    if (!selectedClip?.keyframes || !selectedKeyframeId) return null;
    return selectedClip.keyframes.find(kf => kf.id === selectedKeyframeId) || null;
  }, [selectedClip, selectedKeyframeId]);

  const currentProps = useMemo(() => {
    if (!selectedClip) return null;
    if (selectedKeyframe) {
      return {
        x: selectedKeyframe.x,
        y: selectedKeyframe.y,
        scale: selectedKeyframe.scale,
        rotation: selectedKeyframe.rotation,
        opacity: selectedKeyframe.opacity
      };
    }
    if (hasKeyframes(selectedClip)) {
      return getAnimatedProperties(selectedClip, clipLocalTime);
    }
    return {
      x: selectedClip.x,
      y: selectedClip.y,
      scale: selectedClip.scale,
      rotation: selectedClip.rotation,
      opacity: selectedClip.opacity
    };
  }, [selectedClip, selectedKeyframe, clipLocalTime]);

  const keyframeAtCurrentTime = useMemo(() => {
    if (!selectedClip) return null;
    return getKeyframeAtTime(selectedClip, clipLocalTime, 0.05);
  }, [selectedClip, clipLocalTime]);

  if (!selectedClip || !currentProps) {
    return (
      <div className={`${styles.panel} w-72 p-6 flex flex-col items-center justify-center text-text-tertiary`}>
        <div className="w-12 h-12 mb-4 opacity-20 border-2 border-current rounded" />
        <p className="text-sm">选择片段以编辑属性</p>
      </div>
    );
  }

  // 是否为字幕/文本片段
  const isTextClip = selectedClip.type === MediaType.TEXT;
  // 是否为音频片段
  const isAudioClip = selectedClip.type === MediaType.AUDIO;
  // 仅视频/图片支持关键帧、滤镜、蒙版
  const supportsKeyframes = selectedClip.type === MediaType.VIDEO || selectedClip.type === MediaType.IMAGE;
  // 视频/图片/文本支持动画
  const supportsAnimation = supportsKeyframes || isTextClip;

  const handlePropertyChange = (property: AnimatableProperty, value: number) => {
    if (selectedKeyframe) {
      onUpdateKeyframe(selectedClip.id, selectedKeyframe.id, { [property]: value });
    } else if (hasKeyframes(selectedClip)) {
      if (keyframeAtCurrentTime) {
        onUpdateKeyframe(selectedClip.id, keyframeAtCurrentTime.id, { [property]: value });
      } else {
        onAddKeyframe(selectedClip.id, clipLocalTime);
      }
    } else {
      onUpdateClip(selectedClip.id, { [property]: value });
    }
  };

  // 字幕属性更新
  const handleTextUpdate = (updates: Partial<Clip>) => {
    onUpdateClip(selectedClip.id, updates);
  };

  // 滤镜更新
  const handleFilterChange = (filterId: string) => {
    if (filterId === 'none') {
      onUpdateClip(selectedClip.id, { filter: undefined });
    } else {
      const preset = FILTER_PRESETS.find(f => f.id === filterId);
      if (preset) {
        onUpdateClip(selectedClip.id, {
          filter: {
            id: preset.id,
            name: preset.name,
            resourceId: preset.resourceId,
            intensity: selectedClip.filter?.intensity ?? 1.0,
          }
        });
      }
    }
  };

  const handleFilterIntensityChange = (intensity: number) => {
    if (selectedClip.filter) {
      onUpdateClip(selectedClip.id, {
        filter: { ...selectedClip.filter, intensity }
      });
    }
  };

  // 动画更新
  const handleAnimationChange = (type: 'in' | 'out', effectId: string) => {
    const currentAnimations = selectedClip.animations || [];
    const filtered = currentAnimations.filter(a => a.type !== type);

    if (effectId === 'none') {
      onUpdateClip(selectedClip.id, { animations: filtered.length > 0 ? filtered : undefined });
    } else {
      const preset = ANIMATION_PRESETS.find(a => a.effectId === effectId);
      if (preset) {
        const newAnim: ClipAnimation = {
          type,
          effectId,
          name: preset.name,
          duration: currentAnimations.find(a => a.type === type)?.duration ?? 0.5,
        };
        onUpdateClip(selectedClip.id, { animations: [...filtered, newAnim] });
      }
    }
  };

  const handleAnimationDurationChange = (type: 'in' | 'out', duration: number) => {
    const currentAnimations = selectedClip.animations || [];
    const updated = currentAnimations.map(a =>
      a.type === type ? { ...a, duration } : a
    );
    onUpdateClip(selectedClip.id, { animations: updated });
  };

  // 音频淡入淡出更新
  const handleAudioFadeChange = (fadeIn?: number, fadeOut?: number) => {
    const current = selectedClip.audioFade || { fadeIn: 0, fadeOut: 0 };
    const updated: AudioFade = {
      fadeIn: fadeIn ?? current.fadeIn,
      fadeOut: fadeOut ?? current.fadeOut,
    };
    if (updated.fadeIn === 0 && updated.fadeOut === 0) {
      onUpdateClip(selectedClip.id, { audioFade: undefined });
    } else {
      onUpdateClip(selectedClip.id, { audioFade: updated });
    }
  };

  // 蒙版更新
  const handleMaskTypeChange = (maskType: MaskType | 'none') => {
    if (maskType === 'none') {
      onUpdateClip(selectedClip.id, { mask: undefined });
    } else {
      const current = selectedClip.mask;
      onUpdateClip(selectedClip.id, {
        mask: {
          type: maskType,
          centerX: current?.centerX ?? 0,
          centerY: current?.centerY ?? 0,
          size: current?.size ?? 0.5,
          rotation: current?.rotation ?? 0,
          feather: current?.feather ?? 0.1,
          invert: current?.invert ?? false,
        }
      });
    }
  };

  const handleMaskPropertyChange = (prop: keyof ClipMask, value: number | boolean) => {
    if (selectedClip.mask) {
      onUpdateClip(selectedClip.id, {
        mask: { ...selectedClip.mask, [prop]: value }
      });
    }
  };

  return (
    <div className={`${styles.panel} w-72 flex flex-col overflow-y-auto`}>
      <div className={`${styles.header} p-3 flex justify-between items-center`}>
        <h3 className="font-semibold text-text-primary text-sm">属性</h3>
        <button
          onClick={onDeleteClip}
          className="p-1.5 hover:bg-status-error/12 text-status-error rounded transition-colors"
          title="删除片段"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* 字幕编辑区 */}
      {isTextClip && (
        <div className={`${styles.section} p-3 space-y-3`}>
          <div className="flex items-center gap-2">
            <Type size={14} className="text-status-info" />
            <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">字幕</h4>
          </div>

          {/* 字幕文本 */}
          <div className="space-y-1">
            <label className="text-xs text-text-secondary">文本内容</label>
            <textarea
              value={selectedClip.text || selectedClip.src || ''}
              onChange={(e) => handleTextUpdate({ text: e.target.value, src: e.target.value })}
              placeholder="输入字幕内容..."
              rows={3}
              className={`${styles.field} w-full rounded px-2 py-1.5 text-xs outline-none resize-none`}
            />
          </div>

          {/* 字体选择 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">字体</label>
              <select
                value={selectedClip.fontFamily || 'Arial, sans-serif'}
                onChange={(e) => handleTextUpdate({ fontFamily: e.target.value })}
                className={`${styles.field} w-full rounded px-2 py-1 text-xs outline-none`}
              >
                {FONT_FAMILIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">字号</label>
              <select
                value={selectedClip.fontSize || 48}
                onChange={(e) => handleTextUpdate({ fontSize: parseInt(e.target.value) })}
                className={`${styles.field} w-full rounded px-2 py-1 text-xs outline-none`}
              >
                {FONT_SIZES.map(s => (
                  <option key={s} value={s}>{s}px</option>
                ))}
              </select>
            </div>
          </div>

          {/* 颜色选择 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">文字颜色</label>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={selectedClip.fontColor || DEFAULT_FONT_COLOR}
                  onChange={(e) => handleTextUpdate({ fontColor: e.target.value })}
                  className="w-8 h-6 rounded cursor-pointer border-0"
                />
                <input
                  type="text"
                  value={selectedClip.fontColor || DEFAULT_FONT_COLOR}
                  onChange={(e) => handleTextUpdate({ fontColor: e.target.value })}
                  className={`${styles.field} flex-1 rounded px-2 py-1 text-xs outline-none`}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">背景颜色</label>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={selectedClip.backgroundColor || DEFAULT_BACKGROUND_COLOR}
                  onChange={(e) => handleTextUpdate({ backgroundColor: e.target.value })}
                  className="w-8 h-6 rounded cursor-pointer border-0"
                />
                <button
                  onClick={() => handleTextUpdate({ backgroundColor: undefined })}
                  className="px-1.5 py-0.5 text-xs bg-bg-hover rounded hover:bg-bg-hover"
                  title="清除背景"
                >
                  ×
                </button>
              </div>
            </div>
          </div>

          {/* 位置预设 */}
          <div className="space-y-1">
            <label className="text-xs text-text-secondary">位置</label>
            <div className="flex gap-1">
              {(['top', 'center', 'bottom'] as const).map(pos => (
                <button
                  key={pos}
                  onClick={() => handleTextUpdate({ textPosition: pos })}
                  className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                    (selectedClip.textPosition || 'bottom') === pos
                      ? 'bg-status-info/30 text-status-info border border-status-info/50'
                      : 'bg-bg-hover text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {pos === 'top' ? '顶部' : pos === 'center' ? '居中' : '底部'}
                </button>
              ))}
            </div>
          </div>

          {/* 对齐方式 */}
          <div className="space-y-1">
            <label className="text-xs text-text-secondary">对齐</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => handleTextUpdate({ textAlign: align })}
                  className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                    (selectedClip.textAlign || 'center') === align
                      ? 'bg-status-info/30 text-status-info border border-status-info/50'
                      : 'bg-bg-hover text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {align === 'left' ? '左' : align === 'center' ? '中' : '右'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 关键帧控制 */}
      {supportsKeyframes && (
        <div className={`${styles.section} p-3 space-y-2`}>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">关键帧</h4>
            <span className="text-xs text-text-tertiary">{clipLocalTime.toFixed(2)}s</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => isInClipRange && onAddKeyframe(selectedClip.id, clipLocalTime)}
              disabled={!isInClipRange}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors
                ${isInClipRange
                  ? 'bg-status-warning/20 text-status-warning hover:bg-status-warning/30 border border-status-warning/50'
                  : 'bg-bg-elevated text-text-muted cursor-not-allowed'}
              `}
            >
              <svg viewBox="0 0 12 12" className="w-2.5 h-2.5">
                <path d="M6 0L12 6L6 12L0 6Z" fill="currentColor" />
              </svg>
              添加关键帧
            </button>

            {keyframeAtCurrentTime && (
              <span className="text-xs text-status-info flex items-center gap-1">
                <svg viewBox="0 0 12 12" className="w-2 h-2">
                  <path d="M6 0L12 6L6 12L0 6Z" fill="currentColor" />
                </svg>
                当前有帧
              </span>
            )}
          </div>

          {selectedKeyframe && (
            <div className="bg-status-info/10 border border-status-info/30 rounded p-1.5 text-xs text-status-info">
              已选中关键帧 @ {selectedKeyframe.time.toFixed(2)}s
            </div>
          )}

          {hasKeyframes(selectedClip) && (
            <div className="text-xs text-text-tertiary">
              共 {selectedClip.keyframes?.length || 0} 个关键帧
              {(selectedClip.keyframes?.length || 0) < 2 && (
                <span className="text-status-warning ml-1">（需≥2个）</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="p-3 space-y-4">
        {/* 变换 */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">变换</h4>

          <div className="space-y-1">
            <label className="text-xs text-text-secondary flex justify-between">
              缩放 <span>{Math.round(currentProps.scale * 100)}%</span>
            </label>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={currentProps.scale}
              onChange={(e) => handlePropertyChange('scale', parseFloat(e.target.value))}
              className="w-full accent-status-info h-1 bg-bg-hover rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">X</label>
              <input
                type="number"
                value={Math.round(currentProps.x)}
                onChange={(e) => handlePropertyChange('x', parseInt(e.target.value) || 0)}
                className={`${styles.field} w-full rounded px-2 py-1 text-xs outline-none`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">Y</label>
              <input
                type="number"
                value={Math.round(currentProps.y)}
                onChange={(e) => handlePropertyChange('y', parseInt(e.target.value) || 0)}
                className={`${styles.field} w-full rounded px-2 py-1 text-xs outline-none`}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-text-secondary">旋转</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="-180"
                max="180"
                value={currentProps.rotation}
                onChange={(e) => handlePropertyChange('rotation', parseInt(e.target.value))}
                className="flex-1 accent-status-info h-1 bg-bg-hover rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs w-8 text-right">{Math.round(currentProps.rotation)}°</span>
            </div>
          </div>
        </div>

        {/* 不透明度 */}
        <div className={`${styles.subsection} space-y-3 pt-3`}>
          <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">混合</h4>
          <div className="space-y-1">
            <label className="text-xs text-text-secondary flex justify-between">
              不透明度 <span>{Math.round(currentProps.opacity * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentProps.opacity}
              onChange={(e) => handlePropertyChange('opacity', parseFloat(e.target.value))}
              className="w-full accent-status-info h-1 bg-bg-hover rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>

        {/* 滤镜 - 仅视频/图片 */}
        {supportsKeyframes && (
          <div className={`${styles.subsection} space-y-3 pt-3`}>
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-accent" />
              <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">滤镜</h4>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-secondary">滤镜效果</label>
              <select
                value={selectedClip.filter?.id || 'none'}
                onChange={(e) => handleFilterChange(e.target.value)}
                className={`${styles.field} ${styles.fieldPurple} w-full rounded px-2 py-1 text-xs outline-none`}
              >
                {FILTER_PRESETS.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {selectedClip.filter && (
              <div className="space-y-1">
                <label className="text-xs text-text-secondary flex justify-between">
                  强度 <span>{Math.round((selectedClip.filter.intensity || 1) * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={selectedClip.filter.intensity || 1}
                  onChange={(e) => handleFilterIntensityChange(parseFloat(e.target.value))}
                  className="w-full accent-accent h-1 bg-bg-hover rounded-lg appearance-none cursor-pointer"
                />
              </div>
            )}
          </div>
        )}

        {/* 动画 - 视频/图片/文本 */}
        {supportsAnimation && (
          <div className={`${styles.subsection} space-y-3 pt-3`}>
            <div className="flex items-center gap-2">
              <Play size={14} className="text-status-success" />
              <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">动画</h4>
            </div>

            {/* 入场动画 */}
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">入场动画</label>
              <div className="flex gap-1">
                <select
                  value={selectedClip.animations?.find(a => a.type === 'in')?.effectId || 'none'}
                  onChange={(e) => handleAnimationChange('in', e.target.value)}
                  className={`${styles.field} ${styles.fieldGreen} flex-1 rounded px-2 py-1 text-xs outline-none`}
                >
                  <option value="none">无</option>
                  {ANIMATION_PRESETS.filter(a => a.type === 'in').map(a => (
                    <option key={a.effectId} value={a.effectId}>{a.name}</option>
                  ))}
                </select>
                {selectedClip.animations?.find(a => a.type === 'in') && (
                  <input
                    type="number"
                    value={selectedClip.animations.find(a => a.type === 'in')?.duration || 0.5}
                    onChange={(e) => handleAnimationDurationChange('in', parseFloat(e.target.value) || 0.5)}
                    min="0.1"
                    max="5"
                    step="0.1"
                    className={`${styles.field} ${styles.fieldGreen} w-16 rounded px-2 py-1 text-xs outline-none`}
                    title="时长(秒)"
                  />
                )}
              </div>
            </div>

            {/* 出场动画 */}
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">出场动画</label>
              <div className="flex gap-1">
                <select
                  value={selectedClip.animations?.find(a => a.type === 'out')?.effectId || 'none'}
                  onChange={(e) => handleAnimationChange('out', e.target.value)}
                  className={`${styles.field} ${styles.fieldGreen} flex-1 rounded px-2 py-1 text-xs outline-none`}
                >
                  <option value="none">无</option>
                  {ANIMATION_PRESETS.filter(a => a.type === 'out').map(a => (
                    <option key={a.effectId} value={a.effectId}>{a.name}</option>
                  ))}
                </select>
                {selectedClip.animations?.find(a => a.type === 'out') && (
                  <input
                    type="number"
                    value={selectedClip.animations.find(a => a.type === 'out')?.duration || 0.5}
                    onChange={(e) => handleAnimationDurationChange('out', parseFloat(e.target.value) || 0.5)}
                    min="0.1"
                    max="5"
                    step="0.1"
                    className={`${styles.field} ${styles.fieldGreen} w-16 rounded px-2 py-1 text-xs outline-none`}
                    title="时长(秒)"
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* 音频淡入淡出 - 仅音频 */}
        {isAudioClip && (
          <div className={`${styles.subsection} space-y-3 pt-3`}>
            <div className="flex items-center gap-2">
              <Volume2 size={14} className="text-status-warning" />
              <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">音频效果</h4>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-secondary flex justify-between">
                淡入 <span>{(selectedClip.audioFade?.fadeIn || 0).toFixed(1)}s</span>
              </label>
              <input
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={selectedClip.audioFade?.fadeIn || 0}
                onChange={(e) => handleAudioFadeChange(parseFloat(e.target.value), undefined)}
                className="w-full accent-status-warning h-1 bg-bg-hover rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-secondary flex justify-between">
                淡出 <span>{(selectedClip.audioFade?.fadeOut || 0).toFixed(1)}s</span>
              </label>
              <input
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={selectedClip.audioFade?.fadeOut || 0}
                onChange={(e) => handleAudioFadeChange(undefined, parseFloat(e.target.value))}
                className="w-full accent-status-warning h-1 bg-bg-hover rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* 蒙版 - 仅视频/图片 */}
        {supportsKeyframes && (
          <div className={`${styles.subsection} space-y-3 pt-3`}>
            <div className="flex items-center gap-2">
              <Square size={14} className="text-status-info" />
              <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">蒙版</h4>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-secondary">蒙版类型</label>
              <select
                value={selectedClip.mask?.type || 'none'}
                onChange={(e) => handleMaskTypeChange(e.target.value as MaskType | 'none')}
                className={`${styles.field} ${styles.fieldBlue} w-full rounded px-2 py-1 text-xs outline-none`}
              >
                <option value="none">无</option>
                {MASK_TYPES.map(m => (
                  <option key={m.type} value={m.type}>{m.name}</option>
                ))}
              </select>
            </div>

            {selectedClip.mask && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-text-secondary flex justify-between">
                    大小 <span>{Math.round((selectedClip.mask.size || 0.5) * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedClip.mask.size || 0.5}
                    onChange={(e) => handleMaskPropertyChange('size', parseFloat(e.target.value))}
                    className="w-full accent-status-info h-1 bg-bg-hover rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-text-secondary flex justify-between">
                    羽化 <span>{Math.round((selectedClip.mask.feather || 0) * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedClip.mask.feather || 0}
                    onChange={(e) => handleMaskPropertyChange('feather', parseFloat(e.target.value))}
                    className="w-full accent-status-info h-1 bg-bg-hover rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-text-secondary flex justify-between">
                    旋转 <span>{Math.round(selectedClip.mask.rotation || 0)}°</span>
                  </label>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={selectedClip.mask.rotation || 0}
                    onChange={(e) => handleMaskPropertyChange('rotation', parseInt(e.target.value))}
                    className="w-full accent-status-info h-1 bg-bg-hover rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="maskInvert"
                    checked={selectedClip.mask.invert || false}
                    onChange={(e) => handleMaskPropertyChange('invert', e.target.checked)}
                    className="accent-status-info"
                  />
                  <label htmlFor="maskInvert" className="text-xs text-text-secondary">反转蒙版</label>
                </div>
              </>
            )}
          </div>
        )}

        {/* 信息 */}
        <div className={`${styles.subsection} pt-3 text-xs text-text-tertiary space-y-1`}>
          <p>素材: <span className="text-text-secondary truncate block">{selectedClip.name}</span></p>
          <p>时长: <span className="text-text-secondary">{selectedClip.duration.toFixed(1)}s</span></p>
          <p>起始: <span className="text-text-secondary">{selectedClip.start.toFixed(1)}s</span></p>
        </div>
      </div>
    </div>
  );
};

export default SimplePropertiesPanel;
