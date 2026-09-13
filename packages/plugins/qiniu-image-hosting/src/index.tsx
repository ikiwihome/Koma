/**
 * 七牛云图床 Provider - 前端 UI + Runtime
 * 固定经由 Koma 激活通道（https://komaapi.com）上传。上传地址固定，支持独立配置 KomaAPI 图床凭据。
 */

import type { PluginAPI } from '@komastudio/plugin-sdk';

const React = (window as any).React;
const { useState, useEffect, useCallback } = React;
const {
  Card, Button, Form, Input, Switch, Space, Typography,
  Divider, Tag, Spin, Alert, Row, Col, Statistic,
} = (window as any).antd;
const Icons = (window as any)['@ant-design/icons'] || {};
const {
  CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined,
  CloudUploadOutlined, SettingOutlined, SaveOutlined, ReloadOutlined,
} = Icons;

const { Title, Text, Paragraph } = Typography;

// ========== 常量 ==========

const UPLOAD_ENDPOINT = 'https://komaapi.com/v1/uploads/images';

interface QiniuConfig {
  apiKey?: string;
  enabled: boolean;
}

const DEFAULT_CONFIG: QiniuConfig = {
  enabled: true,
};

interface UploadResponseBody {
  success?: boolean;
  message?: string;
  error?: string | { message?: string };
  msg?: string;
  url?: string;
  data?: {
    url?: string;
    filename?: string;
    key?: string;
    hash?: string;
    size?: number;
  };
}

async function parseUploadResponse(resp: Response): Promise<UploadResponseBody | null> {
  let text = '';
  try {
    text = await resp.text();
  } catch {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as UploadResponseBody;
  } catch {
    return { message: trimmed };
  }
}

function extractUploadMessage(result: UploadResponseBody | null): string {
  const candidates = [
    result?.message,
    typeof result?.error === 'string' ? result.error : result?.error?.message,
    result?.msg,
  ];
  const message = candidates.find((item) => typeof item === 'string' && item.trim());
  return typeof message === 'string' ? message.trim() : '';
}

function formatUploadError(resp: Response, result: UploadResponseBody | null): string {
  if (resp.status === 401 || resp.status === 403) {
    return `激活 Key 无效或无图床权限，请重新激活/检查套餐权限 (HTTP ${resp.status})`;
  }

  if (resp.status === 404) {
    return `上传接口不存在/端点配置错误: ${UPLOAD_ENDPOINT} (HTTP ${resp.status})`;
  }

  const message = extractUploadMessage(result);
  return message ? `${message} (HTTP ${resp.status})` : `上传失败 (HTTP ${resp.status})`;
}

// ========== UI 组件 ==========

interface QiniuProviderProps { api: PluginAPI }

type ConnStatus = 'idle' | 'testing' | 'success' | 'error';

