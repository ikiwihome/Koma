/**
 * ChannelAuth Strategy 语义对齐测试
 *
 * 背景：Round3 引入 `buildChannelAuthRequest({ mode: 'bearer-header' })` 统一抽象，
 * 但 11 个既有 provider（Sora2/Kling/Runway/Pika/Vidu/CustomITV/Grok2/Gemini3Pro/
 * OpenAICompatTTI/Grok2TTI/...）仍在 `getHeaders()` 里手工拼 x-koma-channel-id 或
 * Bearer header。
 *
 * 此测试锁定"手工版本"与"统一抽象"的语义一致性，避免未来改 auth 规则时
 * 两边失配（已迁移 vs 未迁移 provider 产出不同 header）。
 *
 * 契约：
 *   profileId 存在 → { 'x-koma-channel-id': profileId }
 *   profileId 缺失 → { 'Authorization': `Bearer ${apiKey}` }
 */
import { describe, expect, it } from 'vitest';
import { buildChannelAuthRequest } from './auth';

// 手工版本 —— 摘自 Sora2Provider / KlingProvider / RunwayProvider 等 getHeaders()
function handRolledBearerHeaders(config: { profileId?: string; apiKey?: string }): Record<string, string> {
  if (config.profileId) {
    return { 'x-koma-channel-id': config.profileId };
  }
  return { Authorization: `Bearer ${config.apiKey || ''}` };
}

describe('ChannelAuth · 手工 getHeaders 与 buildChannelAuthRequest 语义对齐', () => {
  it('profileId 存在 → 两者均只发 x-koma-channel-id，不发 Authorization', () => {
    const handRolled = handRolledBearerHeaders({ profileId: 'ch-1', apiKey: 'sk' });
    const built = buildChannelAuthRequest({
      channelId: 'ch-1',
      apiKey: 'sk',
      mode: 'bearer-header',
    }).headers;

    expect(handRolled['x-koma-channel-id']).toBe(built['x-koma-channel-id']);
    expect(handRolled['Authorization']).toBeUndefined();
    expect(built['Authorization']).toBeUndefined();
  });

  it('profileId 缺失 + apiKey 存在 → 两者均 Authorization: Bearer <apiKey>', () => {
    const handRolled = handRolledBearerHeaders({ apiKey: 'sk-xxx' });
    const built = buildChannelAuthRequest({
      apiKey: 'sk-xxx',
      mode: 'bearer-header',
    }).headers;

    expect(handRolled['Authorization']).toBe('Bearer sk-xxx');
    expect(built['Authorization']).toBe('Bearer sk-xxx');
  });

  it('profileId 缺失 + apiKey 也缺失 → 手工版本发 "Bearer "，抽象版拒绝', () => {
    // 手工版本会默默发送空 Bearer（历史行为，上游 401）
    const handRolled = handRolledBearerHeaders({});
    expect(handRolled['Authorization']).toBe('Bearer ');

    // 抽象版本显式抛 channel_api_key_missing，端到端更清晰
    expect(() => buildChannelAuthRequest({ mode: 'bearer-header' })).toThrowError(/channel_api_key_missing/);
  });

  it('profileId 不与 Authorization 同时发送（避免 NetController 400 conflict_auth_mode）', () => {
    const handRolled = handRolledBearerHeaders({ profileId: 'ch-1', apiKey: 'sk' });
    const built = buildChannelAuthRequest({
      channelId: 'ch-1',
      apiKey: 'sk',
      mode: 'bearer-header',
    }).headers;

    // 关键断言：profileId 存在时，Authorization 必须缺席
    expect(handRolled['Authorization']).toBeUndefined();
    expect(built['Authorization']).toBeUndefined();
    expect('x-koma-channel-id' in handRolled).toBe(true);
    expect('x-koma-channel-id' in built).toBe(true);
  });
});
