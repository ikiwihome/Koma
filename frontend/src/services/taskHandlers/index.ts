/**
 * 内置任务处理器集中注册
 *
 * MediaGenerationService 顶部 import 此模块触发副作用，把内置 handler
 * 注入 taskHandlerRegistry。新增任务类型在本文件追加 register 一行即可。
 */
import { taskHandlerRegistry } from '../taskHandlerRegistry';
import { ttiTaskHandler } from './ttiTaskHandler';
import { itvTaskHandler } from './itvTaskHandler';
import { ttsTaskHandler } from './ttsTaskHandler';

taskHandlerRegistry.register(ttiTaskHandler);
taskHandlerRegistry.register(itvTaskHandler);
taskHandlerRegistry.register(ttsTaskHandler);

export { ttiTaskHandler, itvTaskHandler, ttsTaskHandler };
