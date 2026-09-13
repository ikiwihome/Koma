/**
 * Chat 设置（MCP）
 */
import { loadSettings, saveSettings } from './core';
import type { MCPServerConfig } from '../../types/mcp';

export async function getMCPServers(): Promise<MCPServerConfig[]> {
  const settings = await loadSettings();
  return (settings as any).mcpServers || [];
}

export async function saveMCPServers(configs: MCPServerConfig[]): Promise<void> {
  const settings = await loadSettings();
  (settings as any).mcpServers = configs;
  await saveSettings(settings);
}
