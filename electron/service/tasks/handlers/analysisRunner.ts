/**
 * analysis:shot / analysis:script —— 父级"分析"任务 main-side handler。
 *
 * 设计目标：
 *  - 加并发上限（concurrency=1）防止用户重复触发同一类分析占满 LLM 池
 *  - 主进程作为权威：取消信号 / 多窗口共享状态 / boot 后视为失败而非半挂着
 *
 * 实现：handler 不在 main 里跑业务（LLM closures + ctx 强依赖 renderer）；
 * 通过 delegateToRenderer 把整段执行交给 renderer 的 'analysis:shot:run' /
 * 'analysis:script:run' fulfiller。fulfiller 内部仍调原 ShotAnalysisService /
 * ScriptAnalysisService（不重写）。
 *
 * 取消传播：main signal abort → delegateToRenderer 立即 reject；renderer 端
 * 任务 cancellation signal（Phase 4-A）也会监听 'cancelled' 状态广播自行中止。
 */
import { taskRunner } from '../TaskRunner';
import { delegateToRenderer } from '../delegate';

interface AnalysisInput {
  projectId: string;
  episodeId: string;
  episodeName: string;
  script: string;
  llmSelection?: string;
  styleSnapshot?: unknown;
  /** shot-analysis 用：预选的 sora2 角色/道具 */
  presetAssets?: unknown;
}

interface AnalysisResult {
  /** 完成时回写到 task.payload.output */
  ok: true;
  shotsCount?: number;
  charactersCount?: number;
  scenesCount?: number;
  propsCount?: number;
}

const ANALYSIS_TIMEOUT_MS = 30 * 60 * 1_000; // 30 分钟

let registered = false;

export function registerAnalysisHandlers(): void {
  if (registered) return;
  registered = true;

  // 注意：type 复用 service 历史已用的 'shot-analysis' / 'script-analysis'，
  // 这样 dedup 检查（"是否已有同 episode 在跑"）对新旧两条提交路径生效。
  taskRunner.registerHandler({
    type: 'shot-analysis',
    concurrency: 1,
    recoverable: false,
    async run(ctx) {
      const result = await delegateToRenderer<AnalysisResult>({
        type: 'analysis:shot:run',
        args: { ...(ctx.input as AnalysisInput), parentTaskId: ctx.taskId },
        signal: ctx.signal,
        timeoutMs: ANALYSIS_TIMEOUT_MS,
      });
      return result;
    },
  });

  taskRunner.registerHandler({
    type: 'script-analysis',
    concurrency: 1,
    recoverable: false,
    async run(ctx) {
      const result = await delegateToRenderer<AnalysisResult>({
        type: 'analysis:script:run',
        args: { ...(ctx.input as AnalysisInput), parentTaskId: ctx.taskId },
        signal: ctx.signal,
        timeoutMs: ANALYSIS_TIMEOUT_MS,
      });
      return result;
    },
  });
}
