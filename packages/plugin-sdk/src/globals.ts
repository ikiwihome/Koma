/**
 * 全局变量声明
 * 插件运行时可用的全局对象
 */

import type * as React from 'react';
import type * as antd from 'antd';
import type * as AntdIcons from '@ant-design/icons';

declare global {
  interface Window {
    /** React 库 - 由宿主应用注入 */
    React: typeof React;
    /** Ant Design 组件库 - 由宿主应用注入 */
    antd: typeof antd;
    /** Ant Design 图标库 - 由宿主应用注入 */
    '@ant-design/icons': typeof AntdIcons;
  }
}

// 便捷访问器（类型安全）
export const KomaGlobals = {
  get React(): typeof React {
    return window.React;
  },
  get antd(): typeof antd {
    return window.antd;
  },
  get AntdIcons(): typeof AntdIcons {
    return window['@ant-design/icons'];
  },
};
