/**
 * 媒体生成结果卡片
 * - 顶部：prompt + 元信息
 * - 中部：图片网格 / 视频
 * - 底部：操作按钮（重新编辑 / 再次生成 / 删除该批次）
 * 生成中显示 Spinner 占位；失败显示错误提示。
 */
import React, { useCallback } from 'react';
import { Spin, Image as AntImage, message } from 'antd';
import { LoadingOutlined, EditOutlined, ReloadOutlined, DeleteOutlined, DownloadOutlined, PaperClipOutlined } from '@ant-design/icons';
import type { ChatImageRef, MediaResultMeta } from './chatMediaGeneration';
import { electronService } from '../../services/electronService';
import { fromKomaLocalUrl } from '../../utils/urlUtils';
import styles from './MediaResultBlock.module.scss';

interface MediaResultBlockProps {
  meta: MediaResultMeta;
  onReedit?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  /** 把这批生成结果（图片）作为参考图加到输入框 pending 队列 */
  onUseAsReference?: (refs: ChatImageRef[]) => void;
}

/**
 * 下载媒体到用户选择的路径。来源可能有三种：
 *   1. koma-local://...  → 已落盘，直接 fs.copy（最可靠，绕过所有网络）
 *   2. https://...       → 走 fs.downloadFile（带 channelId 鉴权）
 *   3. data: / blob:     → 浏览器 anchor download fallback
 *
 * 之前只走 downloadFile，遇到 koma-local:// 在 main 进程被当作 http URL 提交给
 * electronNet.fetch，要么 fetch 抛错 fallback http.get 又因 scheme 不对失败，
 * 要么 volces TOS 类响应头夹杂中文导致 ByteString 报错 → 用户看到"弹了选保存路径
 * 但是没文件"。
 */
async function downloadMediaToLocal(
  primaryUrl: string,
  suggestedName: string,
  fallbackRemoteUrl?: string,
): Promise<void> {
  if (!electronService.isElectron()) {
    const a = document.createElement('a');
    a.href = primaryUrl;
    a.download = suggestedName;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }
  const saveResult = await electronService.dialog.saveFile({
    defaultPath: suggestedName,
    title: '保存到本地',
  });
  if (saveResult?.canceled || !saveResult?.filePath) return;

  try {
    // 1. koma-local:// → 直接 fs.copy
    if (primaryUrl.startsWith('koma-local://')) {
      const fsPath = fromKomaLocalUrl(primaryUrl);
      await electronService.fs.copy(fsPath, saveResult.filePath);
      message.success(`已保存到 ${saveResult.filePath}`);
      return;
    }
    // 2. http(s):// → 走 downloadFile
    if (/^https?:\/\//i.test(primaryUrl)) {
      const result = await electronService.fs.downloadFile(primaryUrl, saveResult.filePath);
      if (!result?.success) {
        // 远程下载失败 → 如果有 fallback（应该不会到这里，因为 primary 已经是 remote）
        if (fallbackRemoteUrl && fallbackRemoteUrl !== primaryUrl) {
          const fb = await electronService.fs.downloadFile(fallbackRemoteUrl, saveResult.filePath);
          if (fb?.success) {
            message.success(`已保存到 ${saveResult.filePath}`);
            return;
          }
        }
        message.error('下载失败');
        return;
      }
      message.success(`已保存到 ${saveResult.filePath}`);
      return;
    }
    // 3. 其它（data: / blob:） — 不在 Electron 里支持
    message.error('不支持的下载源类型');
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // 主路径失败且有 fallback remote URL，再尝试一次
    if (fallbackRemoteUrl && fallbackRemoteUrl !== primaryUrl && /^https?:\/\//i.test(fallbackRemoteUrl)) {
      try {
        const fb = await electronService.fs.downloadFile(fallbackRemoteUrl, saveResult.filePath);
        if (fb?.success) {
          message.success(`已保存到 ${saveResult.filePath}`);
          return;
        }
      } catch {
        // ignore，落到下面 toast
      }
    }
    message.error(`下载失败：${errMsg}`);
  }
}

const MODE_LABEL: Record<MediaResultMeta['mode'], string> = {
  'text-to-image': '图片创作',
  'image-to-image': '图片创作',
  'text-to-video': '视频创作',
  'image-to-video': '视频创作',
  'start-end-to-video': '视频创作',
  'reference-to-video': '视频创作',
};

