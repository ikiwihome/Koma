/**
 * errorHandler 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractErrorMessage,
  handleError,
  handleSilentError,
  createErrorHandler,
  safeAsync,
  safeSync,
  addErrorListener,
  ignoreError,
  catchAndLog,
} from './errorHandler';

describe('errorHandler', () => {
  // 在每个测试前后清理 console mock
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractErrorMessage', () => {
    it('should extract message from Error object', () => {
      const error = new Error('Test error message');
      expect(extractErrorMessage(error)).toBe('Test error message');
    });

    it('should return string error as-is', () => {
      expect(extractErrorMessage('String error')).toBe('String error');
    });

    it('should extract message from object with message property', () => {
      const error = { message: 'Object error message' };
      expect(extractErrorMessage(error)).toBe('Object error message');
    });

    it('should convert other types to string', () => {
      expect(extractErrorMessage(123)).toBe('123');
      expect(extractErrorMessage(null)).toBe('null');
      expect(extractErrorMessage(undefined)).toBe('undefined');
      expect(extractErrorMessage({ foo: 'bar' })).toBe('[object Object]');
    });
  });

  describe('handleError', () => {
    it('should return ErrorResult with correct structure', () => {
      const error = new Error('Test error');
      const result = handleError(error);

      expect(result).toHaveProperty('message', 'Test error');
      expect(result).toHaveProperty('originalError', error);
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('number');
    });

    it('should accept string context', () => {
      const error = new Error('Test error');
      const result = handleError(error, 'TestModule');

      expect(result.context).toEqual({ module: 'TestModule' });
      expect(console.error).toHaveBeenCalledWith(
        '[TestModule] Test error',
        ''
      );
    });

    it('should accept object context', () => {
      const error = new Error('Test error');
      const result = handleError(error, {
        module: 'TestModule',
        action: 'testAction',
        severity: 'warning',
      });

      expect(result.context).toEqual({
        module: 'TestModule',
        action: 'testAction',
        severity: 'warning',
      });
      expect(console.warn).toHaveBeenCalledWith('[TestModule:testAction] Test error');
    });

    it('should log with correct severity level', () => {
      handleError(new Error('info'), { severity: 'info' });
      expect(console.info).toHaveBeenCalled();

      handleError(new Error('warning'), { severity: 'warning' });
      expect(console.warn).toHaveBeenCalled();

      handleError(new Error('error'), { severity: 'error' });
      expect(console.error).toHaveBeenCalled();

      handleError(new Error('critical'), { severity: 'critical' });
      expect(console.error).toHaveBeenCalled();
    });

    it('should include data in log when provided', () => {
      const data = { userId: 123 };
      handleError(new Error('Test'), { data });

      expect(console.error).toHaveBeenCalledWith(
        '[Error] Test',
        { data }
      );
    });
  });

  describe('addErrorListener', () => {
    it('should call listener when error is handled', () => {
      const listener = vi.fn();
      const unsubscribe = addErrorListener(listener);

      handleError(new Error('Test error'));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Test error',
        })
      );

      unsubscribe();
    });

    it('should not call listener after unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = addErrorListener(listener);

      unsubscribe();
      handleError(new Error('Test error'));

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', () => {
      const badListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      const unsubscribe1 = addErrorListener(badListener);
      const unsubscribe2 = addErrorListener(goodListener);

      // Should not throw
      expect(() => handleError(new Error('Test'))).not.toThrow();

      // Good listener should still be called
      expect(goodListener).toHaveBeenCalled();

      unsubscribe1();
      unsubscribe2();
    });
  });

  describe('handleSilentError', () => {
    it('should set silent flag to true', () => {
      const result = handleSilentError(new Error('Silent error'));
      expect(result.context?.silent).toBe(true);
    });

    it('should preserve other context properties', () => {
      const result = handleSilentError(new Error('Silent error'), {
        module: 'TestModule',
        action: 'testAction',
      });

      expect(result.context).toEqual({
        module: 'TestModule',
        action: 'testAction',
        silent: true,
      });
    });
  });

  describe('createErrorHandler', () => {
    it('should create handler with preset module', () => {
      const handleTestError = createErrorHandler('TestModule');
      const result = handleTestError(new Error('Test error'));

      expect(result.context?.module).toBe('TestModule');
    });

    it('should allow action to be specified', () => {
      const handleTestError = createErrorHandler('TestModule');
      const result = handleTestError(new Error('Test error'), 'testAction');

      expect(result.context).toEqual({
        module: 'TestModule',
        action: 'testAction',
      });
    });

    it('should allow additional options', () => {
      const handleTestError = createErrorHandler('TestModule');
      const result = handleTestError(new Error('Test error'), 'testAction', {
        severity: 'warning',
        data: { key: 'value' },
      });

      expect(result.context).toEqual({
        module: 'TestModule',
        action: 'testAction',
        severity: 'warning',
        data: { key: 'value' },
      });
    });
  });

  describe('safeAsync', () => {
    it('should return success result when function succeeds', async () => {
      const result = await safeAsync(async () => 'success');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('success');
      }
    });

    it('should return error result when function throws', async () => {
      const result = await safeAsync<void>(async () => {
        throw new Error('Async error');
      });

      expect(result.success).toBe(false);
      if ('error' in result) {
        expect(result.error.message).toBe('Async error');
      }
    });

    it('should pass context to error handler', async () => {
      const result = await safeAsync<void>(
        async () => {
          throw new Error('Test');
        },
        'TestModule'
      );

      if ('error' in result) {
        expect(result.error.context?.module).toBe('TestModule');
      }
    });
  });

  describe('safeSync', () => {
    it('should return success result when function succeeds', () => {
      const result = safeSync(() => 'success');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('success');
      }
    });

    it('should return error result when function throws', () => {
      const result = safeSync<void>(() => {
        throw new Error('Sync error');
      });

      expect(result.success).toBe(false);
      if ('error' in result) {
        expect(result.error.message).toBe('Sync error');
      }
    });

    it('should pass context to error handler', () => {
      const result = safeSync<void>(
        () => {
          throw new Error('Test');
        },
        { module: 'TestModule', action: 'testAction' }
      );

      if ('error' in result) {
        expect(result.error.context?.module).toBe('TestModule');
        expect(result.error.context?.action).toBe('testAction');
      }
    });
  });

  describe('ignoreError', () => {
    it('should return a function that handles errors silently', () => {
      const handler = ignoreError('TestModule');
      expect(typeof handler).toBe('function');

      // Should not throw
      expect(() => handler(new Error('Test'))).not.toThrow();
    });
  });

  describe('catchAndLog', () => {
    it('should return a function that logs errors', () => {
      const handler = catchAndLog('TestModule');
      expect(typeof handler).toBe('function');

      handler(new Error('Test error'));
      expect(console.error).toHaveBeenCalled();
    });
  });
});
