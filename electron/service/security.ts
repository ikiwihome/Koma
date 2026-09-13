import { app, session } from 'electron';

let registered = false;

/** 已知的 API 域名白名单（connect-src） */
const ALLOWED_CONNECT_DOMAINS = [
  'https://api.openai.com',
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com',
  'https://api.siliconflow.cn',
  'https://dashscope.aliyuncs.com',
  'https://api.deepseek.com',
  'https://open.bigmodel.cn',
  'https://api.minimax.chat',
  'https://api.moonshot.cn',
  'https://api.coze.com',
  'https://ark.cn-beijing.volces.com',
  'https://aip.baidubce.com',
  'https://api.stability.ai',
  'https://api.replicate.com',
  'https://api.luma.ai',
  'https://api.kling.ai',
  'https://api.pika.art',
  'https://*.huggingface.co',
  'https://api-inference.huggingface.co',
  'wss://localhost:*',
  'ws://localhost:*',
  'https://localhost:*',
  'http://localhost:*',
  'http://127.0.0.1:*',
  'https://127.0.0.1:*',
];

export function registerSecurityHeaders(): void {
  if (registered) return;
  registered = true;

  const isDev = process.env.NODE_ENV === 'development' || !app?.isPackaged;

  // dev 模式需要 'unsafe-eval' 用于 Vite HMR / source maps
  // Vite 注入的内联脚本需要 'unsafe-inline'
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' koma-local:"
    : "script-src 'self' 'unsafe-inline' koma-local:";

  const connectSrc = `connect-src 'self' ${ALLOWED_CONNECT_DOMAINS.join(' ')}`;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self' koma-local:",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: koma-local: https: http:",
      "media-src 'self' blob: koma-local: https: http:",
      connectSrc,
    ].join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}
