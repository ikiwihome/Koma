import { getProjectTTIProvider } from '../../providers';
import type { TaskHandler } from '../taskHandlerRegistry';

export const ttiTaskHandler: TaskHandler = {
  type: 'tti',
  kind: 'image',
  defaultCapability: 'image.text-to-image',
  async getSnapshot(task, { selection, capability }) {
    const provider = await getProjectTTIProvider(
      selection,
      capability === 'image.image-to-image' ? 'image.image-to-image' : 'image.text-to-image',
    );
    if (!provider?.getTaskSnapshot) throw new Error('TTI Provider 不可用');
    return provider.getTaskSnapshot(task.remoteTaskId);
  },
  extractSource(output) {
    return output?.url || output?.path;
  },
};
