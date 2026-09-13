/**
 * 插件沙箱
 * 提供隔离的执行环境和受限的 API 访问
 */
import type { PluginScope, InstalledPlugin } from '../../types/plugin';

// TODO(strict-cleanup): _ALLOWED_GLOBALS and _BLOCKED_APIS constants were defined but never referenced.
// Preserved as comments in case the sandbox actually enforces a global/API whitelist in future.

/**
 * 检查插件是否有某个权限
 */
export function hasScope(plugin: InstalledPlugin, scope: PluginScope): boolean {
  return plugin.scopes.includes(scope);
}

/**
 * 验证插件请求的操作是否被允许
 */
export function validateOperation(
  plugin: InstalledPlugin,
  operation: string,
  requiredScope: PluginScope
): { allowed: boolean; reason?: string } {
  if (!plugin.isEnabled) {
    return { allowed: false, reason: '插件已禁用' };
  }

  if (!hasScope(plugin, requiredScope)) {
    return {
      allowed: false,
      reason: `操作 "${operation}" 需要 "${requiredScope}" 权限`,
    };
  }

  return { allowed: true };
}

/**
 * 创建受限的 fetch 函数
 */
export function createSandboxedFetch(
  plugin: InstalledPlugin
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    // 检查网络权限
    if (!hasScope(plugin, 'network:external')) {
      throw new Error('插件没有外部网络访问权限 (network:external)');
    }

    // 阻止访问本地文件
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('file://')) {
      throw new Error('不允许通过 fetch 访问本地文件');
    }

    // 阻止访问内部服务
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      throw new Error('不允许访问本地服务');
    }

    return fetch(input, init);
  };
}

/**
 * 创建沙箱化的 console
 * 注意：这里的 console.log 是故意保留的，用于插件的日志输出
 * 插件通过这个沙箱 console 输出日志，会自动添加插件前缀
 */
export function createSandboxedConsole(pluginId: string): Console {
  const prefix = `[Plugin:${pluginId}]`;

  // 保留 console 调用 - 这是插件的日志输出接口
  return {
    ...console,
    log: (...args: any[]) => console.log(prefix, ...args),
    info: (...args: any[]) => console.info(prefix, ...args),
    warn: (...args: any[]) => console.warn(prefix, ...args),
    error: (...args: any[]) => console.error(prefix, ...args),
    debug: (...args: any[]) => console.debug(prefix, ...args),
  } as Console;
}

/**
 * 获取插件的存储路径 (沙箱目录)
 */
export function getPluginStoragePath(plugin: InstalledPlugin): string {
  return `${plugin.rootPath}/data`;
}

/**
 * 验证文件路径是否在沙箱内
 */
export function isPathInSandbox(plugin: InstalledPlugin, filePath: string): boolean {
  const sandboxPath = getPluginStoragePath(plugin);
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedSandbox = sandboxPath.replace(/\\/g, '/');

  // 检查路径是否在沙箱目录内
  return normalizedPath.startsWith(normalizedSandbox);
}

/**
 * 验证并规范化存储路径
 */
export function validateStoragePath(
  plugin: InstalledPlugin,
  relativePath: string
): { valid: boolean; fullPath?: string; error?: string } {
  // 检查存储权限
  if (!hasScope(plugin, 'storage:limited')) {
    return { valid: false, error: '插件没有存储权限 (storage:limited)' };
  }

  // 防止路径遍历攻击
  if (relativePath.includes('..') || relativePath.includes('~')) {
    return { valid: false, error: '路径不能包含 .. 或 ~' };
  }

  // 构建完整路径
  const sandboxPath = getPluginStoragePath(plugin);
  const fullPath = `${sandboxPath}/${relativePath}`.replace(/\/+/g, '/');

  // 再次验证
  if (!isPathInSandbox(plugin, fullPath)) {
    return { valid: false, error: '路径超出沙箱范围' };
  }

  return { valid: true, fullPath };
}

/**
 * 权限描述映射
 */
export const SCOPE_DESCRIPTIONS: Record<PluginScope, { label: string; description: string; level: 'safe' | 'warning' | 'danger' }> = {
  'settings:read': {
    label: '读取设置',
    description: '读取应用的全局设置',
    level: 'safe',
  },
  'settings:write': {
    label: '修改设置',
    description: '修改应用的全局设置',
    level: 'warning',
  },
  'projects:read': {
    label: '读取项目',
    description: '读取项目列表和内容',
    level: 'safe',
  },
  'projects:write': {
    label: '修改项目',
    description: '创建、修改或删除项目',
    level: 'warning',
  },
  'prompts:override': {
    label: '覆盖提示词',
    description: '自定义或覆盖系统提示词模板',
    level: 'warning',
  },
  'storage:limited': {
    label: '本地存储',
    description: '在插件目录内读写文件',
    level: 'safe',
  },
  'network:external': {
    label: '网络访问',
    description: '访问外部网络服务',
    level: 'danger',
  },
  'mcp:server': {
    label: 'MCP 服务',
    description: '注册 MCP 服务器，对外提供工具和资源',
    level: 'warning',
  },
  'mcp:tool': {
    label: 'MCP 工具',
    description: '注册可被智能体调用的 MCP 工具',
    level: 'warning',
  },
  'mcp:resource': {
    label: 'MCP 资源',
    description: '注册 MCP 资源供智能体读取',
    level: 'safe',
  },
  'agent:register': {
    label: '注册智能体',
    description: '注册 Worker Agent 参与多智能体编排',
    level: 'warning',
  },
  'spawn:process': {
    label: '启动进程',
    description: '启动外部子进程执行命令',
    level: 'danger',
  },
};
