/**
 * Image hosting orchestrator (pluggable).
 *
 * This is a thin layer that:
 * - selects the active image-hosting channel (channelConfig)
 * - creates the provider instance via ProviderRegistry(kind='image-hosting')
 * - uploads bytes and returns a remote URL
 *
 * It intentionally does not know any provider-specific protocol (e.g. SCDN).
 */

import { createLogger } from '../store/logger';
import { electronService } from './electronService';
import { getDefaultChannelConfig, getChannelsByCapability } from '../store/globalStore';
import { createProviderInstance, getProjectImageHostingProvider, listProviders } from '../providers';
import type { ImageHostingProvider, ImageHostingUploadOptions, ImageHostingUploadResult } from '../providers/imageHosting/types';
import { withRetry, withTimeout } from '../utils/retry';

const logger = createLogger('ImageHosting');
const IMAGE_HOSTING_UPLOAD_TIMEOUT_MS = 60_000;

let _recovering: Promise<void> | null = null;

import { base64ToBytes } from '../utils/encoding';

/** 后端 Provider 不存在时使用，从重试循环中拆出来用作"切换到前端 Provider"的信号。 */
class BackendProviderMissingError extends Error {
  readonly name = 'BackendProviderMissingError';
}

export async function getActiveImageHostingChannel() {
  return await getDefaultChannelConfig('image-hosting' as any)
    || (await getChannelsByCapability('image-hosting' as any))[0]
    || null;
}

