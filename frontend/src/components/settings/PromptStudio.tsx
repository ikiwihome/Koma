/**
 * PromptStudio
 *
 * 提示词工作台：左侧按 category 分组列出所有模板（默认 + 用户自定义新建），
 * 右侧是模板编辑器。支持：
 * - 搜索（搜索时折叠展开，扁平显示）
 * - 编辑默认模板（保存为 override）/ 重置（删除 override 回到默认）
 * - 新建自定义模板（id 全新，分类受控选择）
 * - 删除自定义模板（仅自定义可删，默认不可删）
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  App,
  Alert,
  Input,
  Button,
  Tag,
  Typography,
  Space,
  Popconfirm,
  Empty,
  Tooltip,
  Modal,
  Form,
  Select,
} from 'antd';
import {
  SearchOutlined,
  SaveOutlined,
  ReloadOutlined,
  CodeOutlined,
  PlusOutlined,
  DeleteOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
} from '@ant-design/icons';
import {
  loadPromptTemplates,
  saveCustomTemplate,
  resetTemplate,
  validatePromptTemplateDraft,
  createCustomPromptTemplate,
  updateCustomPromptTemplate,
  deleteCustomPromptTemplate,
  isDefaultTemplateId,
  PROMPT_CATEGORY_META,
  type PromptTemplate,
  type PromptTemplateType,
  type PromptTemplateCategory,
} from '../../store/promptTemplates';

const { Title, Text } = Typography;
const { TextArea } = Input;

const ALL_CATEGORIES = (Object.keys(PROMPT_CATEGORY_META) as PromptTemplateCategory[])
  .sort((a, b) => PROMPT_CATEGORY_META[a].order - PROMPT_CATEGORY_META[b].order);

interface NewTemplateFormValues {
  id: string;
  name: string;
  category: PromptTemplateCategory;
  description: string;
  template: string;
}

export const PromptStudio: React.FC = () => {
  const { message } = App.useApp();
  const [templates, setTemplates] = useState<Record<string, PromptTemplate>>({});
  const [selectedId, setSelectedId] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [editingContent, setEditingContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ unknownVariables: string[]; missingRequiredVariables: string[] }>({
    unknownVariables: [],
    missingRequiredVariables: [],
  });
  const [collapsed, setCollapsed] = useState<Set<PromptTemplateCategory>>(new Set());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm<NewTemplateFormValues>();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const data = await loadPromptTemplates();
    setTemplates(data);
    if (!selectedId && Object.keys(data).length > 0) {
      // 默认选中第一个有内容的分组的第一个模板
      const firstId = Object.keys(data)[0];
      setSelectedId(firstId);
    }
  };

  // 切换模板时同步编辑内容 + 校验
  useEffect(() => {
    if (selectedId && templates[selectedId]) {
      const nextTemplate = templates[selectedId].template;
      setEditingContent(nextTemplate);
      setHasUnsavedChanges(false);
      const validation = validatePromptTemplateDraft(selectedId as PromptTemplateType, nextTemplate);
      setValidationErrors({
        unknownVariables: validation.unknownVariables,
        missingRequiredVariables: validation.missingRequiredVariables,
      });
    }
  }, [selectedId, templates]);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextContent = e.target.value;
    setEditingContent(nextContent);
    setHasUnsavedChanges(true);
    if (selectedId) {
      const validation = validatePromptTemplateDraft(selectedId as PromptTemplateType, nextContent);
      setValidationErrors({
        unknownVariables: validation.unknownVariables,
        missingRequiredVariables: validation.missingRequiredVariables,
      });
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    try {
      const validation = validatePromptTemplateDraft(selectedId as PromptTemplateType, editingContent);
      if (!validation.isValid) {
        setValidationErrors({
          unknownVariables: validation.unknownVariables,
          missingRequiredVariables: validation.missingRequiredVariables,
        });
        message.error('模板校验未通过，请先修正变量');
        return;
      }

      // 用户自定义新建模板走 updateCustomPromptTemplate；改写默认模板走 saveCustomTemplate（override）
      if (isDefaultTemplateId(selectedId)) {
        const currentTemplate = templates[selectedId];
        const updatedTemplate = { ...currentTemplate, template: editingContent };
        await saveCustomTemplate(updatedTemplate);
      } else {
        await updateCustomPromptTemplate(selectedId, { template: editingContent });
      }
      await loadData();
      setHasUnsavedChanges(false);
      message.success('模板已保存');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`保存失败: ${msg}`);
    }
  };

  const handleReset = async () => {
    if (!selectedId) return;
    try {
      await resetTemplate(selectedId as PromptTemplateType);
      await loadData();
      setHasUnsavedChanges(false);
      message.success('模板已重置为默认');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`重置失败: ${msg}`);
    }
  };

  /** 判断当前模板是不是用户自定义新建的（非 override） */
  const isUserCreated = (template?: PromptTemplate): boolean => {
    if (!template) return false;
    // 默认模板的 id 都在 PROMPT_CATEGORY_META 之外
    // 简化：自定义模板 id 不在 DEFAULT_TEMPLATES 中（运行时判断走 ALL_CATEGORIES 比较粗，
    // 这里用一个稳定信号：自定义模板没出现在 default 列表的方式 — 通过 categories 反向推）
    // 实际上：如果模板 isCustom 为 true 且 id 不在内置列表里就是 user-created
    // 但内置列表只能从内部拿。简化为：id 不是任何已知 PromptTemplateType union 中的字符串
    // 我们没有内置列表的 runtime 数组，但有 PROMPT_CATEGORY_META。退一步：
    // 如果模板的 id 不出现在原始 templates 加载之后的某个集合里，无法直接区分
    // 简化方案：默认模板 id 的命名都是固定的下划线 snake，这个判断不可靠
    // → 干脆用一个 hidden 字段（已加 isCustom，不区分两种 custom）
    // 改用：检查 settings.customPromptTemplates 是否包含此 id（异步，UI 难做）
    // 折中：用一个简单的启发 — 默认模板不会是用户能在 UI 创建的（用户创建会带分类下拉）
    // user-created：isCustom 为 true 且 id 不属于内置默认模板
    return !!template.isCustom && !isDefaultTemplateId(template.id);
  };

  const handleDeleteCustom = async () => {
    if (!selectedId) return;
    try {
      await deleteCustomPromptTemplate(selectedId);
      // 切到第一个剩下的模板
      const remaining = Object.keys(templates).filter(id => id !== selectedId);
      setSelectedId(remaining[0] || '');
      await loadData();
      message.success('自定义模板已删除');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`删除失败: ${msg}`);
    }
  };

  const handleCreateCustom = async () => {
    try {
      const values = await createForm.validateFields();
      await createCustomPromptTemplate({
        id: values.id.trim(),
        name: values.name.trim(),
        category: values.category,
        description: values.description.trim(),
        template: values.template,
        // 暂不让用户在 UI 里编辑变量元数据，自定义模板的变量校验在 buildValidationResult 中放宽
      });
      setCreateModalOpen(false);
      createForm.resetFields();
      await loadData();
      setSelectedId(values.id.trim());
      message.success('自定义模板已创建');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return; // 校验失败，AntD 已提示
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`创建失败: ${msg}`);
    }
  };

  // 按分类分组
  const groupedTemplates = useMemo(() => {
    const lower = searchText.trim().toLowerCase();
    const groups: Record<PromptTemplateCategory, PromptTemplate[]> = {
      global: [], system: [], script: [], analysis: [], extraction: [],
      tweet: [], 'inference-image': [], 'inference-video': [], tti: [], itv: [],
    };
    for (const t of Object.values(templates)) {
      if (lower) {
        if (
          !t.name.toLowerCase().includes(lower)
          && !t.description.toLowerCase().includes(lower)
          && !t.id.toLowerCase().includes(lower)
        ) continue;
      }
      const cat = (t.category || 'global') as PromptTemplateCategory;
      if (groups[cat]) groups[cat].push(t);
    }
    // 同组内按名字排序
    for (const cat of ALL_CATEGORIES) {
      groups[cat].sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }, [templates, searchText]);

  const isSearching = searchText.trim().length > 0;
  const selectedTemplate = templates[selectedId];
  const hasValidationErrors = validationErrors.unknownVariables.length > 0 || validationErrors.missingRequiredVariables.length > 0;

  const toggleCategory = (cat: PromptTemplateCategory) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div className="prompt-studio-shell">
      {/* 左侧模板列表 */}
      <div className="prompt-studio-sidebar">
        <div className="prompt-studio-sidebar-header">
          <Space.Compact className="settings-full-width">
            <Input
              placeholder="搜索模板..."
              allowClear
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              prefix={<SearchOutlined className="text-text-tertiary" />}
              size="small"
            />
            <Tooltip title="新建自定义模板">
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setCreateModalOpen(true)}
              />
            </Tooltip>
          </Space.Compact>
        </div>
        <div className="prompt-studio-sidebar-list">
          {ALL_CATEGORIES.map(cat => {
            const list = groupedTemplates[cat];
            if (list.length === 0) return null;
            const meta = PROMPT_CATEGORY_META[cat];
            // 搜索状态下默认全展开；否则按用户折叠状态
            const isCollapsed = !isSearching && collapsed.has(cat);
            return (
              <div key={cat} className="prompt-studio-category">
                <div
                  className="flex items-center justify-between px-2 py-1.5 cursor-pointer hover:bg-bg-elevated/50 rounded select-none"
                  onClick={() => !isSearching && toggleCategory(cat)}
                  title={meta.description}
                >
                  <div className="flex items-center gap-1.5 text-xs">
                    {!isSearching && (isCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />)}
                    <span className="text-text-secondary font-medium">{meta.label}</span>
                    <span className="text-text-muted">({list.length})</span>
                  </div>
                </div>
                {!isCollapsed && (
                  <div>
                    {list.map(item => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                        className={`prompt-studio-list-item${selectedId === item.id ? ' is-active' : ''}`}
                      >
                        <div className="flex justify-between items-center mb-1 gap-2">
                          <span className={`font-medium text-sm truncate ${selectedId === item.id ? 'text-accent' : 'text-text-primary'}`}>
                            {item.name}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {!isDefaultTemplateId(item.id) && (
                              <Tag color="cyan" className="!m-0 !text-[10px] !leading-4 !px-1">新</Tag>
                            )}
                            {item.isCustom && isDefaultTemplateId(item.id) && (
                              <Tag color="orange" className="!m-0 !text-[10px] !leading-4 !px-1">改</Tag>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-text-tertiary overflow-hidden text-ellipsis whitespace-nowrap">
                          {item.description}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {/* 空态：搜索无匹配 */}
          {isSearching && ALL_CATEGORIES.every(cat => groupedTemplates[cat].length === 0) && (
            <div className="px-3 py-6 text-center">
              <Empty description={<span className="text-xs text-text-tertiary">没有匹配的模板</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          )}
        </div>
      </div>

      {/* 右侧编辑器 */}
      <div className="prompt-studio-editor">
        {selectedTemplate ? (
          <>
            <div className="prompt-studio-editor-header">
              <div className="prompt-studio-editor-meta">
                <div className="flex items-center gap-2 flex-wrap">
                  <Title level={5} className="!m-0 !text-text-primary">{selectedTemplate.name}</Title>
                  <Tag color="default" className="!m-0">{PROMPT_CATEGORY_META[selectedTemplate.category]?.label || selectedTemplate.category}</Tag>
                  {!isDefaultTemplateId(selectedTemplate.id) && <Tag color="cyan">自定义</Tag>}
                  {selectedTemplate.isCustom && isDefaultTemplateId(selectedTemplate.id) && <Tag color="orange">已修改</Tag>}
                  {hasUnsavedChanges && <Tag color="warning">未保存</Tag>}
                </div>
                <Text className="text-xs !text-text-tertiary">
                  {selectedTemplate.description}
                  <span className="ml-2 text-text-muted font-mono text-[11px]">id: {selectedTemplate.id}</span>
                </Text>
              </div>
              <Space size="small" wrap>
                {isUserCreated(selectedTemplate) ? (
                  <Popconfirm title="确定删除此自定义模板？此操作不可撤销" onConfirm={handleDeleteCustom}>
                    <Button danger icon={<DeleteOutlined />} size="small">删除</Button>
                  </Popconfirm>
                ) : (
                  selectedTemplate.isCustom && (
                    <Popconfirm title="确定重置为默认模板？" onConfirm={handleReset}>
                      <Button icon={<ReloadOutlined />} size="small">重置</Button>
                    </Popconfirm>
                  )
                )}
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  size="small"
                  onClick={handleSave}
                  disabled={!hasUnsavedChanges || hasValidationErrors}
                >
                  保存
                </Button>
              </Space>
            </div>

            <div className="prompt-studio-editor-main">
              {hasValidationErrors && (
                <div className="prompt-studio-validation">
                  <Alert
                    type="error"
                    showIcon
                    message="模板变量校验失败"
                    description={
                      <div className="text-xs">
                        {validationErrors.unknownVariables.length > 0 && (
                          <div>未知变量：{validationErrors.unknownVariables.join(', ')}</div>
                        )}
                        {validationErrors.missingRequiredVariables.length > 0 && (
                          <div>缺失必需变量：{validationErrors.missingRequiredVariables.join(', ')}</div>
                        )}
                      </div>
                    }
                  />
                </div>
              )}

              <div className="prompt-studio-textarea-shell">
                <TextArea
                  value={editingContent}
                  onChange={handleContentChange}
                  autoSize={false}
                  className="!bg-bg-surface !text-text-primary !border-none settings-full-height"
                  spellCheck={false}
                />
              </div>

              {selectedTemplate.variables.length > 0 && (
                <div className="prompt-studio-vars">
                  <div className="flex items-center gap-2 mb-2">
                    <CodeOutlined className="text-accent" />
                    <Text strong className="text-xs !text-accent uppercase">可用变量</Text>
                  </div>
                  <div className="prompt-studio-vars-grid">
                    {selectedTemplate.variables.map(v => (
                      <div key={v.name} className="prompt-studio-var-card">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <Tooltip title={`点击复制 {{${v.name}}}`}>
                            <Tag
                              color="green"
                              className="font-mono cursor-pointer !m-0"
                              onClick={() => {
                                navigator.clipboard.writeText(`{{${v.name}}}`);
                                message.success('已复制');
                              }}
                            >
                              {`{{${v.name}}}`}
                            </Tag>
                          </Tooltip>
                          <Tag color={v.required === false ? 'default' : 'blue'} className="!m-0">
                            {v.required === false ? '选填' : '必填'}
                          </Tag>
                        </div>
                        <div className="text-sm text-text-primary mb-1">{v.label}</div>
                        <div className="text-xs text-text-secondary mb-2">{v.description}</div>
                        <div className="text-[11px] text-text-tertiary">格式：{v.format}</div>
                        {v.example && (
                          <div className="text-[11px] text-text-tertiary mt-1 break-all">
                            示例：{v.example}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="prompt-studio-empty">
            <Empty description="请从左侧选择一个模板" />
          </div>
        )}
      </div>

      {/* 新建自定义模板 Modal */}
      <Modal
        title="新建自定义提示词模板"
        open={createModalOpen}
        onOk={handleCreateCustom}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        okText="创建"
        cancelText="取消"
        width={640}
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ category: 'extraction' }}
        >
          <Form.Item
            name="id"
            label="模板 ID"
            tooltip="3-64 位小写字母 / 数字 / 下划线，必须以字母开头；不能与内置模板冲突"
            rules={[
              { required: true, message: '请输入模板 ID' },
              { pattern: /^[a-z][a-z0-9_]{2,63}$/, message: '只能小写字母 / 数字 / 下划线，3-64 位，字母开头' },
            ]}
          >
            <Input placeholder="例如：my_dialogue_polish" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="name"
            label="显示名"
            rules={[{ required: true, message: '请输入显示名' }]}
          >
            <Input placeholder="例如：对话风格润色" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="category"
            label="分类"
            tooltip="选择最贴近用途的分类，用于左侧分组归类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select
              options={ALL_CATEGORIES.map(cat => ({
                value: cat,
                label: `${PROMPT_CATEGORY_META[cat].label} — ${PROMPT_CATEGORY_META[cat].description}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="description"
            label="简介"
            rules={[{ required: true, message: '请输入简介' }]}
          >
            <Input placeholder="一句话说明用途" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="template"
            label="模板内容"
            tooltip="用 {{变量名}} 占位；自定义模板不强制变量白名单校验"
            rules={[{ required: true, message: '请输入模板内容' }]}
          >
            <TextArea rows={8} spellCheck={false} placeholder={'模板正文...\n可用 {{变量}} 占位'} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
