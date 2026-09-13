/**
 * 插件初始化器
 * 在应用启动时初始化所有已启用的 Provider 插件
 */
import { usePluginStore, waitForPluginStoreRehydration } from '../../store/pluginStore';
import { loadPluginComponent, loadProviderPlugin } from './PluginLoader';
import { createPluginAPI } from './PluginAPI';
import { electronService } from '../electronService';
import type { InstalledPlugin } from '../../types/plugin';
import { createLogger } from '../../store/logger';

const logger = createLogger('PluginInitializer');

// 已初始化的插件 ID 集合
const initializedPlugins = new Set<string>();

/**
 * 初始化单个插件（调用 onActivate）
 */
export async function initializePlugin(plugin: InstalledPlugin): Promise<boolean> {
  if (initializedPlugins.has(plugin.id)) {
    return true;
  }

  try {
    logger.info('初始化插件: start', {
      pluginId: plugin.id,
      category: plugin.category,
      hasFrontendEntry: Boolean(plugin.entry?.frontend || plugin.entry?.ui || plugin.entry?.logic),
      hasBackendEntry: Boolean(plugin.entry?.backend),
    });
    // mcp / agent / provider 类型插件如果有 backend 入口，需要后端激活
    const needsBackendActivation =
      plugin.category === 'mcp' ||
      plugin.category === 'agent' ||
      (plugin.category === 'provider' && plugin.entry?.backend);

    if (needsBackendActivation) {
      try {
        logger.info('初始化插件: backend activate', { pluginId: plugin.id });
        const result = await electronService.ipc.invoke('controller/plugin/activate', { manifest: plugin });
        if (!result?.success) {
          logger.error(`后端激活失败: ${plugin.id}`, result?.error);
          // 历史上 provider 类型后端激活失败时仍继续注册前端 Provider —— 但这会导致
          // "渲染端 Provider 已注册但实际跑不通"的半残状态（典型表现：图床插件后端
          // 没起来但前端注册了，调用时撞 komaapi.com 的 CORS 报 "Failed to fetch"）。
          // 现在统一：**只要 manifest 声明了 backend 入口且激活失败，就放弃整个插件**，
          // 让 channel 直接走"未就绪"分支，错误信息更聚焦。
          return false;
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`后端激活异常: ${plugin.id}`, { error: errMsg });
        return false;
      }
    }

    // mcp / agent 只需后端激活
    if (plugin.category === 'mcp' || plugin.category === 'agent') {
      initializedPlugins.add(plugin.id);
      return true;
    }

    // global / provider / tool 类型由前端加载
    let exports;
    if (plugin.category === 'global') {
      exports = await loadPluginComponent(plugin);
    } else if (plugin.category === 'provider') {
      exports = await loadProviderPlugin(plugin);
    } else if (plugin.category === 'tool') {
      // tool 类型暂时走前端加载
      exports = await loadPluginComponent(plugin);
    } else {
      logger.warn(`不支持的插件类型: ${plugin.category}`);
      return false;
    }

    if (!exports) {
      logger.warn(`插件 ${plugin.id} 加载失败`);
      return false;
    }

    // 创建 API 实例并调用 onActivate
    if (exports.onActivate) {
      logger.info('初始化插件: calling onActivate', { pluginId: plugin.id, category: plugin.category });
      const api = createPluginAPI(plugin);
      await exports.onActivate(api);
      logger.info('初始化插件: onActivate done', { pluginId: plugin.id, category: plugin.category });
    }

    initializedPlugins.add(plugin.id);
    logger.info('初始化插件: done', { pluginId: plugin.id, category: plugin.category });
    return true;
  } catch (err) {
    logger.error(`插件 ${plugin.id} 初始化失败`, err);
    return false;
  }
}

/**
 * 初始化所有已启用的插件
 * 启动时先和后端实际安装列表对账，清除已不存在的插件记录
 */
