import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../store/pluginStore', () => ({ usePluginStore: { getState: vi.fn() } }));
vi.mock('./PluginInitializer', () => ({ clearPluginInitialized: vi.fn() }));
import { loadUMDModule } from './PluginLoader';

describe('CSP-compatible plugin script loading', () => {
  beforeEach(() => {
    Object.assign(window, { React: {}, antd: {}, '@ant-design/icons': {} });
  });
  it('loads Windows paths through an external koma-local script and returns the export', async () => {
    const result = loadUMDModule('C:\\Users\\tester\\plugins-runtime\\test plugin\\./main.js', 'com.test.hosting');
    await vi.waitFor(() => expect(document.querySelector('script[src^="koma-local:"]')).not.toBeNull());
    const script = document.querySelector('script[src^="koma-local:"]') as HTMLScriptElement;
    expect(script.src).toContain('test%20plugin/main.js');
    expect(script.textContent).toBe('');
    const exported = { default: () => null };
    (window as any).__KOMA_PLUGIN_com_test_hosting__ = exported;
    script.dispatchEvent(new Event('load'));
    expect(await result).toBe(exported);
    expect(script.isConnected).toBe(false);
  });
  it('reports failed script loads and cleans up the script tag', async () => {
    const result = loadUMDModule('C:/plugins/missing.js', 'com.test.missing');
    const rejection = expect(result).rejects.toThrow('加载插件脚本失败');
    await vi.waitFor(() => expect(document.querySelector('script[src^="koma-local:"]')).not.toBeNull());
    const script = document.querySelector('script[src^="koma-local:"]')!;
    script.dispatchEvent(new Event('error'));
    await rejection;
    expect(script.isConnected).toBe(false);
  });
});
