/**
 * 草稿导出框架 - 类型定义
 * 支持导出到多种剪辑软件格式
 */

import type { Track } from '../../types/editor';

// 编辑器坐标系 (项目内部使用)
// - 原点: 画布中心
// - 单位: 像素
// - x: 正向右, y: 正向下
// - 时间: 秒
export interface EditorCoordinate {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

// 画布尺寸
export interface CanvasSize {
  width: number;
  height: number;
}

// 导出选项
export interface DraftExportOptions {
  outputPath: string;
  projectName: string;
  fps: number;
  copyMaterials: boolean;
}

// 导出结果
export interface DraftExportResult {
  success: boolean;
  outputPath: string;
  warnings?: string[];
  error?: string;
}

// 坐标转换器接口 - 不同软件实现自己的转换逻辑
export interface CoordinateTransformer {
  // 编辑器坐标 → 目标软件坐标
  transformPosition(
    editorX: number,
    editorY: number,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number };

  // 编辑器缩放 → 目标软件缩放
  transformScale(editorScale: number): { scaleX: number; scaleY: number };

  // 编辑器旋转 → 目标软件旋转
  transformRotation(editorRotation: number): number;

  // 编辑器透明度 → 目标软件透明度
  transformOpacity(editorOpacity: number): number;

  // 编辑器时间(秒) → 目标软件时间单位
  transformTime(seconds: number): number;

  // 目标软件时间单位 → 编辑器时间(秒)
  transformTimeReverse(targetTime: number): number;
}

// 草稿导出器接口 - 每种软件格式实现���个导出器
export interface DraftExporter {
  readonly format: string;
  readonly displayName: string;
  readonly fileExtension: string;

  // 获取坐标转换器
  getTransformer(): CoordinateTransformer;

  // 检查是否支持导出
  canExport(tracks: Track[], options: DraftExportOptions): boolean;

  // 执行导出
  export(
    tracks: Track[],
    options: DraftExportOptions,
    canvasSize: CanvasSize
  ): Promise<DraftExportResult>;
}
