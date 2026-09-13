# Koma 插件开发指南

> 版本: 1.0.0 | SDK: 1.0.0

## 快速开始

### 1. 创建插件目录结构

```
my-plugin/
├── manifest.json          # 必须：插件元数据
├── package.json           # 可选：NPM 包配置
├── dist/
│   └── ui/
│       └── main.js        # 前端入口 (global 插件)
├── src/                   # 源代码目录
│   └── index.tsx
└── README.md
```

### 2. 配置 manifest.json

```json
{
  "id": "com.yourname.plugin-name",
  "name": "插件显示名称",
  "version": "1.0.0",
  "description": "插件描述",
  "author": {
    "name": "作者名",
    "url": "https://example.com"
  },

  "category": "global",
  "engine": {
    "minAppVersion": "2.5.0",
    "sdkVersion": "1.0.0"
  },

  "scopes": [
    "settings:read",
    "storage:limited"
  ],

  "entry": {
    "frontend": "./dist/ui/main.js"
  },

  "globalMeta": {
    "entryRoute": "/plugins/com.yourname.plugin-name",
    "navigation": {
      "icon": "SmileOutlined",
      "label": "插件名称",
      "order": 100
    }
  }
}
```

### 3. 编写插件代码

```typescript
// src/index.tsx
const React = window.React;
const { useState } = React;
const { Button, Card } = window.antd;

function MyPlugin({ api }) {
  const [count, setCount] = useState(0);

  return (
    <Card title="我的插件">
      <p>计数: {count}</p>
      <Button onClick={() => setCount(c => c + 1)}>+1</Button>
    </Card>
  );
}

// 生命周期钩子
function onActivate(api) {
  console.log('插件已激活');
}

function onDeactivate() {
  console.log('插件已停用');
}

// 必须导出到全局变量
window.__KOMA_PLUGIN_com_yourname_plugin_name__ = {
  default: MyPlugin,
  onActivate,
  onDeactivate,
};
```

### 4. 构建插件

```bash
# 使用 esbuild 构建
npx esbuild src/index.tsx \
  --bundle \
  --format=iife \
  --global-name=__KOMA_PLUGIN_com_yourname_plugin_name__ \
  --outfile=dist/ui/main.js \
  --external:react \
  --external:antd
```

### 5. 安装插件

在 Koma 应用中：
1. 打开「设置 → 插件管理」
2. 将插件文件夹拖拽到导入区域
3. 确认权限请求
4. 插件将出现在左侧菜单

---

## 插件类型

| 类型 | 说明 | 入口 | UI 位置 |
|------|------|------|---------|
| `global` | 全局功能插件 | frontend | 左侧主菜单 |
| `provider` | 服务提供者 | backend | 设置页配置 |
| `tool` | 后台工具 | backend | 工具菜单 |

---

## 权限系统 (Scopes)

| Scope | 说明 | 风险级别 |
|-------|------|----------|
| `settings:read` | 读取全局设置 | 🟢 安全 |
| `settings:write` | 修改全局设置 | 🟡 警告 |
| `projects:read` | 读取项目数据 | 🟢 安全 |
| `projects:write` | 修改项目数据 | 🟡 警告 |
| `prompts:override` | 覆盖提示词模板 | 🟡 警告 |
| `storage:limited` | 访问插件沙箱存储 | 🟢 安全 |
| `network:external` | 访问外部网络 | 🔴 危险 |

**安全原则**：
- 只申请必要的权限
- 敏感权限会在安装时二次确认
- 沙箱存储仅限插件专属目录

---

## Plugin API 参考

### core - 核心功能

```typescript
// 获取 SDK 版本
const version = await api.core.getVersion();

// 获取主机信息
const info = await api.core.getHostInfo();
// { appVersion: "2.5.0", platform: "win32", electronVersion: "28.0.0" }

// 监听事件
api.core.on('settingsChanged', (data) => { ... });
api.core.off('settingsChanged', handler);
```

### settings - 设置访问

```typescript
// 读取设置 (需要 settings:read)
const settings = await api.settings.get(['theme', 'language']);

// 修改设置 (需要 settings:write)
await api.settings.set({ theme: 'dark' });
```

### projects - 项目访问

```typescript
// 列出项目 (需要 projects:read)
const projects = await api.projects.list({ status: 'active' });

// 获取项目详情
const project = await api.projects.get('project-id');

// 更新项目 (需要 projects:write)
await api.projects.update('project-id', { name: '新名称' });
```

