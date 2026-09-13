import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Project } from '../../types';
import { Plus, Clock, Search, MoreHorizontal, FileText, Film, PlayCircle, CheckCircle2, Trash2, FolderPlus } from 'lucide-react';
import { Dropdown, Modal } from 'antd';
import type { MenuProps } from 'antd';

interface ProjectListProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject?: (id: string) => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  onSelectProject,
  onCreateProject,
  onDeleteProject
}) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'script' | 'video' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  const statusConfig = {
    'script': { label: t('project.statusScript'), color: 'text-status-info', bg: 'bg-status-info/10', icon: FileText },
    'storyboard': { label: t('project.statusStoryboard'), color: 'text-status-info', bg: 'bg-status-info/10', icon: Film },
    'generating': { label: t('project.statusGenerating'), color: 'text-status-warning', bg: 'bg-status-warning/10', icon: PlayCircle },
    'completed': { label: t('project.statusCompleted'), color: 'text-status-success', bg: 'bg-status-success/10', icon: CheckCircle2 }
  };

  const filteredProjects = projects.filter(p => {
    const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === 'all'
      ? true
      : filter === 'completed'
        ? p.status === 'completed'
        : filter === 'video'
          ? (p.status === 'storyboard' || p.status === 'generating')
          : p.status === 'script';
    return matchesSearch && matchesFilter;
  });

  const handleDeleteConfirm = () => {
    if (projectToDelete && onDeleteProject) {
      onDeleteProject(projectToDelete.id);
    }
    setDeleteModalVisible(false);
    setProjectToDelete(null);
  };

  const getDropdownItems = (project: Project): MenuProps['items'] => [
    {
      key: 'delete',
      label: t('project.deleteProject'),
      icon: <Trash2 className="w-4 h-4" />,
      danger: true,
      onClick: (info) => {
        info.domEvent.stopPropagation();
        setProjectToDelete(project);
        setDeleteModalVisible(true);
      },
    },
  ];

  // 是否真的没有项目（而不是筛选后无结果）
  const hasNoProjects = projects.length === 0;
  // 筛选后无结果
  const isFilterEmpty = !hasNoProjects && filteredProjects.length === 0;

  return (
    <div className="flex flex-col h-full bg-bg-app overflow-y-auto">
      {/* 紧凑头部 */}
      <div className="sticky top-0 z-20 bg-bg-app/95 backdrop-blur border-b border-border-subtle px-6 py-3">
        <div className="w-full flex items-center justify-between gap-4">
          {/* 左侧：标题 */}
          <h1 className="text-xl font-bold text-text-primary whitespace-nowrap">{t('project.myProjects')}</h1>

          {/* 中间：搜索和筛选 */}
          <div className="flex-1 flex items-center justify-center gap-2 max-w-xl">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                placeholder={`${t('common.search')}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-bg-surface border border-border-subtle text-sm text-text-primary placeholder-text-muted pl-9 pr-3 py-1.5 rounded-md focus:outline-none focus:border-border"
              />
            </div>
            <div className="flex gap-0.5 bg-bg-surface p-0.5 rounded-md border border-border-subtle">
              {(['all', 'script', 'video', 'completed'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                    filter === f
                      ? 'bg-bg-hover text-text-primary'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {f === 'all' ? t('common.all') : f === 'script' ? t('project.statusScript') : f === 'video' ? t('project.statusInProgress') : t('project.statusCompleted')}
                </button>
              ))}
            </div>
          </div>

          {/* 右侧：新建按钮（有项目时显示） */}
          {!hasNoProjects && (
            <button
              onClick={onCreateProject}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('project.new')}</span>
            </button>
          )}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 p-6">
        <div className="w-full px-6">
          {/* 空状态：没有任何项目 */}
          {hasNoProjects && (
            <div className="flex flex-col items-center justify-center py-20">
              <button
                onClick={onCreateProject}
                className="group w-full max-w-md py-8 bg-bg-surface border-2 border-dashed border-border hover:border-accent/50 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-bg-elevated/50"
              >
                <div className="w-16 h-16 rounded-full bg-bg-elevated group-hover:bg-accent/15 flex items-center justify-center mb-4 transition-colors">
                  <FolderPlus className="w-8 h-8 text-text-tertiary group-hover:text-accent" />
                </div>
                <span className="text-lg font-bold text-text-secondary group-hover:text-text-primary transition-colors">{t('project.createFirst')}</span>
                <span className="text-sm text-text-muted mt-1">{t('project.startJourney')}</span>
              </button>
            </div>
          )}

          {/* 筛选后无结果 */}
          {isFilterEmpty && (
            <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
              <Search className="w-12 h-12 mb-4 opacity-20" />
              <p>{t('project.noMatchingProjects')}</p>
              <button
                onClick={() => { setSearchQuery(''); setFilter('all'); }}
                className="mt-4 text-sm text-accent hover:underline"
              >
                {t('project.clearFilters')}
              </button>
            </div>
          )}

          {/* 项目列表 */}
          {filteredProjects.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-6">
              {filteredProjects.map((project) => {
                const StatusIcon = statusConfig[project.status]?.icon || FileText;
                const statusCfg = statusConfig[project.status];

                return (
                  <div
                    key={project.id}
                    onClick={() => onSelectProject(project.id)}
                    className="group bg-bg-surface rounded-xl border border-border-subtle hover:border-accent/40 p-4 cursor-pointer transition-all hover:shadow-lg hover:shadow-accent/5"
                  >
                    {/* 顶部：状态和操作 */}
                    <div className="flex items-center justify-between mb-3">
                      <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${statusCfg?.bg || 'bg-bg-elevated'}`}>
                        <StatusIcon className={`w-3 h-3 ${statusCfg?.color || 'text-text-secondary'}`} />
                        <span className={`text-[10px] font-bold ${statusCfg?.color || 'text-text-secondary'}`}>
                          {statusCfg?.label}
                        </span>
                      </div>
                      <Dropdown
                        menu={{ items: getDropdownItems(project) }}
                        trigger={['click']}
                        placement="bottomRight"
                      >
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </Dropdown>
                    </div>

                    {/* 标题 */}
                    <h3 className="text-base font-bold text-text-primary mb-2 truncate group-hover:text-accent transition-colors">
                      {project.title}
                    </h3>

                    {/* 进度条 (仅生成中显示) */}
                    {project.status === 'generating' && (
                      <div className="h-1 bg-bg-elevated rounded-full mb-2 overflow-hidden">
                        <div className="h-full bg-status-warning w-2/3 animate-pulse rounded-full" />
                      </div>
                    )}

                    {/* 标签和信息 */}
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <span className="text-[10px] font-medium text-text-tertiary bg-bg-elevated px-1.5 py-0.5 rounded">
                        {project.genre}
                      </span>
                      {project.mode === 'narration' && (
                        <span className="text-[10px] font-medium text-status-info bg-status-info/10 px-1.5 py-0.5 rounded">
                          {t('project.narration')}
                        </span>
                      )}
                      <span className="text-[10px] text-text-muted">{project.episodes} {t('project.episodes')}</span>
                    </div>

                    {/* 底部：时间 */}
                    <div className="flex items-center text-xs text-text-muted">
                      <Clock className="w-3 h-3 mr-1" />
                      {project.lastEdited}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <Modal
        title={t('project.confirmDelete')}
        open={deleteModalVisible}
        onOk={handleDeleteConfirm}
        onCancel={() => { setDeleteModalVisible(false); setProjectToDelete(null); }}
        okText={t('project.confirmDeleteBtn')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}
        mask={{ closable: false }}
      >
        <div className="py-4">
          <p className="text-text-secondary mb-2">
            {t('project.deleteConfirmMsg')} <strong className="text-text-primary">{projectToDelete?.title}</strong>?
          </p>
          <p className="text-status-error text-sm">
            {t('project.deleteWarning')}
          </p>
        </div>
      </Modal>
    </div>
  );
};
