import type { AsyncTask, MediaOwnerRef, StoredMediaAsset } from '../types';
import { electronService } from './electronService';
import { createLogger } from '../store/logger';

const logger = createLogger('MediaTaskBinding');

export async function bindCompletedMediaTask(
  projectId: string,
  task: AsyncTask,
  asset: StoredMediaAsset,
): Promise<void> {
  const ownerRef = task.ownerRef;
  if (!ownerRef || ownerRef.projectId !== projectId) return;
  await bindOwnerRefMedia(projectId, ownerRef, asset);
}

export async function bindOwnerRefMedia(
  projectId: string,
  ownerRef: MediaOwnerRef,
  asset: StoredMediaAsset,
): Promise<void> {
  if (!electronService.isElectron()) {
    logger.warn('绑定媒体跳过：非 Electron 环境', { projectId, ownerRef });
    return;
  }
  if (!ownerRef || ownerRef.projectId !== projectId) {
    logger.warn('绑定媒体跳过：ownerRef 不匹配', { projectId, ownerRef });
    return;
  }
  const result = await electronService.project.bindOwnerRefMedia(projectId, ownerRef, asset);
  if (!result?.success) {
    logger.error('绑定媒体失败', {
      projectId,
      ownerRef,
      localPath: asset.localPath,
      remoteUrl: asset.remoteUrl,
      provider: asset.provider,
      result,
    });
    throw new Error('媒体生成完成但回写失败');
  }
  logger.info('绑定媒体成功', {
    projectId,
    ownerRef,
    localPath: asset.localPath,
    remoteUrl: asset.remoteUrl,
    provider: asset.provider,
  });
}
