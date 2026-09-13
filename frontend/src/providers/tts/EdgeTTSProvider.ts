/**
 * Edge TTS Provider (免费)
 * 使用 Microsoft Edge 的 TTS 服务
 */
import type { TTSConfig, AudioResult, Voice } from '../../types';
import type { ProviderStartResult } from '../../types';
import type { TTSProvider, TTSRequest } from './types';
import { createLogger } from '../../store/logger';

const logger = createLogger('EdgeTTSProvider');

// Edge TTS 中文音色列表
const EDGE_VOICES: Voice[] = [
  {
    id: 'zh-CN-XiaoxiaoNeural',
    name: '晓晓 (女声)',
    language: 'zh-CN',
    gender: 'female',
    provider: 'edge-tts',
  },
  {
    id: 'zh-CN-YunxiNeural',
    name: '云希 (男声)',
    language: 'zh-CN',
    gender: 'male',
    provider: 'edge-tts',
  },
  {
    id: 'zh-CN-YunjianNeural',
    name: '云健 (男声)',
    language: 'zh-CN',
    gender: 'male',
    provider: 'edge-tts',
  },
  {
    id: 'zh-CN-XiaoyiNeural',
    name: '晓伊 (女声)',
    language: 'zh-CN',
    gender: 'female',
    provider: 'edge-tts',
  },
  {
    id: 'zh-CN-YunyangNeural',
    name: '云扬 (男声-新闻)',
    language: 'zh-CN',
    gender: 'male',
    provider: 'edge-tts',
  },
  {
    id: 'zh-CN-XiaochenNeural',
    name: '晓辰 (女声)',
    language: 'zh-CN',
    gender: 'female',
    provider: 'edge-tts',
  },
];

export class EdgeTTSProvider implements TTSProvider {
  type: 'edge-tts' = 'edge-tts';
  config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  validate(): boolean {
    // Edge TTS 不需要 API Key
    return true;
  }

  async testConnection(): Promise<boolean> {
    // Edge TTS 通常可用
    return true;
  }

  async start(request: TTSRequest): Promise<ProviderStartResult<AudioResult>> {
    const output = await this.synthesizeInternal(request);
    return { mode: 'immediate', output };
  }

  private async synthesizeInternal(request: TTSRequest): Promise<AudioResult> {
    const { text, voiceId, options } = request;
    const requestId = crypto.randomUUID().replace(/-/g, '');
    const timestamp = new Date().toString();

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4'
      );

      const audioChunks: BlobPart[] = [];

      ws.onopen = () => {
        // 1. 发送配置
        const configMessage = `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
        ws.send(configMessage);

        // 2. 构建 SSML
        const rate = options?.rate ? `${options.rate >= 1 ? '+' : ''}${Math.round((options.rate - 1) * 100)}%` : '+0%';
        // const pitch = '+0Hz'; // 暂不支持调整音调，简单处理
        const ssml = `
          <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
            <voice name='${voiceId}'>
              <prosody pitch='+0Hz' rate='${rate}' volume='+0%'>
                ${text}
              </prosody>
            </voice>
          </speak>
        `.trim();

        // 3. 发送合成请求
        const ssmlMessage = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}\r\nPath:ssml\r\n\r\n${ssml}`;
        ws.send(ssmlMessage);
      };

      ws.onmessage = async (event) => {
        const data = event.data;

        if (typeof data === 'string') {
          // 文本消息，检查是否结束
          if (data.includes('Path:turn.end')) {
            ws.close();
            const blob = new Blob(audioChunks, { type: 'audio/mp3' });
            const url = URL.createObjectURL(blob);
            resolve({
              path: url,
              duration: 0, // Edge TTS 不直接返回时长，需要解码音频获取，这里先置 0
            });
          }
        } else if (data instanceof Blob) {
          // 二进制数据，寻找音频头
          // 数据格式: Header (Text) + Binary Audio
          // 需要解析 Header 找到 Path:audio
          const text = await data.slice(0, 128).text(); // 读取前128字节检查头
          if (text.includes('Path:audio')) {
            // 找到 header 的结束位置 \r\n\r\n
            const headerEnd = text.indexOf('\r\n\r\n');
            if (headerEnd !== -1) {
               // 提取音频部分
               const audioData = data.slice(headerEnd + 4);
               audioChunks.push(audioData);
            }
          }
        }
      };

      ws.onerror = (error) => {
        logger.error('WebSocket Error:', error);
        reject(new Error('Edge TTS 连接失败'));
      };

      ws.onclose = (event) => {
        if (event.code !== 1000 && event.code !== 1005) {
           // 非正常关闭，且没有 resolve (audioChunks length check usually done in turn.end)
           // 但如果 turn.end 来了已经 resolve 了，这里不做处理
        }
      };
    });
  }

  async listVoices(): Promise<Voice[]> {
    return EDGE_VOICES;
  }
}

export default EdgeTTSProvider;
