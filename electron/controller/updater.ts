/**
 * 主程序更新 controller — 极简版只暴露 4 个方法。
 *
 * Channel 命名：controller/updater/{methodName}（ee-core 自动从文件名 + class 方法名拼成）
 * Bridge 白名单见 electron/preload/bridge.ts。
 *
 * 历史还有过 installOnQuit / openManualDownload / dismiss / setAutoCheck / setChannel；
 * 已随极简化方案删除——自动检查永远开、不允许 dismiss、channel 概念取消、
 * 失败连续 3 次后由 UpdaterService 自行 shell.openExternal 兜底。
 */
import { BaseController } from './base';
import { getUpdaterService, initUpdaterService } from '../service/updater';

function ensure() {
  return getUpdaterService() ?? initUpdaterService();
}

class UpdaterController extends BaseController {
  getState() {
    return ensure().getState();
  }

  async checkNow() {
    return ensure().checkNow();
  }

  async download() {
    await ensure().download();
    return { success: true };
  }

  async installNow() {
    await ensure().installNow();
    return { success: true };
  }
}

export = UpdaterController;
