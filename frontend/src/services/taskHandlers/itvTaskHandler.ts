import { getProjectITVProvider } from '../../providers';
import type { TaskHandler } from '../taskHandlerRegistry';

export const itvTaskHandler: TaskHandler = {
  type: 'itv',
  kind: 'video',
  defaultCapability: 'video.image-to-video',
  async getSnapshot(task, { selection, capability }) {
    const provider = await getProjectITVProvider(selection, capability as any);
    if (!provider?.getTaskSnapshot) throw new Error('ITV Provider 不可用');
    return provider.getTaskSnapshot(task.remoteTaskId, { capability: capability as any });
  },
  extractSource(output) {
    return output?.source;
  },
};
