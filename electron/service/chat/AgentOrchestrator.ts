/**
 * AgentOrchestrator
 * Supervisor 模式的多智能体编排器
 * 基于 LangGraph StateGraph 实现并行 Worker 调度
 * 支持 CapabilityRegistry 能力解析
 */
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { EventEmitter } from 'events';
import { agentRegistry } from '../plugin/registries';
import { capabilityRegistry } from '../plugin/capability';
import { AgentWorker, createWorker, AgentResult } from './AgentWorker';
import { createLLM } from './AgentGraph';
import type { WorkerAgentDefinition } from '../plugin/types';
import type { SessionConfig } from './types';

// ========== 类型定义 ==========

export interface TaskPlan {
  id: string;
  workerId: string;
  workerName: string;
  task: string;
  priority: number;
  dependencies: string[];
  status: 'pending' | 'running' | 'done' | 'error';
  result?: AgentResult;
  retryCount: number;
}

export interface OrchestratorEvent {
  type: 'plan' | 'dispatch' | 'worker_start' | 'worker_done' | 'worker_error' | 'synthesize' | 'done' | 'error';
  data: unknown;
}

// 编排配置
export interface OrchestratorConfig {
  maxIterations: number;        // 最大迭代次数（防死循环）
  maxRetries: number;           // Worker 最大重试次数
  parallelExecution: boolean;   // 是否并行执行 Worker
  workerIds?: string[];         // 限定使用的 Worker（为空则使用全部）
  requiredCapabilities?: string[]; // 需要的能力标签（Supervisor 可参考）
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxIterations: 5,
  maxRetries: 2,
  parallelExecution: true,
};

// ========== 编排状态 ==========

// ========== 核心编排器 ==========