function QiniuProvider({ api }: QiniuProviderProps) {
  const [form] = Form.useForm();
  const [config, setConfig] = useState<QiniuConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<ConnStatus>('idle');
  const [err, setErr] = useState('');
  const [hasActivation, setHasActivation] = useState<boolean | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const cfg = await api.channels.getProviderConfig('qiniu-image-hosting');
        const merged = { ...DEFAULT_CONFIG, ...(cfg || {}) } as QiniuConfig;
        setConfig(merged);
        form.setFieldsValue(merged);
        try {
          const key = merged.apiKey || await api.activation.getApiKey();
          setHasActivation(!!key);
          if (merged.enabled && key) setStatus('success');
        } catch {
          setHasActivation(false);
        }
      } catch {
        form.setFieldsValue(DEFAULT_CONFIG);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api, form]);

  const testConn = useCallback(async (cfg?: QiniuConfig) => {
    const t = cfg || config;
    if (!t.enabled) { api.ui.showMessage('warning', '请先启用图床服务'); return; }
    const key = t.apiKey || await api.activation.getApiKey();
    if (!key) {
      api.ui.showMessage('error', '未配置 Koma 图床 Key，请到设置 → 插件 → 七牛云图床（内置）填写 KomaAPI Key；Agnes Key 仅用于模型服务');
      setStatus('error');
      setErr('未检测到激活 Key');
      setHasActivation(false);
      return;
    }
    setStatus('testing');
    setErr('');
    const r = await api.channels.testProvider('image-hosting', 'qiniu-image-hosting', t);
    if (r.success) {
      setStatus('success');
      api.ui.showMessage('success', '七牛云图床连接成功');
    } else {
      setStatus('error');
      setErr(r.error || '连接失败');
    }
  }, [config, api]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.channels.updateProviderConfig('qiniu-image-hosting', values);
      const saved = await api.channels.getProviderConfig('qiniu-image-hosting');
      const next = { ...values, ...saved };
      setConfig(next);
      if (values.enabled) await testConn(next);
      else setStatus('idle');
      api.ui.showMessage('success', '配置已保存');
    } catch (e: any) {
      api.ui.showMessage('error', `保存失败: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }, [form, api, testConn]);

  const handleReset = useCallback(() => {
    form.setFieldsValue(DEFAULT_CONFIG);
    setConfig(DEFAULT_CONFIG);
    setStatus('idle');
    setErr('');
  }, [form]);

  if (loading) {
    return React.createElement('div', { style: { padding: 48, textAlign: 'center' } },
      React.createElement(Spin, { size: 'large', tip: '加载配置中...' })
    );
  }

  const StatusIcon = () => {
    if (status === 'testing') return React.createElement(LoadingOutlined, { style: { color: '#1890ff' } });
    if (status === 'success') return React.createElement(CheckCircleOutlined, { style: { color: '#52c41a' } });
    if (status === 'error') return React.createElement(CloseCircleOutlined, { style: { color: '#ff4d4f' } });
    return React.createElement(CloudUploadOutlined, { style: { color: '#999' } });
  };

  return React.createElement('div', { style: { padding: 24, maxWidth: 800 } },
    React.createElement(Title, { level: 3 },
      React.createElement(CloudUploadOutlined, { style: { marginRight: 8 } }),
      '七牛云图床（内置）'
    ),
    React.createElement(Paragraph, { type: 'secondary' },
      '默认图床。调用 Koma 激活通道 (komaapi.com) 将图片上传到七牛云 Kodo，返回带时间戳防盗链签名的 URL（默认 3 天有效期）。可单独填写 KomaAPI 图床 Key；未填写时沿用原 Koma 激活 Key。Agnes Key 仅用于模型服务。'
    ),

    React.createElement(Divider),

    React.createElement(Card, { size: 'small', style: { marginBottom: 16 } },
      React.createElement(Row, { gutter: 16 },
        React.createElement(Col, { span: 8 },
          React.createElement(Statistic, {
            title: '服务状态',
            value: status === 'success' ? '已启用' : status === 'error' ? '连接失败' : status === 'testing' ? '测试中...' : '未启用',
            prefix: React.createElement(StatusIcon),
          })
        ),
        React.createElement(Col, { span: 8 },
          React.createElement(Statistic, { title: '存储后端', value: '七牛云 Kodo' })
        ),
        React.createElement(Col, { span: 8 },
          React.createElement(Space, { direction: 'vertical', size: 0 },
            React.createElement(Text, { type: 'secondary', style: { fontSize: 12 } }, '能力'),
            React.createElement('div', { style: { marginTop: 4 } },
              React.createElement(Tag, { color: 'green' }, '图片上传'),
              React.createElement(Tag, { color: 'blue' }, '防盗链')
            )
          )
        )
      )
    ),

    hasActivation === false && React.createElement(Alert, {
      type: 'warning',
      message: '未配置 Koma 图床 Key',
      description: '请在下方填写具有图床权限的 KomaAPI Key，然后保存配置。',
      style: { marginBottom: 16 },
      showIcon: true,
    }),

    err && React.createElement(Alert, { type: 'error', message: '连接失败', description: err, style: { marginBottom: 16 }, showIcon: true }),

    React.createElement(Card, {
      title: React.createElement(Space, null, React.createElement(SettingOutlined), '服务配置'),
    },
      React.createElement(Form, { form, layout: 'vertical', initialValues: config },
        React.createElement(Form.Item, {
          name: 'enabled',
          label: '启用图床',
          valuePropName: 'checked',
          extra: '启用后，手动上传的图片资产将自动通过 komaapi.com 上传到七牛云 Kodo',
        }, React.createElement(Switch, { checkedChildren: '已启用', unCheckedChildren: '已禁用' })),

        React.createElement(Form.Item, {
          label: '上传接口',
          extra: '固定使用 Koma 官方图片上传接口（komaapi.com），无法修改',
        }, React.createElement(Text, { code: true }, UPLOAD_ENDPOINT)),

        React.createElement(Form.Item, {
          name: 'apiKey',
          label: 'KomaAPI 图床 Key',
          extra: '填写具有图床权限的 KomaAPI Key，保存时加密存储。不要填写 Agnes Key。留空沿用已保存的 Key。',
        }, React.createElement(Input.Password, { placeholder: '输入 KomaAPI Key', autoComplete: 'new-password' })),

        React.createElement(Divider),

        React.createElement(Space, null,
          React.createElement(Button, {
            type: 'primary',
            icon: SaveOutlined && React.createElement(SaveOutlined),
            onClick: handleSave,
            loading: saving,
          }, '保存配置'),
          React.createElement(Button, {
            icon: CloudUploadOutlined && React.createElement(CloudUploadOutlined),
            onClick: () => testConn(),
            loading: status === 'testing',
          }, '测试连接'),
          React.createElement(Button, {
            icon: ReloadOutlined && React.createElement(ReloadOutlined),
            onClick: handleReset,
          }, '重置为默认')
        )
      )
    ),

    React.createElement(Divider),

    React.createElement(Alert, {
      type: 'info',
      message: '使用说明',
      description: React.createElement('ul', { style: { margin: 0, paddingLeft: 20 } },
        React.createElement('li', null, '本插件为内置图床，无需单独安装'),
        React.createElement('li', null, 'API Key 即 Koma 激活 Key，上传调用由 komaapi.com 图床接口校验'),
        React.createElement('li', null, '上传失败会自动重试 3 次'),
        React.createElement('li', null, '返回的 URL 自带时间戳防盗链签名，有效期 3 天')
      ),
      showIcon: true,
    })
  );
}

// ========== Runtime ==========

class QiniuImageHostingRuntime {
  type = 'qiniu-image-hosting';
  private readonly fetcher: typeof fetch;
  private readonly config: QiniuConfig;
  private readonly api: PluginAPI | null;

  constructor(
    config: Record<string, unknown>,
    ctx: { sandboxedFetch?: typeof fetch; api?: PluginAPI }
  ) {
    this.fetcher = ctx?.sandboxedFetch || fetch;
    this.config = { ...DEFAULT_CONFIG, ...(config as any) } as QiniuConfig;
    this.api = ctx?.api || ((window as any).__KOMA_PLUGIN_API__ || null);
  }

  validate(): boolean {
    return Boolean(this.config.enabled);
  }

  private async resolveApiKey(): Promise<string | null> {
    if (this.config.apiKey?.trim()) return this.config.apiKey.trim();
    try {
      if (this.api?.activation?.getApiKey) {
        return await this.api.activation.getApiKey();
      }
      const globalApi: PluginAPI | undefined = (window as any).__KOMA_PLUGIN_API__;
      if (globalApi?.activation?.getApiKey) {
        return await globalApi.activation.getApiKey();
      }
    } catch {
      // fall through
    }
    return null;
  }

  async testConnection(): Promise<boolean> {
    if (!this.validate()) return false;
    const key = await this.resolveApiKey();
    if (!key) return false;
    try {
      const testBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const bytes = Uint8Array.from(atob(testBase64), (c) => c.charCodeAt(0));
      const r = await this.uploadImage(bytes, { filename: 'koma-qiniu-test.png' });
      return Boolean(r?.success);
    } catch { return false; }
  }

  async uploadImage(
    bytes: ArrayBuffer | Uint8Array,
    options?: { filename?: string; mimeType?: string }
  ): Promise<{ success: boolean; url?: string; error?: string; data?: any }> {
    if (!this.validate()) return { success: false, error: '图床未启用' };

    const apiKey = await this.resolveApiKey();
    if (!apiKey) return { success: false, error: '未配置 Koma 图床 Key，请到设置 → 插件 → 七牛云图床（内置）填写 KomaAPI Key；Agnes Key 仅用于模型服务' };

    try {
      const filename = options?.filename || `image_${Date.now()}.png`;
      const mimeType = options?.mimeType || this.guessMime(filename);
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const blob = new Blob([u8], { type: mimeType });

      const formData = new FormData();
      formData.append('file', blob, filename);

      const resp = await this.fetcher(UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      const result = await parseUploadResponse(resp);
      const uploadedUrl = result?.data?.url || result?.url;
      if (result?.success && uploadedUrl) {
        return { success: true, url: uploadedUrl, data: result.data || { url: uploadedUrl } };
      }
      return { success: false, error: formatUploadError(resp, result) };
    } catch (err: any) {
      return { success: false, error: err?.message || '网络请求失败' };
    }
  }

  private guessMime(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', heic: 'image/heic', ico: 'image/x-icon',
    };
    return map[ext] || 'image/png';
  }
}

async function onActivate(api: PluginAPI) {
  console.log('[Qiniu] 前端 UI 已加载');
  try {
    // 让 runtime 能从全局兜底读到 api.activation
    (window as any).__KOMA_PLUGIN_API__ = api;
    await api.channels.registerProvider({
      type: 'qiniu-image-hosting',
      kind: 'image-hosting' as any,
      name: '七牛云图床（内置）',
      description: '使用激活 Key 调用 Koma 官方上传接口（komaapi.com），返回七牛云 Kodo 外链并支持时间戳防盗链',
      capabilities: ['image-hosting'] as any[],
      defaultConfig: DEFAULT_CONFIG,
      factory: (config: any, ctx: any) => new QiniuImageHostingRuntime(config, { ...ctx, api }),
    });
    console.log('[Qiniu] Provider 注册成功');
  } catch (err) {
    console.warn('[Qiniu] Provider 注册跳过:', err);
  }
}

function onDeactivate() {
  console.log('[Qiniu] 前端 UI 已卸载');
}

export default QiniuProvider;
export { onActivate, onDeactivate };

(window as any).__KOMA_PLUGIN_com_koma_qiniu_image_hosting__ = {
  default: QiniuProvider,
  onActivate,
  onDeactivate,
};
