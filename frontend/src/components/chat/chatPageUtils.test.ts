import { describe, expect, it } from 'vitest';
import {
  CHAT_AUTH_ERROR_MESSAGE,
  formatChatErrorMessage,
} from './chatPageUtils';

describe('chatPageUtils', () => {
  it('鉴权错误显示友好提示且不保留 API Key', () => {
    const formatted = formatChatErrorMessage(
      new Error('401 Incorrect API key provided: sk-xxxx. You can find your API key at https://platform.openai.com/account/api-keys.'),
    );

    expect(formatted).toBe(CHAT_AUTH_ERROR_MESSAGE);
    expect(formatted).not.toContain('sk-xxxx');
  });

  it('非鉴权错误会脱敏常见 API Key 片段', () => {
    const formatted = formatChatErrorMessage(
      'provider failed with sk-abcdefghijklmnop xai-abcdefghi AIzaSyA1234567890abcdef and Bearer secret-token-123456',
    );

    expect(formatted).toContain('[REDACTED_API_KEY]');
    expect(formatted).not.toContain('sk-abcdefghijklmnop');
    expect(formatted).not.toContain('xai-abcdefghi');
    expect(formatted).not.toContain('AIzaSyA1234567890abcdef');
    expect(formatted).not.toContain('secret-token-123456');
  });
});
