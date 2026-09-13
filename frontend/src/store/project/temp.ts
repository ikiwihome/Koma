/**
 * 临时文件管理
 */
import { electronService } from '../../services/electronService';
import { getProjectPath, getProjectsRoot } from './core';

export async function createTempFile(
  projectId: string,
  extension: string = 'tmp'
): Promise<string | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const projectPath = await getProjectPath(projectId);
  const tempDir = `${projectPath}/temp`;
  await electronService.fs.mkdir(tempDir);

  const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const tempPath = `${tempDir}/${uniqueName}`;

  await electronService.fs.writeFile(tempPath, '');
  return tempPath;
}

export async function cleanAllTempOnStartup(): Promise<void> {
  if (!electronService.isElectron()) {
    return;
  }

  try {
    const projectsRoot = await getProjectsRoot();
    const exists = await electronService.fs.exists(projectsRoot);
    if (!exists) return;

    const projectDirs = await electronService.fs.readdir(projectsRoot);
    for (const dir of projectDirs) {
      const tempPath = `${projectsRoot}/${dir}/temp`;
      const tempExists = await electronService.fs.exists(tempPath);
      if (tempExists) {
        await electronService.fs.remove(tempPath);
        await electronService.fs.mkdir(tempPath);
      }
    }
  } catch {
    // 启动清理失败不影响正常运行
  }
}
