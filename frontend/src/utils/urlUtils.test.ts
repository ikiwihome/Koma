/**
 * urlUtils 单元测试
 * 协议规范：koma-local://files/<encoded path>（唯一形式，无兼容旧格式）
 */
import { describe, it, expect } from 'vitest';
import { toKomaLocalUrl, fromKomaLocalUrl } from './urlUtils';

describe('urlUtils', () => {
  describe('toKomaLocalUrl', () => {
    it('should return empty string for empty input', () => {
      expect(toKomaLocalUrl('')).toBe('');
    });

    it('should return http URLs unchanged', () => {
      const url = 'http://example.com/image.png';
      expect(toKomaLocalUrl(url)).toBe(url);
    });

    it('should return https URLs unchanged', () => {
      const url = 'https://example.com/image.png';
      expect(toKomaLocalUrl(url)).toBe(url);
    });

    it('should return koma-local URLs unchanged', () => {
      const url = 'koma-local://files/path/to/file.png';
      expect(toKomaLocalUrl(url)).toBe(url);
    });

    it('should return data URLs unchanged', () => {
      const url = 'data:image/png;base64,iVBORw0KGgo=';
      expect(toKomaLocalUrl(url)).toBe(url);
    });

    it('should return blob URLs unchanged', () => {
      const url = 'blob:http://localhost:3000/abc-123';
      expect(toKomaLocalUrl(url)).toBe(url);
    });

    it('should convert Unix local path to koma-local URL', () => {
      const path = '/home/user/images/photo.png';
      expect(toKomaLocalUrl(path)).toBe('koma-local://files/home/user/images/photo.png');
    });

    it('should convert Windows local path to koma-local URL', () => {
      const path = 'C:\\Users\\user\\images\\photo.png';
      expect(toKomaLocalUrl(path)).toBe('koma-local://files/C%3A/Users/user/images/photo.png');
    });

    it('should handle relative paths', () => {
      const path = 'images/photo.png';
      expect(toKomaLocalUrl(path)).toBe('koma-local://files/images/photo.png');
    });

    it('should encode spaces in path segments', () => {
      const path = '/home/user/my images/photo.png';
      expect(toKomaLocalUrl(path)).toBe('koma-local://files/home/user/my%20images/photo.png');
    });

    it('should encode CJK characters in path segments', () => {
      const path = '/home/user/图片/照片.png';
      expect(toKomaLocalUrl(path)).toBe(
        'koma-local://files/home/user/%E5%9B%BE%E7%89%87/%E7%85%A7%E7%89%87.png'
      );
    });
  });

  describe('fromKomaLocalUrl', () => {
    it('should return empty string for empty input', () => {
      expect(fromKomaLocalUrl('')).toBe('');
    });

    it('should extract Unix path from koma-local URL', () => {
      const url = 'koma-local://files/home/user/images/photo.png';
      expect(fromKomaLocalUrl(url)).toBe('/home/user/images/photo.png');
    });

    it('should extract Windows path from koma-local URL (drop pseudo leading slash)', () => {
      const url = 'koma-local://files/C%3A/Users/user/images/photo.png';
      expect(fromKomaLocalUrl(url)).toBe('C:/Users/user/images/photo.png');
    });

    it('should return http URLs unchanged', () => {
      const url = 'http://example.com/image.png';
      expect(fromKomaLocalUrl(url)).toBe(url);
    });

    it('should return https URLs unchanged', () => {
      const url = 'https://example.com/image.png';
      expect(fromKomaLocalUrl(url)).toBe(url);
    });

    it('should return data URLs unchanged', () => {
      const url = 'data:image/png;base64,iVBORw0KGgo=';
      expect(fromKomaLocalUrl(url)).toBe(url);
    });

    it('should return blob URLs unchanged', () => {
      const url = 'blob:http://localhost:3000/abc-123';
      expect(fromKomaLocalUrl(url)).toBe(url);
    });

    it('should return local paths unchanged', () => {
      const path = '/home/user/images/photo.png';
      expect(fromKomaLocalUrl(path)).toBe(path);
    });

    it('should decode encoded spaces', () => {
      const url = 'koma-local://files/home/user/my%20images/photo.png';
      expect(fromKomaLocalUrl(url)).toBe('/home/user/my images/photo.png');
    });

    it('should decode encoded CJK characters', () => {
      const url = 'koma-local://files/home/user/%E5%9B%BE%E7%89%87/%E7%85%A7%E7%89%87.png';
      expect(fromKomaLocalUrl(url)).toBe('/home/user/图片/照片.png');
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve POSIX absolute path after round-trip', () => {
      const originalPath = '/home/user/images/photo.png';
      const url = toKomaLocalUrl(originalPath);
      const extractedPath = fromKomaLocalUrl(url);
      expect(extractedPath).toBe(originalPath);
    });

    it('should preserve Windows path after round-trip', () => {
      const originalPath = 'C:/Users/user/images/photo.png';
      const url = toKomaLocalUrl(originalPath);
      const extractedPath = fromKomaLocalUrl(url);
      expect(extractedPath).toBe(originalPath);
    });

    it('should preserve POSIX path with spaces after round-trip', () => {
      const originalPath = '/home/user/my images/photo.png';
      const url = toKomaLocalUrl(originalPath);
      expect(fromKomaLocalUrl(url)).toBe(originalPath);
    });

    it('should preserve POSIX path with CJK after round-trip', () => {
      const originalPath = '/home/user/图片/照片.png';
      const url = toKomaLocalUrl(originalPath);
      expect(fromKomaLocalUrl(url)).toBe(originalPath);
    });
  });
});
