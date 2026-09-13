/**
 * Renderer-side fulfillers for main-side analysis:* 父任务 handler。
 *
 * 用途：main 进程注册的 'analysis:shot' / 'analysis:script' handler 通过
 * delegateToRenderer 把执行交回这里。fulfiller 直接复用现有 ShotAnalysisService /
 * ScriptAnalysisService（不重写 LLM closures），共享同一 parentTaskId
 * 让 service 内部的 TaskManager.updateTask 写到主进程已创建的那条记录上。
 *
 * 这样得到：
 *  - 主进程父任务限流（concurrency=1）+ 取消 AbortController
 *  - service 仍然按原代码走 stage / chunk 推进 + 写 result.stageStates 进度细节
 */
import { registerDelegate } from './tasksDelegate';
import { waitForTaskCompletion, type TaskRecord } from './tasksIPC';
import type { PresetAssets } from './ShotAnalysisService';
import type { StyleSnapshotLike } from '../utils/promptNormalize';
import { createLogger } from '../store/logger';

const logger = createLogger('AnalysisFulfillers');

interface ShotAnalysisInput {
  parentTaskId: string;
  projectId: string;
  episodeId: string;
  episodeName: string;
  script: string;
  llmSelection?: string;
  presetAssets?: PresetAssets;
  styleSnapshot?: StyleSnapshotLike;
}

interface ScriptAnalysisInput {
  parentTaskId: string;
  projectId: string;
  episodeId: string;
  episodeName: string;
  script: string;
  llmSelection?: string;
  styleSnapshot?: StyleSnapshotLike;
}

interface AnalysisResult {
  ok: true;
  shotsCount?: number;
  charactersCount?: number;
  scenesCount?: number;
  propsCount?: number;
}

/**
 * 等任务进入终态。走 IPC 广播订阅（waitForTaskCompletion），不再依赖
 * TaskManager 本地 cache + listener。
 *
 * 为什么改：之前的 waitForLocalTaskTerminal 依赖 TaskManager.addListener。
 * 用户切换项目时 App.tsx 会调 TaskManager.dispose() → listeners.clear()，
 * 此时 fulfiller 在等的 listener 被清掉，service 写入 'completed' 后没有
 * 任何人唤醒它，最终只能等主进程 delegateToRenderer 超时（30 分钟）
 * 才把任务标 failed —— 但实际产物（角色/场景/道具）已经写盘成功。
 *
 * 切到 waitForTaskCompletion 后，等待路径只依赖 tasks:updated 广播；
 * 即便 TaskManager 被 dispose，service 配合 TaskManager.updateTask 的 IPC
 * 兜底仍能把终态写到主进程，从而广播触达本 fulfiller 让它正常 resolve。
 */
async function waitForTaskTerminal(taskId: string): Promise<TaskRecord> {
  return waitForTaskCompletion(taskId);
}

/**
 * service.runAnalysis 通过 TaskManager.updateTask({ result: {...} }) 写入摘要；
 * TaskManager 把整个 Task 序列化进 payload，所以从 record 取回时走 payload.result。
 */
function readTaskResult(record: TaskRecord): {
  shotsCount?: number;
  charactersCount?: number;
  scenesCount?: number;
  propsCount?: number;
} {
  const payload = (record.payload || {}) as { result?: unknown };
  const raw = (payload.result && typeof payload.result === 'object'
    ? payload.result
    : {}) as Record<string, unknown>;
  const pickNumber = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return {
    shotsCount: pickNumber(raw.shotsCount),
    charactersCount: pickNumber(raw.charactersCount),
    scenesCount: pickNumber(raw.scenesCount),
    propsCount: pickNumber(raw.propsCount),
  };
}

let registered = false;

export function registerAnalysisFulfillers(): void {
  if (registered) return;
  registered = true;

  registerDelegate<ShotAnalysisInput, AnalysisResult>('analysis:shot:run', async (args) => {
    const { createCreationContext } = await import('./CreationContext');
    const { ShotAnalysisService } = await import('./ShotAnalysisService');
    const ctx = await createCreationContext(args.projectId, args.episodeId, {
      llmConfigId: args.llmSelection,
      styleSnapshot: args.styleSnapshot,
    });
    const service = new ShotAnalysisService(ctx);
    // 关键：用 main 已经创建的 parentTaskId，不让 service 自己 createTask
    service.setPresetAssets(args.presetAssets);
    // service.runShotAnalysis 内部按 parentTaskId 走 TaskManager.updateTask 推进进度
    // 抛错会写 status:failed；正常完成写 status:completed + result
    void service.runShotAnalysis(args.parentTaskId, args.episodeId, args.script);
    const final = await waitForTaskTerminal(args.parentTaskId);
    const result = readTaskResult(final);
    return { ok: true, shotsCount: result.shotsCount };
  });

  registerDelegate<ScriptAnalysisInput, AnalysisResult>('analysis:script:run', async (args) => {
    const { BackgroundAnalysisService } = await import('./ScriptAnalysisService');
    const service = new BackgroundAnalysisService(args.projectId);
    // BackgroundAnalysisService.runAnalysis 内部使用 this.task，所以先绑定外部 taskId
    service.bindTask(args.parentTaskId);
    void service.runAnalysis(
      args.episodeId,
      args.episodeName,
      args.script,
      args.llmSelection,
      args.styleSnapshot,
    );
    const final = await waitForTaskTerminal(args.parentTaskId);
    const result = readTaskResult(final);
    logger.info('analysis:script:run done', { taskId: args.parentTaskId, result });
    return {
      ok: true,
      charactersCount: result.charactersCount,
      scenesCount: result.scenesCount,
      propsCount: result.propsCount,
    };
  });
}
