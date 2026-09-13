/**
 * 草稿导出模块入口
 */

// 类型导出
export type {
  DraftExporter,
  DraftExportOptions,
  DraftExportResult,
  CanvasSize,
  CoordinateTransformer,
  EditorCoordinate,
} from './types';

// 坐标转换
export {
  IdentityTransformer,
  generateUUID,
  generateHexId,
  getFileExtension,
  isVideoFile,
  isImageFile,
  isAudioFile,
} from './coordinateTransform';

// 注册表
export { exporterRegistry } from './ExporterRegistry';

// 剪映导出器
export { JianyingExporter } from './JianyingExporter';
export {
  JianyingCoordinateTransformer,
  jianyingTransformer,
  MICROSECONDS_PER_SECOND,
} from './JianyingCoordinateTransformer';

// 剪映工具函数
export {
  secondsToMicroseconds,
  pixelToHalfCanvas,
  buildKeyframeListsFromClip,
  buildFilter,
  buildAnimations,
  buildAudioFade,
  buildMask,
  buildTransition,
} from './jianyingUtils';

// 兼容性检测
export {
  checkExportCompatibility,
  getCompatibilityWarning,
  type CompatibilityReport,
  type AdvancedFeature,
  type FeatureSupport,
} from './exportCapabilityChecker';

// 初始化：注册所有导出器
import { exporterRegistry } from './ExporterRegistry';
import { JianyingExporter } from './JianyingExporter';

// 注册剪映导出器
exporterRegistry.register(new JianyingExporter());
