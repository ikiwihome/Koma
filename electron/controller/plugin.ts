/**
 * 插件管理 Controller
 */
import { IpcMainInvokeEvent, shell } from 'electron';
import { pluginService } from '../service/plugin';
import { pluginRuntime } from '../service/plugin/runtime';
import { pluginBridge } from '../service/plugin/bridge';
import { ensureServicesReady } from '../service';

const pluginController = {
  /**
   * 验证插件包
   */
  async validate({ zipPath }: { zipPath: string }, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginService.validate(zipPath);
  },

  /**
   * 安装插件
   */
  async install(
    { zipPath, manifest, stagingId }: { zipPath: string; manifest: any; stagingId?: string },
    _event?: IpcMainInvokeEvent
  ) {
    await ensureServicesReady();
    // 如果是文件夹路径（开发模式）
    const isFolder = !zipPath.endsWith('.zip');
    if (isFolder) {
      return pluginService.installFromFolder(zipPath, manifest);
    }
    return pluginService.install(zipPath, manifest, stagingId);
  },

  /**
   * 卸载插件
   */
  async uninstall({ pluginPath }: { pluginPath: string }, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginService.uninstall(pluginPath);
  },

  /**
   * 通过插件 ID 卸载插件
   */
  async uninstallById({ pluginId }: { pluginId: string }, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginService.uninstall(pluginId);
  },

  /**
   * 列出已安装插件
   */
  async list(_args: any, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginService.listInstalled();
  },

  /**
   * 打开插件目录
   */
  async openFolder({ pluginPath }: { pluginPath: string }, _event?: IpcMainInvokeEvent) {
    shell.openPath(pluginPath);
    return { success: true };
  },

  // ========== 运行时管理 ==========

  /**
   * 激活插件
   *
   * **重要 — 错误处理**：ee-core 的 ipcServer.js 在 ipcMain.handle 里吞错（catch
   * 后只 coreLogger.error 不 rethrow）。`pluginService.loadAndActivate` 自身已经把
   * loadPlugin/activatePlugin 的异常转成 `{success, error}`，但如果 `ensureServicesReady`
   * 或 IPC 路由层抛出（罕见但会发生），ee-core 会吞掉错误返回 undefined，渲染端只能
   * 看到 `result?.success` 为 falsy 但拿不到 error 信息。这里加一层 try/catch 兜底，
   * 把所有 throw 转成结构化 result。
   */
  async activate({ manifest }: { manifest: any }, _event?: IpcMainInvokeEvent) {
    try {
      await ensureServicesReady();
      const result = await pluginService.loadAndActivate(manifest);
      if (!result?.success) {
        console.error('[PluginController] activate failed', {
          pluginId: manifest?.id,
          error: result?.error,
        });
      }
      return result ?? { success: false, error: 'loadAndActivate 返回 undefined' };
    } catch (err: any) {
      const errorMsg = err?.message || String(err) || '未知激活错误';
      console.error('[PluginController] activate threw', {
        pluginId: manifest?.id,
        error: errorMsg,
        stack: err?.stack,
      });
      return { success: false, error: `[plugin/activate] ${errorMsg}` };
    }
  },

  /**
   * 停用插件
   */
  async deactivate({ pluginId }: { pluginId: string }, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginService.deactivate(pluginId);
  },

  /**
   * 获取插件运行状态
   */
  async status({ pluginId }: { pluginId: string }, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginService.getPluginStatus(pluginId);
  },

  /**
   * 列出活跃插件
   */
  async listActive(_args: any, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginRuntime.listActivePlugins().map(p => ({
      id: p.manifest.id,
      name: p.manifest.name,
      category: p.manifest.category,
      status: p.status,
    }));
  },

  // ========== 工具和 Agent 查询 ==========

  /**
   * 列出插件系统注册的 MCP 工具
   */
  async listMCPTools(_args: any, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginBridge.listMCPTools();
  },

  /**
   * 调用插件 MCP 工具
   */
  async callMCPTool({ name, args }: { name: string; args: unknown }, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginBridge.callMCPTool(name, args);
  },

  /**
   * 调用 Provider（后端执行）
   *
   * 说明：
   * - 主要用于 image-hosting 这类需要 FormData/Buffer 的能力，前端沙箱 fetch/IPC 传输可能不支持
   * - 由 PluginBridge 负责查找 provider 定义并调用实例方法
   *
   * **重要 — 错误处理**：
   * ee-core 的 IpcServer.register 会用 try/catch 包裹 ipcMain.handle，捕获后**只写
   * coreLogger 不 rethrow**（ee-core 源码 socket/ipcServer.js 第 65-74 行）。
   * 直接 throw 的话，前端 invoke 返回 undefined，错误信息全部丢失。
   * 这里**统一把所有 throw 转成 image-hosting 调用方期望的 `{success:false, error}`
   * 形状**，确保前端拿到真实错误（适用于 image-hosting 路径；其它 kind 调用方目前
   * 也都能容忍 `{success, error}` 形状或会先校验 success 字段）。
   */
  async callProvider(
    { kind, type, method, args }: { kind: 'tti' | 'itv' | 'tts' | 'llm' | 'image-hosting'; type: string; method: string; args: unknown[] },
    _event?: IpcMainInvokeEvent
  ) {
    await ensureServicesReady();
    try {
      const result = await pluginBridge.callProvider(kind, type, method, args);
      // Provider 方法有时返回 undefined（不该但要兜底） — 同样转成结构化错误而不是把
      // undefined 透回前端
      if (result === undefined || result === null) {
        const msg = `Provider 方法 "${type}.${method}" 返回了 ${result === null ? 'null' : 'undefined'}`;
        console.error('[PluginController] callProvider returned empty', { kind, type, method });
        return { success: false, error: msg };
      }
      return result;
    } catch (err: any) {
      const errorMsg = err?.message || String(err) || '未知后端错误';
      console.error('[PluginController] callProvider failed', {
        kind,
        type,
        method,
        error: errorMsg,
        stack: err?.stack,
      });
      // 把抛出的异常转成结构化 result，绕开 ee-core 的吞错行为
      return { success: false, error: `[${type}.${method}] ${errorMsg}` };
    }
  },

  /**
   * 列出可用 Worker Agent
   */
  async listAgents(_args: any, _event?: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return pluginBridge.listAgents().map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      capabilities: a.capabilities,
      pluginId: a.pluginId,
    }));
  },
};

export = pluginController;
