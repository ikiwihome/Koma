import {
  app as electronApp,
  Menu,
  type Event as ElectronEvent,
  type Input,
  type MenuItemConstructorOptions,
} from 'electron';
import { eventBus, Preload } from 'ee-core/app/events';
import { createMainWindow, getMainWindow, loadServer, restoreMainWindow } from 'ee-core/electron/window';
import { logger } from 'ee-core/log';
import { closeServices, diagnosticsService } from '../service';

const isMac = process.platform === 'darwin';
const APP_DISPLAY_NAME = 'Koma Studio';
const APP_DESCRIPTION = 'AI 视频创作与分镜制作工具。';

function configureAboutPanel(): void {
  if (!isMac) return;

  electronApp.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: electronApp.getVersion(),
    version: electronApp.getVersion(),
    credits: APP_DESCRIPTION,
    copyright: '© 2026 Koma Studio',
  });
}

function configureApplicationMenu(): void {
  if (!isMac) return;

  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_DISPLAY_NAME,
      submenu: [
        {
          label: `About ${APP_DISPLAY_NAME}`,
          click: () => electronApp.showAboutPanel(),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function hideMacWindowControls(): void {
  if (!isMac) return;

  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;

  win.setWindowButtonVisibility(false);
}

function attachRendererConsoleLogging(): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;

  win.webContents.on('console-message', (eventOrDetails, level, message, lineNumber, sourceId) => {
    const details =
      typeof message === 'string'
        ? { level, message, lineNumber, sourceId }
        : eventOrDetails && 'message' in eventOrDetails
          ? eventOrDetails
          : {};

    diagnosticsService.appendConsoleMessage({
      level: details.level,
      message: details.message,
      lineNumber: details.lineNumber,
      sourceId: details.sourceId,
    }).catch((err) => {
      logger.warn('[diagnostics] renderer console logging failed', err);
    });
  });
}

export class Lifecycle {
  ready(): void {
    logger.info('[lifecycle] ready');
  }

  electronAppReady(): void {
    logger.info('[lifecycle] electron-app-ready');
    configureAboutPanel();
    configureApplicationMenu();

    electronApp.on('second-instance', () => {
      restoreMainWindow();
    });

    electronApp.on('activate', () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        restoreMainWindow();
        return;
      }

      createMainWindow();
      eventBus.emitLifecycle(Preload);
      loadServer();
    });
  }

  windowReady(): void {
    logger.info('[lifecycle] window-ready');

    const win = getMainWindow();
    if (!win) return;
    configureAboutPanel();
    configureApplicationMenu();
    hideMacWindowControls();
    attachRendererConsoleLogging();

    win.webContents.on('before-input-event', (_event: ElectronEvent, input: Input) => {
      if (
        input.key === 'F12' ||
        (input.control && input.shift && input.key.toLowerCase() === 'i')
      ) {
        win.webContents.toggleDevTools();
      }
    });
  }

  beforeClose(): void {
    logger.info('[lifecycle] before-close');
    closeServices();
  }
}
