import { logger } from 'ee-core/log';
import { registerLocalProtocol } from '../service/protocol';
import { registerSecurityHeaders } from '../service/security';
import { initServices } from '../service';
import { chatIpc } from '../service/chat/ipc';
import { registerSettingsIpc } from '../service/settings/ipc';
import { registerTasksIpc } from '../service/tasks/ipc';
import { taskService } from '../service/tasks/TaskService';
import { taskRunner } from '../service/tasks/TaskRunner';
import { registerMediaPollHandlers } from '../service/tasks/handlers/mediaPoll';
import { registerLLMCompleteHandler } from '../service/tasks/handlers/llmComplete';
import { registerAnalysisHandlers } from '../service/tasks/handlers/analysisRunner';
import { registerBuiltinLLMProviders } from '../service/chat/providers';
import { initUpdaterService } from '../service/updater';
import { runVersionMigrationIfNeeded } from '../service/updater/versionMigration';
import { initPluginMarketplaceService } from '../service/marketplace';

function preload(): void {
  logger.info('[preload] load');
  registerLocalProtocol();
  registerSecurityHeaders();
  registerBuiltinLLMProviders();
  chatIpc.init();
  registerSettingsIpc();
  registerTasksIpc();
  registerMediaPollHandlers();
  registerLLMCompleteHandler();
  registerAnalysisHandlers();

  void initServices()
    .then(() => {
      try {
        const reconciled = taskService.reconcileOnBoot();
        const gc = taskService.runGc();
        // 把 reconcile 后状态为 pending 的可恢复任务重新入 main-side 队列
        taskRunner.resumeFromBoot();
        logger.info(
          '[preload] tasks reconcile/gc:',
          { reconciled, ...gc }
        );
      } catch (err) {
        logger.error('[preload] tasks reconcile/gc failed:', err);
      }

      // 版本变更迁移：必须在 initUpdaterService() 之前调用，
      // 因为 UpdaterService 启动会立刻把当前版本写入 updater-last-installed-version，
      // 之后再读就检测不到差异了。
      try {
        runVersionMigrationIfNeeded();
      } catch (err) {
        logger.warn('[preload] version migration failed:', err);
      }

      // updater / marketplace 必须在 taskService 初始化之后启动
      // （longTaskGuard 订阅 TaskService.addListener）
      try {
        initUpdaterService();
        initPluginMarketplaceService();
        logger.info('[preload] updater & marketplace services initialized');
      } catch (err) {
        logger.error('[preload] updater/marketplace init failed:', err);
      }
    })
    .catch(error => {
      logger.error('[preload] init failed:', error);
    });
}

export { preload };