export async function initializeProviderPlugins(): Promise<{
  total: number;
  success: number;
  failed: string[];
}> {
  // 等待 pluginStore 数据恢复完成
  await waitForPluginStoreRehydration();

  // 和后端实际安装列表对账，清除 store 中已不存在的插件
  await reconcilePluginStore();

  const plugins = usePluginStore.getState().plugins;

  // 筛选已启用的插件（global 类型插件也可能注册 Provider）
  const enabledPlugins = plugins.filter(p => p.isEnabled);

  if (enabledPlugins.length === 0) {
    return { total: 0, success: 0, failed: [] };
  }


  // 串行初始化插件，避免竞态条件
  const failed: string[] = [];
  let success = 0;

  for (const plugin of enabledPlugins) {
    const result = await initializePlugin(plugin);
    if (result) {
      success++;
    } else {
      failed.push(plugin.id);
    }
  }


  return {
    total: enabledPlugins.length,
    success,
    failed,
  };
}

/**
 * 对账：比较 store 中的插件列表与后端实际安装列表，移除已不存在的记录
 */
async function reconcilePluginStore(): Promise<void> {
  try {
    // 查询后端实际安装的插件
    const installedManifests = await electronService.ipc.invoke('controller/plugin/list', {}) as any[];
    const installedIds = new Set((installedManifests || []).map((m: any) => m.id));

    const store = usePluginStore.getState();
    const stalePlugins = store.plugins.filter(p => !installedIds.has(p.id));

    if (stalePlugins.length > 0) {
      logger.warn(
        `发现 ${stalePlugins.length} 个已不存在的插件，清理`,
        stalePlugins.map(p => p.id)
      );
      for (const p of stalePlugins) {
        store.unregisterPlugin(p.id);
      }
    }

    // 将后端已安装但 store 缺失的插件（如内置插件）注册到 store，保证首次启动就能激活
    const latestPlugins = usePluginStore.getState().plugins;
    const storeIds = new Set(latestPlugins.map(p => p.id));
    const missing = (installedManifests || []).filter((m: any) => m?.id && !storeIds.has(m.id));
    if (missing.length > 0) {
      logger.info(`发现 ${missing.length} 个后端已安装但未注册的插件，自动注册`, missing.map((m: any) => m.id));
      for (const manifest of missing) {
        try {
          const rootPath = manifest.rootPath || `plugins-runtime/${manifest.id}`;
          store.registerPlugin(manifest, rootPath);
          if (manifest.isBuiltin) {
            // 内置插件确保 isBuiltin 字段写入
            const updated = usePluginStore.getState().plugins.map(p =>
              p.id === manifest.id ? { ...p, isBuiltin: true } : p,
            );
            usePluginStore.setState({ plugins: updated });
          }
        } catch (e) {
          logger.warn(`注册插件失败: ${manifest?.id}`, e);
        }
      }
    } else {
      // 对内置字段做一次校准
      const currentPlugins = usePluginStore.getState().plugins;
      const withBuiltinPatched = currentPlugins.map(p => {
        const m = (installedManifests || []).find((x: any) => x.id === p.id);
        if (!m) return p;
        const nextRootPath = m.rootPath || p.rootPath;
        if ((m.isBuiltin && !p.isBuiltin) || nextRootPath !== p.rootPath) {
          return { ...p, isBuiltin: Boolean(m.isBuiltin || p.isBuiltin), rootPath: nextRootPath };
        }
        return p;
      });
      if (withBuiltinPatched.some((p, i) => p !== currentPlugins[i])) {
        usePluginStore.setState({ plugins: withBuiltinPatched });
      }
    }
  } catch (err) {
    // 对账失败不阻塞启动
    logger.warn('插件对账失败，跳过', err);
  }
}

/**
 * 检查插件是否已初始化
 */
export function isPluginInitialized(pluginId: string): boolean {
  return initializedPlugins.has(pluginId);
}

/**
 * 清除插件初始化状态（用于插件卸载时）
 */
export function clearPluginInitialized(pluginId: string): void {
  initializedPlugins.delete(pluginId);
}
