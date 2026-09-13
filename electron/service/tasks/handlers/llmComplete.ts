/**
 * llm:complete —— 主进程主导的 LLM 调用 handler
 *
 * 设计：
 *  - 现有 IPCLLMProvider 调 `llm:query` 是 one-shot IPC：renderer await 一个 Promise，
 *    关窗口 → 响应没人收，被丢弃。
 *  - 这个 handler 把 LLM 调用包成 task：写 SQLite → 主进程跑 llmExecutionEngine → 完成态广播 →
 *    renderer 通过 waitForTaskCompletion 拿结果，**关窗口不影响主进程跑完**，
 *    重新打开 renderer 时还能通过 task.id 取回。
 *
 * 不处理：
 *  - 流式（streaming）暂留 chat:* 通道，未来再做"流式分块入 task"
 *  - 被取消时调用方应自己实现取消上游 fetch；当前 cancel 只翻状态
 */
import { taskRunner } from '../TaskRunner';
import { llmExecutionEngine, type LLMQueryRequest, type LLMQueryResponse } from '../../llm';

interface LLMCompleteOutput {
  content: string;
  usage?: LLMQueryResponse['usage'];
}

let registered = false;

export function registerLLMCompleteHandler(): void {
  if (registered) return;
  registered = true;

  taskRunner.registerHandler({
    type: 'llm:complete',
    concurrency: 5,
    // 非 streaming 一次性请求；中途中断没法可靠续传，所以 boot 时如果残留就标 failed
    recoverable: false,
    async run(ctx) {
      const request = ctx.input as LLMQueryRequest;
      // 落 input 副本到 payload，便于诊断
      ctx.patch({ payload: { request } });

      const response = await llmExecutionEngine.query(request);
      if (response.error) {
        throw new Error(response.error.message || '请检查 LLM 配置');
      }
      if (!response.content) {
        throw new Error('LLM 返回为空');
      }
      const output: LLMCompleteOutput = {
        content: response.content,
        usage: response.usage,
      };
      return output;
    },
  });
}
