/**
 * 变换控制框组件
 * 用于在预览区域选中素材后显示拖拽、缩放、旋转控制
 */
import React, { useRef, useCallback, useEffect, useState } from 'react';
import styles from './TransformControl.module.scss';
import { cssVars } from '../../theme/runtime';

interface TransformControlProps {
  // 素材在画布中的位置（相对于画布中心的偏移，画布坐标系）
  x: number;
  y: number;
  scale: number;
  rotation: number;
  // 素材原始尺寸（用于计算 contain 后的实际显示尺寸）
  sourceWidth: number;
  sourceHeight: number;
  // 预览区域尺寸（像素）
  previewWidth: number;
  previewHeight: number;
  // 实际画布尺寸（用于坐标转换）
  canvasWidth: number;
  canvasHeight: number;
  // 回调 - screenDeltaX/Y 是屏幕像素总增量，initialX/Y 是拖动开始时的画布坐标
  onMove: (screenDeltaX: number, screenDeltaY: number, initialX: number, initialY: number) => void;
  onScale: (newScale: number) => void;
  onRotate: (newRotation: number) => void;
  onTransformEnd: () => void;
}

type HandleType = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'rotate';

// 拖动初始状态
interface DragStart {
  startX: number;
  startY: number;
  initialX: number;  // 素材初始 x
  initialY: number;  // 素材初始 y
  initialScale: number;
  initialRotation: number;
}

export const TransformControl: React.FC<TransformControlProps> = ({
  x,
  y,
  scale,
  rotation,
  sourceWidth,
  sourceHeight,
  previewWidth,
  previewHeight,
  canvasWidth,
  canvasHeight,
  onMove,
  onScale,
  onRotate,
  onTransformEnd,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<HandleType | null>(null);
  const dragStartRef = useRef<DragStart>({
    startX: 0, startY: 0,
    initialX: 0, initialY: 0,
    initialScale: 1, initialRotation: 0
  });

  // 使用 ref 保存回调，避免 useEffect 依赖变化导致无限循环
  const onMoveRef = useRef(onMove);
  const onScaleRef = useRef(onScale);
  const onRotateRef = useRef(onRotate);
  const onTransformEndRef = useRef(onTransformEnd);
  onMoveRef.current = onMove;
  onScaleRef.current = onScale;
  onRotateRef.current = onRotate;
  onTransformEndRef.current = onTransformEnd;

  // 坐标转换比例
  const scaleRatio = previewWidth / canvasWidth;

  // 计算素材在画布中的实际显示尺寸（contain 模式）
  const sourceAspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  let contentWidth: number, contentHeight: number;
  if (sourceAspect > canvasAspect) {
    // 素材更宽，宽度撑满画布
    contentWidth = canvasWidth;
    contentHeight = canvasWidth / sourceAspect;
  } else {
    // 素材更高，高度撑满画布
    contentHeight = canvasHeight;
    contentWidth = canvasHeight * sourceAspect;
  }

  // 应用 scale 并转换到预览区像素
  const baseWidth = contentWidth * scale * scaleRatio;
  const baseHeight = contentHeight * scale * scaleRatio;

  // 控制框位置 = 预览区中心 + 偏移
  const centerX = previewWidth / 2 + x * scaleRatio;
  const centerY = previewHeight / 2 + y * scaleRatio;
  const boxLeft = centerX - baseWidth / 2;
  const boxTop = centerY - baseHeight / 2;

  // 控制点大小
  const handleSize = 10;
  const rotateHandleOffset = 30;

  const handleMouseDown = useCallback((e: React.MouseEvent, type: HandleType) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    setDragType(type);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: x,
      initialY: y,
      initialScale: scale,
      initialRotation: rotation,
    };
  }, [x, y, scale, rotation]);

  useEffect(() => {
    if (!isDragging || !dragType) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartRef.current.startX;
      const deltaY = e.clientY - dragStartRef.current.startY;

      switch (dragType) {
        case 'move': {
          // 传递总增量和初始位置
          onMoveRef.current(deltaX, deltaY, dragStartRef.current.initialX, dragStartRef.current.initialY);
          break;
        }
        case 'nw':
        case 'ne':
        case 'sw':
        case 'se': {
          // 角点等比缩放
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const sign = (dragType === 'se' || dragType === 'ne' ? deltaX > 0 : deltaX < 0) ? 1 : -1;
          const scaleDelta = sign * distance / 500;
          const newScale = Math.max(0.1, Math.min(3, dragStartRef.current.initialScale + scaleDelta));
          onScaleRef.current(newScale);
          break;
        }
        case 'rotate': {
          // 计算从控制框中心到鼠标的角度
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI) + 90;
          onRotateRef.current(angle);
          break;
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragType(null);
      onTransformEndRef.current();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragType]);

  return (
    <div
      ref={containerRef}
      className={`${styles.root} absolute pointer-events-none`}
      style={cssVars({
        '--transform-left': `${boxLeft}px`,
        '--transform-top': `${boxTop}px`,
        '--transform-width': `${baseWidth}px`,
        '--transform-height': `${baseHeight}px`,
        '--transform-rotation': `${rotation}deg`,
        '--transform-handle-size': `${handleSize}px`,
        '--transform-handle-offset': `${-handleSize / 2}px`,
        '--transform-rotate-offset': `${rotateHandleOffset}px`,
        '--transform-rotate-top': `${-rotateHandleOffset - handleSize}px`,
      })}
    >
      {/* 边框 */}
      <div
        className="absolute inset-0 border-2 border-status-info pointer-events-auto cursor-move"
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      />

      {/* 四角控制点 */}
      <div
        className={`${styles.handle} ${styles.handleNw} pointer-events-auto`}
        onMouseDown={(e) => handleMouseDown(e, 'nw')}
      />
      <div
        className={`${styles.handle} ${styles.handleNe} pointer-events-auto`}
        onMouseDown={(e) => handleMouseDown(e, 'ne')}
      />
      <div
        className={`${styles.handle} ${styles.handleSw} pointer-events-auto`}
        onMouseDown={(e) => handleMouseDown(e, 'sw')}
      />
      <div
        className={`${styles.handle} ${styles.handleSe} pointer-events-auto`}
        onMouseDown={(e) => handleMouseDown(e, 'se')}
      />

      {/* 旋转手柄 */}
      <div
        className={`${styles.rotateControl} absolute pointer-events-auto`}
      >
        {/* 连接线 */}
        <div
          className={`${styles.rotateStem} absolute left-1/2 -translate-x-1/2 bg-status-info`}
        />
        {/* 旋转手柄 */}
        <div
          className={styles.rotateHandle}
          onMouseDown={(e) => handleMouseDown(e, 'rotate')}
        />
      </div>
    </div>
  );
};

export default TransformControl;
