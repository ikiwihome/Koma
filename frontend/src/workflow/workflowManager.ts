/**
 * 工作流管理器
 * 管理异步任务队列和工作流状态
 * 支持 DAG 工作流的检查点持久化与断点恢复
 */
import type { WorkflowProgress, WorkflowType } from '../types';
import { electronService } from '../services/electronService';
import { getStorageConfig, initStorageConfig } from '../store/storageConfig';
import type { DAGCheckpoint } from './DAGExecutor';

type WorkflowHandler = (
  params: any,
  onProgress: (progress: number, step?: string) => void
) => Promise<any>;

interface QueuedTask {
  id: string;
  type: WorkflowType;
  params: any;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

// ========== 检查点持久化辅助 ==========

async function getProjectPath(projectId: string): Promise<string> {
  const config = getStorageConfig() || (await initStorageConfig());
  return `${config.rootPath}/projects/${projectId}`;
}

async function getCheckpointPath(projectId: string, workflowId: string): Promise<string> {
  const projectPath = await getProjectPath(projectId);
  return `${projectPath}/workflow-checkpoints/${workflowId}.json`;
}

async function getCheckpointsDir(projectId: string): Promise<string> {
  const projectPath = await getProjectPath(projectId);
  return `${projectPath}/workflow-checkpoints`;
}

export class WorkflowManager {
  private handlers: Map<WorkflowType, WorkflowHandler> = new Map();
  private queue: QueuedTask[] = [];
  private running: Map<string, WorkflowProgress> = new Map();
  private isProcessing = false;
  private maxConcurrent = 2;

  private listeners: ((workflows: WorkflowProgress[]) => void)[] = [];

  /**
   * 注册工作流处理器
   */
  registerHandler(type: WorkflowType, handler: WorkflowHandler) {
    this.handlers.set(type, handler);
  }

  /**
   * 提交工作流任务
   */
  submit<T = any>(type: WorkflowType, params: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.queue.push({ id, type, params, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * 取消工作流
   */
  cancel(workflowId: string) {
    // 从队列中移除
    this.queue = this.queue.filter((t) => t.id !== workflowId);
    // 标记为取消
    const workflow = this.running.get(workflowId);
    if (workflow) {
      workflow.status = 'cancelled';
      this.notifyListeners();
    }
  }

  /**
   * 获取所有工作流状态
   */
  getAll(): WorkflowProgress[] {
    const queued: WorkflowProgress[] = this.queue.map((t) => ({
      workflowId: t.id,
      type: t.type,
      status: 'pending',
      progress: 0,
    }));
    return [...queued, ...Array.from(this.running.values())];
  }

  /**
   * 监听工作流变化
   */
  subscribe(listener: (workflows: WorkflowProgress[]) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ========== 检查点持久化 ==========

  /**
   * 保存 DAG 检查点到项目目录
   */
  async saveCheckpoint(projectId: string, workflowId: string, checkpoint: DAGCheckpoint): Promise<void> {
    if (!electronService.isElectron()) return;
    const dir = await getCheckpointsDir(projectId);
    await electronService.fs.mkdir(dir);
    const filePath = await getCheckpointPath(projectId, workflowId);
    await electronService.fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2));
  }

  /**
   * 加载 DAG 检查点
   */
  async loadCheckpoint(projectId: string, workflowId: string): Promise<DAGCheckpoint | null> {
    if (!electronService.isElectron()) return null;
    try {
      const filePath = await getCheckpointPath(projectId, workflowId);
      const exists = await electronService.fs.exists(filePath);
      if (!exists) return null;
      const data = await electronService.fs.readFile(filePath);
      const raw = typeof data === 'string' ? data : (data as any).content;
      return JSON.parse(raw) as DAGCheckpoint;
    } catch {
      return null;
    }
  }

  /**
   * 删除检查点（工作流完成后清理）
   */
  async removeCheckpoint(projectId: string, workflowId: string): Promise<void> {
    if (!electronService.isElectron()) return;
    try {
      const filePath = await getCheckpointPath(projectId, workflowId);
      await electronService.fs.remove(filePath);
    } catch {
      // 忽略删除失败
    }
  }

  /**
   * 列出项目中所有未完成的检查点
   */
  async listIncompleteCheckpoints(projectId: string): Promise<DAGCheckpoint[]> {
    if (!electronService.isElectron()) return [];
    try {
      const dir = await getCheckpointsDir(projectId);
      const exists = await electronService.fs.exists(dir);
      if (!exists) return [];

      const files: string[] = await electronService.fs.readdir(dir);
      const checkpoints: DAGCheckpoint[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await electronService.fs.readFile(`${dir}/${file}`);
          const raw = typeof data === 'string' ? data : (data as any).content;
          const cp: DAGCheckpoint = JSON.parse(raw);
          // 有未完成节点的才算 incomplete
          const hasIncomplete = cp.nodes.some(
            (n) => n.status === 'pending' || n.status === 'running'
          );
          if (hasIncomplete) checkpoints.push(cp);
        } catch {
          // 跳过损坏的检查点文件
        }
      }

      return checkpoints;
    } catch {
      return [];
    }
  }

  // ========== 内部方法 ==========

  /**
   * 处理队列
   */
  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const task = this.queue.shift()!;
      this.executeTask(task);
    }

    this.isProcessing = false;
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: QueuedTask) {
    const handler = this.handlers.get(task.type);
    if (!handler) {
      task.reject(new Error(`No handler for workflow type: ${task.type}`));
      return;
    }

    const progress: WorkflowProgress = {
      workflowId: task.id,
      type: task.type,
      status: 'running',
      progress: 0,
      startedAt: Date.now(),
    };
    this.running.set(task.id, progress);
    this.notifyListeners();

    try {
      const result = await handler(task.params, (p, step) => {
        progress.progress = p;
        progress.currentStep = step;
        this.notifyListeners();
      });

      progress.status = 'completed';
      progress.progress = 100;
      progress.completedAt = Date.now();
      this.notifyListeners();
      task.resolve(result);
    } catch (err: any) {
      progress.status = 'failed';
      progress.error = err.message;
      this.notifyListeners();
      task.reject(err);
    } finally {
      // 移除已完成的任务（延迟5秒）
      setTimeout(() => {
        this.running.delete(task.id);
        this.notifyListeners();
      }, 5000);

      // 继续处理队列
      this.processQueue();
    }
  }

  private notifyListeners() {
    const workflows = this.getAll();
    this.listeners.forEach((l) => l(workflows));
  }
}

export const workflowManager = new WorkflowManager();
export default workflowManager;
