/**
 * Image Generation MCP 插件
 * 将全局 Provider 渠道 (TTI/ITV) 暴露为 MCP 工具
 * Agent 可通过工具调用实现文生图、图生视频
 */
import type { ElectronPluginAPI, MCPServerDefinition } from '@anthropic/plugin-sdk';

let pluginApi: ElectronPluginAPI | null = null;

export async function onActivate(api: ElectronPluginAPI): Promise<void> {
  pluginApi = api;
  api.log.info('Image Generation plugin activated');
}

export async function onDeactivate(): Promise<void> {
  pluginApi = null;
}

interface GenerateImageArgs {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  model?: string;
  steps?: number;
  seed?: number;
}

interface ImageToVideoArgs {
  imageUrl: string;
  prompt?: string;
  duration?: number;
  model?: string;
}

interface ListProvidersArgs {
  kind?: string;
}

export function createMCPServer(): MCPServerDefinition {
  return {
    name: 'image-gen',
    transport: 'internal',
    tools: [
      {
        definition: {
          name: 'generate_image',
          description: '文生图 - 根据文字描述生成图片。支持指定尺寸、步数、模型等参数。',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: '图片描述 (正向提示词)，尽量详细描述想要的画面',
              },
              negativePrompt: {
                type: 'string',
                description: '负向提示词，描述不想出现的内容',
              },
              width: {
                type: 'number',
                description: '图片宽度 (像素)，默认 1024',
              },
              height: {
                type: 'number',
                description: '图片高度 (像素)，默认 1024',
              },
              model: {
                type: 'string',
                description: '指定生成模型/渠道名称，留空使用默认',
              },
              steps: {
                type: 'number',
                description: '推理步数，越多质量越高但越慢',
              },
              seed: {
                type: 'number',
                description: '随机种子，相同种子可复现结果',
              },
            },
            required: ['prompt'],
          },
        },
        handler: async (args: GenerateImageArgs | undefined) => {
          if (!pluginApi) {
            throw new Error('插件未激活，无法访问 Provider');
          }

          const {
            prompt,
            negativePrompt,
            width = 1024,
            height = 1024,
            model,
            steps,
            seed,
          } = args || { prompt: '' };

          if (!prompt) {
            throw new Error('prompt is required');
          }

          const ttiProviders = pluginApi.channels.listProviders('tti');
          if (ttiProviders.length === 0) {
            return {
              error: '没有可用的文生图渠道，请先配置 TTI Provider',
              availableProviders: [],
            };
          }

          const provider = model
            ? ttiProviders.find((p) => p.type === model || p.name === model) || ttiProviders[0]
            : ttiProviders[0];

          try {
            const config = {
              ...provider.defaultConfig,
              prompt,
              negativePrompt,
              width,
              height,
              steps,
              seed,
            };

            const instance = provider.factory(config, {});

            let result: unknown;
            if (typeof (instance as any).generate === 'function') {
              result = await (instance as any).generate(config);
            } else if (typeof (instance as any).execute === 'function') {
              result = await (instance as any).execute(config);
            } else if (typeof instance === 'function') {
              result = await instance(config);
            } else {
              result = instance;
            }

            return {
              success: true,
              provider: provider.name,
              model: provider.type,
              result,
              params: { prompt, negativePrompt, width, height, steps, seed },
            };
          } catch (err: any) {
            return {
              error: `生图失败: ${err.message}`,
              provider: provider.name,
              params: { prompt, width, height },
            };
          }
        },
      },
      {
        definition: {
          name: 'image_to_video',
          description: '图生视频 - 根据图片和描述生成短视频',
          inputSchema: {
            type: 'object',
            properties: {
              imageUrl: {
                type: 'string',
                description: '输入图片的 URL 或 base64 编码',
              },
              prompt: {
                type: 'string',
                description: '视频描述/运动提示',
              },
              duration: {
                type: 'number',
                description: '视频时长 (秒)，默认 4',
              },
              model: {
                type: 'string',
                description: '指定生成模型/渠道名称',
              },
            },
            required: ['imageUrl'],
          },
        },
        handler: async (args: ImageToVideoArgs | undefined) => {
          if (!pluginApi) {
            throw new Error('插件未激活，无法访问 Provider');
          }

          const { imageUrl, prompt, duration = 4, model } = args || { imageUrl: '' };

          if (!imageUrl) {
            throw new Error('imageUrl is required');
          }

          const itvProviders = pluginApi.channels.listProviders('itv');
          if (itvProviders.length === 0) {
            return {
              error: '没有可用的图生视频渠道，请先配置 ITV Provider',
              availableProviders: [],
            };
          }

          const provider = model
            ? itvProviders.find((p) => p.type === model || p.name === model) || itvProviders[0]
            : itvProviders[0];

          try {
            const config = {
              ...provider.defaultConfig,
              imageUrl,
              prompt,
              duration,
            };

            const instance = provider.factory(config, {});

            let result: unknown;
            if (typeof (instance as any).generate === 'function') {
              result = await (instance as any).generate(config);
            } else if (typeof (instance as any).execute === 'function') {
              result = await (instance as any).execute(config);
            } else if (typeof instance === 'function') {
              result = await instance(config);
            } else {
              result = instance;
            }

            return {
              success: true,
              provider: provider.name,
              result,
              params: { imageUrl: '(provided)', prompt, duration },
            };
          } catch (err: any) {
            return {
              error: `图生视频失败: ${err.message}`,
              provider: provider.name,
            };
          }
        },
      },
      {
        definition: {
          name: 'list_providers',
          description: '列出所有可用的生成模型/渠道（TTI 文生图、ITV 图生视频、TTS 语音合成）',
          inputSchema: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                description: '筛选类型: tti, itv, tts, llm。留空列出全部',
              },
            },
          },
        },
        handler: async (args: ListProvidersArgs | undefined) => {
          if (!pluginApi) {
            throw new Error('插件未激活，无法访问 Provider');
          }

          const kind = args?.kind;
          const providers = kind
            ? pluginApi.channels.listProviders(kind)
            : pluginApi.channels.listProviders();

          return {
            count: providers.length,
            providers: providers.map((p) => ({
              type: p.type,
              kind: p.kind,
              name: p.name,
              description: p.description,
              capabilities: p.capabilities,
              pluginId: p.pluginId,
            })),
          };
        },
      },
    ],
  };
}
