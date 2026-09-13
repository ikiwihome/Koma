# 七牛云图床插件（内置）

Koma Studio 内置图床插件，使用 Koma 激活 Key 调用 Koma 激活通道图片上传接口 (`https://komaapi.com/v1/uploads/images`) 将图片上传到七牛云 Kodo，返回带时间戳防盗链签名的外链 URL。

## 特性

- ✅ **内置**：无需用户手动安装，首次启动自动激活
- ✅ **自动复用激活 Key**：通过 `api.activation.getApiKey()` 动态获取，不再硬编码
- ✅ **使用 Koma 激活通道**：上传地址由插件内部锁定为 `komaapi.com` 官方图片上传接口，用户无法修改
- ✅ **返回七牛 Kodo 外链**：上传成功后返回可直接访问的图片 URL
- ✅ **时间戳防盗链**：默认 3 天有效期
- ✅ **自动重试**：上传失败最多重试 3 次

## 配置项

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 是否启用 |

> 上传接口固定为 Koma 激活通道（komaapi.com）的官方图片上传接口，API Key 由宿主注入，不暴露在配置里。

## 目录结构

```
qiniu-image-hosting/
├── manifest.json          # 插件元信息
├── package.json           # 构建配置
├── src/
│   ├── backend.ts         # Electron 后端（Provider 注册 + 上传逻辑）
│   └── index.tsx          # 前端 UI（配置面板）+ Runtime
├── dist/
│   ├── backend.js         # 构建产物（esbuild CJS）
│   └── ui/main.js         # 构建产物（esbuild IIFE）
└── README.md
```

## 构建

```bash
cd packages/plugins/qiniu-image-hosting
npm run build
```

## 内置加载机制

`electron/service/plugin.ts` 的 `PluginService.init()` 在启动时会把本插件从 `packages/plugins/qiniu-image-hosting` 同步到用户数据目录 `plugins-runtime/com.koma.qiniu-image-hosting`，随后由前端 `PluginInitializer` 自动加载并激活。

插件配置保存在 SQLite 的 `channel_configs` 表，激活 Key 保存在 SQLite 的 `app_settings_kv` 表（key = `koma-activation`），二者互不混用。
