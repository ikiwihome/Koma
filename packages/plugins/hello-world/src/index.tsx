/**
 * Hello World 插件
 * 展示 Koma 插件 API 的基本用法
 */

import type { PluginAPI } from '@komastudio/plugin-sdk';

const { useState, useEffect } = window.React;
const { Card, Button, Typography, Space, Statistic, Divider, Tag } = window.antd;
const { Title, Text, Paragraph } = Typography;

interface HelloWorldProps {
  api: PluginAPI;
}

function HelloWorld({ api }: HelloWorldProps) {
  const [hostInfo, setHostInfo] = useState<any>(null);
  const [sdkVersion, setSdkVersion] = useState('');
  const [clickCount, setClickCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    async function init() {
      try {
        const info = await api.core.getHostInfo();
        setHostInfo(info);

        const version = await api.core.getVersion();
        setSdkVersion(version);

        // 尝试读取保存的计数
        try {
          const files = await api.storage.listFiles('/');
          if (files.includes('count.txt')) {
            const data = await api.storage.readFile('/count.txt');
            const text = new TextDecoder().decode(data);
            const count = parseInt(text, 10);
            if (!isNaN(count)) {
              setClickCount(count);
              setSavedCount(count);
            }
          }
        } catch (e) {
          // 首次运行，无保存数据
        }
      } catch (err) {
        console.error('初始化失败:', err);
      }
    }
    init();
  }, [api]);

  const handleClick = () => {
    setClickCount(prev => prev + 1);
    api.ui.showMessage('success', `点击次数: ${clickCount + 1}`);
  };

  const handleSave = async () => {
    try {
      const data = new TextEncoder().encode(String(clickCount));
      await api.storage.writeFile('/count.txt', data.buffer);
      setSavedCount(clickCount);
      api.ui.showMessage('success', '已保存到插件存储');
    } catch (err: any) {
      api.ui.showMessage('error', `保存失败: ${err.message}`);
    }
  };

  const handleShowModal = async () => {
    const confirmed = await api.ui.showModal({
      title: '确认操作',
      content: '这是一个由插件触发的确认弹窗。点击确定或取消。',
    });
    api.ui.showMessage('info', confirmed ? '你点击了确定' : '你点击了取消');
  };

  return window.React.createElement('div', { style: { padding: 24, maxWidth: 800 } },
    window.React.createElement(Title, { level: 3 }, '👋 Hello World Plugin'),
    window.React.createElement(Paragraph, { type: 'secondary' },
      '这是一个示例插件，展示了 Koma 插件系统的基本能力。'
    ),

    window.React.createElement(Divider, null),

    window.React.createElement(Card, { title: '主机信息', style: { marginBottom: 16 } },
      hostInfo ? window.React.createElement(Space, { size: 'large' },
        window.React.createElement(Statistic, { title: '应用版本', value: hostInfo.appVersion }),
        window.React.createElement(Statistic, { title: '平台', value: hostInfo.platform }),
        window.React.createElement(Statistic, { title: 'Electron', value: hostInfo.electronVersion }),
        window.React.createElement(Statistic, { title: 'SDK 版本', value: sdkVersion })
      ) : window.React.createElement(Text, { type: 'secondary' }, '加载中...')
    ),

    window.React.createElement(Card, { title: '交互示例', style: { marginBottom: 16 } },
      window.React.createElement(Space, { direction: 'vertical', style: { width: '100%' } },
        window.React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          window.React.createElement(Text, null, '点击计数:'),
          window.React.createElement(Tag, { color: 'blue', style: { fontSize: 16 } }, clickCount),
          savedCount !== clickCount && window.React.createElement(Tag, { color: 'orange' }, '未保存')
        ),
        window.React.createElement(Space, null,
          window.React.createElement(Button, { type: 'primary', onClick: handleClick }, '点击 +1'),
          window.React.createElement(Button, { onClick: handleSave, disabled: savedCount === clickCount }, '保存到存储'),
          window.React.createElement(Button, { onClick: handleShowModal }, '显示弹窗')
        )
      )
    ),

    window.React.createElement(Card, { title: '本插件申请的权限', size: 'small' },
      window.React.createElement(Space, null,
        window.React.createElement(Tag, { color: 'green' }, 'settings:read'),
        window.React.createElement(Tag, { color: 'green' }, 'storage:limited')
      ),
      window.React.createElement(Paragraph, { type: 'secondary', style: { marginTop: 8, marginBottom: 0 } },
        '• settings:read - 读取应用设置（只读）',
        window.React.createElement('br', null),
        '• storage:limited - 访问插件专属沙箱存储'
      )
    )
  );
}

function onActivate(api: PluginAPI) {
  console.log('[HelloWorld] 插件已激活');
  api.ui.showMessage('info', 'Hello World 插件已加载');
}

function onDeactivate() {
  console.log('[HelloWorld] 插件已停用');
}

export default HelloWorld;
export { onActivate, onDeactivate };

(window as any).__KOMA_PLUGIN_com_koma_hello_world__ = {
  default: HelloWorld,
  onActivate,
  onDeactivate,
};