### prompts - 提示词系统

```typescript
// 获取模板
const template = await api.prompts.getTemplate('shot_analysis');

// 列出所有模板
const templates = await api.prompts.listTemplates();

// 覆盖模板 (需要 prompts:override)
await api.prompts.override({
  templateId: 'shot_analysis',
  newTemplate: '新的模板内容 {{variable}}',
  priority: 10,
});
```

### storage - 沙箱存储

```typescript
// 读取文件 (需要 storage:limited)
const data = await api.storage.readFile('/config.json');
const text = new TextDecoder().decode(data);

// 写入文件
const content = new TextEncoder().encode(JSON.stringify(config));
await api.storage.writeFile('/config.json', content.buffer);

// 列出目录
const files = await api.storage.listFiles('/');

// 删除文件
await api.storage.deleteFile('/temp.txt');

// 打开文件选择对话框
const paths = await api.storage.openDialog({
  title: '选择文件',
  filters: [{ name: 'JSON', extensions: ['json'] }],
});
```

### ui - UI 交互

```typescript
// 显示消息
api.ui.showMessage('success', '操作成功');
api.ui.showMessage('error', '操作失败');
api.ui.showMessage('info', '提示信息');
api.ui.showMessage('warning', '警告信息');

// 显示确认弹窗
const confirmed = await api.ui.showModal({
  title: '确认删除',
  content: '确定要删除吗？',
  okText: '删除',
  cancelText: '取消',
});

// 注册菜单项
api.ui.registerMenuItem({
  key: 'my-action',
  label: '我的操作',
  icon: 'ToolOutlined',
  onClick: () => { ... },
});

// 移除菜单项
api.ui.removeMenuItem('my-action');
```

### channels - 渠道管理 (Provider 插件)

```typescript
// 注册渠道
await api.channels.register({
  id: 'my-tti-channel',
  type: 'tti',
  name: '我的图像生成服务',
  config: { apiKey: '...', endpoint: '...' },
});

// 测试渠道
const result = await api.channels.test('my-tti-channel');

// 调用渠道
const response = await api.channels.invoke('my-tti-channel', 'generate', {
  prompt: '...',
});
```

---

## 生命周期钩子

```typescript
// 插件激活时调用
export function onActivate(api: PluginAPI) {
  // 初始化资源、注册事件监听等
}

// 插件停用时调用
export function onDeactivate() {
  // 清理资源、移除事件监听等
}
```

---

## 最佳实践

### 1. 使用 Host 提供的库

```typescript
// ✅ 正确：从 window 获取
const React = window.React;
const antd = window.antd;

// ❌ 错误：自行导入（会导致包体积增大和版本冲突）
import React from 'react';
import antd from 'antd';
```

### 2. 全局变量命名规范

```typescript
// 变量名格式: __KOMA_PLUGIN_<id>__
// 将插件 ID 中的非字母数字字符替换为下划线

// 插件 ID: com.example.my-plugin
// 全局变量: __KOMA_PLUGIN_com_example_my_plugin__
```

### 3. 错误处理

```typescript
try {
  const data = await api.storage.readFile('/config.json');
} catch (error) {
  if (error.message.includes('权限')) {
    api.ui.showMessage('error', '缺少必要权限');
  } else {
    api.ui.showMessage('error', `读取失败: ${error.message}`);
  }
}
```

### 4. 性能优化

- 使用 `React.memo` 避免不必要的重渲染
- 大数据处理使用 Web Worker
- 合理使用 `useEffect` 依赖项

---

## 示例插件

查看 `examples/plugins/hello-world/` 获取完整示例代码。

---

## 常见问题

### Q: 插件加载失败？

1. 检查 `manifest.json` 格式是否正确
2. 确认全局变量名与插件 ID 对应
3. 查看浏览器控制台错误信息

### Q: API 调用报权限错误？

检查 `manifest.json` 中的 `scopes` 是否包含所需权限。

### Q: 如何调试插件？

1. 使用 `console.log` 输出调试信息
2. 在 Electron DevTools 中查看
3. 使用 `api.ui.showMessage` 显示状态

---

## 更新日志

### v1.0.0
- 初始版本
- 支持 global、provider、tool 三种插件类型
- 完整的 Plugin API