export class AgentOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private sessionConfig: SessionConfig;
  private supervisorLLM: BaseChatModel;
  private workers = new Map<string, AgentWorker>();
  private abortController: AbortController | null = null;

  constructor(sessionConfig: SessionConfig, config?: Partial<OrchestratorConfig>) {
    super();
    this.sessionConfig = sessionConfig;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.supervisorLLM = createLLM(sessionConfig);
  }

  /**
   * 初始化可用 Worker
   * 支持 workerIds 过滤（AgentTemplate 的 orchestrated 模式）
   */
  private initWorkers(): void {
    this.workers.clear();
    let definitions = agentRegistry.list();

    // 如果指定了 workerIds，只使用指定的 Worker
    if (this.config.workerIds && this.config.workerIds.length > 0) {
      definitions = definitions.filter(d => this.config.workerIds!.includes(d.id));
    }

    for (const def of definitions) {
      const worker = createWorker(def, this.sessionConfig);
      this.workers.set(def.id, worker);
    }
  }

  /**
   * 获取可用 Worker 描述（给 Supervisor LLM 使用）
   * 包含 capabilities 和可用能力上下文
   */
  private getWorkerDescriptions(): string {
    const descriptions: string[] = [];
    for (const [id, worker] of this.workers) {
      descriptions.push(
        `- Worker "${id}" (${worker.name}): capabilities=[${worker.capabilities.join(', ')}]`
      );
    }

    // 附加全局可用能力概览
    const capSummary = capabilityRegistry.listTypes();
    const capInfo: string[] = [];
    for (const [type, count] of capSummary) {
      capInfo.push(`${type}: ${count}`);
    }
    if (capInfo.length > 0) {
      descriptions.push(`\n全局可用能力: ${capInfo.join(', ')}`);
    }

    return descriptions.join('\n');
  }

  /**
   * Supervisor 分析并生成任务计划
   */
  private async planTasks(userMessage: string, previousResults?: string): Promise<TaskPlan[]> {
    const workerDescriptions = this.getWorkerDescriptions();

    let prompt = `你是一个任务编排器（Supervisor）。你的工作是分析用户需求，将其分解为子任务并分配给合适的 Worker。

可用 Worker：
${workerDescriptions}

用户需求：${userMessage}`;

    if (previousResults) {
      prompt += `\n\n之前的执行结果：\n${previousResults}\n\n请根据结果决定：
1. 如果所有任务完成，返回空数组 []
2. 如果需要补充任务，返回新的任务列表`;
    }

    prompt += `\n\n请以 JSON 数组格式返回任务计划，每个任务包含：
- workerId: Worker ID
- task: 具体任务描述
- priority: 优先级 (1最高)
- dependencies: 依赖的任务ID数组

只返回 JSON 数组，不要额外文字。如果无需分发 Worker（你自己就能回答），返回空数组 []。`;

    const response = await this.supervisorLLM.invoke([
      new SystemMessage('你是一个智能任务编排器，返回纯 JSON。'),
      new HumanMessage(prompt),
    ]);

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return this.parseTaskPlan(content);
  }

  /**
   * 解析 LLM 返回的任务计划
   */
  private parseTaskPlan(content: string): TaskPlan[] {
    try {
      // 提取 JSON（可能包裹在 markdown 代码块中）
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const raw = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(raw)) return [];

      return raw.map((item: any, index: number) => ({
        id: `task_${Date.now()}_${index}`,
        workerId: item.workerId || '',
        workerName: this.workers.get(item.workerId)?.name || item.workerId,
        task: item.task || '',
        priority: item.priority || index + 1,
        dependencies: item.dependencies || [],
        status: 'pending' as const,
        retryCount: 0,
      })).filter(t => t.workerId && this.workers.has(t.workerId));
    } catch {
      return [];
    }
  }

  /**
   * 分发并执行任务
   */
  private async dispatchTasks(tasks: TaskPlan[]): Promise<Array<{ taskId: string; result: AgentResult }>> {
    const results: Array<{ taskId: string; result: AgentResult }> = [];

    // 按优先级排序
    const sorted = [...tasks].sort((a, b) => a.priority - b.priority);

    // 按依赖关系分批
    const batches = this.buildExecutionBatches(sorted);

    for (const batch of batches) {
      if (this.abortController?.signal.aborted) break;

      const batchResults = this.config.parallelExecution
        ? await this.executeBatchParallel(batch)
        : await this.executeBatchSerial(batch);

      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 构建执行批次（相同依赖层级可以并行）
   */
  private buildExecutionBatches(tasks: TaskPlan[]): TaskPlan[][] {
    const batches: TaskPlan[][] = [];
    const completed = new Set<string>();
    const remaining = [...tasks];

    while (remaining.length > 0) {
      const batch: TaskPlan[] = [];
      const nextRemaining: TaskPlan[] = [];

      for (const task of remaining) {
        const depsResolved = task.dependencies.every(d => completed.has(d));
        if (depsResolved) {
          batch.push(task);
        } else {
          nextRemaining.push(task);
        }
      }

      if (batch.length === 0) {
        // 死锁：剩余任务的依赖无法解决
        batches.push(nextRemaining);
        break;
      }

      batches.push(batch);
      batch.forEach(t => completed.add(t.id));
      remaining.length = 0;
      remaining.push(...nextRemaining);
    }

    return batches;
  }

  /**
   * 并行执行一批任务
   */
  private async executeBatchParallel(batch: TaskPlan[]): Promise<Array<{ taskId: string; result: AgentResult }>> {
    const promises = batch.map(async (task) => {
      this.emit('event', { type: 'worker_start', data: { taskId: task.id, workerId: task.workerId, task: task.task } });
      task.status = 'running';

      const worker = this.workers.get(task.workerId)!;
      const result = await worker.invoke({ message: task.task });

      if (result.error && task.retryCount < this.config.maxRetries) {
        task.retryCount++;
        task.status = 'pending';
        this.emit('event', { type: 'worker_error', data: { taskId: task.id, error: result.error, retrying: true } });
        // 重试
        const retryResult = await worker.invoke({ message: task.task });
        task.status = retryResult.error ? 'error' : 'done';
        task.result = retryResult;
        this.emit('event', { type: 'worker_done', data: { taskId: task.id, result: retryResult } });
        return { taskId: task.id, result: retryResult };
      }

      task.status = result.error ? 'error' : 'done';
      task.result = result;
      this.emit('event', { type: 'worker_done', data: { taskId: task.id, result } });
      return { taskId: task.id, result };
    });

    return Promise.all(promises);
  }

  /**
   * 串行执行一批任务
   */
  private async executeBatchSerial(batch: TaskPlan[]): Promise<Array<{ taskId: string; result: AgentResult }>> {
    const results: Array<{ taskId: string; result: AgentResult }> = [];

    for (const task of batch) {
      if (this.abortController?.signal.aborted) break;

      this.emit('event', { type: 'worker_start', data: { taskId: task.id, workerId: task.workerId, task: task.task } });
      task.status = 'running';

      const worker = this.workers.get(task.workerId)!;
      const result = await worker.invoke({ message: task.task });

      task.status = result.error ? 'error' : 'done';
      task.result = result;
      results.push({ taskId: task.id, result });
      this.emit('event', { type: 'worker_done', data: { taskId: task.id, result } });
    }

    return results;
  }

  /**
   * 综合所有结果生成最终回复
   */
  private async synthesize(userMessage: string, results: Array<{ taskId: string; result: AgentResult }>, plan: TaskPlan[]): Promise<string> {
    // 如果没有 Worker 参与，直接回复
    if (results.length === 0) {
      const response = await this.supervisorLLM.invoke([
        new HumanMessage(userMessage),
      ]);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    }

    // 汇总 Worker 结果
    const workerSummary = plan.map(task => {
      const r = results.find(r => r.taskId === task.id);
      return `[${task.workerName}] 任务: ${task.task}\n结果: ${r?.result.content || '(无结果)'}\n状态: ${task.status}`;
    }).join('\n\n');

    const response = await this.supervisorLLM.invoke([
      new SystemMessage('你是一个智能助手。请综合下面各 Worker 的执行结果，生成完整、连贯的回复给用户。'),
      new HumanMessage(`用户需求：${userMessage}\n\n各 Worker 执行结果：\n${workerSummary}`),
    ]);

    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  }

  /**
   * 执行编排（完整流程）
   */
  async orchestrate(userMessage: string): Promise<string> {
    this.abortController = new AbortController();
    this.initWorkers();

    // 如果没有可用 Worker，直接用 LLM 回复
    if (this.workers.size === 0) {
      const response = await this.supervisorLLM.invoke([new HumanMessage(userMessage)]);
      return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    }

    let allResults: Array<{ taskId: string; result: AgentResult }> = [];
    let allPlans: TaskPlan[] = [];

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      if (this.abortController.signal.aborted) break;

      // 1. 规划
      const previousSummary = allResults.length > 0
        ? allResults.map(r => `[${r.taskId}]: ${r.result.content}`).join('\n')
        : undefined;

      this.emit('event', { type: 'plan', data: { iteration } });
      const tasks = await this.planTasks(userMessage, previousSummary);

      if (tasks.length === 0) break; // Supervisor 判定无需更多任务

      allPlans.push(...tasks);

      // 2. 分发执行
      this.emit('event', { type: 'dispatch', data: { tasks } });
      const results = await this.dispatchTasks(tasks);
      allResults.push(...results);
    }

    // 3. 综合结果
    this.emit('event', { type: 'synthesize', data: { resultCount: allResults.length } });
    const finalResponse = await this.synthesize(userMessage, allResults, allPlans);

    this.emit('event', { type: 'done', data: { response: finalResponse } });
    return finalResponse;
  }

  /**
   * 流式编排
   */
  async *orchestrateStream(userMessage: string): AsyncGenerator<OrchestratorEvent> {
    this.abortController = new AbortController();
    this.initWorkers();

    if (this.workers.size === 0) {
      // 无 Worker，直接 LLM 回复
      const response = await this.supervisorLLM.invoke([new HumanMessage(userMessage)]);
      const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      yield { type: 'done', data: { response: content } };
      return;
    }

    let allResults: Array<{ taskId: string; result: AgentResult }> = [];
    let allPlans: TaskPlan[] = [];

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      if (this.abortController.signal.aborted) break;

      const previousSummary = allResults.length > 0
        ? allResults.map(r => `[${r.taskId}]: ${r.result.content}`).join('\n')
        : undefined;

      yield { type: 'plan', data: { iteration } };
      const tasks = await this.planTasks(userMessage, previousSummary);

      if (tasks.length === 0) break;

      allPlans.push(...tasks);
      yield { type: 'dispatch', data: { tasks } };

      const results = await this.dispatchTasks(tasks);
      allResults.push(...results);

      // yield 每个 worker 结果
      for (const r of results) {
        if (r.result.error) {
          yield { type: 'worker_error', data: { taskId: r.taskId, error: r.result.error } };
        } else {
          yield { type: 'worker_done', data: { taskId: r.taskId, content: r.result.content } };
        }
      }
    }

    yield { type: 'synthesize', data: { resultCount: allResults.length } };
    const finalResponse = await this.synthesize(userMessage, allResults, allPlans);
    yield { type: 'done', data: { response: finalResponse } };
  }

  /**
   * 取消编排
   */
  cancel(): void {
    this.abortController?.abort();
  }

  /**
   * 列出可用 Worker
   */
  listAvailableWorkers(): WorkerAgentDefinition[] {
    return agentRegistry.list();
  }
}

/**
 * 创建编排器
 */
export function createOrchestrator(
  sessionConfig: SessionConfig,
  config?: Partial<OrchestratorConfig>
): AgentOrchestrator {
  return new AgentOrchestrator(sessionConfig, config);
}
