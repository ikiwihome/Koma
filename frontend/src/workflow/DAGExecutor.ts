/**
 * DAG 工作流执行器
 * 支持拓扑排序并行执行、检查点持久化、断点恢复
 */

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface DAGNode {
  id: string;
  type: string;
  dependencies: string[];
  status: NodeStatus;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface DAGDefinition {
  id: string;
  nodes: DAGNode[];
  metadata?: Record<string, unknown>;
}

export interface DAGCheckpoint {
  definitionId: string;
  nodes: DAGNode[];
  createdAt: number;
}

export interface DAGExecutorOptions {
  maxConcurrent?: number;
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string, result: unknown) => void;
  onNodeError?: (nodeId: string, error: string) => void;
  onCheckpoint?: (checkpoint: DAGCheckpoint) => void | Promise<void>;
  nodeExecutor: (node: DAGNode, results: Map<string, unknown>) => Promise<unknown>;
}

export class DAGExecutor {
  private definition: DAGDefinition;
  private options: DAGExecutorOptions;
  private results: Map<string, unknown> = new Map();
  private cancelled = false;

  constructor(definition: DAGDefinition, options: DAGExecutorOptions) {
    this.definition = definition;
    this.options = options;
  }

  /**
   * 从头执行 DAG
   */
  async execute(): Promise<Map<string, unknown>> {
    this.cancelled = false;
    this.results.clear();
    return this.runLoop();
  }

  /**
   * 从检查点恢复执行
   */
  async resume(checkpoint: DAGCheckpoint): Promise<Map<string, unknown>> {
    this.cancelled = false;
    this.results.clear();

    // 用检查点状态覆盖节点
    for (const saved of checkpoint.nodes) {
      const node = this.definition.nodes.find((n) => n.id === saved.id);
      if (!node) continue;
      node.status = saved.status;
      node.result = saved.result;
      node.error = saved.error;
      node.startedAt = saved.startedAt;
      node.completedAt = saved.completedAt;

      // 已完成的节点结果放入 results map
      if (saved.status === 'completed' && saved.result !== undefined) {
        this.results.set(saved.id, saved.result);
      }
    }

    return this.runLoop();
  }

  /**
   * 取消执行（正在运行的节点会完成，但不再启动新节点）
   */
  cancel(): void {
    this.cancelled = true;
  }

  // ========== 内部方法 ==========

  private async runLoop(): Promise<Map<string, unknown>> {
    const maxConcurrent = this.options.maxConcurrent ?? 3;

    while (!this.cancelled) {
      const ready = this.getReadyNodes();
      if (ready.length === 0) {
        // 没有可执行节点：要么全部完成，要么有节点卡住
        const hasRunning = this.definition.nodes.some((n) => n.status === 'running');
        if (!hasRunning) break;
        // 等待正在运行的节点（不应该走到这里，因为下面 Promise.all 会等）
        break;
      }

      // 限制并发数
      const batch = ready.slice(0, maxConcurrent);
      await Promise.all(batch.map((node) => this.executeNode(node)));
    }

    return this.results;
  }

  private async executeNode(node: DAGNode): Promise<void> {
    node.status = 'running';
    node.startedAt = Date.now();
    this.options.onNodeStart?.(node.id);

    try {
      const result = await this.options.nodeExecutor(node, this.results);
      node.status = 'completed';
      node.result = result;
      node.completedAt = Date.now();
      this.results.set(node.id, result);
      this.options.onNodeComplete?.(node.id, result);
    } catch (err: any) {
      node.status = 'failed';
      node.error = err?.message ?? String(err);
      node.completedAt = Date.now();
      this.options.onNodeError?.(node.id, node.error!);
      // 跳过所有依赖此节点的下游节点
      this.skipDependents(node.id);
    }

    // 保存检查点
    const checkpoint = this.createCheckpoint();
    await this.options.onCheckpoint?.(checkpoint);
  }

  /**
   * 获取所有依赖已满足且状态为 pending 的节点
   */
  private getReadyNodes(): DAGNode[] {
    return this.definition.nodes.filter((node) => {
      if (node.status !== 'pending') return false;
      return node.dependencies.every((depId) => {
        const dep = this.definition.nodes.find((n) => n.id === depId);
        return dep?.status === 'completed';
      });
    });
  }

  /**
   * 递归跳过依赖失败节点的所有下游节点
   */
  private skipDependents(failedId: string): void {
    for (const node of this.definition.nodes) {
      if (node.status !== 'pending') continue;
      if (node.dependencies.includes(failedId)) {
        node.status = 'skipped';
        this.skipDependents(node.id);
      }
    }
  }

  private createCheckpoint(): DAGCheckpoint {
    return {
      definitionId: this.definition.id,
      nodes: this.definition.nodes.map((n) => ({ ...n })),
      createdAt: Date.now(),
    };
  }
}
