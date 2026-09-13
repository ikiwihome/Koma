/**
 * 剧集管理组件
 * 支持剧集列表展示、增删改、拖拽排序
 */
import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Modal, Form, Input, InputNumber, App, Spin, Empty } from 'antd';
import { GripVertical, Play, Pencil, Trash2, Plus, Zap } from 'lucide-react';
import type { Episode } from '../../types';
import { createEpisode, saveEpisode, deleteEpisode, listEpisodes } from '../../store/projectStore';
import { EpisodeSplitService } from '../../services/EpisodeSplitService';
import { createCreationContext } from '../../services/CreationContext';
interface EpisodeManagerProps {
  projectId: string;
  fullScript?: string;
  onEpisodeSelect?: (episode: Episode) => void;
  onEpisodeUpdate?: (episode: Episode) => void;
  selectedEpisodeId?: string;
}

export interface EpisodeManagerRef {
  refresh: () => void;
}

const statusConfig: Record<Episode['status'], { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-bg-hover text-text-secondary' },
  script: { label: '剧本', color: 'bg-status-info/15 text-status-info' },
  storyboard: { label: '分镜', color: 'bg-accent/15 text-accent' },
  generating: { label: '生成中', color: 'bg-status-warning/15 text-status-warning' },
  completed: { label: '已完成', color: 'bg-status-success/15 text-status-success' },
};

