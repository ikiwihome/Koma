/**
 * 剧本工作室组件
 * 剧本编辑、导入、版本历史管理
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Input,
  Button,
  Space,
  App,
  Modal,
  Typography,
  Dropdown,
  Divider,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SaveOutlined,
  ImportOutlined,
  ExportOutlined,
  HistoryOutlined,
  EditOutlined,
  RobotOutlined,
  ScissorOutlined,
  TeamOutlined,
  EnvironmentOutlined,
  AppstoreOutlined,
  DownOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { electronService } from '../../services/electronService';
import { ScriptEditor } from '../../editor';
import type { MentionItem } from '../../editor';
import { getScriptVersionsKey } from '../../constants/storageKeys';
import styles from './ScriptWorkshop.module.scss';

const { TextArea } = Input;
const { Text } = Typography;

export interface ScriptVersion {
  id: string;
  content: string;
  timestamp: number;
  description?: string;
}

interface ScriptWorkshopProps {
  projectId: string;
  episodeId?: string;
  episodeName?: string;
  initialScript?: string;
  mentionItems?: MentionItem[];
  onScriptChange?: (script: string) => void;
  onStartAnalysis?: (script: string) => void;
  onGenerateShots?: (script: string) => void;
  onExtractEntities?: (script: string, type: 'character' | 'scene' | 'prop') => void;
  onPolishScript?: (script: string) => void;
  onGenerateScript?: (idea: string, style: string, duration: string) => void;
  onRandomGenerate?: (duration: string) => Promise<string>;
  onMentionClick?: (item: MentionItem) => void;
}

export const ScriptWorkshop: React.FC<ScriptWorkshopProps> = ({
  projectId,
  episodeId: _episodeId,
  episodeName: _episodeName,
  initialScript = '',
  mentionItems = [],
  onScriptChange,
  onStartAnalysis,
  onGenerateShots: _onGenerateShots,
  onExtractEntities,
  onPolishScript,
  onGenerateScript,
  onRandomGenerate,
  onMentionClick,
}) => {
  const { message } = App.useApp();
  const [script, setScript] = useState(initialScript);
  const [versions, setVersions] = useState<ScriptVersion[]>([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [randomGenerating, setRandomGenerating] = useState(false);
  const [idea, setIdea] = useState('');
  const [style, setStyle] = useState('治愈');
  const [duration, setDuration] = useState('3');

  // 加载剧本版本历史
  useEffect(() => {
    loadVersions();
  }, [projectId]);

  // 同步初始剧本
  useEffect(() => {
    setScript(initialScript);
  }, [initialScript]);

  const loadVersions = async () => {
    if (!electronService.isElectron()) {
      const data = localStorage.getItem(getScriptVersionsKey(projectId));
      if (data) {
        setVersions(JSON.parse(data));
      }
      return;
    }

    // Electron 环境：从项目目录加载
    try {
      const storagePath = await electronService.getStoragePath?.();
      if (!storagePath) return;
      const versionsPath = `${storagePath}/projects/${projectId}/script-versions.json`;
      const exists = await electronService.fs.exists(versionsPath);
      if (exists) {
        const data = await electronService.fs.readFile(versionsPath);
        setVersions(JSON.parse(data));
      }
    } catch {
      // ignore
    }
  };

  const saveVersion = async (content: string, description?: string) => {
    const newVersion: ScriptVersion = {
      id: `v_${Date.now()}`,
      content,
      timestamp: Date.now(),
      description,
    };

    const updatedVersions = [newVersion, ...versions].slice(0, 50); // 最多 50 个版本

    if (!electronService.isElectron()) {
      localStorage.setItem(getScriptVersionsKey(projectId), JSON.stringify(updatedVersions));
      setVersions(updatedVersions);
      return;
    }

    try {
      const storagePath = await electronService.getStoragePath?.();
      if (!storagePath) return;
      const versionsPath = `${storagePath}/projects/${projectId}/script-versions.json`;
      await electronService.fs.writeFile(versionsPath, JSON.stringify(updatedVersions, null, 2));
      setVersions(updatedVersions);
    } catch {
      // ignore
    }
  };

  const handleScriptChange = useCallback((value: string) => {
    setScript(value);
    onScriptChange?.(value);
  }, [onScriptChange]);

  const handleSave = async () => {
    await saveVersion(script, '手动保存');
    message.success('剧本已保存');
  };

  const handleImport = async () => {
    if (!electronService.isElectron()) {
      // 浏览器环境
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.txt,.md,.fountain';
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (file) {
          const content = await file.text();
          handleScriptChange(content);
          await saveVersion(content, `导入: ${file.name}`);
          message.success('剧本已导入');
        }
      };
      input.click();
      return;
    }

    const result = await electronService.dialog.openFile({
      title: '导入剧本',
      filters: [
        { name: '文本文件', extensions: ['txt', 'md', 'fountain'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (result.filePaths && result.filePaths.length > 0) {
      const content = await electronService.fs.readFile(result.filePaths[0]);
      handleScriptChange(content);
      await saveVersion(content, `导入: ${result.filePaths[0].split('/').pop()}`);
      message.success('剧本已导入');
    }
  };

  const handleExport = async () => {
    if (!electronService.isElectron()) {
      const blob = new Blob([script], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'script.txt';
      a.click();
      URL.revokeObjectURL(url);
      message.success('剧本已导出');
      return;
    }

    const result = await electronService.dialog.saveFile({
      title: '导出剧本',
      defaultPath: 'script.txt',
      filters: [
        { name: '文本文件', extensions: ['txt'] },
        { name: 'Markdown', extensions: ['md'] },
      ],
    });

    if (result.filePath) {
      await electronService.fs.writeFile(result.filePath, script);
      message.success('剧本已导出');
    }
  };

  const handleRestoreVersion = (version: ScriptVersion) => {
    handleScriptChange(version.content);
    setHistoryVisible(false);
    message.success('已恢复到该版本');
  };

  // AI 功能菜单
  const aiMenuItems: MenuProps['items'] = [
    {
      key: 'random',
      icon: <ThunderboltOutlined />,
      label: randomGenerating ? '正在随机生成...' : '随机生成剧本',
      disabled: randomGenerating || !onRandomGenerate,
      onClick: () => handleRandomGenerate(),
    },
    {
      key: 'generate',
      icon: <RobotOutlined />,
      label: '从创意生成剧本',
      onClick: () => setGenerateModalVisible(true),
    },
    {
      key: 'polish',
      icon: <EditOutlined />,
      label: 'AI 润色剧本',
      disabled: !script.trim(),
      onClick: () => onPolishScript?.(script),
    },
    { type: 'divider' },
    {
      key: 'characters',
      icon: <TeamOutlined />,
      label: '提取角色',
      disabled: !script.trim(),
      onClick: () => onExtractEntities?.(script, 'character'),
    },
    {
      key: 'scenes',
      icon: <EnvironmentOutlined />,
      label: '提取场景',
      disabled: !script.trim(),
      onClick: () => onExtractEntities?.(script, 'scene'),
    },
    {
      key: 'props',
      icon: <AppstoreOutlined />,
      label: '提取道具',
      disabled: !script.trim(),
      onClick: () => onExtractEntities?.(script, 'prop'),
    },
  ];

  const handleGenerateFromIdea = async () => {
    if (!idea.trim()) {
      message.warning('请输入创意/灵感');
      return;
    }
    setGenerating(true);
    try {
      await onGenerateScript?.(idea, style, duration);
      setGenerateModalVisible(false);
      setIdea('');
    } finally {
      setGenerating(false);
    }
  };

  // 随机生成剧本
  const handleRandomGenerate = async () => {
    if (!onRandomGenerate) {
      message.warning('随机生成功能未配置');
      return;
    }
    setRandomGenerating(true);
    try {
      const generatedScript = await onRandomGenerate(duration);
      if (generatedScript) {
        handleScriptChange(generatedScript);
        await saveVersion(generatedScript, 'AI 随机生成');
        message.success('剧本随机生成成功！');
      }
    } catch (err: any) {
      message.error(`生成失败: ${err.message}`);
    } finally {
      setRandomGenerating(false);
    }
  };

  return (
    <Card
      title="剧本工作室"
      extra={
        <Space>
          <Button icon={<SaveOutlined />} onClick={handleSave}>
            保存
          </Button>
          <Button icon={<ImportOutlined />} onClick={handleImport}>
            导入
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出
          </Button>
          <Button icon={<HistoryOutlined />} onClick={() => setHistoryVisible(true)}>
            历史
          </Button>
          <Divider type="vertical" />
          <Button
            type="primary"
            icon={<ScissorOutlined />}
            disabled={!script.trim()}
            onClick={() => onStartAnalysis?.(script)}
          >
            AI 解析
          </Button>
          <Dropdown menu={{ items: aiMenuItems }}>
            <Button icon={<RobotOutlined />}>
              更多 <DownOutlined />
            </Button>
          </Dropdown>
        </Space>
      }
      className={styles.rootCard}
      styles={{ body: { height: 'calc(100% - 57px)', padding: 0 } }}
    >
      <ScriptEditor
        value={script}
        onChange={handleScriptChange}
        placeholder="在此输入或粘贴剧本内容...\n\n提示：\n- 使用 @ 可以引用角色、道具或场景\n- 使用 ## 标记场景\n- 使用 **角色名**：标记对话"
        mentionItems={mentionItems}
        onMentionClick={onMentionClick}
        minHeight="100%"
        maxHeight="100%"
        className={styles.editorFill}
      />

      {/* 版本历史 Modal */}
      <Modal
        title="版本历史"
        open={historyVisible}
        onCancel={() => setHistoryVisible(false)}
        footer={null}
        width={600}
        mask={{ closable: false }}
      >
        {versions.length === 0 ? (
          <div className={styles.emptyHistory}>
            暂无历史版本
          </div>
        ) : (
          <div className={styles.versionList}>
            {versions.map((version) => (
              <Card key={version.id} size="small">
                <div className={styles.versionItem}>
                  <div>
                    <div className={styles.versionTime}>{new Date(version.timestamp).toLocaleString()}</div>
                    <Text type="secondary" ellipsis className={styles.versionDescription}>
                      {version.description || version.content.slice(0, 100)}
                    </Text>
                  </div>
                  <Button type="link" onClick={() => handleRestoreVersion(version)}>
                    恢复
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Modal>

      {/* 生成剧本 Modal */}
      <Modal
        title="从创意生成剧本"
        open={generateModalVisible}
        onOk={handleGenerateFromIdea}
        onCancel={() => setGenerateModalVisible(false)}
        okText="生成"
        cancelText="取消"
        confirmLoading={generating}
        mask={{ closable: false }}
      >
        <div className={styles.formBlock}>
          <div className={styles.formLabel}>创意/灵感</div>
          <TextArea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="输入你的创意或故事想法，如：一个程序员意外获得了穿越时空的能力，每次只能穿越5分钟..."
            rows={4}
          />
        </div>
        <Space size="large">
          <div>
            <div className={styles.formLabel}>风格</div>
            <Input
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="治愈/搞笑/悬疑"
              className={styles.styleInput}
            />
          </div>
          <div>
            <div className={styles.formLabel}>时长 (分钟)</div>
            <Input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="3"
              className={styles.durationInput}
            />
          </div>
        </Space>
      </Modal>
    </Card>
  );
};

export default ScriptWorkshop;