async function tryCreateProviderFallback(channel: any): Promise<ImageHostingProvider | null> {
  if (!channel) return null;
  if (!listProviders('image-hosting').some(p => p.type === channel.providerType)) {
    return null;
  }

  const defs = listProviders('image-hosting');
  const def = defs.find(d => d.type === channel.providerType);
  if (!def) return null;

  const pluginIdFromDef = def.pluginId;
  const pluginId = channel.pluginId || pluginIdFromDef;

  // Reconstruct plugin context locally (avoid depending on higher-level provider factory paths).
  let sandboxedFetch: typeof fetch = fetch;
  if (pluginId) {
    try {
      const { usePluginStore, waitForPluginStoreRehydration } = await import('../store/pluginStore');
      const { createSandboxedFetch } = await import('./plugin/PluginSandbox');
      await waitForPluginStoreRehydration();
      const plugin = usePluginStore.getState().getPlugin(pluginId);
      if (plugin) {
        sandboxedFetch = createSandboxedFetch(plugin);
      }
    } catch (err: unknown) {
      logger.warn('fallback 创建 provider：构建 sandboxedFetch 失败，降级使用全局 fetch', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const provider = createProviderInstance<ImageHostingProvider>(
      'image-hosting',
      channel.providerType,
      channel.providerConfig || {},
      { sandboxedFetch, pluginId }
    );
    return provider;
  } catch (err: unknown) {
    logger.error('fallback 创建 provider 失败', {
      providerType: channel.providerType,
      pluginId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function recoverImageHostingProviderOnce(): Promise<void> {
  // Avoid dogpiling if multiple uploads happen concurrently.
  if (_recovering) return _recovering;

  _recovering = (async () => {
    try {
      const channel = await getActiveImageHostingChannel();
      if (!channel) return;

      // If this channel comes from a plugin, attempt to initialize that plugin.
      if (channel.source === 'plugin' && channel.pluginId) {
        // Lazy import to avoid module cycles.
        const { usePluginStore } = await import('../store/pluginStore');
        const { initializePlugin } = await import('./plugin/PluginInitializer');

        const plugin = usePluginStore.getState().getPlugin(channel.pluginId);
        if (plugin && plugin.isEnabled) {
          const ok = await initializePlugin(plugin);
          if (ok) return;
        }
      }

      // Fallback: re-run provider plugin initialization (best-effort).
      const { initializeProviderPlugins } = await import('./plugin/PluginInitializer');
      await initializeProviderPlugins();
    } catch (err: unknown) {
      logger.warn('尝试恢复 image-hosting provider 失败', { error: err instanceof Error ? err.message : String(err) });
    }
  })();

  try {
    await _recovering;
  } finally {
    _recovering = null;
  }
}

export async function getActiveImageHostingProvider(): Promise<ImageHostingProvider | null> {
  const channel = await getActiveImageHostingChannel();
  let provider = await getProjectImageHostingProvider();
  if (!provider) {
    const defs = listProviders('image-hosting').map(d => ({ type: d.type, pluginId: d.pluginId }));
    let pluginRuntimeState: any = null;
    if (channel?.source === 'plugin' && channel.pluginId) {
      const { usePluginStore } = await import('../store/pluginStore');
      pluginRuntimeState = usePluginStore.getState().runtimeStates?.[channel.pluginId] || null;
    }
    logger.warn('image-hosting provider 未就绪: before recover', {
      channel: channel
        ? {
            id: channel.id,
            providerType: channel.providerType,
            source: channel.source,
            pluginId: channel.pluginId,
            enabled: channel.enabled,
            providerConfigEnabled: Boolean((channel.providerConfig as any)?.enabled),
            providerConfigKeys: Object.keys((channel.providerConfig as any) || {}),
          }
        : null,
      registeredProviders: defs,
      pluginRuntimeState,
    });
    // Self-heal: plugin might be enabled and channel config exists, but provider definitions
    // were not registered in-memory yet (startup race / prior plugin load failure).
    await recoverImageHostingProviderOnce();
    provider = await getProjectImageHostingProvider();
  }
  if (!provider) {
    // Last-resort: we can see the provider definition exists in the registry but higher-level
    // factory paths still returned null. Try constructing the instance directly.
    const fallbackProvider = await tryCreateProviderFallback(channel);
    if (fallbackProvider) {
      logger.info('image-hosting provider recovered via fallback create', {
        providerType: channel?.providerType,
        pluginId: channel?.pluginId,
      });
      provider = fallbackProvider;
    }
  }
  if (!provider) {
    const defs = listProviders('image-hosting').map(d => ({ type: d.type, pluginId: d.pluginId }));
    logger.warn('image-hosting provider 未就绪: after recover', {
      channel: channel ? { id: channel.id, providerType: channel.providerType, pluginId: channel.pluginId } : null,
      registeredProviders: defs,
    });
  }
  if (!provider) return null;
  if (!provider.validate()) return null;
  return provider;
}

export async function isImageHostingEnabled(): Promise<boolean> {
  return Boolean(await getActiveImageHostingProvider());
}

export async function uploadBytesToImageHostingWithRetry(
  bytes: ArrayBuffer | Uint8Array,
  options?: ImageHostingUploadOptions,
  maxRetries: number = 3
): Promise<ImageHostingUploadResult> {
  const channel = await getActiveImageHostingChannel();
  if (!channel) {
    return { success: false, error: '未找到 image-hosting 渠道，请在插件设置中启用图床并创建渠道' };
  }

  // In Electron, plugin-based image hosting should prefer backend execution.
  // This avoids renderer CSP restrictions and keeps upload transport centralized.
  if (electronService.isElectron() && channel.source === 'plugin') {
    const payloadBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try {
      return await withRetry(
        async (attempt) => {
          logger.info('图床后端 Provider 上传开始', {
            providerType: channel.providerType,
            attempt,
            bytes: payloadBytes.byteLength,
            filename: options?.filename,
          });
          let result: ImageHostingUploadResult | null;
          try {
            result = await withTimeout(
              electronService.ipc.invoke('controller/plugin/callProvider', {
                kind: 'image-hosting',
                type: channel.providerType,
                method: 'uploadImage',
                args: [channel.providerConfig || {}, payloadBytes, options],
              }),
              IMAGE_HOSTING_UPLOAD_TIMEOUT_MS,
              `图床上传超时（>${IMAGE_HOSTING_UPLOAD_TIMEOUT_MS / 1000} 秒）`,
            ) as ImageHostingUploadResult | null;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            // 后端 Provider 不存在（仅前端入口的插件）— 跳出重试，回退到前端 Provider
            if (msg.includes('Provider "') && msg.includes('not found')) {
              throw new BackendProviderMissingError(msg);
            }
            logger.error('图床后端 Provider 调用抛错', {
              providerType: channel.providerType,
              attempt,
              error: msg,
              stack: err instanceof Error ? err.stack : undefined,
            });
            throw err instanceof Error ? err : new Error(msg);
          }
          if (result?.success) {
            logger.info('图床后端 Provider 上传成功', {
              providerType: channel.providerType,
              attempt,
              url: result.url,
              filename: options?.filename,
            });
            return result;
          }
          const errMsg = result && typeof result === 'object'
            ? (result.error || `未返回 success=true，原始结果: ${JSON.stringify(result)}`)
            : `返回了不可识别结果: ${String(result)}`;
          logger.warn('图床后端 Provider 返回非成功结果', {
            providerType: channel.providerType,
            attempt,
            result,
          });
          // 后端 Provider 在主进程里没注册（仅前端入口的插件） — controller/plugin/callProvider
          // 现在会把异常转成 {success:false, error:'... Provider "xyz" not found'}，这里需要从
          // error 字符串里识别该信号并跳出重试，回退到前端 Provider
          if (errMsg.includes('Provider "') && errMsg.includes('not found')) {
            throw new BackendProviderMissingError(errMsg);
          }
          throw new Error(errMsg);
        },
        {
          maxAttempts: maxRetries,
          initialDelayMs: 1000,
          backoffMultiplier: 2,
          shouldRetry: (err) => !(err instanceof BackendProviderMissingError),
          onRetry: (err, attempt, wait) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`图床上传失败 (后端 Provider 尝试 ${attempt}/${maxRetries})，${wait}ms 后重试: ${msg}`);
          },
        },
      );
    } catch (err: unknown) {
      if (err instanceof BackendProviderMissingError) {
        // 主进程图床 Provider 没注册（通常意味着插件后端激活失败）。
        // **不要**回退到前端 fetch —— komaapi.com 没给渲染端 origin 开 CORS，
        // 渲染端 fetch 必定 "Failed to fetch"，错误信息更迷惑。
        // 直接报清晰错误，让用户去查后端激活日志（[PluginInitializer] 后端激活失败 ...）。
        logger.error('图床后端 Provider 未在主进程注册（插件后端可能激活失败）', {
          providerType: channel.providerType,
          pluginId: channel.pluginId,
        });
        return {
          success: false,
          error: `图床后端 Provider 未注册（${channel.providerType}）。该插件的后端模块未成功激活，请查看主进程日志或重启应用；前端 fetch 受 CORS 限制无法兜底，必须走后端通道。`,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `上传失败，已重试 ${maxRetries} 次: ${msg || '未知错误'}`,
      };
    }
  }

  const provider = await getActiveImageHostingProvider();
  if (!provider) {
    // Differentiate "provider not registered" vs "provider exists but config invalid/disabled".
    // This helps users fix the real issue without guesswork.
    const raw = await getProjectImageHostingProvider();
    if (raw && !raw.validate()) {
      return {
        success: false,
        error: `图床 Provider 已加载但未启用或配置不完整（${channel.providerType}）。请在插件设置中启用并保存配置后重试。`,
      };
    }

    return {
      success: false,
      error: `图床渠道已存在但 Provider 未就绪（${channel.providerType}）。请尝试重启应用或重新启用插件后再试。`,
    };
  }

  try {
    return await withRetry(
      async (attempt) => {
        logger.info('图床前端 Provider 上传开始', {
          providerType: provider.type,
          attempt,
          bytes: bytes instanceof Uint8Array ? bytes.byteLength : bytes.byteLength,
          filename: options?.filename,
        });
        const result = await withTimeout(
          provider.uploadImage(bytes, options),
          IMAGE_HOSTING_UPLOAD_TIMEOUT_MS,
          `图床上传超时（>${IMAGE_HOSTING_UPLOAD_TIMEOUT_MS / 1000} 秒）`,
        );
        if (result.success) {
          logger.info('图床前端 Provider 上传成功', {
            providerType: provider.type,
            attempt,
            url: result.url,
            filename: options?.filename,
          });
          return result;
        }
        throw new Error(result.error || '未知错误');
      },
      {
        maxAttempts: maxRetries,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        onRetry: (err, attempt, wait) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`图床上传失败 (尝试 ${attempt}/${maxRetries})，${wait}ms 后重试: ${msg}`);
        },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `上传失败，已重试 ${maxRetries} 次: ${msg}`,
    };
  }
}

export async function uploadLocalFileToImageHosting(
  localPath: string,
  options?: ImageHostingUploadOptions
): Promise<ImageHostingUploadResult> {
  if (!electronService.isElectron()) {
    return { success: false, error: '不支持的环境（需要 Electron）' };
  }

  try {
    const base64 = await electronService.fs.readFileAsBase64(localPath);
    const bytes = base64ToBytes(base64);
    const filename = options?.filename || localPath.split(/[/\\]/).pop() || 'image.png';
    return uploadBytesToImageHostingWithRetry(bytes, { ...options, filename });
  } catch (err: unknown) {
    return { success: false, error: `读取文件失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}
