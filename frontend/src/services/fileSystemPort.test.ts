import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryFileSystemPort,
  resetDefaultFileSystemPort,
  setDefaultFileSystemPort,
  toFileSystemDisplayUrl,
} from './fileSystemPort';

describe('fileSystemPort', () => {
  afterEach(() => {
    resetDefaultFileSystemPort();
  });

  it('resolves local files through the active port and preserves passthrough URLs', async () => {
    const port = createMemoryFileSystemPort({
      files: {
        '/fixtures/example.png': Uint8Array.from([137, 80, 78, 71]),
      },
    });
    setDefaultFileSystemPort(port);

    expect(toFileSystemDisplayUrl('/fixtures/example.png')).toMatch(/^data:image\/png;base64,/);
    expect(toFileSystemDisplayUrl('https://example.com/image.png')).toBe('https://example.com/image.png');
    expect(toFileSystemDisplayUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(toFileSystemDisplayUrl('blob:https://example.com/1')).toBe('blob:https://example.com/1');
    expect(toFileSystemDisplayUrl('koma-local:///tmp/example.png')).toBe('koma-local:///tmp/example.png');
  });

  it('writes files into memory snapshots and tracks parent directories', async () => {
    const port = createMemoryFileSystemPort();

    await port.mkdir('/workspace/assets');
    await port.writeText('/workspace/assets/note.txt', 'hello');
    await port.writeBase64('/workspace/assets/image.png', 'aGVsbG8=');
    await port.writeBytes('/workspace/assets/data.bin', Uint8Array.from([1, 2, 3]));

    const snapshot = port.snapshot();
    const decoder = new TextDecoder();

    expect(snapshot.directories).toContain('/workspace/assets');
    expect(decoder.decode(snapshot.files['/workspace/assets/note.txt'])).toBe('hello');
    expect(Array.from(snapshot.files['/workspace/assets/image.png'])).toEqual([104, 101, 108, 108, 111]);
    expect(Array.from(snapshot.files['/workspace/assets/data.bin'])).toEqual([1, 2, 3]);
  });
});
