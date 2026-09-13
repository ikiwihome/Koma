import { describe, expect, it } from 'vitest';
import { parseNetError, translateToToast, isChannelNetError, ChannelApiKeyMissingError } from './netError';

describe('parseNetError', () => {
  it('parses structured body { error: { code, message } }', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'conflict_auth_mode', message: 'dup auth' } }),
      { status: 400 },
    );
    const err = await parseNetError(res, 'ch-1');
    expect(err.code).toBe('conflict_auth_mode');
    expect(err.status).toBe(400);
    expect(err.channelId).toBe('ch-1');
    expect(err.i18nKey).toBe('settings.error.conflict_auth_mode');
    expect(err.actionable).toBe(false);
  });

  it('returns ChannelApiKeyMissingError (actionable=true) for channel_api_key_missing', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'channel_api_key_missing', message: 'no key' } }),
      { status: 401 },
    );
    const err = await parseNetError(res, 'ch-2');
    expect(err).toBeInstanceOf(ChannelApiKeyMissingError);
    expect(err.actionable).toBe(true);
  });

  it('falls back to unknown_error on non-JSON response', async () => {
    const res = new Response('plain text error', { status: 500 });
    const err = await parseNetError(res);
    expect(err.code).toBe('unknown_error');
    expect(err.status).toBe(500);
    expect(err.raw).toContain('plain text error');
  });
});

describe('translateToToast', () => {
  it('ChannelNetError → message uses i18n t(i18nKey)', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'channel_api_key_missing', message: 'no key' } }),
      { status: 401 },
    );
    const err = await parseNetError(res, 'ch-1');
    const t = (key: string) => (key === 'settings.error.channel_api_key_missing' ? '该渠道未配置 API Key' : '');
    const toast = translateToToast(err, t);
    expect(toast.message).toBe('该渠道未配置 API Key');
    expect(toast.actionable).toBe(true);
    expect(toast.channelId).toBe('ch-1');
  });

  it('non-ChannelNetError → generic fallback', () => {
    const t = () => '';
    const toast = translateToToast(new Error('network failed'), t);
    expect(toast.actionable).toBe(false);
    expect(toast.description).toBe('network failed');
  });
});

describe('isChannelNetError', () => {
  it('true for parsed errors', async () => {
    const err = await parseNetError(new Response('{}', { status: 500 }));
    expect(isChannelNetError(err)).toBe(true);
  });
  it('false for plain Error', () => {
    expect(isChannelNetError(new Error('x'))).toBe(false);
    expect(isChannelNetError(null)).toBe(false);
  });
});
