import { electronService, normalizePath } from './electronService';
import { base64ToBytes, bytesToBase64 } from '../utils/encoding';

export interface FileSystemPortCapabilities {
  readWrite: boolean;
  directoryPicker: boolean;
  nativeLocalPaths: boolean;
}

export interface FileSystemPort {
  name: string;
  capabilities: FileSystemPortCapabilities;
  toDisplayUrl(path: string): string;
  readText(path: string): Promise<string>;
  readBase64(path: string): Promise<string>;
  writeText(path: string, data: string): Promise<void>;
  writeBase64(path: string, base64: string): Promise<void>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  copy(sourcePath: string, targetPath: string): Promise<void>;
  download(url: string, targetPath: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
}

export interface MemoryFileSystemPort extends FileSystemPort {
  snapshot(): { files: Record<string, Uint8Array>; directories: string[] };
  setPickDirectoryResult(path: string | null): void;
}

function normalizeFilePath(path: string): string {
  return normalizePath(String(path || ''));
}

function getParentDirectory(path: string): string | null {
  const normalizedPath = normalizeFilePath(path).replace(/\/+$/g, '');
  const slashIndex = normalizedPath.lastIndexOf('/');
  if (slashIndex <= 0) {
    return null;
  }
  return normalizedPath.slice(0, slashIndex);
}

function inferMimeTypeFromPath(path: string): string {
  const normalized = path.split('?')[0].split('#')[0].toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  if (normalized.endsWith('.mp4')) return 'video/mp4';
  if (normalized.endsWith('.webm')) return 'video/webm';
  if (normalized.endsWith('.mov')) return 'video/quicktime';
  if (normalized.endsWith('.mp3')) return 'audio/mpeg';
  if (normalized.endsWith('.wav')) return 'audio/wav';
  if (normalized.endsWith('.json')) return 'application/json';
  if (normalized.endsWith('.txt') || normalized.endsWith('.md')) return 'text/plain';
  return 'application/octet-stream';
}

export function createElectronFileSystemPort(): FileSystemPort {
  return {
    name: 'electron',
    capabilities: {
      readWrite: electronService.isElectron(),
      directoryPicker: electronService.isElectron(),
      nativeLocalPaths: electronService.isElectron(),
    },
    toDisplayUrl(path: string) {
      return electronService.fs.toLocalUrl(path);
    },
    async readText(path: string) {
      return electronService.fs.readFile(path);
    },
    async readBase64(path: string) {
      return electronService.fs.readFileAsBase64(path);
    },
    async writeText(path: string, data: string) {
      await electronService.fs.writeFile(path, data);
    },
    async writeBase64(path: string, base64: string) {
      await electronService.fs.writeFile(path, base64, true);
    },
    async writeBytes(path: string, data: Uint8Array) {
      await electronService.fs.writeFileBuffer(path, data);
    },
    async mkdir(path: string) {
      await electronService.fs.mkdir(path);
    },
    async exists(path: string) {
      return electronService.fs.exists(path);
    },
    async copy(sourcePath: string, targetPath: string) {
      await electronService.fs.copy(sourcePath, targetPath);
    },
    async download(url: string, targetPath: string) {
      await electronService.fs.downloadFile(url, targetPath);
    },
    async pickDirectory() {
      const result = await electronService.dialog.openDirectory();
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return normalizeFilePath(result.filePaths[0]);
    },
  };
}

export function createMemoryFileSystemPort(options?: {
  files?: Record<string, string | Uint8Array>;
  pickDirectory?: string | null;
  capabilities?: Partial<FileSystemPortCapabilities>;
}): MemoryFileSystemPort {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let pickDirectoryResult = options?.pickDirectory ?? null;

  const ensureParentDirectory = (path: string): void => {
    const parentDirectory = getParentDirectory(path);
    if (parentDirectory) {
      directories.add(parentDirectory);
    }
  };

  for (const [path, value] of Object.entries(options?.files ?? {})) {
    const normalizedPath = normalizeFilePath(path);
    files.set(
      normalizedPath,
      typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value),
    );
    ensureParentDirectory(normalizedPath);
  }

