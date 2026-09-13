/**
 * 插件加载器
 * 负责动态加载和卸载插件
 */
import type {
  PluginManifest,
  PluginExports,
  PluginValidationResult,
  InstalledPlugin,
} from '../../types/plugin';
import { usePluginStore } from '../../store/pluginStore';
import { clearPluginInitialized } from './PluginInitializer';
import { createLogger } from '../../store/logger';
import { toKomaLocalUrl } from '../../utils/urlUtils';

const logger = createLogger('PluginLoader');

// 缓存已加载的插件模块
const loadedModules = new Map<string, PluginExports>();

// manifest.json 必填字段
const REQUIRED_FIELDS = ['id', 'name', 'version', 'category', 'engine', 'scopes', 'entry'];

/**
 * 验证插件 manifest
 */
export function validateManifest(manifest: any): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 检查必填字段
  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined) {
      errors.push(`缺少必填字段: ${field}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // 验证 id 格式
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(manifest.id)) {
    warnings.push('id 建议使用反向域名格式，如 com.example.my-plugin');
  }

  // 验证版本号格式
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version)) {
    errors.push('version 必须符合语义版本规范 (如 1.0.0)');
  }

  // 验证分类
  const VALID_CATEGORIES = ['provider', 'global', 'tool', 'mcp', 'agent'];
  if (!VALID_CATEGORIES.includes(manifest.category)) {
    errors.push(`category 必须是 ${VALID_CATEGORIES.join(', ')} 之一`);
  }

  // 验证入口配置
  if (manifest.category === 'global' && !manifest.entry?.frontend) {
    errors.push('global 类型插件必须提供 entry.frontend');
  }

  // provider 类型插件必须提供前端入口（UI 或 frontend）
  if (manifest.category === 'provider') {
    const hasFrontendEntry = manifest.entry?.frontend || manifest.entry?.ui || manifest.entry?.logic;
    if (!hasFrontendEntry) {
      errors.push('provider 类型插件必须提供 entry.frontend、entry.ui 或 entry.logic');
    }
  }

  // 验证 scopes
  const validScopes = [
    'settings:read', 'settings:write',
    'projects:read', 'projects:write',
    'prompts:override', 'storage:limited', 'network:external',
    'mcp:server', 'mcp:tool', 'mcp:resource',
    'agent:register', 'spawn:process',
  ];
  for (const scope of manifest.scopes || []) {
    if (!validScopes.includes(scope)) {
      warnings.push(`未知的权限作用域: ${scope}`);
    }
  }

  // 分类特定验证
  if (manifest.category === 'global' && !manifest.globalMeta) {
    errors.push('global 类型插件必须提供 globalMeta');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: errors.length === 0 ? manifest as PluginManifest : undefined,
  };
}

/**
 * 加载插件前端组件 (global 类型)
 */
export async function loadPluginComponent(plugin: InstalledPlugin): Promise<PluginExports | null> {
  if (plugin.category !== 'global' || !plugin.entry.frontend) {
    logger.warn(`插件 ${plugin.id} 不是 global 类型或无前端入口`);
    return null;
  }

  return loadPluginModule(plugin);
}

/**
 * 加载 Provider 插件（provider 类型，用于注册渠道）
 */
export async function loadProviderPlugin(plugin: InstalledPlugin): Promise<PluginExports | null> {
  if (plugin.category !== 'provider') {
    logger.warn(`插件 ${plugin.id} 不是 provider 类型`);
    return null;
  }

  // 优先使用 frontend 入口（兼容旧插件）
  const entryFile = plugin.entry.frontend || plugin.entry.logic || plugin.entry.ui;
  if (!entryFile) {
    logger.warn(`插件 ${plugin.id} 无可用入口`);
    return null;
  }

  return loadPluginModule(plugin);
}

/**
 * 加载插件逻辑入口（不加载 UI，用于后台任务场景）
 * 优先加载 entry.logic，降级到 entry.frontend
 */
export async function loadPluginLogic(plugin: InstalledPlugin): Promise<PluginExports | null> {
  // 优先使用 logic 入口
  const logicEntry = plugin.entry.logic || plugin.entry.frontend;
  if (!logicEntry) {
    logger.warn(`插件 ${plugin.id} 无逻辑入口`);
    return null;
  }

  // 检查缓存
  if (loadedModules.has(plugin.id)) {
    return loadedModules.get(plugin.id)!;
  }

  const store = usePluginStore.getState();
  store.setRuntimeState(plugin.id, { status: 'loading' });

  try {
    const entryPath = `${plugin.rootPath}/${logicEntry}`;
    const module = await loadUMDModule(entryPath, plugin.id);

    if (!module) {
      throw new Error('插件模块加载失败');
    }

    const exports: PluginExports = {
      default: module.default,
      onActivate: module.onActivate,
      onDeactivate: module.onDeactivate,
    };

    loadedModules.set(plugin.id, exports);
    store.setRuntimeState(plugin.id, { status: 'loaded', component: exports.default });

    return exports;
  } catch (error: unknown) {
    logger.error(`加载插件逻辑 ${plugin.id} 失败`, error);
    store.setRuntimeState(plugin.id, { status: 'error', error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * 通用插件模块加载（支持 global 和 provider 类型）
 */
async function loadPluginModule(plugin: InstalledPlugin): Promise<PluginExports | null> {
  // 支持多种入口配置
  const entryFile = plugin.entry.frontend || plugin.entry.ui || plugin.entry.logic;
  if (!entryFile) {
    logger.warn(`插件 ${plugin.id} 无可用入口`);
    return null;
  }

  // 检查缓存
  if (loadedModules.has(plugin.id)) {
    return loadedModules.get(plugin.id)!;
  }

  const store = usePluginStore.getState();
  store.setRuntimeState(plugin.id, { status: 'loading' });

  try {
    // 构建入口文件路径
    const entryPath = `${plugin.rootPath}/${entryFile}`;

    // 如果是 HTML 文件，需要从中提取 JS
    if (entryPath.endsWith('.html')) {
      // HTML 模式暂不支持，提示使用 JS bundle
      throw new Error('请使用 JS bundle 作为前端入口，而非 HTML');
    }

    // 动态加载 UMD/IIFE bundle
    const module = await loadUMDModule(entryPath, plugin.id);

    if (!module || !module.default) {
      throw new Error('插件必须导出 default 组件');
    }

    const exports: PluginExports = {
      default: module.default,
      onActivate: module.onActivate,
      onDeactivate: module.onDeactivate,
    };

    loadedModules.set(plugin.id, exports);
    store.setRuntimeState(plugin.id, { status: 'loaded', component: exports.default });

    return exports;
  } catch (error: unknown) {
    logger.error(`加载插件 ${plugin.id} 失败`, error);
    store.setRuntimeState(plugin.id, { status: 'error', error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * 加载 UMD/IIFE 模块
 */
export async function loadUMDModule(path: string, pluginId: string): Promise<PluginExports> {
  // Provider/global 插件的 UI bundle 目前按 UMD/IIFE 方式运行在宿主页面上下文中，
  // 且插件代码依赖 window.React / window.antd / window['@ant-design/icons'] 等外部全局。
  // 宿主应用本身使用模块化打包，这些全局默认不存在，因此这里做一次集中注入。
  // 这样插件侧无需重复打包 React/AntD，也避免每个插件写兼容代码。
  await ensurePluginUmdGlobals();

  // 使用 koma-local:// 自定义协议加载本地文件（绕过 file:// 安全限制）
  // 路径归一化（移除 /./），URL 编码统一交给 toKomaLocalUrl
  const cleanedPath = path.replace(/\\/g, '/').replace(/\/\.\//g, '/');
  const fileUrl = toKomaLocalUrl(cleanedPath);

  // 创建 script 标签动态加载
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = fileUrl;
    script.async = true;

    // 定义全局接收变量
    const globalKey = `__KOMA_PLUGIN_${pluginId.replace(/[^a-zA-Z0-9]/g, '_')}__`;

    script.onload = () => {
      const module = (window as any)[globalKey];
      if (module) {
        // 尝试删除全局变量，忽略失败（某些情况下不可删除）
        try {
          delete (window as any)[globalKey];
        } catch {
          // 忽略删除失败
        }
        resolve(module);
      } else {
        logger.error('插件 UMD 导出缺失', {
          pluginId,
          globalKey,
          fileUrl,
        });
        reject(new Error(`插件 ${pluginId} 未正确导出到 window.${globalKey}`));
      }
      document.head.removeChild(script);
    };

    script.onerror = (_err) => {
      document.head.removeChild(script);
      logger.error('加载插件脚本失败', { pluginId, fileUrl, path });
      reject(new Error(`加载插件脚本失败: ${path}`));
    };

    document.head.appendChild(script);
  });
}

let pluginUmdGlobalsReady = false;
async function ensurePluginUmdGlobals(): Promise<void> {
  if (pluginUmdGlobalsReady) return;
  if (typeof window === 'undefined') return;

  // React
  if (!(window as any).React) {
    const ReactMod = await import('react');
    const ReactDefault = (ReactMod as any).default;
    // In different bundlers, React may appear on either the module namespace or default export.
    // We normalize to an object that exposes hooks as properties (React.useState etc.).
    const ReactGlobal = ReactDefault && (ReactDefault.useState || ReactDefault.createElement)
      ? { ...ReactMod, ...ReactDefault }
      : ReactMod;
    (window as any).React = ReactGlobal;
  }

  // Ant Design
  if (!(window as any).antd) {
    const antdMod = await import('antd');
    const antdDefault = (antdMod as any).default;
    (window as any).antd = antdDefault && typeof antdDefault === 'object'
      ? { ...antdMod, ...antdDefault }
      : antdMod;
  }

  // Ant Design Icons
  if (!(window as any)['@ant-design/icons']) {
    const iconsMod = await import('@ant-design/icons');
    const iconsDefault = (iconsMod as any).default;
    (window as any)['@ant-design/icons'] = iconsDefault && typeof iconsDefault === 'object'
      ? { ...iconsMod, ...iconsDefault }
      : iconsMod;
  }

  pluginUmdGlobalsReady = true;
}

/**
 * 卸载插件
 */
export function unloadPlugin(pluginId: string): void {
  const exports = loadedModules.get(pluginId);
  if (exports?.onDeactivate) {
    try {
      exports.onDeactivate();
    } catch (err) {
      logger.error(`插件 ${pluginId} onDeactivate 执行失败`, err);
    }
  }

  loadedModules.delete(pluginId);
  usePluginStore.getState().clearRuntimeState(pluginId);

  // 清除初始化状态
  clearPluginInitialized(pluginId);
}

/**
 * 获取已加载的插件模块
 */
export function getLoadedModule(pluginId: string): PluginExports | undefined {
  return loadedModules.get(pluginId);
}

/**
 * 检查插件是否已加载
 */
export function isPluginLoaded(pluginId: string): boolean {
  return loadedModules.has(pluginId);
}
