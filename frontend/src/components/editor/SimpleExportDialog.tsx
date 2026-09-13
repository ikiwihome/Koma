/**
 * SimpleEditor 导出对话框
 * 支持视频导出和草稿导出（剪映等）
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Modal, Form, Select, InputNumber, Input, Button, Progress, Space, Radio, Segmented, Checkbox, Alert, App } from 'antd';
import { ExportOutlined, FolderOutlined, WarningOutlined } from '@ant-design/icons';
import { Track } from '../../types/editor';
import { SimpleExportRenderer, SimpleExportConfig, SimpleExportProgress } from '../../services/simpleExportRenderer';
import { saveFileDialog, openDirectoryDialog, isElectron, writeFile, createDirectory, fsCopy, fsExists } from '../../services/electronService';
import { exporterRegistry } from '../../services/draftExport';
import type { DraftExportOptions } from '../../services/draftExport';
import { checkExportCompatibility } from '../../services/draftExport/exportCapabilityChecker';
import type { JianyingDraftContent, JianyingDraftMetaInfo } from '../../types/jianying';
import { VIDEO_RESOLUTIONS } from '../../constants/dimensions';
import { createLogger } from '../../store/logger';
import styles from './SimpleExportDialog.module.scss';
import { cssVars } from '../../theme/runtime';

const logger = createLogger('SimpleExportDialog');

/** 今天的日期，固定 YYYY-MM-DD 格式，避免 toLocaleDateString() 在中文 locale 输出 2026/5/3 这种含斜杠形式
 *  导致后续 mkdir 把斜杠当成路径分隔符建出嵌套子目录。*/
function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 清洗草稿/项目名，防止用户输入或默认值包含 / \ : * ? " < > | 等路径非法字符
 *  造成 createSubfolder 时 mkdir(recursive) 建出多层意外目录。
 *  规则：把所有路径分隔符与 Windows 文件名禁用字符替换为连字符；折叠重复连字符；去掉首尾的 `.` 和空白。
 *  保留普通空格（macOS / Windows 都允许带空格的目录名）。*/
function sanitizeFolderName(raw: string): string {
  const cleaned = (raw || '')
    .replace(/[\\/:*?"<>|-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
  return cleaned || `export_${Date.now()}`;
}

interface SimpleExportDialogProps {
  open: boolean;
  onClose: () => void;
  tracks: Track[];
  duration: number;
  canvasSize: { width: number; height: number };
}

type ExportType = 'video' | 'draft';

const VIDEO_FORMAT_OPTIONS = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'webm', label: 'WebM (VP9)' },
  { value: 'gif', label: 'GIF 动图' },
];

const QUALITY_OPTIONS = [
  { value: 'low', label: '低质量 (快速, ~2Mbps)' },
  { value: 'medium', label: '中等质量 (~5Mbps)' },
  { value: 'high', label: '高质量 (~10Mbps)' },
  { value: 'custom', label: '自定义' },
];

const RESOLUTION_PRESETS = [
  { ...VIDEO_RESOLUTIONS['1080p'] },
  { ...VIDEO_RESOLUTIONS['720p'] },
  { ...VIDEO_RESOLUTIONS['480p'] },
  { ...VIDEO_RESOLUTIONS['4K'] },
];

const FPS_OPTIONS = [
  { value: 24, label: '24 fps (电影)' },
  { value: 30, label: '30 fps (标准)' },
  { value: 60, label: '60 fps (流畅)' },
];

