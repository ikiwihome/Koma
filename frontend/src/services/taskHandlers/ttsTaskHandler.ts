import { getProjectTTSProvider } from '../../providers';
import type { TaskHandler } from '../taskHandlerRegistry';

export const ttsTaskHandler: TaskHandler = {
  type: 'tts',
  kind: 'audio',
  defaultCapability: 'speech.text-to-speech',
  async getSnapshot(task, { selection }) {
    const provider = await getProjectTTSProvider(selection, 'speech.text-to-speech');
    if (!provider?.getTaskSnapshot) throw new Error('TTS Provider 不可用');
    return provider.getTaskSnapshot(task.remoteTaskId);
  },
  extractSource(output) {
    return output?.path;
  },
};
