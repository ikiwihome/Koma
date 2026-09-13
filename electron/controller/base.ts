/**
 * 控制器基类
 */
import { IpcMainInvokeEvent } from 'electron';

export abstract class BaseController {
  protected ctx: any;

  constructor(ctx?: any) {
    this.ctx = ctx;
  }
}

export interface ControllerMethod<T = any, R = any> {
  (args: T, event?: IpcMainInvokeEvent): Promise<R> | R;
}
