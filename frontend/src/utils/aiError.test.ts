import { describe, expect, it } from 'vitest';
import { classifyAIError, summarizeHTTPErrorDetail } from './aiError';

describe('aiError', () => {
  it('将 504/524 HTML 错误归类为网关超时', () => {
    const error = new Error('API 请求失败 (524): <!DOCTYPE html><html>gateway timeout</html>');
    const result = classifyAIError(error);

    expect(result.kind).toBe('gateway_timeout');
    expect(result.userMessage).toBe('AI 服务网关超时或代理异常，请稍后重试。');
  });

  it('压缩 HTML 网关错误详情', () => {
    const detail = summarizeHTTPErrorDetail(504, '<!DOCTYPE html><html>timeout</html>');
    expect(detail).toContain('网关超时或代理服务异常');
  });

  it('保留普通业务错误消息', () => {
    const result = classifyAIError(new Error('角色提取失败'));
    expect(result.kind).toBe('unknown');
    expect(result.userMessage).toBe('角色提取失败');
  });
});
