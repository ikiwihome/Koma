/**
 * MCP 服务器配置管理器
 * 用于在设置页面管理 MCP 服务器连接
 */
import React, { useState, useEffect, useCallback } from 'react';
import { createLogger } from '../../store/logger';

const logger = createLogger('MCPConfigManager');
import {
  Card,
  Row,
  Col,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Empty,
  Popconfirm,
  Spin,
  App,
  Typography,
  Statistic,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ApiOutlined,
  ToolOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { MCPServerConfig, MCPConnection } from '../../types/mcp';
import { mcpService } from '../../services/mcpService';

const { Text, Paragraph } = Typography;

interface MCPConfigManagerProps {
  onConfigChange?: () => void;
}

type TransportType = 'stdio' | 'sse' | 'websocket';

interface FormData {
  name: string;
  transport: TransportType;
  command?: string;
  args?: string;
  url?: string;
  env?: string;
}

export const MCPConfigManager: React.FC<MCPConfigManagerProps> = ({ onConfigChange }) => {
  const { message } = App.useApp();
  const [connections, setConnections] = useState<MCPConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<MCPServerConfig | null>(null);
  const [connectingName, setConnectingName] = useState<string | null>(null);
  const [form] = Form.useForm<FormData>();

  // 加载连接列表
  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const conns = await mcpService.getConnections(true);
      setConnections(conns);
    } catch (err) {
      logger.error('Failed to load MCP connections:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  // 打开新建/编辑模态框
  const openModal = (config?: MCPServerConfig) => {
    if (config) {
      setEditingConfig(config);
      form.setFieldsValue({
        name: config.name,
        transport: config.transport as TransportType,
        command: config.command,
        args: config.args?.join(' '),
        url: config.url,
        env: config.env ? JSON.stringify(config.env, null, 2) : '',
      });
    } else {
      setEditingConfig(null);
      form.resetFields();
      form.setFieldsValue({ transport: 'stdio' });
    }
    setModalVisible(true);
  };

  // 保存配置并连接
  const handleSave = async () => {
    try {
      const values = await form.validateFields();

      const config: MCPServerConfig = {
        id: editingConfig?.id || `mcp-${Date.now()}`,
        name: values.name,
        transport: values.transport,
        command: values.transport === 'stdio' ? values.command : undefined,
        args: values.transport === 'stdio' && values.args
          ? values.args.split(/\s+/).filter(Boolean)
          : undefined,
        url: values.transport !== 'stdio' ? values.url : undefined,
        env: values.env ? JSON.parse(values.env) : undefined,
      };

      setConnectingName(config.name);
      await mcpService.connect(config);

      message.success(editingConfig ? '配置已更新并重新连接' : '服务器已添加并连接');
      setModalVisible(false);
      loadConnections();
      onConfigChange?.();
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        message.error('环境变量 JSON 格式错误');
      } else {
        message.error(`连接失败: ${err.message}`);
      }
    } finally {
      setConnectingName(null);
    }
  };

  // 断开连接
  const handleDisconnect = async (name: string) => {
    try {
      await mcpService.disconnect(name);
      message.success('已断开连接');
      loadConnections();
      onConfigChange?.();
    } catch (err: any) {
      message.error(`断开失败: ${err.message}`);
    }
  };

  // 重新连接
  const handleReconnect = async (conn: MCPConnection) => {
    const config: MCPServerConfig = {
      id: conn.name,
      name: conn.name,
      transport: conn.transport,
    };
    setConnectingName(conn.name);
    try {
      await mcpService.connect(config);
      message.success('重新连接成功');
      loadConnections();
    } catch (err: any) {
      message.error(`连接失败: ${err.message}`);
    } finally {
      setConnectingName(null);
    }
  };

  // 获取状态图标
  const getStatusIcon = (status: MCPConnection['status'], name: string) => {
    if (connectingName === name) {
      return <LoadingOutlined spin className="settings-status-info" />;
    }
    switch (status) {
      case 'connected':
        return <CheckCircleOutlined className="settings-status-success" />;
      case 'connecting':
        return <LoadingOutlined spin className="settings-status-info" />;
      case 'error':
        return <CloseCircleOutlined className="settings-status-error" />;
      default:
        return <CloseCircleOutlined className="settings-status-muted" />;
    }
  };

  // 获取状态文本
  const getStatusText = (status: MCPConnection['status']) => {
    switch (status) {
      case 'connected': return '已连接';
      case 'connecting': return '连接中';
      case 'error': return '连接失败';
      default: return '未连接';
    }
  };

  if (loading) {
    return (
      <div className="settings-loading-state is-large">
        <Spin size="large" description="加载 MCP 服务器..." />
      </div>
    );
  }

  return (
    <div className="settings-manager">
      <div className="settings-manager-toolbar">
        <div>
          <Typography.Title level={5} className="settings-title-row">
            <ApiOutlined className="settings-title-icon" />
            MCP 服务器
          </Typography.Title>
          <Text type="secondary">管理 Model Context Protocol 服务器连接</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadConnections}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
            添加服务器
          </Button>
        </Space>
      </div>

      {connections.length === 0 ? (
        <Empty
          description="暂无 MCP 服务器"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="settings-empty-state"
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
            添加第一个服务器
          </Button>
        </Empty>
      ) : (
        <Row gutter={[12, 12]}>
          {connections.map(conn => (
            <Col key={conn.name} xs={24} md={12} xl={8}>
              <Card
                size="small"
                className="settings-config-card"
                title={
                  <Space>
                    {getStatusIcon(conn.status, conn.name)}
                    <span>{conn.name}</span>
                  </Space>
                }
                extra={
                  <Tag color={
                    conn.transport === 'stdio' ? 'blue' :
                    conn.transport === 'sse' ? 'green' : 'purple'
                  }>
                    {conn.transport.toUpperCase()}
                  </Tag>
                }
                actions={[
                  conn.status === 'connected' ? (
                    <Popconfirm
                      key="disconnect"
                      title="确定断开连接？"
                      onConfirm={() => handleDisconnect(conn.name)}
                    >
                      <Button type="text" size="small" danger>
                        断开
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button
                      key="reconnect"
                      type="text"
                      size="small"
                      onClick={() => handleReconnect(conn)}
                      loading={connectingName === conn.name}
                    >
                      连接
                    </Button>
                  ),
                  <Button
                    key="edit"
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openModal({ id: conn.name, name: conn.name, transport: conn.transport })}
                  />,
                  <Popconfirm
                    key="delete"
                    title="确定删除此服务器？"
                    onConfirm={() => handleDisconnect(conn.name)}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <Row gutter={12}>
                  <Col span={12}>
                    <Statistic
                      title="工具"
                      value={conn.tools?.length || 0}
                      prefix={<ToolOutlined />}
                      className="settings-stat-value-lg"
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="状态"
                      value={getStatusText(conn.status)}
                      className={
                        conn.status === 'connected'
                          ? 'settings-stat-status-connected'
                          : conn.status === 'error'
                            ? 'settings-stat-status-error'
                            : 'settings-stat-status-muted'
                      }
                    />
                  </Col>
                </Row>
                {conn.error && (
                  <Paragraph type="danger" ellipsis className="settings-paragraph-compact">
                    {conn.error}
                  </Paragraph>
                )}
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* 新建/编辑模态框 */}
      <Modal
        title={editingConfig ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSave}
        confirmLoading={!!connectingName}
        okText={editingConfig ? '保存并连接' : '添加并连接'}
        width={760}
        className="dark-modal settings-compact-modal"
      >
        <Form form={form} layout="vertical" className="settings-modal-form">
          <div className="settings-form-section">
            <div className="settings-form-section-title">基础信息</div>
            <div className="settings-modal-grid">
              <Form.Item
                name="name"
                label="服务器名称"
                required
                rules={[{ required: true, message: '请输入服务器名称' }]}
              >
                <Input placeholder="例如：filesystem" disabled={!!editingConfig} />
              </Form.Item>

              <Form.Item
                name="transport"
                label="传输类型"
                required
                rules={[{ required: true }]}
                className="settings-form-item-flush"
              >
                <Select>
                  <Select.Option value="stdio">Stdio（本地进程）</Select.Option>
                  <Select.Option value="sse">SSE（HTTP 流）</Select.Option>
                  <Select.Option value="websocket">WebSocket</Select.Option>
                </Select>
              </Form.Item>
            </div>
          </div>

          <div className="settings-form-section">
            <div className="settings-form-section-title">连接参数</div>
            <Form.Item
              noStyle
              shouldUpdate={(prev, curr) => prev.transport !== curr.transport}
            >
              {({ getFieldValue }) => {
                const transport = getFieldValue('transport');
                if (transport === 'stdio') {
                  return (
                    <div className="settings-modal-grid">
                      <Form.Item
                        name="command"
                        label="命令"
                        required
                        rules={[{ required: true, message: '请输入命令' }]}
                      >
                        <Input placeholder="例如：npx" />
                      </Form.Item>
                      <Form.Item name="args" label="参数" className="settings-form-item-flush">
                        <Input placeholder="例如：-y @anthropic/mcp-server-filesystem" />
                      </Form.Item>
                    </div>
                  );
                }
                return (
                  <div className="settings-modal-grid">
                    <Form.Item
                      name="url"
                      label="URL"
                      className="settings-grid-span-full settings-form-item-flush"
                      required
                      rules={[{ required: true, message: '请输入 URL' }]}
                    >
                      <Input placeholder="例如：http://localhost:3000/mcp" />
                    </Form.Item>
                  </div>
                );
              }}
            </Form.Item>
          </div>

          <div className="settings-form-section">
            <div className="settings-form-section-title">环境变量</div>
            <Form.Item name="env" label="环境变量（JSON）" className="settings-form-item-flush">
              <Input.TextArea
                placeholder='{"API_KEY": "xxx"}'
                autoSize={{ minRows: 3, maxRows: 6 }}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default MCPConfigManager;
