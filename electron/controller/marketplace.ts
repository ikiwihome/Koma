/**
 * 插件 marketplace controller
 *
 * Channel 命名：controller/marketplace/{methodName}
 */
import { BaseController } from './base';
import {
  getPluginMarketplaceService,
  initPluginMarketplaceService,
} from '../service/marketplace';

function ensure() {
  return getPluginMarketplaceService() ?? initPluginMarketplaceService();
}

class MarketplaceController extends BaseController {
  async list() {
    return { items: await ensure().list() };
  }

  async refresh() {
    return ensure().refreshRegistry();
  }

  async checkUpdates() {
    return { items: await ensure().checkUpdates() };
  }

  getState() {
    return ensure().getState();
  }

  async installOrUpdate(args: { pluginId: string }) {
    await ensure().installOrUpdate(String(args?.pluginId || ''));
    return { success: true };
  }

  async uninstall(args: { pluginId: string }) {
    await ensure().uninstall(String(args?.pluginId || ''));
    return { success: true };
  }

  async setAutoCheck(args: { enabled: boolean }) {
    await ensure().setAutoCheck(Boolean(args?.enabled));
    return { success: true };
  }
}

export = MarketplaceController;
