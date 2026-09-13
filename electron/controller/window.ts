/**
 * 窗口控制器
 */
import { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { BaseController } from './base';

function isWindowExpanded(win: BrowserWindow): boolean {
  return win.isMaximized() || win.isFullScreen();
}

class WindowController extends BaseController {
  minimize(_args: any, event?: IpcMainInvokeEvent) {
    const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
    if (win) win.minimize();
    return { success: true };
  }

  maximize(_args: any, event?: IpcMainInvokeEvent) {
    const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
    if (win) {
      // macOS green window button enters a dedicated fullscreen Space instead of a plain maximize.
      if (process.platform === 'darwin') {
        win.setFullScreen(!win.isFullScreen());
      } else if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    return { success: true };
  }

  close(_args: any, event?: IpcMainInvokeEvent) {
    const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
    if (win) win.close();
    return { success: true };
  }

  isMaximized(_args: any, event?: IpcMainInvokeEvent) {
    const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
    return { isMaximized: win ? isWindowExpanded(win) : false };
  }
}

export = WindowController;
