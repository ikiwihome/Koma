/**
 * 对话框控制器
 */
import { dialog, BrowserWindow, IpcMainInvokeEvent, OpenDialogOptions } from 'electron';
import { BaseController } from './base';

interface OpenFileArgs {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}

interface SaveFileArgs {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

class DialogController extends BaseController {
  async openFile(args: OpenFileArgs, event?: IpcMainInvokeEvent) {
    const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: args?.filters || [],
    };
    if (args?.multiple) {
      options.properties!.push('multiSelections');
    }
    const result = await dialog.showOpenDialog(win!, options);
    return result;
  }

  async openDirectory(_args: any, event?: IpcMainInvokeEvent) {
    const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result;
  }

  async saveFile(args: SaveFileArgs, event?: IpcMainInvokeEvent) {
    const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: args?.defaultPath,
      filters: args?.filters || [],
    });
    return result;
  }
}

export = DialogController;
