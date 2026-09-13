import { describe, expect, it } from 'vitest';

import {
  buildScriptAnalysisChunkFailureMessage,
  formatScriptAnalysisChunkError,
} from './scriptAnalysisErrorSummary';

describe('scriptAnalysisErrorSummary', () => {
  it('keeps JSON parse errors specific', () => {
    const error = new Error('JSON 解析失败: Unexpected token < in JSON at position 0');

    expect(formatScriptAnalysisChunkError(error)).toBe('JSON 解析失败: Unexpected token < in JSON at position 0');
  });

  it('summarizes chunk failures with chunk indexes', () => {
    const message = buildScriptAnalysisChunkFailureMessage('角色', [
      {
        chunkIndex: 1,
        chunkTotal: 2,
        error: new Error('JSON 解析失败: Unexpected token < in JSON at position 0'),
      },
      {
        chunkIndex: 2,
        chunkTotal: 2,
        error: new Error('API 请求失败 (504): <!DOCTYPE html><html>timeout</html>'),
      },
    ]);

    expect(message).toContain('角色提取失败：2/2 个分块失败');
    expect(message).toContain('分块 1/2：JSON 解析失败: Unexpected token < in JSON at position 0');
    expect(message).toContain('分块 2/2：AI 服务网关超时或代理异常，请稍后重试。');
  });

  it('limits verbose chunk details', () => {
    const message = buildScriptAnalysisChunkFailureMessage('场景', [
      { chunkIndex: 1, chunkTotal: 4, error: 'error-1' },
      { chunkIndex: 2, chunkTotal: 4, error: 'error-2' },
      { chunkIndex: 3, chunkTotal: 4, error: 'error-3' },
    ]);

    expect(message).toContain('场景提取失败：3/4 个分块失败');
    expect(message).toContain('分块 1/4：error-1');
    expect(message).toContain('分块 2/4：error-2');
    expect(message).toContain('另 1 个分块失败');
    expect(message).not.toContain('分块 3/4：error-3');
  });
});