export const EpisodeManager = forwardRef<EpisodeManagerRef, EpisodeManagerProps>(({
  projectId,
  fullScript,
  onEpisodeSelect,
  onEpisodeUpdate,
  selectedEpisodeId,
}, ref) => {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitCount, setSplitCount] = useState(3);
  const [adding, setAdding] = useState(false);

  const loadEpisodes = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listEpisodes(projectId);
      setEpisodes(list);
    } catch {
      message.error('加载剧集列表失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  }, [projectId, message]);

  useEffect(() => { loadEpisodes(); }, [loadEpisodes]);

  useImperativeHandle(ref, () => ({ refresh: loadEpisodes }), [loadEpisodes]);

  const handleAddEpisode = async () => {
    if (adding) return;
    const nextNumber = episodes.length + 1;
    setAdding(true);
    try {
      const newEpisode = await createEpisode(projectId, {
        number: nextNumber,
        title: `第 ${nextNumber} 集`,
        status: 'draft',
      });
      setEpisodes([...episodes, newEpisode]);
      message.success('剧集已添加');
    } catch {
      message.error('添加剧集失败，请重试');
    } finally {
      setAdding(false);
    }
  };

  const handleEditClick = (episode: Episode, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingEpisode(episode);
    form.setFieldsValue({
      number: episode.number,
      title: episode.title,
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingEpisode) return;
    try {
      const values = await form.validateFields();
      const nextNumber = Number(values.number);
      if (episodes.some(ep => ep.id !== editingEpisode.id && ep.number === nextNumber)) {
        message.error(`第 ${nextNumber} 集已存在，请使用其他集数`);
        return;
      }
      const updated = await saveEpisode(projectId, editingEpisode.id, {
        number: nextNumber,
        title: values.title,
      });
      if (updated) {
        setEpisodes(episodes
          .map(ep => ep.id === updated.id ? updated : ep)
          .sort((a, b) => a.number - b.number));
        onEpisodeUpdate?.(updated);
      }
      setEditDialogOpen(false);
      setEditingEpisode(null);
      form.resetFields();
      message.success('剧集已保存');
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('保存剧集失败，请重试');
    }
  };

  const handleDeleteEpisode = async (episode: Episode, e: React.MouseEvent) => {
    e.stopPropagation();
    modal.confirm({
      title: '确定删除此剧集？',
      content: `将删除"${episode.title}"及其所有数据`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteEpisode(projectId, episode.id);
          const remaining = episodes.filter(ep => ep.id !== episode.id);
          const renumbered = remaining.map((ep, idx) => ({ ...ep, number: idx + 1 }));
          setEpisodes(renumbered);
          for (const ep of renumbered) {
            await saveEpisode(projectId, ep.id, { number: ep.number });
          }
          message.success('剧集已删除');
        } catch {
          message.error('删除剧集失败，请重试');
        }
      },
    });
  };

  const handleAutoSplit = async () => {
    if (!fullScript?.trim()) {
      message.warning('请先输入完整剧本');
      return;
    }
    setSplitting(true);
    try {
      const ctx = await createCreationContext(projectId, '');
      const splitService = new EpisodeSplitService(ctx);
      const analysis = await splitService.analyzeScript(fullScript, {
        targetEpisodeCount: splitCount,
        splitStrategy: 'auto',
      });
      const splitResults = splitService.splitScript(fullScript, analysis);

      for (const ep of episodes) {
        await deleteEpisode(projectId, ep.id);
      }

      const newEpisodes: Episode[] = [];
      for (let i = 0; i < splitResults.length; i++) {
        const split = splitResults[i];
        const ep = await createEpisode(projectId, {
          number: i + 1,
          title: split.title,
          scriptText: split.scriptText,
          status: 'script',
        });
        newEpisodes.push(ep);
      }

      setEpisodes(newEpisodes);
      setSplitDialogOpen(false);
      message.success(`已分割为 ${newEpisodes.length} 集`);
    } catch (err: any) {
      message.error(`AI 分割失败: ${err?.message || '未知错误'}`);
    } finally {
      setSplitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spin />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 工具栏 */}
      {fullScript && (
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setSplitDialogOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-status-info hover:text-status-info bg-status-info/10 hover:bg-status-info/15 border border-status-info/30 rounded-md transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            AI 分割
          </button>
        </div>
      )}

      {/* 剧集列表 */}
      {episodes.length === 0 ? (
        <Empty description="暂无剧集" className="py-8" />
      ) : (
        <div className="flex flex-col">
          {episodes.map((episode) => {
            const status = statusConfig[episode.status];
            const isSelected = selectedEpisodeId === episode.id;

            return (
              <div
                key={episode.id}
                onClick={() => onEpisodeSelect?.(episode)}
                className={`group flex items-center justify-between h-[72px] px-4 cursor-pointer transition-colors border-b border-border-subtle/80 ${
                  isSelected
                    ? 'bg-accent/10 border-l-[3px] border-l-accent'
                    : 'bg-bg-surface hover:bg-bg-elevated/50 border-l-[3px] border-l-transparent'
                }`}
              >
                {/* Left: Drag + Info */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <GripVertical className="w-4 h-4 text-text-muted opacity-50 cursor-grab" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-text-primary truncate">
                        第 {episode.number} 集: {episode.title}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${status.color}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="text-xs text-text-tertiary truncate pr-4">
                      {episode.scriptText?.slice(0, 50) || '暂无剧本内容...'}
                    </p>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEpisodeSelect?.(episode);
                    }}
                    className="p-1.5 text-accent hover:text-accent border border-accent/50 hover:border-accent rounded-md transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => handleEditClick(episode, e)}
                    className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => handleDeleteEpisode(episode, e)}
                    className="p-1.5 text-status-error hover:text-status-error hover:bg-status-error/12 rounded-md transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 添加剧集按钮 */}
      <button
        onClick={handleAddEpisode}
        disabled={adding}
        className={`flex items-center justify-center gap-2 h-12 border border-dashed rounded-lg text-sm transition-colors ${
          adding
            ? 'border-border text-text-muted cursor-not-allowed'
            : 'border-border hover:border-accent/50 text-text-tertiary hover:text-accent'
        }`}
      >
        <Plus className={`w-4 h-4 ${adding ? 'animate-spin' : ''}`} />
        {adding ? '添加中...' : '添加剧集'}
      </button>

      {/* 编辑对话框 */}
      <Modal
        title={`编辑 - 第 ${editingEpisode?.number} 集`}
        open={editDialogOpen}
        onOk={handleSaveEdit}
        onCancel={() => {
          setEditDialogOpen(false);
          setEditingEpisode(null);
          form.resetFields();
        }}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="number"
            label="集数"
            rules={[
              { required: true, message: '请输入剧集编号' },
              {
                validator: async (_, value) => {
                  if (!Number.isInteger(Number(value)) || Number(value) < 1) {
                    throw new Error('集数必须为大于 0 的整数');
                  }
                },
              },
            ]}
          >
            <InputNumber min={1} precision={0} className="!w-full" placeholder="请输入集数" />
          </Form.Item>
          <Form.Item
            name="title"
            label="剧集标题"
            rules={[{ required: true, message: '请输入剧集标题' }]}
          >
            <Input placeholder="请输入剧集标题" />
          </Form.Item>
          <div className="rounded-lg border border-border-subtle bg-bg-surface px-3 py-2 text-xs text-text-secondary">
            完整剧本内容仅在中间工作台编辑，这里只维护剧集标题等元数据。
          </div>
        </Form>
      </Modal>

      {/* 自动分割对话框 */}
      <Modal
        title="AI 自动分割剧本"
        open={splitDialogOpen}
        onOk={handleAutoSplit}
        onCancel={() => !splitting && setSplitDialogOpen(false)}
        okText={splitting ? '分割中...' : '开始分割'}
        cancelText="取消"
        confirmLoading={splitting}
        closable={!splitting}
        mask={{ closable: !splitting }}
      >
        <p className="text-text-secondary text-sm mb-4">
          优先按原文已存在的分集标题拆分；若原文未分集，再按目标集数规划。现有剧集将被替换。
        </p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">分割成</span>
          <InputNumber
            value={splitCount}
            onChange={(v) => setSplitCount(v || 1)}
            min={1}
            className="!w-20"
          />
          <span className="text-sm text-text-secondary">集</span>
        </div>
      </Modal>
    </div>
  );
});

EpisodeManager.displayName = 'EpisodeManager';

export default EpisodeManager;
