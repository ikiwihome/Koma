/**
 * 插件页面容器
 * 用于渲染 global 类型插件的 UI
 */
import React, { useEffect, useState } from 'react';
import { Spin, Result, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { PluginAPI } from '../../types/plugin';
import { loadPluginComponent, unloadPlugin } from '../../services/plugin/PluginLoader';
import { createPluginAPI } from '../../services/plugin/PluginAPI';
import { isPluginInitialized } from '../../services/plugin/PluginInitializer';
import { usePluginStore, usePluginRuntimeState } from '../../store/pluginStore';
import { createLogger } from '../../store/logger';

const logger = createLogger('PluginHost');

interface PluginHostProps {
  pluginId: string;
}

// 错误边界
class PluginErrorBoundary extends React.Component<
  { children: React.ReactNode; pluginId: string; onError: (error: Error) => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error(`插件 ${this.props.pluginId} 渲染错误:`, { error, errorInfo });
    this.props.onError(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="插件渲染错误"
          subTitle={this.state.error?.message}
          extra={
            <Button
              icon={<ReloadOutlined />}
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              重试
            </Button>
          }
        />
      );
    }

    return this.props.children;
  }
}

export const PluginHost: React.FC<PluginHostProps> = ({ pluginId }) => {
  const plugin = usePluginStore(state => state.getPlugin(pluginId));
  const runtimeState = usePluginRuntimeState(pluginId);
  const setRuntimeState = usePluginStore(state => state.setRuntimeState);

  const [Component, setComponent] = useState<React.ComponentType<{ api: PluginAPI }> | null>(null);
  const [api, setApi] = useState<PluginAPI | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plugin) {
      setError('插件不存在');
      return;
    }

    if (!plugin.isEnabled) {
      setError('插件已禁用');
      return;
    }

    if (plugin.category !== 'global') {
      setError('该插件不是全局插件');
      return;
    }

    let mounted = true;

    const loadPlugin = async () => {
      try {
        const exports = await loadPluginComponent(plugin);

        if (!mounted) return;

        if (!exports || !exports.default) {
          setError('插件未导出有效组件');
          return;
        }

        // 创建 API 实例
        const pluginApi = createPluginAPI(plugin);
        setApi(pluginApi);

        // 调用 onActivate（如果尚未初始化）
        if (exports.onActivate && !isPluginInitialized(pluginId)) {
          await exports.onActivate(pluginApi);
        }

        setComponent(() => exports.default);
        setError(null);
      } catch (err: any) {
        if (!mounted) return;
        setError(err.message);
        setRuntimeState(pluginId, { status: 'error', error: err.message });
      }
    };

    loadPlugin();

    return () => {
      mounted = false;
    };
  }, [plugin, pluginId, setRuntimeState]);

  // 加载中
  if (runtimeState?.status === 'loading' || (!Component && !error)) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin size="large" description="加载插件中..." />
      </div>
    );
  }

  // 错误状态
  if (error || runtimeState?.status === 'error') {
    return (
      <Result
        status="error"
        title="插件加载失败"
        subTitle={error || runtimeState?.error}
        extra={
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={() => {
              setError(null);
              setComponent(null);
              unloadPlugin(pluginId);
            }}
          >
            重新加载
          </Button>
        }
      />
    );
  }

  // 渲染插件
  if (Component && api) {
    return (
      <div className="plugin-host h-full overflow-auto">
        <PluginErrorBoundary
          pluginId={pluginId}
          onError={(err) => setRuntimeState(pluginId, { status: 'error', error: err.message })}
        >
          <Component api={api} />
        </PluginErrorBoundary>
      </div>
    );
  }

  return null;
};

export default PluginHost;
