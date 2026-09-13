import React from 'react';
import ReactDOM from 'react-dom/client';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './index.scss';
import './i18n'; // i18n 初始化
import { ThemeProvider } from './theme/runtime/ThemeProvider';
import { initializeProviderPlugins } from './services/plugin/PluginInitializer';
import { createLogger } from './store/logger';

const logger = createLogger('Startup');

// 应用启动时初始化
async function bootstrap() {
  // 初始化所有已启用的插件（注册 Provider 和渠道配置）
  // 注：原本这里有 cleanupDuplicateChannels()，按 (providerType, pluginId) 去重；
  //   v2 SQLite 之后渠道以 id 作为身份、同 providerType 多渠道（多套 OpenAI 兼容端点）
  //   是合法用法，那个去重会把用户新增的同 providerType 渠道误删。已下线。
  try {
    const result = await initializeProviderPlugins();
    if (result.total > 0) {
      if (result.failed.length > 0) {
        logger.warn('初始化失败的插件', result.failed);
      }
    }
  } catch (err) {
    logger.warn('插件初始化失败', err);
  }
}

// 执行启动初始化
bootstrap();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ThemeProvider locale={zhCN}>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
