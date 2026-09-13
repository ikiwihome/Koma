# @koma/plugin-sdk

Koma 插件开发 SDK，提供类型定义和全局变量声明。

## 安装

```bash
npm install @koma/plugin-sdk
```

## 使用

```typescript
import type {
  PluginAPI,
  PluginManifest,
  ProviderDefinition,
  TTIProvider,
  ITVProvider,
} from '@koma/plugin-sdk';
import { MEDIA_PROVIDER_CONTRACT_VERSION } from '@koma/plugin-sdk';

// 使用全局变量（类型安全）
const React = window.React;
const { Button, Form } = window.antd;
const { SaveOutlined } = window['@ant-design/icons'];
```

## 类型导出

### 插件 API
- `PluginAPI` - 插件 API 接口
- `PluginManifest` - 插件清单
- `PluginExports` - 插件导出接口
- `InstalledPlugin` - 已安装插件

### Provider
- `ProviderDefinition` - Provider 定义
- `ProviderContext` - Provider 上下文
- `ChannelKind` - 渠道类型 ('tti' | 'itv' | 'tts')
- `PollingConfig` - 轮询配置
- `MEDIA_PROVIDER_CONTRACT_VERSION` - 媒体 Provider 契约版本常量（注册时用于 `contractVersion` 校验）

媒体 Provider (`tti` / `itv` / `tts`) 注册时建议显式声明契约版本：

```typescript
const providerDef: ProviderDefinition = {
  type: 'my-provider',
  kind: 'tti',
  name: 'My Provider',
  contractVersion: MEDIA_PROVIDER_CONTRACT_VERSION,
  factory: (config, ctx) => new MyProvider(config, ctx),
  capabilities: ['tti'],
};
```

### TTI Provider
- `TTIProvider` - 文生图 Provider 接口
- `TTIOptions` - 生成选项
- `ImageResult` - 图像结果

### ITV Provider
- `ITVProvider` - 图生视频 Provider 接口
- `ITVOptions` - 生成选项
- `VideoResult` - 视频结果
- `ProgressInfo` - 进度信息

## 全局变量

SDK 声明了以下全局变量（由宿主应用注入）：

```typescript
window.React        // React 库
window.antd         // Ant Design 组件库
window['@ant-design/icons']  // Ant Design 图标库
```

## 配置持久化

使用 `channels.getProviderConfig` / `channels.updateProviderConfig` 管理配置。
宿主会把 Provider 配置统一持久化到全局 `settings.db` 的 `channel_configs` 表；
其中 `apiKey` 会在主进程加密后存储，并在 Electron backend 插件侧按需解密回填：

```typescript
// 读取配置
const config = await api.channels.getProviderConfig('my-provider');

// 保存配置
await api.channels.updateProviderConfig('my-provider', newConfig);
```

## License

MIT
