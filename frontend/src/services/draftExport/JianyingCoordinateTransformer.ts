/**
 * 剪映坐标转换器
 * 将编辑器坐标系转换为剪映坐标系
 *
 * 编辑器坐标系:
 * - 原点: 画布中心
 * - 单位: 像素
 * - x: 正向右, y: 正向下
 * - 时间: 秒
 *
 * 剪映坐标系:
 * - 原点: 画布中心
 * - 单位: 「半画布宽/高」
 * - x: -1 = 左边缘, 0 = 中心, 1 = 右边缘
 * - y: -1 = 上边缘, 0 = 中心, 1 = 下边缘
 * - 时间: 微秒 (1秒 = 1,000,000微秒)
 */

import type { CoordinateTransformer } from './types';

// 微秒常量
export const MICROSECONDS_PER_SECOND = 1_000_000;

export class JianyingCoordinateTransformer implements CoordinateTransformer {
  /**
   * 将编辑器像素坐标转换为剪映半画布单位
   * 编辑器: (0, 0) = 画布中心, 像素单位
   * 剪映: (0, 0) = 画布中心, 半画布宽高为单位
   */
  transformPosition(
    editorX: number,
    editorY: number,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number } {
    const halfWidth = canvasWidth / 2;
    const halfHeight = canvasHeight / 2;

    return {
      x: editorX / halfWidth,
      y: editorY / halfHeight
    };
  }

  /**
   * 将剪映坐标转换回编辑器像素坐标
   */
  transformPositionReverse(
    jianyingX: number,
    jianyingY: number,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number } {
    const halfWidth = canvasWidth / 2;
    const halfHeight = canvasHeight / 2;

    return {
      x: jianyingX * halfWidth,
      y: jianyingY * halfHeight
    };
  }

  /**
   * 缩放转换 - 剪映使用 x/y 分离的缩放
   */
  transformScale(editorScale: number): { scaleX: number; scaleY: number } {
    return {
      scaleX: editorScale,
      scaleY: editorScale
    };
  }

  /**
   * 旋转转换 - 直接使用，单位都是角度
   */
  transformRotation(editorRotation: number): number {
    return editorRotation;
  }

  /**
   * 透明度转换 - 直接使用，范围都是 0-1
   */
  transformOpacity(editorOpacity: number): number {
    return editorOpacity;
  }

  /**
   * 时间转换: 秒 → 微秒
   */
  transformTime(seconds: number): number {
    return Math.round(seconds * MICROSECONDS_PER_SECOND);
  }

  /**
   * 时间反向转换: 微秒 → 秒
   */
  transformTimeReverse(microseconds: number): number {
    return microseconds / MICROSECONDS_PER_SECOND;
  }
}

// 单例导出
export const jianyingTransformer = new JianyingCoordinateTransformer();
