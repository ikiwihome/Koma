/**
 * 长任务静音守卫（极简版）
 *
 * 唯一职责：判定"此刻是否有视频生成 / 批量分镜 / LLM 流式 / 脚本分析在跑"。
 * UpdaterService 在执行 quitAndInstall 之前会查一次此函数——命中则拒绝安装，
 * 用户的下一次点击或下一次启动检查会再试。
 *
 * 历史版本还有"任务空闲 30s 后把 silent 状态升级为 visible"逻辑；已删除：
 * 新方案没有 silent state，按钮要么显示要么不显示，长任务期间用户也能看到按钮，
 * 只是点击"重启以更新"会被静默忽略（前端不知道，但 UpdaterService 会拒绝）。
 *
 * 长任务类型集合是白名单——新增长任务类型必须同步更新。
 */

import { taskService } from '../tasks/TaskService';

const LONG_TASK_TYPES = new Set<string>([
  'tti',
  'itv',
  'tts',
  'shot-generation',
  'prompt-generation:image',
  'prompt-generation:video',
  'llm:complete',
  'script-analysis',
  'shot-analysis',
  'entity-extraction',
  'episode-split',
  'shot-prompt',
  'asset-match',
]);

export function isLongTaskRunning(): boolean {
  return taskService.list({ status: 'running' }).some((t) => LONG_TASK_TYPES.has(t.type));
}
