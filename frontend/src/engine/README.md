# Engine Module

The engine module currently provides **a single playback engine** (`simpleEngine`) plus
two parallel keyframe systems (one per data model).

## P1#2 清理记录

历史上本目录曾有 6 个组件（MediaEngine / PlaybackEngine / VideoRenderer /
AudioController / KeyframeInterpolator / SnapEngine），实际从未被 src 中任何模块
消费——所有 UI 都直接 `new SimpleMediaEngine` 等。在 P1#2 重构中作为死码删除，
README 同步收敛。

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Engine Module                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │            Playback (SimplePlayer.tsx 消费)          │    │
│  │  ┌─────────────────┐  ┌────────────────────┐        │    │
│  │  │ SimpleMediaEngine│  │ SimpleVideoRenderer│        │    │
│  │  │  (RAF + 状态)   │  │     (Canvas)       │        │    │
│  │  └────────┬────────┘  └──────────┬─────────┘        │    │
│  │           │                      │                   │    │
│  │           └──────────┬───────────┘                   │    │
│  │                      ▼                               │    │
│  │            ┌─────────────────────┐                   │    │
│  │            │ SimpleAudioController│                   │    │
│  │            └─────────────────────┘                   │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                    Keyframes                         │    │
│  │  ┌──────────────────┐  ┌──────────────────┐         │    │
│  │  │   keyframe.ts    │  │ simpleKeyframe.ts│         │    │
│  │  │ (TrackKeyframe)  │  │   (Keyframe)     │         │    │
│  │  └────────┬─────────┘  └────────┬─────────┘         │    │
│  │           │                     │                    │    │
│  │   trackStore +              SimpleEditor +           │    │
│  │   PropertiesPanel           SimplePropertiesPanel +  │    │
│  │                             simpleExportRenderer     │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `simpleEngine.ts` | `SimpleMediaEngine` / `SimpleVideoRenderer` / `SimpleAudioController` —— 唯一播放路径 |
| `simpleKeyframe.ts` | `Clip` / `Keyframe` 数据模型下的关键帧工具 |
| `keyframe.ts` | `TrackLine` / `TrackKeyframe` 数据模型下的关键帧工具 + easingFunctions |
| `index.ts` | 模块导出（仅 keyframe；其余直接 import simpleEngine 路径） |

## Two Keyframe Systems

The codebase currently has two independent keyframe utilities in this module:

| Module | Data model | Consumers |
|---|---|---|
| `keyframe.ts` | `TrackLine` / `TrackKeyframe` (`types/track.ts`) | `store/trackStore.ts`, `EasingPicker.tsx`, `PropertiesPanel/index.tsx` |
| `simpleKeyframe.ts` | `Clip` / `Keyframe` (`types/media.ts`) | `SimpleEditor.tsx`, `SimplePropertiesPanel.tsx`, `services/simpleExportRenderer.ts`, `SimplePlayer.tsx` |

两套并行，对应 UI 的两个数据通道。统一为单一模型属于更大的数据模型重构，
不在本次清理范围内。

## Usage

```typescript
import { SimpleMediaEngine, SimpleVideoRenderer, SimpleAudioController } from './engine/simpleEngine';

const engine = new SimpleMediaEngine(durationMs);
const audioController = new SimpleAudioController(engine);
const renderer = new SimpleVideoRenderer(engine, canvasElement);
renderer.setAudioController(audioController);

engine.on('timeUpdate', (e) => { /* ... */ });
engine.play();
```

## Performance Considerations

- `SimpleVideoRenderer` 使用 `requestAnimationFrame` 渲染循环
- `SimpleAudioController` 共享视频元素以避免双解码
- 关键帧插值在 `simpleKeyframe.getAnimatedProperties()` 中按时间二分实现
