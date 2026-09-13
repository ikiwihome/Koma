import React from 'react';
import { Button, Card, Checkbox, Form, Input, InputNumber, Space, Tag, Typography, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ModelCapability } from '../../providers/channel/types';
import { generateId } from '../../store/globalStore';

export interface CapabilityOption {
  value: ModelCapability;
  label: string;
}

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

export interface ChannelModelsEditorProps {
  /**
   * Form field name, defaults to "models".
   */
  name?: string;
  /**
   * Capability options to select from. When omitted, the editor will not render
   * a checkbox group and callers are expected to fill capabilities on save.
   */
  capabilityOptions?: CapabilityOption[];
  /**
   * When capabilityOptions is omitted, show these fixed capabilities as tags.
   */
  fixedCapabilities?: ModelCapability[];
  /**
   * Used when adding a new row.
   */
  defaultCapabilities?: ModelCapability[];
  modelNamePlaceholder?: string;
  labelPlaceholder?: string;
  helpText?: string;
  /**
   * 视频时长范围编辑（写入 model.defaults.durationMin/Max/Step）。
   * 仅 ITV 渠道用，其他类别保持隐藏。
   */
  showDurationRange?: boolean;
  /**
   * 视频任务接口路径覆盖（写入 model.defaults.videosPath，例如 /v1/videos/generations）。
   * 仅对 OpenAI 兼容 ITV 渠道有意义。
   */
  showVideosPath?: boolean;
}

export const ChannelModelsEditor: React.FC<ChannelModelsEditorProps> = ({
  name = 'models',
  capabilityOptions,
  fixedCapabilities,
  defaultCapabilities,
  modelNamePlaceholder = '填写三方渠道的模型名称，如: model-a / provider-model-001',
  labelPlaceholder = '展示名（可选）',
  helpText,
  showDurationRange,
  showVideosPath,
}) => (
  <div className="settings-models-editor">
    {helpText && (
      <Typography.Paragraph type="secondary" className="settings-models-help">
        {helpText}
      </Typography.Paragraph>
    )}

    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <Space direction="vertical" className="settings-full-width" size="small">
          {fields.map((field, index) => (
            <Card
              key={field.key}
              size="small"
              className="settings-model-card"
              title={`模型 ${index + 1}`}
              extra={(
                <Tooltip title={fields.length === 1 ? '至少保留一个模型' : '删除该模型'}>
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={fields.length === 1}
                    onClick={() => remove(field.name)}
                  />
                </Tooltip>
              )}
            >
              <Form.Item name={[field.name, 'id']} hidden>
                <Input />
              </Form.Item>

              <div className="settings-model-grid">
                <Form.Item
                  name={[field.name, 'providerModelName']}
                  label="模型名称"
                  rules={[{
                    required: true,
                    message: '请输入模型名称',
                    transform: normalizeString,
                  }]}
                  className="settings-form-item-flush"
                >
                  <Input placeholder={modelNamePlaceholder} />
                </Form.Item>

                <Form.Item
                  name={[field.name, 'label']}
                  label="展示名"
                  className="settings-form-item-flush"
                >
                  <Input placeholder={labelPlaceholder} />
                </Form.Item>

                {capabilityOptions?.length ? (
                  <Form.Item
                    name={[field.name, 'capabilities']}
                    label="能力"
                    rules={[{
                      validator: async (_rule, value: unknown) => {
                        const array = Array.isArray(value) ? value : [];
                        if (array.length === 0) {
                          throw new Error('请至少选择一个能力');
                        }
                      },
                    }]}
                    className="full-span settings-form-item-flush"
                  >
                    <Checkbox.Group
                      className="settings-model-capabilities"
                      options={capabilityOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                    />
                  </Form.Item>
                ) : fixedCapabilities?.length ? (
                  <div className="full-span">
                    <Typography.Text type="secondary">能力:</Typography.Text>
                    <div className="settings-tag-block">
                      <Space wrap size={[6, 6]}>
                        {fixedCapabilities.map((capability) => (
                          <Tag key={capability} color="cyan">{capability}</Tag>
                        ))}
                      </Space>
                    </div>
                  </div>
                ) : null}

                {showDurationRange ? (
                  <div className="full-span">
                    <Typography.Text type="secondary">时长范围（秒）</Typography.Text>
                    <Space size={8} className="settings-full-width" style={{ marginTop: 6 }} wrap>
                      <Form.Item
                        name={[field.name, 'defaults', 'durationMin']}
                        label="最小"
                        className="settings-form-item-flush"
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={1} max={600} step={1} placeholder="如 4" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'defaults', 'durationMax']}
                        label="最大"
                        className="settings-form-item-flush"
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={1} max={600} step={1} placeholder="如 15" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'defaults', 'durationStep']}
                        label="步长"
                        className="settings-form-item-flush"
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={1} max={60} step={1} placeholder="默认 1" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'defaults', 'defaultDuration']}
                        label="默认"
                        className="settings-form-item-flush"
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={1} max={600} step={1} placeholder="如 5" />
                      </Form.Item>
                    </Space>
                  </div>
                ) : null}

                {showVideosPath ? (
                  <div className="full-span">
                    <Form.Item
                      name={[field.name, 'defaults', 'videosPath']}
                      label="视频任务路径"
                      tooltip="OpenAI 兼容的视频任务路径，默认 /v1/videos。某些代理可能用 /v1/videos/generations 等变体；不填则用默认。"
                      className="settings-form-item-flush"
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="/v1/videos" />
                    </Form.Item>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            size="small"
            block
            onClick={() => add({
              id: generateId(),
              providerModelName: '',
              label: '',
              capabilities: defaultCapabilities || [],
            })}
          >
            添加模型
          </Button>
        </Space>
      )}
    </Form.List>
  </div>
);

export default ChannelModelsEditor;
