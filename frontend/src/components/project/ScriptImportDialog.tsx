/**
 * 剧本导入对话框
 *
 * 把 ProjectOverview 顶部"导入剧本"流程抽出独立组件，便于在编辑器流程的
 * 剧本步骤里复用同一份业务逻辑，业务行为（替换旧剧集 / AI 自动分集）保持不变。
 *
 * 内部状态：
 * - importVisible：导入文本输入 Modal 显示
 * - splitWizardVisible：AI 自动分集向导显示
 * - tempScript / fullScript：录入与确认中的剧本文本
 *
 * 外部接口：
 * - open / onClose：受控显示
 * - projectId：当前项目
 * - onImported：分集完成后的回调（调用方负责刷新自己的剧集列表 / 资产视图）
 */
import React, { useEffect, useRef, useState } from 'react';
import { App, Button, Modal, Space } from 'antd';
import { ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';
import type { Episode } from '../../types';
import { listEpisodes, deleteEpisode, saveCharacters, saveScenes, saveProps } from '../../store/projectStore';
import { TaskManager } from '../../services/TaskManager';
import { ScriptEditor } from '../../editor';
import { EpisodeSplitWizard } from './EpisodeSplitWizard';
import { useTheme } from '../../theme/runtime';
import { createLogger } from '../../store/logger';

const logger = createLogger('ScriptImportDialog');

interface ScriptImportDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** 默认填入文本输入框（如剧集已有的全文）；可省略 */
  initialScript?: string;
  /** 分集完成后的回调；调用方据此刷新剧集列表 / 资产视图等 */
  onImported?: (episodes: Episode[]) => void;
}

export const ScriptImportDialog: React.FC<ScriptImportDialogProps> = ({
  open,
  onClose,
  projectId,
  initialScript,
  onImported,
}) => {
  const { message } = App.useApp();
  const { theme } = useTheme();
  const isDarkTheme = theme.meta.mode === 'dark';
  const [tempScript, setTempScript] = useState('');
  const [fullScript, setFullScript] = useState('');
  const [splitWizardVisible, setSplitWizardVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 每次 open 切到 true 时，把 initialScript 灌到输入框
  useEffect(() => {
    if (open) {
      setTempScript(initialScript || '');
    }
  }, [open, initialScript]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 复位 input.value 以便相同文件可以再次选择触发 change 事件
    if (event.target) event.target.value = '';
    if (!file) return;

    // 大小保护：避免一次性把超大文件读到内存
    const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_SIZE_BYTES) {
      message.error('文件过大（最大 10 MB），请分段后再导入');
      return;
    }

    try {
      const text = await file.text();
      if (!text.trim()) {
        message.warning('文件内容为空');
        return;
      }
      setTempScript(text);
      message.success(`已读取 ${file.name}（${text.length} 字）`);
    } catch (err: unknown) {
      logger.error('读取文件失败', err);
      message.error('读取文件失败，请检查编码后重试');
    }
  };

  const confirmImport = async () => {
    if (!tempScript.trim()) return;

    onClose();

    // 检查后台分析任务（剧本分析 / 分镜分析）— 在跑时不允许导入
    const runningTasks = TaskManager.getProjectTasks(projectId).filter(task =>
      (task.type === 'script-analysis' || task.type === 'shot-analysis')
      && (task.status === 'pending' || task.status === 'running' || task.status === 'processing')
    );
    if (runningTasks.length > 0) {
      message.warning('当前有分析任务正在执行，请等待完成后再导入');
      return;
    }

    // 检查是否有旧剧集，有则二次确认
    const existingEpisodes = await listEpisodes(projectId);
    if (existingEpisodes.length > 0) {
      Modal.confirm({
        title: '确认替换剧本',
        content: `项目中已有 ${existingEpisodes.length} 个剧集，重新导入将删除全部旧剧集及其分析数据、角色、场景、道具信息。已生成的图片/视频文件将保留。此操作不可撤销。`,
        okText: '确认替换',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            const failedEpisodes: string[] = [];
            for (const ep of existingEpisodes) {
              const ok = await deleteEpisode(projectId, ep.id);
              if (!ok) failedEpisodes.push(ep.title || ep.id);
            }
            if (failedEpisodes.length > 0) {
              message.error(`以下剧集删除失败: ${failedEpisodes.join(', ')}，已中止导入`);
              return;
            }
            await Promise.all([
              saveCharacters(projectId, []),
              saveScenes(projectId, []),
              saveProps(projectId, []),
            ]);
            setFullScript(tempScript);
            setSplitWizardVisible(true);
          } catch (err: unknown) {
            logger.error('清理旧数据失败', err);
            message.error('清理旧数据失败，请重试');
          }
        },
      });
    } else {
      setFullScript(tempScript);
      setSplitWizardVisible(true);
    }
  };

  const handleSplitComplete = (episodes: Episode[]) => {
    setSplitWizardVisible(false);
    setFullScript('');
    onImported?.(episodes);
    if (episodes.length > 0) {
      message.success(`成功创建 ${episodes.length} 个剧集`);
    }
  };

  return (
    <>
      <Modal
        title="导入剧本并自动分割剧集"
        open={open}
        onCancel={onClose}
        onOk={confirmImport}
        okText="AI 自动分集"
        okButtonProps={{
          disabled: !tempScript.trim(),
          icon: <ThunderboltOutlined />,
          title: !tempScript.trim() ? '请先输入剧本内容' : undefined,
        }}
        cancelText="取消"
        width={900}
        centered
        mask={{ closable: false }}
      >
        <div className="flex items-center justify-between mb-3 gap-3">
          <p className="text-xs text-text-tertiary m-0 flex-1">
            输入完整剧本后点击"AI 自动分集"，系统将智能拆分为多个剧集
          </p>
          <Space>
            <Button size="small" icon={<UploadOutlined />} onClick={handleUploadClick}>
              从文件导入
            </Button>
            {tempScript && (
              <Button size="small" type="text" onClick={() => setTempScript('')}>
                清空
              </Button>
            )}
          </Space>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        <ScriptEditor
          value={tempScript}
          onChange={setTempScript}
          placeholder={`粘贴或从文件导入完整剧本内容...\n\n提示：\n- 支持 .txt / .md 文件，点击右上角"从文件导入"\n- 使用 ## 标记场景\n- 使用 **角色名**：标记对话\n- 文本请用"第n章/集"分割，系统将自动识别剧集`}
          minHeight="400px"
          maxHeight="500px"
          showLineNumbers={true}
          darkTheme={isDarkTheme}
          enableCameraCommands={false}
        />
      </Modal>

      <EpisodeSplitWizard
        visible={splitWizardVisible}
        projectId={projectId}
        script={fullScript}
        onCancel={() => setSplitWizardVisible(false)}
        onComplete={handleSplitComplete}
      />
    </>
  );
};

export default ScriptImportDialog;
