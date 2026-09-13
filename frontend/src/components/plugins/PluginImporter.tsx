/**
 * 插件导入组件（拖拽/选择）
 */
import React, { useState, useCallback } from 'react';
import { Upload, Button, message, Modal } from 'antd';
import type { UploadProps } from 'antd';
import { InboxOutlined, FolderAddOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { PluginManifest } from '../../types/plugin';
import { validateManifest } from '../../services/plugin/PluginLoader';
import { initializePlugin } from '../../services/plugin/PluginInitializer';
import { PluginPermissions } from './PluginPermissions';
import { usePluginStore } from '../../store/pluginStore';
import { electronService } from '../../services/electronService';
import { createLogger } from '../../store/logger';

const logger = createLogger('PluginImporter');

const { Dragger } = Upload;

interface PluginImporterProps {
  onImportSuccess?: (pluginId: string) => void;
}

export const PluginImporter: React.FC<PluginImporterProps> = ({ onImportSuccess }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [permissionModal, setPermissionModal] = useState<{
    visible: boolean;
    manifest: PluginManifest | null;
    zipPath: string;
    stagingId?: string; // 用于复用 validate 的解压结果
  }>({ visible: false, manifest: null, zipPath: '' });

  const registerPlugin = usePluginStore(state => state.registerPlugin);

  // 处理文件上传/拖拽
  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      message.error(t('plugin.selectZipFile'));
      return false;
    }

    setLoading(true);

    try {
      // 获取文件绝对路径。
      // Electron 32+ 已移除 File.path 扩展属性，需改用官方 webUtils.getPathForFile，
      // 由 preload 暴露在 window.electronAPI.webUtils 上。保留 (file as any).path
      // 作为兜底，兼容老版本 Electron/Web 环境。
      const win = window as unknown as { electronAPI?: { webUtils?: { getPathForFile?: (f: File) => string } } };
      const filePath = win.electronAPI?.webUtils?.getPathForFile?.(file) || (file as any).path;
      if (!filePath) {
        message.error(t('plugin.cannotGetFilePath'));
        return false;
      }

      // 调用主进程解压并验证
      const result = await electronService.ipc.invoke('controller/plugin/validate', { zipPath: filePath });

      if (!result.valid) {
        Modal.error({
          title: t('plugin.validationFailed'),
          content: (
            <ul className="list-disc pl-4">
              {result.errors.map((err: string, i: number) => (
                <li key={i} className="text-status-error">{err}</li>
              ))}
            </ul>
          ),
        });
        return false;
      }

      // 显示权限确认弹窗
      setPermissionModal({
        visible: true,
        manifest: result.manifest,
        zipPath: filePath,
        stagingId: result.stagingId, // 保存 stagingId 供安装时复用
      });

    } catch (err: unknown) {
      logger.error('导入失败', err);
      message.error(`${t('plugin.importFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }

    return false; // 阻止默认上传行为
  }, [t]);

  // 确认安装
  const handleConfirmInstall = useCallback(async () => {
    const { manifest, zipPath, stagingId } = permissionModal;
    if (!manifest) return;

    setLoading(true);

    try {
      // 调用主进程安装插件（传递 stagingId 复用解压结果）
      const installResult = await electronService.ipc.invoke('controller/plugin/install', {
        zipPath,
        manifest,
        stagingId,
      });

      if (installResult.success) {
        // 注册到 store
        registerPlugin(manifest, installResult.rootPath);

        // 立即初始化插件（使其 Provider 生效）
        const installedPlugin = usePluginStore.getState().getPlugin(manifest.id);
        if (installedPlugin) {
          try {
            const initSuccess = await initializePlugin(installedPlugin);
            if (initSuccess) {
              message.success(t('plugin.installedAndReady', { name: manifest.name }));
            } else {
              message.warning(t('plugin.installedButInitFailed', { name: manifest.name }));
            }
          } catch (initErr) {
            logger.error('初始化异常', initErr);
            message.warning(t('plugin.initException', { name: manifest.name }));
          }
        } else {
          message.success(t('plugin.installSuccess', { name: manifest.name }));
        }

        onImportSuccess?.(manifest.id);
      } else {
        throw new Error(installResult.error);
      }
    } catch (err: any) {
      message.error(`${t('plugin.installFailed')}: ${err.message}`);
    } finally {
      setLoading(false);
      setPermissionModal({ visible: false, manifest: null, zipPath: '' });
    }
  }, [permissionModal, registerPlugin, onImportSuccess, t]);

  // 从文件夹导入（开发模式）
  const handleImportFromFolder = useCallback(async () => {
    try {
      const result = await electronService.dialog.openDirectory();

      if (result.canceled || !result.filePaths?.[0]) return;

      const folderPath = result.filePaths[0];

      // 验证目录中的 manifest.json
      const manifestPath = `${folderPath}/manifest.json`;
      const manifestContent = await electronService.fs.readFile(manifestPath);
      const manifest = JSON.parse(manifestContent);

      const validation = validateManifest(manifest);
      if (!validation.valid) {
        Modal.error({
          title: t('plugin.validationFailed'),
          content: (
            <ul className="list-disc pl-4">
              {validation.errors.map((err, i) => (
                <li key={i} className="text-status-error">{err}</li>
              ))}
            </ul>
          ),
        });
        return;
      }

      // 直接显示权限确认（开发模式不需要解压）
      setPermissionModal({
        visible: true,
        manifest: validation.manifest!,
        zipPath: folderPath, // 使用文件夹路径
      });

    } catch (err: any) {
      message.error(`${t('plugin.importFailed')}: ${err.message}`);
    }
  }, [t]);

  const uploadProps: UploadProps = {
    name: 'plugin',
    multiple: false,
    accept: '.zip',
    showUploadList: false,
    beforeUpload: handleFile,
    disabled: loading,
  };

  return (
    <div className="plugin-importer">
      <Dragger {...uploadProps} className="!bg-bg-app !border-dashed">
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">{t('plugin.dragOrClickToImport')}</p>
        <p className="ant-upload-hint text-text-secondary">
          {t('plugin.supportZipFormat')}
        </p>
      </Dragger>

      <div className="mt-3 flex justify-center">
        <Button
          type="link"
          icon={<FolderAddOutlined />}
          onClick={handleImportFromFolder}
          disabled={loading}
        >
          {t('plugin.importFromFolder')}
        </Button>
      </div>

      {permissionModal.manifest && (
        <PluginPermissions
          visible={permissionModal.visible}
          manifest={permissionModal.manifest}
          onConfirm={handleConfirmInstall}
          onCancel={() => setPermissionModal({ visible: false, manifest: null, zipPath: '' })}
        />
      )}
    </div>
  );
};

export default PluginImporter;
