/**
 * ComfyUI 工作流上传与节点映射组件
 */
import React, { useState, useEffect } from 'react';
import {
  Upload,
  Button,
  Card,
  Table,
  Select,
  Space,
  Tag,
  Modal,
  App,
  Tooltip,
  Empty,
} from 'antd';
import {
  UploadOutlined,
  EyeOutlined,
  NodeIndexOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';

// ComfyUI 工作流节点类型
interface ComfyNode {
  id: string;
  type: string;
  title?: string;
  inputs: Record<string, any>;
  outputs?: any[];
}

// 解析后的工作流信息
interface ParsedWorkflow {
  nodes: ComfyNode[];
  inputNodes: ComfyNode[];  // 可作为输入的节点
  outputNodes: ComfyNode[]; // 输出节点
}

// 系统输入映射类型
type SystemInputType = 'positive_prompt' | 'negative_prompt' | 'image' | 'seed' | 'width' | 'height' | 'steps' | 'cfg';

const SYSTEM_INPUTS: { key: SystemInputType; label: string; description: string }[] = [
  { key: 'positive_prompt', label: '正向提示词', description: '生成图像的正向描述' },
  { key: 'negative_prompt', label: '负向提示词', description: '不希望出现的内容' },
  { key: 'image', label: '输入图片', description: '参考图或待处理图片' },
  { key: 'seed', label: '随机种子', description: '控制生成结果的可复现性' },
  { key: 'width', label: '宽度', description: '输出图像宽度' },
  { key: 'height', label: '高度', description: '输出图像高度' },
  { key: 'steps', label: '采样步数', description: '去噪迭代次数' },
  { key: 'cfg', label: 'CFG Scale', description: '提示词引导强度' },
];

// 常见的 ComfyUI 输入节点类型
const INPUT_NODE_TYPES = [
  'CLIPTextEncode',
  'KSampler',
  'KSamplerAdvanced',
  'EmptyLatentImage',
  'LoadImage',
  'VAEDecode',
  'CheckpointLoaderSimple',
];

interface WorkflowUploaderProps {
  value?: {
    workflowPath?: string;
    workflowMapping?: Record<string, string>;
  };
  onChange?: (value: { workflowPath?: string; workflowMapping?: Record<string, string>; workflowJson?: string }) => void;
  disabled?: boolean;
}

export const WorkflowUploader: React.FC<WorkflowUploaderProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const { message } = App.useApp();
  const [workflow, setWorkflow] = useState<ParsedWorkflow | null>(null);
  const [workflowJson, setWorkflowJson] = useState<string>('');
  const [mapping, setMapping] = useState<Record<string, string>>(value?.workflowMapping || {});
  const [previewVisible, setPreviewVisible] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  useEffect(() => {
    if (value?.workflowMapping) {
      setMapping(value.workflowMapping);
    }
  }, [value?.workflowMapping]);

  // 解析 ComfyUI 工作流 JSON
  const parseWorkflow = (json: any): ParsedWorkflow => {
    const nodes: ComfyNode[] = [];
    const inputNodes: ComfyNode[] = [];
    const outputNodes: ComfyNode[] = [];

    // ComfyUI 工作流格式：{ "1": { "class_type": "...", "inputs": {...} }, ... }
    for (const [id, nodeData] of Object.entries(json)) {
      if (typeof nodeData !== 'object' || !nodeData) continue;

      const node: ComfyNode = {
        id,
        type: (nodeData as any).class_type || (nodeData as any).type || 'Unknown',
        title: (nodeData as any)._meta?.title,
        inputs: (nodeData as any).inputs || {},
      };
      nodes.push(node);

      // 识别输入节点
      if (INPUT_NODE_TYPES.some(t => node.type.includes(t))) {
        inputNodes.push(node);
      }

      // 识别输出节点（SaveImage、PreviewImage 等）
      if (node.type.includes('Save') || node.type.includes('Preview') || node.type.includes('Output')) {
        outputNodes.push(node);
      }
    }

    return { nodes, inputNodes, outputNodes };
  };

  // 处理文件上传
  const handleUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const json = JSON.parse(content);
        const parsed = parseWorkflow(json);

        if (parsed.nodes.length === 0) {
          message.error('无法解析工作流，请检查文件格式');
          return;
        }

        setWorkflow(parsed);
        setWorkflowJson(content);
        setFileList([{
          uid: '-1',
          name: file.name,
          status: 'done',
        }]);

        // 自动映射常见节点
        const autoMapping: Record<string, string> = {};
        for (const node of parsed.inputNodes) {
          if (node.type === 'CLIPTextEncode' && !autoMapping.positive_prompt) {
            // 检查是否连接到正向或负向
            const inputText = node.inputs.text;
            if (typeof inputText === 'string') {
              if (inputText.toLowerCase().includes('negative') || node.title?.toLowerCase().includes('negative')) {
                autoMapping.negative_prompt = `${node.id}:text`;
              } else {
                autoMapping.positive_prompt = `${node.id}:text`;
              }
            }
          }
          if (node.type.includes('KSampler')) {
            if (!autoMapping.seed) autoMapping.seed = `${node.id}:seed`;
            if (!autoMapping.steps) autoMapping.steps = `${node.id}:steps`;
            if (!autoMapping.cfg) autoMapping.cfg = `${node.id}:cfg`;
          }
          if (node.type === 'EmptyLatentImage') {
            if (!autoMapping.width) autoMapping.width = `${node.id}:width`;
            if (!autoMapping.height) autoMapping.height = `${node.id}:height`;
          }
          if (node.type === 'LoadImage') {
            if (!autoMapping.image) autoMapping.image = `${node.id}:image`;
          }
        }
        setMapping(autoMapping);

        message.success(`工作流已加载，共 ${parsed.nodes.length} 个节点`);

        onChange?.({
          workflowPath: file.name,
          workflowMapping: autoMapping,
          workflowJson: content,
        });
      } catch {
        message.error('JSON 解析失败，请检查文件格式');
      }
    };
    reader.readAsText(file);
    return false; // 阻止默认上传
  };

  // 更新映射
  const handleMappingChange = (systemInput: string, nodeInput: string) => {
    const newMapping = { ...mapping, [systemInput]: nodeInput };
    setMapping(newMapping);
    onChange?.({
      workflowPath: value?.workflowPath,
      workflowMapping: newMapping,
      workflowJson,
    });
  };

  // 清除工作流
  const handleClear = () => {
    setWorkflow(null);
    setWorkflowJson('');
    setMapping({});
    setFileList([]);
    onChange?.({
      workflowPath: undefined,
      workflowMapping: undefined,
      workflowJson: undefined,
    });
  };

  // 生成节点选项
  const getNodeOptions = () => {
    if (!workflow) return [];
    return workflow.inputNodes.map(node => ({
      label: `${node.title || node.type} (ID: ${node.id})`,
      options: Object.keys(node.inputs).map(inputKey => ({
        value: `${node.id}:${inputKey}`,
        label: `${node.title || node.type} → ${inputKey}`,
      })),
    }));
  };

  // 映射表格列
  const mappingColumns = [
    {
      title: '系统输入',
      dataIndex: 'label',
      width: 120,
    },
    {
      title: '说明',
      dataIndex: 'description',
      width: 200,
      render: (text: string) => <span className="settings-muted-table-text">{text}</span>,
    },
    {
      title: '映射到节点',
      dataIndex: 'key',
      render: (key: string) => (
        <Select
          value={mapping[key]}
          onChange={(val) => handleMappingChange(key, val)}
          placeholder="选择节点输入"
          allowClear
          className="settings-full-width"
          options={getNodeOptions()}
          disabled={disabled || !workflow}
        />
      ),
    },
    {
      title: '状态',
      width: 60,
      render: (_: any, record: any) => (
        mapping[record.key] ? (
          <CheckCircleOutlined className="settings-status-dot-success" />
        ) : (
          <span className="settings-status-dot-muted">—</span>
        )
      ),
    },
  ];

  return (
    <div>
      {/* 上传区域 */}
      <div className="settings-margin-bottom-md">
        <Space>
          <Upload
            accept=".json"
            maxCount={1}
            fileList={fileList}
            beforeUpload={handleUpload}
            onRemove={handleClear}
            disabled={disabled}
          >
            <Button icon={<UploadOutlined />} disabled={disabled}>
              上传工作流 JSON
            </Button>
          </Upload>

          {workflow && (
            <>
              <Tooltip title="预览节点">
                <Button
                  icon={<EyeOutlined />}
                  onClick={() => setPreviewVisible(true)}
                />
              </Tooltip>
              <Tag color="green">
                <NodeIndexOutlined /> {workflow.nodes.length} 节点
              </Tag>
            </>
          )}
        </Space>
      </div>

      {/* 节点映射配置 */}
      {workflow ? (
        <Card size="small" title="节点映射配置" className="settings-config-card settings-margin-top-sm">
          <p className="settings-form-hint settings-form-hint-offset">
            将系统输入映射到工作流中对应的节点参数，未映射的输入将使用工作流默认值。
          </p>
          <Table
            dataSource={SYSTEM_INPUTS}
            columns={mappingColumns}
            rowKey="key"
            pagination={false}
            size="small"
          />
        </Card>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="上传 ComfyUI 工作流 JSON 文件后可配置节点映射"
          className="settings-preview-empty"
        />
      )}

      {/* 节点预览 Modal */}
      <Modal
        title="工作流节点预览"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={860}
        className="dark-modal settings-compact-modal settings-slim-preview"
      >
        {workflow && (
          <Table
            dataSource={workflow.nodes}
            columns={[
              { title: 'ID', dataIndex: 'id', width: 60 },
              { title: '类型', dataIndex: 'type', width: 200 },
              { title: '标题', dataIndex: 'title', render: (t: string) => t || '—' },
              {
                title: '输入',
                dataIndex: 'inputs',
                render: (inputs: Record<string, any>) => (
                  <span className="settings-muted-table-text">
                    {Object.keys(inputs).slice(0, 3).join(', ')}
                    {Object.keys(inputs).length > 3 && '...'}
                  </span>
                ),
              },
            ]}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10 }}
          />
        )}
      </Modal>
    </div>
  );
};
