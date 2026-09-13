/**
 * MCP 服务器配置界面
 */
import React, { useState, useCallback } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  Button,
  Table,
  Space,
  message,
  Popconfirm,
  Tag,
  Upload,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ToolOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import type { MCPServerConfig } from '../../types/mcp';
import styles from './MCPSettings.module.scss';

interface MCPSettingsProps {
  visible: boolean;
  onClose: () => void;
  configs: MCPServerConfig[];
  onSave: (configs: MCPServerConfig[]) => void;
  onTest?: (config: MCPServerConfig) => Promise<boolean>;
}

type TransportType = 'stdio' | 'sse' | 'websocket' | 'internal';

interface ConfigFormData {
  name: string;
  transport: TransportType;
  command?: string;
  args?: string;
  url?: string;
  env?: string;
  enabled: boolean;
}

export const MCPSettings: React.FC<MCPSettingsProps> = ({
  visible,
  onClose,
  configs,
  onSave,
  onTest,
}) => {
  const [form] = Form.useForm<ConfigFormData>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});

  // 打开新建表单
  const handleAdd = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ transport: 'stdio', enabled: true });
    setEditingId(null);
    setShowForm(true);
  }, [form]);

  // 打开编辑表单
  const handleEdit = useCallback((config: MCPServerConfig) => {
    form.setFieldsValue({
      name: config.name,
      transport: config.transport,
      command: config.command,
      args: config.args?.join(' '),
      url: config.url,
      env: config.env ? JSON.stringify(config.env, null, 2) : '',
      enabled: true,
    });
    setEditingId(config.id);
    setShowForm(true);
  }, [form]);

  // 保存配置
  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();

      const config: MCPServerConfig = {
        id: editingId || `mcp_${Date.now()}`,
        name: values.name,
        transport: values.transport,
        command: values.transport === 'stdio' ? values.command : undefined,
        args: values.transport === 'stdio' && values.args
          ? values.args.split(/\s+/).filter(Boolean)
          : undefined,
        url: values.transport !== 'stdio' ? values.url : undefined,
        env: values.env ? JSON.parse(values.env) : undefined,
      };

      let newConfigs: MCPServerConfig[];
      if (editingId) {
        newConfigs = configs.map(c => c.id === editingId ? config : c);
      } else {
        if (configs.some(c => c.name === config.name)) {
          message.error('配置名称已存在');
          return;
        }
        newConfigs = [...configs, config];
      }

      onSave(newConfigs);
      setShowForm(false);
      message.success(editingId ? '配置已更新' : '配置已添加');
    } catch (e) {
      if (e instanceof SyntaxError) {
        message.error('环境变量 JSON 格式错误');
      }
    }
  }, [form, editingId, configs, onSave]);

  // 删除配置
  const handleDelete = useCallback((name: string) => {
    const newConfigs = configs.filter(c => c.name !== name);
    onSave(newConfigs);
    message.success('配置已删除');
  }, [configs, onSave]);

  // 导入 JSON 配置
  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);

      if (!Array.isArray(json)) {
        throw new Error('格式错误: 根节点应为数组');
      }

      const newConfigs = json.filter((item: any) =>
        item.name && item.transport && !configs.some(c => c.name === item.name)
      );

      if (newConfigs.length === 0) {
        message.warning('没有发现有效的新配置');
        return;
      }

      onSave([...configs, ...newConfigs]);
      message.success(`成功导入 ${newConfigs.length} 个配置`);
    } catch (e) {
      message.error('导入失败: ' + (e instanceof Error ? e.message : '未知错误'));
    }
  }, [configs, onSave]);

  // 测试连接
  const handleTest = useCallback(async (config: MCPServerConfig) => {
    if (!onTest) return;

    setTestingId(config.name);
    try {
      const result = await onTest(config);
      setTestResults(prev => ({ ...prev, [config.name]: result }));
      message.success(result ? '连接成功' : '连接失败');
    } catch {
      setTestResults(prev => ({ ...prev, [config.name]: false }));
      message.error('连接测试失败');
    } finally {
      setTestingId(null);
    }
  }, [onTest]);

  // 表格列
  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <Space>
          <ApiOutlined />
          {name}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'transport',
      key: 'transport',
      render: (transport: TransportType) => (
        <Tag color={transport === 'stdio' ? 'blue' : transport === 'sse' ? 'green' : 'purple'}>
          {transport.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: '地址',
      key: 'address',
      render: (_: unknown, record: MCPServerConfig) => (
        <span className={styles.address}>
          {record.transport === 'stdio' ? record.command : record.url}
        </span>
      ),
    },
    {
      title: '工具',
      key: 'tools',
      width: 100,
      render: (_: unknown, record: MCPServerConfig) => {
        // 工具发现需要连接 MCP 服务器
        // 当前显示占位提示，连接后可获取具体工具列表
        if (record.name in testResults && testResults[record.name]) {
          return (
            <Tag color="cyan" icon={<ToolOutlined />}>
              已连接
            </Tag>
          );
        }
        return (
          <Tag color="default">
            待连接
          </Tag>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_: unknown, record: MCPServerConfig) => {
        if (testingId === record.name) {
          return <LoadingOutlined spin />;
        }
        if (record.name in testResults) {
          return testResults[record.name]
            ? <CheckCircleOutlined className={styles.statusSuccess} />
            : <CloseCircleOutlined className={styles.statusError} />;
        }
        return null;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: unknown, record: MCPServerConfig) => (
        <Space>
          {onTest && (
            <Button
              type="text"
              size="small"
              onClick={() => handleTest(record)}
              loading={testingId === record.name}
            >
              测试
            </Button>
          )}
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确定删除此配置？"
            onConfirm={() => handleDelete(record.name)}
            okText="删除"
            cancelText="取消"
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title="MCP 服务器配置"
      open={visible}
      onCancel={onClose}
      width={800}
      footer={null}
      className={styles.modal}
    >
      {/* 配置列表 */}
      {!showForm && (
        <>
          <div className={styles.header}>
            <Space>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAdd}
              >
                添加服务器
              </Button>
              <Upload
                beforeUpload={(file) => { handleImport(file); return false; }}
                showUploadList={false}
                accept=".json"
              >
                <Button icon={<ImportOutlined />}>
                  导入配置
                </Button>
              </Upload>
            </Space>
          </div>
          <Table
            dataSource={configs}
            columns={columns}
            rowKey="name"
            pagination={false}
            size="small"
            locale={{ emptyText: '暂无 MCP 服务器配置' }}
          />
        </>
      )}

      {/* 配置表单 */}
      {showForm && (
        <Form
          form={form}
          layout="vertical"
          className={styles.form}
        >
          <Form.Item
            name="name"
            label="服务器名称"
            rules={[{ required: true, message: '请输入服务器名称' }]}
          >
            <Input placeholder="例如：filesystem" disabled={!!editingId} />
          </Form.Item>

          <Form.Item
            name="transport"
            label="传输类型"
            rules={[{ required: true }]}
          >
            <Select>
              <Select.Option value="stdio">Stdio（本地进程）</Select.Option>
              <Select.Option value="sse">SSE（HTTP 流）</Select.Option>
              <Select.Option value="websocket">WebSocket</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.transport !== curr.transport}
          >
            {({ getFieldValue }) => {
              const transport = getFieldValue('transport');
              if (transport === 'stdio') {
                return (
                  <>
                    <Form.Item
                      name="command"
                      label="命令"
                      rules={[{ required: true, message: '请输入命令' }]}
                    >
                      <Input placeholder="例如：npx" />
                    </Form.Item>
                    <Form.Item
                      name="args"
                      label="参数"
                    >
                      <Input placeholder="例如：-y @anthropic/mcp-server-filesystem" />
                    </Form.Item>
                  </>
                );
              }
              return (
                <Form.Item
                  name="url"
                  label="URL"
                  rules={[{ required: true, message: '请输入 URL' }]}
                >
                  <Input placeholder="例如：http://localhost:3000/mcp" />
                </Form.Item>
              );
            }}
          </Form.Item>

          <Form.Item
            name="env"
            label="环境变量（JSON）"
          >
            <Input.TextArea
              placeholder='{"API_KEY": "xxx"}'
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </Form.Item>

          <Form.Item className={styles.formActions}>
            <Space>
              <Button onClick={() => setShowForm(false)}>取消</Button>
              <Button type="primary" onClick={handleSave}>
                {editingId ? '更新' : '添加'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
};

export default MCPSettings;
