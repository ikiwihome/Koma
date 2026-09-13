/**
 * 视频推理模板内容（按时长 × 模式拆分的 5 份默认模板源）
 *
 * 这些 .md 文件是 prompts/视频推理*.md / .txt 的项目内副本，通过 Vite ?raw
 * 直接导入为字符串。修改时请同步更新 prompts/ 下的对应源文件，便于在 PromptStudio
 * 之外也能离线参考。
 */
import shotVideo6sMulti from './shot_video_6s_multi.md?raw';
import shotVideo10sMulti from './shot_video_10s_multi.md?raw';
import shotVideo15sMulti from './shot_video_15s_multi.md?raw';
import shotVideo20sMulti from './shot_video_20s_multi.md?raw';
import shotVideo6sFirstFrame from './shot_video_6s_firstframe.md?raw';
import shotVideo10sFirstFrame from './shot_video_10s_firstframe.md?raw';
import shotVideo16sFirstFrame from './shot_video_16s_firstframe.md?raw';
import shotVideo20sFirstFrame from './shot_video_20s_firstframe.md?raw';

export const VIDEO_REASONING_TEMPLATE_CONTENT = {
  shot_video_6s_multi: shotVideo6sMulti,
  shot_video_10s_multi: shotVideo10sMulti,
  shot_video_15s_multi: shotVideo15sMulti,
  shot_video_20s_multi: shotVideo20sMulti,
  shot_video_6s_firstframe: shotVideo6sFirstFrame,
  shot_video_10s_firstframe: shotVideo10sFirstFrame,
  shot_video_16s_firstframe: shotVideo16sFirstFrame,
  shot_video_20s_firstframe: shotVideo20sFirstFrame,
} as const;
