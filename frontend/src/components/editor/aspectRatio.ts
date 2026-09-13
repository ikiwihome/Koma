// 预设比例（从 SimplePlayer 提取，避免破坏 React Fast Refresh）
export type AspectRatio = '16:9' | '9:16' | '4:3' | '1:1';

export const ASPECT_RATIOS: { label: string; value: AspectRatio; ratio: number }[] = [
  { label: '16:9', value: '16:9', ratio: 16 / 9 },
  { label: '9:16', value: '9:16', ratio: 9 / 16 },
  { label: '4:3', value: '4:3', ratio: 4 / 3 },
  { label: '1:1', value: '1:1', ratio: 1 },
];

export function getCanvasSize(aspectRatio: AspectRatio): { width: number; height: number } {
  const ratio = ASPECT_RATIOS.find(r => r.value === aspectRatio)?.ratio || 16 / 9;
  if (ratio >= 1) {
    return { width: 1920, height: Math.round(1920 / ratio) };
  } else {
    return { width: Math.round(1080 * ratio), height: 1080 };
  }
}
