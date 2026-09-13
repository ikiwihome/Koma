/**
 * Engine 模块统一导出
 *
 * P1#2 清理：MediaEngine / PlaybackEngine / VideoRenderer / AudioController /
 * KeyframeInterpolator / SnapEngine 在 src 中无任何消费者，作为死码删除。
 *
 * 阶段 2-A 清理：keyframe.ts (TrackKeyframe 数据模型) 与 trackStore + types/track.ts
 * 整套孤立子系统一并删除。
 *
 * 当前实际在用：
 *  - SimpleMediaEngine / SimpleVideoRenderer / SimpleAudioController（simpleEngine.ts）
 *    由 components/editor/SimplePlayer.tsx 直接 new
 *  - simpleKeyframe（用于 Clip 数据模型 / SimplePlayer 等）
 */