  const port: MemoryFileSystemPort = {
    name: 'memory',
    capabilities: {
      readWrite: options?.capabilities?.readWrite ?? true,
      directoryPicker: options?.capabilities?.directoryPicker ?? false,
      nativeLocalPaths: options?.capabilities?.nativeLocalPaths ?? false,
    },
    toDisplayUrl(path: string) {
      const normalizedPath = normalizeFilePath(path);
      const bytes = files.get(normalizedPath);
      if (!bytes) {
        return normalizedPath;
      }
      return `data:${inferMimeTypeFromPath(normalizedPath)};base64,${bytesToBase64(bytes)}`;
    },
    async readText(path: string) {
      const bytes = files.get(normalizeFilePath(path));
      if (!bytes) {
        throw new Error(`File not found: ${path}`);
      }
      return decoder.decode(bytes);
    },
    async readBase64(path: string) {
      const bytes = files.get(normalizeFilePath(path));
      if (!bytes) {
        throw new Error(`File not found: ${path}`);
      }
      return bytesToBase64(bytes);
    },
    async writeText(path: string, data: string) {
      const normalizedPath = normalizeFilePath(path);
      files.set(normalizedPath, encoder.encode(data));
      ensureParentDirectory(normalizedPath);
    },
    async writeBase64(path: string, base64: string) {
      const normalizedPath = normalizeFilePath(path);
      files.set(normalizedPath, base64ToBytes(base64));
      ensureParentDirectory(normalizedPath);
    },
    async writeBytes(path: string, data: Uint8Array) {
      const normalizedPath = normalizeFilePath(path);
      files.set(normalizedPath, new Uint8Array(data));
      ensureParentDirectory(normalizedPath);
    },
    async mkdir(path: string) {
      directories.add(normalizeFilePath(path));
    },
    async exists(path: string) {
      const normalizedPath = normalizeFilePath(path);
      return files.has(normalizedPath) || directories.has(normalizedPath);
    },
    async copy(sourcePath: string, targetPath: string) {
      const bytes = files.get(normalizeFilePath(sourcePath));
      if (!bytes) {
        throw new Error(`File not found: ${sourcePath}`);
      }
      const normalizedTargetPath = normalizeFilePath(targetPath);
      files.set(normalizedTargetPath, new Uint8Array(bytes));
      ensureParentDirectory(normalizedTargetPath);
    },
    async download(url: string, targetPath: string) {
      const response = await fetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const normalizedTargetPath = normalizeFilePath(targetPath);
      files.set(normalizedTargetPath, bytes);
      ensureParentDirectory(normalizedTargetPath);
    },
    async pickDirectory() {
      return this.capabilities.directoryPicker ? pickDirectoryResult : null;
    },
    snapshot() {
      return {
        files: Object.fromEntries(Array.from(files.entries()).map(([path, value]) => [path, new Uint8Array(value)])),
        directories: Array.from(directories.values()).sort(),
      };
    },
    setPickDirectoryResult(path: string | null) {
      pickDirectoryResult = path ? normalizeFilePath(path) : null;
    },
  };

  return port;
}

let defaultFileSystemPort: FileSystemPort | null = null;

export function getFileSystemPort(): FileSystemPort {
  if (!defaultFileSystemPort) {
    defaultFileSystemPort = createElectronFileSystemPort();
  }
  return defaultFileSystemPort;
}

export function setDefaultFileSystemPort(port: FileSystemPort | null): void {
  defaultFileSystemPort = port;
}

export function resetDefaultFileSystemPort(): void {
  defaultFileSystemPort = null;
}

export function toFileSystemDisplayUrl(source?: string): string | undefined {
  if (!source) return undefined;
  if (
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('data:') ||
    source.startsWith('blob:') ||
    source.startsWith('koma-local://')
  ) {
    return source;
  }
  return getFileSystemPort().toDisplayUrl(source);
}