export function SimpleExportDialog({ open, onClose, tracks, duration, canvasSize }: SimpleExportDialogProps) {
  const { message, modal } = App.useApp();
  const [videoForm] = Form.useForm();
  const [draftForm] = Form.useForm();
  const [exportType, setExportType] = useState<ExportType>('video');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<SimpleExportProgress | null>(null);
  const exporterRef = useRef<SimpleExportRenderer | null>(null);

  // 监听 fps 字段变化
  const fpsValue = Form.useWatch('fps', videoForm) ?? 30;

  // 路径状态（用于显示）
  const [videoOutputPath, setVideoOutputPath] = useState('');
  const [draftOutputPath, setDraftOutputPath] = useState('');

  // 获取可用的草稿导出器
  const draftExporters = exporterRegistry.getAll();

  // 检测高级特性兼容性
  const compatibilityReport = useMemo(() => checkExportCompatibility(tracks), [tracks]);

  // 同步 canvasSize 到视频表单，并重置草稿表单
  useEffect(() => {
    if (open) {
      videoForm.setFieldsValue({
        width: canvasSize.width,
        height: canvasSize.height,
      });

      // 重置草稿表单默认值
      const defaultDraftFormat = draftExporters[0]?.format || 'jianying';
      draftForm.setFieldsValue({
        draftFormat: defaultDraftFormat,
        projectName: `导出_${todayStamp()}`,
        draftOutputPath: '',
        copyMaterials: true,
        createSubfolder: false,
      });

      // 重置路径状态
      setVideoOutputPath('');
      setDraftOutputPath('');
    }
  }, [open]);

  // 选择视频输出路径
  const handleSelectVideoOutput = useCallback(async () => {
    try {
      const format = videoForm.getFieldValue('videoFormat') || 'mp4';
      const result = await saveFileDialog({
        defaultPath: `export_${Date.now()}.${format}`,
        filters: [
          { name: 'MP4 视频', extensions: ['mp4'] },
          { name: 'WebM 视频', extensions: ['webm'] },
          { name: 'GIF 动图', extensions: ['gif'] },
        ],
      });

      if (!result.canceled && result.filePath) {
        videoForm.setFieldsValue({ videoOutputPath: result.filePath });
        setVideoOutputPath(result.filePath);
      }
    } catch (err) {
      logger.error('Select output failed', err);
    }
  }, [videoForm]);

  // 选择草稿输出目录
  const handleSelectDraftOutput = useCallback(async () => {
    try {
      const result = await openDirectoryDialog();

      if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        draftForm.setFieldsValue({ draftOutputPath: selectedPath });
        setDraftOutputPath(selectedPath);
      }
    } catch (err) {
      logger.error('Select draft output failed', err);
    }
  }, [draftForm]);

  // 视频导出
  const handleVideoExport = useCallback(async () => {
    try {
      const values = await videoForm.validateFields();

      if (!isElectron()) {
        message.error('导出功能需要在桌面应用中使用');
        return;
      }

      const config: SimpleExportConfig = {
        width: values.width,
        height: values.height,
        fps: values.fps,
        format: values.videoFormat,
        quality: values.quality,
        videoBitrate: values.videoBitrate,
        audioBitrate: values.audioBitrate,
        outputPath: values.videoOutputPath,
      };

      setExporting(true);
      setProgress(null);

      const exporter = new SimpleExportRenderer(config);
      exporterRef.current = exporter;

      exporter.onProgress((p) => {
        setProgress(p);
      });

      await exporter.export(tracks, duration);

      modal.success({
        title: '导出完成',
        content: `视频已保存到: ${config.outputPath}`,
      });

      onClose();
    } catch (err) {
      if ((err as Error).message !== 'Export aborted') {
        logger.error('视频导出失败', err);
        modal.error({
          title: '导出失败',
          content: '视频导出过程中出现错误，请检查输出路径和磁盘空间后重试',
        });
      }
    } finally {
      setExporting(false);
      exporterRef.current?.dispose();
      exporterRef.current = null;
    }
  }, [duration, message, onClose, tracks, videoForm]);

  // 草稿导出
  const handleDraftExport = useCallback(async () => {
    try {
      const values = await draftForm.validateFields();

      if (!isElectron()) {
        message.error('导出功能需要在桌面应用中使用');
        return;
      }

      const exporter = exporterRegistry.get(values.draftFormat);
      if (!exporter) {
        message.error('未找到对应的导出器');
        return;
      }

      if (!exporter.canExport(tracks, {
        outputPath: values.draftOutputPath,
        projectName: values.projectName,
        fps: 30,
        copyMaterials: values.copyMaterials || false,
      })) {
        message.error('当前草稿导出前置检查未通过，请先修复非法转场或不支持场景。');
        return;
      }

      setExporting(true);

      // 根据选项决定草稿目录路径
      // createSubfolder=true 时**只新增一层**子目录；项目名先经 sanitizeFolderName 清洗，
      // 防止用户输入或默认值里的 / \ : * ? 等字符被 mkdir(recursive) 当成路径分隔符建出多层嵌套。
      const safeFolderName = sanitizeFolderName(values.projectName);
      const draftFolderPath = values.createSubfolder
        ? `${values.draftOutputPath}/${safeFolderName}`
        : values.draftOutputPath;
      const options: DraftExportOptions = {
        outputPath: draftFolderPath,
        projectName: values.projectName,
        fps: 30,
        copyMaterials: values.copyMaterials || false,
      };

      const result = await exporter.export(tracks, options, canvasSize);

      if (result.success) {
        const exportResult = result as typeof result & {
          draftContent: JianyingDraftContent;
          draftMetaInfo: JianyingDraftMetaInfo;
        };

        // 只在创建子目录选项开启时创建目录
        if (values.createSubfolder) {
          await createDirectory(draftFolderPath);
        }

        // 如果需要复制素材
        if (values.copyMaterials) {
          const materialsDir = `${draftFolderPath}/materials`;
          await createDirectory(materialsDir);

          const materials = exportResult.draftContent.materials;

          // 复制策略（解决"多片段同名 video.mp4 互相覆盖"问题）：
          //  - 同一源文件（path 完全相同）→ 仅复制一次，所有引用该 path 的素材记录共享同一目标，
          //    避免重复 IO；
          //  - 不同源文件但 basename 相同（典型：每个分镜下都叫 video.mp4）→ 给后续命中
          //    者拼上 material id 段（`name__<id8>.ext`），仍冲突再追加 -2 / -3，保证落盘
          //    文件名唯一，避免互相覆盖导致草稿里多个时间线片段共用一份资源。
          const sourceToDest = new Map<string, string>();
          const takenDestNames = new Set<string>();

          const allocateDestName = (srcPath: string, materialId: string, fallbackPrefix: string): string => {
            const baseName = srcPath.split(/[/\\]/).pop() || `${fallbackPrefix}_${materialId}`;
            if (!takenDestNames.has(baseName)) {
              return baseName;
            }
            const dotIdx = baseName.lastIndexOf('.');
            const stem = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
            const ext = dotIdx > 0 ? baseName.slice(dotIdx) : '';
            const idSlug = (materialId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || String(takenDestNames.size + 1);
            let candidate = `${stem}__${idSlug}${ext}`;
            let n = 2;
            while (takenDestNames.has(candidate)) {
              candidate = `${stem}__${idSlug}-${n}${ext}`;
              n += 1;
            }
            return candidate;
          };

          const copyOnce = async (srcPath: string, materialId: string, fallbackPrefix: string): Promise<string | null> => {
            const cached = sourceToDest.get(srcPath);
            if (cached) return cached;
            try {
              if (!(await fsExists(srcPath))) return null;
              const destName = allocateDestName(srcPath, materialId, fallbackPrefix);
              takenDestNames.add(destName);
              const destPath = `${materialsDir}/${destName}`;
              await fsCopy(srcPath, destPath);
              sourceToDest.set(srcPath, destPath);
              return destPath;
            } catch (e) {
              logger.warn(`复制素材失败: ${srcPath}`, e);
              return null;
            }
          };

          // 复制视频 / 图片素材（剪映 materials.videos 同时承载 video / photo 两类）
          for (const video of materials.videos || []) {
            if (video.path && !video.path.startsWith('http')) {
              const dest = await copyOnce(video.path, video.id, 'video');
              if (dest) video.path = dest;
            }
          }

          // 复制音频素材
          for (const audio of materials.audios || []) {
            if (audio.path && !audio.path.startsWith('http')) {
              const dest = await copyOnce(audio.path, audio.id, 'audio');
              if (dest) audio.path = dest;
            }
          }
        }

        // 写入 draft_content.json
        await writeFile(
          `${draftFolderPath}/draft_content.json`,
          JSON.stringify(exportResult.draftContent, null, 2)
        );

        // 写入 draft_meta_info.json
        await writeFile(
          `${draftFolderPath}/draft_meta_info.json`,
          JSON.stringify(exportResult.draftMetaInfo, null, 2)
        );

        modal.success({
          title: '导出完成',
          content: (
            <div>
              <p>草稿已保存到: {draftFolderPath}</p>
              {values.copyMaterials && <p className={styles.successText}>素材已复制到草稿目录</p>}
              {result.warnings && result.warnings.length > 0 && (
                <div className={styles.warningBlock}>
                  <p>警告:</p>
                  <ul>
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ),
        });

        onClose();
      } else {
        logger.error('草稿导出失败', result.error);
        modal.error({
          title: '导出失败',
          content: '草稿导出失败，请检查输出目录权限后重试',
        });
      }
    } catch (err) {
      logger.error('草稿导出异常', err);
      modal.error({
        title: '导出失败',
        content: '导出过程中出现错误，请检查输出路径后重试',
      });
    } finally {
      setExporting(false);
    }
  }, [draftForm, tracks, canvasSize, onClose]);

  const handleExport = useCallback(() => {
    if (exportType === 'video') {
      handleVideoExport();
    } else {
      handleDraftExport();
    }
  }, [exportType, handleVideoExport, handleDraftExport]);

  const handleCancel = useCallback(() => {
    if (exporting) {
      exporterRef.current?.abort();
    } else {
      onClose();
    }
  }, [exporting, onClose]);

  const handleResolutionPreset = useCallback((preset: typeof RESOLUTION_PRESETS[0]) => {
    videoForm.setFieldsValue({
      width: preset.width,
      height: preset.height,
    });
  }, [videoForm]);

  return (
    <Modal
      title="导出"
      open={open}
      onCancel={handleCancel}
      footer={null}
      width={520}
      mask={{ closable: !exporting }}
      closable={!exporting}
    >
      {exporting && progress ? (
        <div className={styles.progressContainer}>
          <Progress
            percent={Math.round(progress.progress)}
            status={progress.stage === 'error' ? 'exception' : 'active'}
          />
          <p className={styles.progressMessage}>{progress.message}</p>
          {progress.stage === 'rendering' && (
            <p className={styles.progressDetail}>
              帧 {progress.currentFrame} / {progress.totalFrames}
              {progress.estimatedTimeRemaining !== undefined && (
                <> · 剩余约 {Math.round(progress.estimatedTimeRemaining)}秒</>
              )}
            </p>
          )}
          <Button
            danger
            onClick={handleCancel}
            className={styles.cancelButton}
          >
            取消导出
          </Button>
        </div>
      ) : (
        <>
          {/* 导出类型选择 */}
          <div className={styles.typeSelector}>
            <Segmented
              value={exportType}
              onChange={(v) => setExportType(v as ExportType)}
              options={[
                { label: '视频导出', value: 'video' },
                { label: '草稿导出', value: 'draft' },
              ]}
              block
            />
          </div>

          {/* 视频导出表单 - 用 display 控制显示隐藏，保证表单字段始终注册 */}
          <div
            className={styles.exportPane}
            style={cssVars({ '--export-pane-display': exportType === 'video' ? 'block' : 'none' })}
          >
            <Form
              form={videoForm}
              layout="vertical"
              initialValues={{
                width: 1920,
                height: 1080,
                fps: 30,
                videoFormat: 'mp4',
                quality: 'medium',
                videoBitrate: 5000,
                audioBitrate: 192,
                videoOutputPath: '',
              }}
            >
              {/* 分辨率预设 */}
              <Form.Item label="分辨率预设">
                <Radio.Group
                  buttonStyle="solid"
                  onChange={(e) => {
                    const preset = RESOLUTION_PRESETS.find(
                      (p) => `${p.width}x${p.height}` === e.target.value
                    );
                    if (preset) handleResolutionPreset(preset);
                  }}
                  defaultValue="1920x1080"
                >
                  {RESOLUTION_PRESETS.map((p) => (
                    <Radio.Button key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>
                      {p.label}
                    </Radio.Button>
                  ))}
                </Radio.Group>
              </Form.Item>

              {/* 自定义分辨率 */}
              <Space>
                <Form.Item name="width" label="宽度" rules={[{ required: true }]}>
                  <InputNumber min={320} max={7680} step={2} suffix="px" />
                </Form.Item>
                <Form.Item name="height" label="高度" rules={[{ required: true }]}>
                  <InputNumber min={240} max={4320} step={2} suffix="px" />
                </Form.Item>
                <Form.Item name="fps" label="帧率" rules={[{ required: true }]}>
                  <Select options={FPS_OPTIONS} className={styles.fpsSelect} />
                </Form.Item>
              </Space>

              {/* 格式和质量 */}
              <Space className={styles.fullWidth}>
                <Form.Item name="videoFormat" label="格式" rules={[{ required: true }]}>
                  <Select options={VIDEO_FORMAT_OPTIONS} className={styles.formatSelect} />
                </Form.Item>
                <Form.Item name="quality" label="质量" rules={[{ required: true }]}>
                  <Select options={QUALITY_OPTIONS} className={styles.qualitySelect} />
                </Form.Item>
              </Space>

              {/* 自定义码率 */}
              <Form.Item noStyle shouldUpdate={(prev, curr) => prev.quality !== curr.quality}>
                {({ getFieldValue }) =>
                  getFieldValue('quality') === 'custom' ? (
                    <Space>
                      <Form.Item name="videoBitrate" label="视频码率">
                        <InputNumber min={500} max={50000} suffix="kbps" />
                      </Form.Item>
                      <Form.Item name="audioBitrate" label="音频码率">
                        <InputNumber min={64} max={512} suffix="kbps" />
                      </Form.Item>
                    </Space>
                  ) : null
                }
              </Form.Item>

              {/* 输出路径 */}
              <Form.Item label="保存位置" required>
                <Space.Compact className={styles.fullWidth}>
                  <Input
                    placeholder="点击选择保存位置"
                    readOnly
                    value={videoOutputPath}
                    className={styles.flexInput}
                  />
                  <Button
                    icon={<FolderOutlined />}
                    onClick={handleSelectVideoOutput}
                  />
                </Space.Compact>
                <Form.Item name="videoOutputPath" hidden noStyle rules={[{ required: true, message: '请选择保存位置' }]}>
                  <Input />
                </Form.Item>
              </Form.Item>

              {/* 高级特性兼容性提示 */}
              {compatibilityReport.jianyingOnlyFeatures.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  icon={<WarningOutlined />}
                  message="部分效果无法原生导出"
                  description={
                    <div>
                      <p>项目使用了以下仅剪映支持的特性：</p>
                      <ul className={styles.compatList}>
                        {compatibilityReport.featureDetails.map((detail) => (
                          <li key={detail.feature}>
                            {detail.name}（{detail.clipCount} 个片段）
                          </li>
                        ))}
                      </ul>
                      <p className={styles.compatHint}>建议使用「草稿导出」以保留这些效果。</p>
                    </div>
                  }
                  className={styles.compatAlert}
                />
              )}

              {/* 视频信息 */}
              <div className={styles.infoBox}>
                <p>时长: {duration.toFixed(1)} 秒</p>
                <p>轨道: {tracks.length} 个</p>
                <p>预计帧数: {Math.ceil(duration * fpsValue)} 帧</p>
              </div>
            </Form>
          </div>

          {/* 草稿导出表单 */}
          <div
            className={styles.exportPane}
            style={cssVars({ '--export-pane-display': exportType === 'draft' ? 'block' : 'none' })}
          >
            <Form
              form={draftForm}
              layout="vertical"
              initialValues={{
                draftFormat: 'jianying',
                projectName: `导出_${todayStamp()}`,
                draftOutputPath: '',
                copyMaterials: true,
                createSubfolder: false,
              }}
            >
              {/* 格式选择 */}
              <Form.Item name="draftFormat" label="导出格式" rules={[{ required: true }]}>
                <Select className={styles.fullWidth}>
                  {draftExporters.map((exp) => (
                    <Select.Option key={exp.format} value={exp.format}>
                      {exp.displayName}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              {/* 草稿名称 */}
              <Form.Item
                name="projectName"
                label="草稿名称"
                rules={[{ required: true, message: '请输入草稿名称' }]}
              >
                <Input placeholder="输入草稿名称" />
              </Form.Item>

              {/* 输出目录 */}
              <Form.Item label="保存目录" required>
                <Space.Compact className={styles.fullWidth}>
                  <Input
                    placeholder="点击选择保存目录"
                    readOnly
                    value={draftOutputPath}
                    className={styles.flexInput}
                  />
                  <Button
                    icon={<FolderOutlined />}
                    onClick={handleSelectDraftOutput}
                  />
                </Space.Compact>
                <Form.Item name="draftOutputPath" hidden noStyle rules={[{ required: true, message: '请选择保存目录' }]}>
                  <Input />
                </Form.Item>
              </Form.Item>

              {/* 创建子目录选项 */}
              <Form.Item name="createSubfolder" valuePropName="checked">
                <Checkbox>创建以草稿名称命名的子目录</Checkbox>
              </Form.Item>

              {/* 复制素材选项 */}
              <Form.Item name="copyMaterials" valuePropName="checked">
                <Checkbox>复制素材到草稿目录（推荐，防止原素材被删除导致草稿失效）</Checkbox>
              </Form.Item>

              {/* 项目信息 */}
              <div className={styles.infoBox}>
                <p>时长: {duration.toFixed(1)} 秒</p>
                <p>轨道: {tracks.length} 个</p>
                <p>画布尺寸: {canvasSize.width} × {canvasSize.height}</p>
                <p className={styles.warningBlock}>
                  提示: 草稿导出后可在对应软件中打开并继续编辑
                </p>
              </div>
            </Form>
          </div>

          {/* 导出按钮 */}
          <div className={styles.footer}>
            <Space>
              <Button onClick={onClose}>取消</Button>
              <Button
                type="primary"
                icon={<ExportOutlined />}
                onClick={handleExport}
                loading={exporting}
              >
                {exporting ? '导出中...' : '开始导出'}
              </Button>
            </Space>
          </div>
        </>
      )}
    </Modal>
  );
}

export default SimpleExportDialog;
