import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/safeFetch', () => ({ safeFetch: vi.fn() }));
import { safeFetch } from '../utils/safeFetch';
import { activationService } from './agnesActivationService';

describe('Agnes balance', () => {
  beforeEach(() => vi.mocked(safeFetch).mockReset());
  it('uses billing endpoints, encrypted credentials and converts cents once', async () => {
    vi.mocked(safeFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ hard_limit_usd: 25 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_usage: 1234 })));
    const result = await activationService.getStoredTokenUsage('agnes-default-llm');
    expect(result.data).toMatchObject({ totalGranted: 25, totalUsed: 12.34, totalAvailable: 12.66, quotaPerUnit: 1 });
    expect(safeFetch).toHaveBeenNthCalledWith(1, 'https://api.agnes-ai.cn/v1/dashboard/billing/subscription',
      { headers: { 'x-koma-channel-id': 'agnes-default-llm' } });
    expect(activationService.formatUsdQuota(result.data?.totalAvailable, result.data?.quotaPerUnit)).toBe('$12.66');
  });
  it('rejects malformed balance instead of displaying zero', async () => {
    vi.mocked(safeFetch).mockImplementation(async () => new Response('{}'));
    expect((await activationService.getTokenUsage('test')).success).toBe(false);
  });
  it('rejects HTTP errors', async () => {
    vi.mocked(safeFetch).mockImplementation(async () => new Response('{}', { status: 403 }));
    expect((await activationService.getTokenUsage('test')).success).toBe(false);
  });
});
