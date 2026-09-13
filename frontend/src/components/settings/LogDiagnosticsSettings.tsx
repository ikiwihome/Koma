import React, { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Statistic } from 'antd';
import { Download, Trash2 } from 'lucide-react';
import { electronService, type DiagnosticsUsageSummary } from '../../services/electronService';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getDefaultZipName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `koma-diagnostics-${stamp}.zip`;
}

export const LogDiagnosticsSettings: React.FC = () => {
  const { message, modal } = App.useApp();
  const [usage, setUsage] = useState<DiagnosticsUsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadUsage = useCallback(async () => {
    if (!electronService.isElectron()) return;
    setLoading(true);
    try {
      const nextUsage = await electronService.diagnostics.getUsage();
      setUsage(nextUsage);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取日志大小失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  const handleExport = async () => {
    if (!electronService.isElectron()) {
      message.warning('仅桌面端支持导出日志');
      return;
    }

    const result = await electronService.dialog.saveFile({
      defaultPath: getDefaultZipName(),
      filters: [{ name: 'Zip', extensions: ['zip'] }],
      title: '导出诊断日志',
    });
    if (result.canceled || !result.filePath) return;

    setExporting(true);
    try {
      await electronService.diagnostics.exportLogs(result.filePath);
      message.success('日志已导出');
      await loadUsage();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出日志失败');
    } finally {
      setExporting(false);
    }
  };

  const handleClearLogs = () => {
    modal.confirm({
      title: '清理日志',
      content: '将删除本机已收集的前端和后端日志。已导出的日志包不会受影响。',
      okText: '清理',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setClearing(true);
        try {
          await electronService.diagnostics.clearLogs();
          message.success('日志已清理');
          await loadUsage();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '清理日志失败');
        } finally {
          setClearing(false);
        }
      },
    });
  };

  if (!electronService.isElectron()) {
    return (
      <Alert
        type="info"
        showIcon
        message="日志与诊断仅桌面端可用"
        description="浏览器预览环境不会写入本地日志文件。"
      />
    );
  }

  return (
    <div className="settings-manager settings-appearance-theme">
      <Card size="small" title="日志占用" className="settings-config-card settings-summary-card">
        <div className="settings-summary-metrics">
          <Statistic
            title="当前大小"
            value={loading ? '计算中' : formatBytes(usage?.totalSize || 0)}
          />
        </div>
      </Card>

      <Card size="small" title="操作" className="settings-config-card settings-config-card-offset">
        <div className="settings-action-list">
          <div className="settings-action-row">
            <div className="settings-action-copy">
              <span className="settings-action-title">导出日志</span>
              <span className="settings-action-desc">生成压缩包，用于问题反馈和排查</span>
            </div>
            <Button type="primary" icon={<Download size={15} />} loading={exporting} onClick={handleExport}>
              导出
            </Button>
          </div>
          <div className="settings-action-row">
            <div className="settings-action-copy">
              <span className="settings-action-title is-danger">清理日志</span>
              <span className="settings-action-desc">释放本机日志占用空间</span>
            </div>
            <Button danger icon={<Trash2 size={15} />} loading={clearing} onClick={handleClearLogs}>
              清理
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default LogDiagnosticsSettings;