export const MediaResultBlock: React.FC<MediaResultBlockProps> = ({
  meta,
  onReedit,
  onRegenerate,
  onDelete,
  onUseAsReference,
}) => {
  const handleDownloadOne = useCallback(async (img: ChatImageRef, idx: number) => {
    const ext = img.mimeType?.includes('png') ? 'png' : img.mimeType?.includes('webp') ? 'webp' : 'jpg';
    await downloadMediaToLocal(
      img.source,
      `koma-image-${Date.now()}-${idx + 1}.${ext}`,
      img.remoteUrl,
    );
  }, []);
  const handleDownloadVideo = useCallback(async () => {
    if (!meta.video) return;
    await downloadMediaToLocal(meta.video, `koma-${meta.mode}-${Date.now()}.mp4`);
  }, [meta.video, meta.mode]);
  const metaLine: string[] = [];
  if (meta.modelLabel) metaLine.push(meta.modelLabel);
  if (meta.aspectRatio) metaLine.push(meta.aspectRatio);
  if (meta.resolution && meta.mode !== 'image-to-video') metaLine.push(meta.resolution);
  if (meta.duration && meta.mode === 'image-to-video') metaLine.push(`${meta.duration}s`);
  if (meta.count && meta.count > 1) metaLine.push(`${meta.count} 张`);

  const imagesCount = meta.images?.length ?? 0;

  return (
    <div className={styles.card}>
      {/* 头部：prompt + 元信息 + ReAct 思考 */}
      <div className={styles.header}>
        <div className={styles.prompt}>{meta.prompt || `（${MODE_LABEL[meta.mode]}）`}</div>
        {metaLine.length > 0 && (
          <div className={styles.metaLine}>
            {metaLine.map((t, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className={styles.metaDivider}>|</span>}
                <span>{t}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        {meta.thought && (
          <div className={styles.thought}>
            <span className={styles.thoughtLabel}>💭 推理</span>
            <span>{meta.thought}</span>
          </div>
        )}
      </div>

      {/* 主内容区 */}
      <div className={styles.body}>
        {meta.generating && (
          <div className={styles.placeholder}>
            <Spin indicator={<LoadingOutlined className={styles.loadingIcon} spin />} />
            <span>正在{MODE_LABEL[meta.mode]}...</span>
          </div>
        )}

        {!meta.generating && meta.error && (
          <div className={styles.errorBlock}>
            <span>{MODE_LABEL[meta.mode]}失败</span>
            <span className={styles.errorMsg}>{meta.error}</span>
          </div>
        )}

        {!meta.generating && !meta.error && imagesCount > 0 && (
          <div className={styles.imageGrid}>
            <AntImage.PreviewGroup>
              {meta.images!.map((img, idx) => (
                <div key={img.id} className={styles.imageItem}>
                  <AntImage
                    src={img.source}
                    alt={img.label}
                    width={160}
                    height={160}
                    rootClassName={styles.imageWrapper}
                    className={styles.image}
                    preview={{ mask: '点击查看大图' }}
                  />
                  <div className={styles.imageOverlay}>
                    {onUseAsReference && (
                      <button
                        type="button"
                        className={styles.imageOverlayBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUseAsReference([img]);
                        }}
                        title="作为参考图"
                      >
                        <PaperClipOutlined />
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.imageOverlayBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDownloadOne(img, idx);
                      }}
                      title="下载到本地"
                    >
                      <DownloadOutlined />
                    </button>
                  </div>
                </div>
              ))}
            </AntImage.PreviewGroup>
          </div>
        )}

        {!meta.generating && !meta.error && meta.video && (
          <div className={styles.videoItem}>
            <video
              className={styles.video}
              src={meta.video}
              controls
              // 屏蔽 Chromium 原生 3-dot 菜单的"下载" —— 它对 koma-local:// 协议不工作。
              // 用户走我们下方的下载按钮（走 fs.copy / fs.downloadFile）。
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
              poster={meta.images?.[0]?.source}
            />
            <div className={styles.videoOverlay}>
              <button
                type="button"
                className={styles.imageOverlayBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDownloadVideo();
                }}
                title="下载视频"
              >
                <DownloadOutlined />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 操作栏：单图操作（下载 / 作为参考）已在每张图 hover 时显示，这里只剩批次级动作 */}
      {!meta.generating && !meta.error && (
        <div className={styles.actions}>
          {onReedit && (
            <button type="button" className={styles.actionButton} onClick={onReedit}>
              <EditOutlined />
              <span>重新编辑</span>
            </button>
          )}
          {onRegenerate && (
            <button type="button" className={styles.actionButton} onClick={onRegenerate}>
              <ReloadOutlined />
              <span>再次生成</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionDanger}`}
              onClick={onDelete}
            >
              <DeleteOutlined />
              <span>删除该批次</span>
            </button>
          )}
        </div>
      )}
      {!meta.generating && meta.error && onDelete && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionDanger}`}
            onClick={onDelete}
          >
            <DeleteOutlined />
            <span>删除该批次</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default MediaResultBlock;
