/**
 * Agent 注册表
 * 管理 Worker Agent 定义
 */
import type { WorkerAgentDefinition, IRegistry } from '../types';

class AgentRegistry implements IRegistry<WorkerAgentDefinition> {
  private agents = new Map<string, WorkerAgentDefinition>();

  register(agent: WorkerAgentDefinition): void {
    if (this.agents.has(agent.id)) {
      console.warn(`[AgentRegistry] Agent "${agent.id}" already registered, overwriting`);
    }
    this.agents.set(agent.id, agent);
    console.log(`[AgentRegistry] Registered agent: ${agent.id} (${agent.name})`);
  }

  unregister(id: string): void {
    if (this.agents.delete(id)) {
      console.log(`[AgentRegistry] Unregistered agent: ${id}`);
    }
  }

  get(id: string): WorkerAgentDefinition | undefined {
    return this.agents.get(id);
  }

  list(): WorkerAgentDefinition[] {
    return Array.from(this.agents.values());
  }

  listByCapability(capability: string): WorkerAgentDefinition[] {
    return this.list().filter(a => a.capabilities.includes(capability));
  }

  listByPlugin(pluginId: string): WorkerAgentDefinition[] {
    return this.list().filter(a => a.pluginId === pluginId);
  }

  unregisterByPlugin(pluginId: string): void {
    const toRemove = this.listByPlugin(pluginId).map(a => a.id);
    toRemove.forEach(id => this.unregister(id));
  }

  clear(): void {
    this.agents.clear();
  }
}

export const agentRegistry = new AgentRegistry();
