const SIZE_PATTERN = /^(\d{2,5})x(\d{2,5})$/i;

const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  '16:9': '1920x1080',
  '9:16': '1080x1920',
  '1:1': '1024x1024',
  '4:3': '1440x1080',
  '3:4': '1080x1440',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
};

function normalizeSize(value: string | undefined): string | undefined {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(SIZE_PATTERN);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return `${Math.round(width)}x${Math.round(height)}`;
}

function normalizeAspectRatio(value: string | undefined): string | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  const direct = raw.match(/^(\d{1,3})\s*:\s*(\d{1,3})$/);
  if (direct) {
    const width = Number(direct[1]);
    const height = Number(direct[2]);
    if (width > 0 && height > 0) return `${width}:${height}`;
  }
  const size = normalizeSize(raw);
  if (!size) return undefined;
  const [width, height] = size.split('x').map(Number);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export function resolveTTISize(options?: { width?: number; height?: number; aspectRatio?: string }, defaultSize?: string): string | undefined {
  if (typeof options?.width === 'number' && typeof options?.height === 'number') {
    const width = Math.round(options.width);
    const height = Math.round(options.height);
    if (width > 0 && height > 0) return `${width}x${height}`;
  }

  const aspectRatio = normalizeAspectRatio(options?.aspectRatio);
  if (aspectRatio && ASPECT_RATIO_TO_SIZE[aspectRatio]) {
    return ASPECT_RATIO_TO_SIZE[aspectRatio];
  }

  return normalizeSize(defaultSize) || undefined;
}
