# Hello World 插件

这是 Koma 插件系统的示例插件，展示了基本的插件开发模式。

## 功能

- 显示主机信息（应用版本、平台、Electron 版本）
- 点击计数器
- 将数据保存到沙箱存储
- 显示确认弹窗

## 权限

- `settings:read` - 读取应用设置
- `storage:limited` - 访问插件专属存储

## 安装方式

1. 将此文件夹拖拽到 Koma 的「设置 → 插件管理」页面
2. 确认权限请求
3. 在左侧菜单中找到「Hello World」

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build
```

## 文件结构

```
hello-world/
├── manifest.json    # 插件清单
├── package.json     # NPM 配置
├── src/
│   └── index.tsx    # 源代码
└── dist/
    └── ui/
        └── main.js  # 编译后的 bundle
```

## 学习要点

1. **Runtime Injection**: 插件从 `window.React` 和 `window.antd` 获取依赖
2. **全局导出**: 使用 `window.__KOMA_PLUGIN_xxx__` 导出组件
3. **Plugin API**: 通过 `api` prop 访问系统功能
4. **生命周期**: `onActivate` 和 `onDeactivate` 钩子
