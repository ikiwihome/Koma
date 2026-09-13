import { describe, expect, it, vi } from 'vitest';
import { withRetry, withTimeout, delay, computeBackoffDelay } from './retry';

describe('computeBackoffDelay', () => {
  it('first retry uses initialDelay', () => {
    expect(computeBackoffDelay(1, 1000, 2, 30_000)).toBe(1000);
  });
  it('exponential growth', () => {
    expect(computeBackoffDelay(2, 1000, 2, 30_000)).toBe(2000);
    expect(computeBackoffDelay(3, 1000, 2, 30_000)).toBe(4000);
    expect(computeBackoffDelay(4, 1000, 2, 30_000)).toBe(8000);
  });
  it('caps at maxDelayMs', () => {
    expect(computeBackoffDelay(20, 1000, 2, 5000)).toBe(5000);
  });
});

describe('delay', () => {
  it('resolves after timeout', async () => {
    const start = Date.now();
    await delay(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('rejects when signal already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(delay(50, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects when signal aborts during wait', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    await expect(delay(500, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('withTimeout', () => {
  it('resolves when promise wins', async () => {
    const p = new Promise<number>((r) => setTimeout(() => r(42), 5));
    expect(await withTimeout(p, 100)).toBe(42);
  });

  it('rejects with custom message when timeout wins', async () => {
    const p = new Promise<number>((r) => setTimeout(() => r(42), 100));
    await expect(withTimeout(p, 5, '太慢了')).rejects.toThrow('太慢了');
  });
});

describe('withRetry', () => {
  it('returns result on first success without retry', async () => {
    const task = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(task, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('retries until success', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error(`fail ${attempts}`);
        return 'eventually ok';
      },
      { maxAttempts: 5, initialDelayMs: 1, backoffMultiplier: 1 },
    );
    expect(result).toBe('eventually ok');
    expect(attempts).toBe(3);
  });

  it('throws last error after exhausting attempts', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error(`fail ${attempts}`);
        },
        { maxAttempts: 3, initialDelayMs: 1 },
      ),
    ).rejects.toThrow('fail 3');
    expect(attempts).toBe(3);
  });

  it('respects shouldRetry=false (no further attempts)', async () => {
    const task = vi.fn().mockRejectedValue(new Error('permission denied'));
    await expect(
      withRetry(task, {
        maxAttempts: 5,
        initialDelayMs: 1,
        shouldRetry: (err) => !(err as Error).message.includes('permission'),
      }),
    ).rejects.toThrow('permission denied');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry with error/attempt/delay before each retry', async () => {
    const onRetry = vi.fn();
    let attempts = 0;
    await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error(`fail ${attempts}`);
        return 'ok';
      },
      { maxAttempts: 3, initialDelayMs: 1, backoffMultiplier: 2, onRetry },
    );
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect((onRetry.mock.calls[0][0] as Error).message).toBe('fail 1');
    expect(onRetry.mock.calls[0][1]).toBe(1);
    expect(onRetry.mock.calls[0][2]).toBe(1);
    expect((onRetry.mock.calls[1][0] as Error).message).toBe('fail 2');
    expect(onRetry.mock.calls[1][1]).toBe(2);
    expect(onRetry.mock.calls[1][2]).toBe(2);
  });

  it('does not call onRetry on the final failure', async () => {
    const onRetry = vi.fn();
    await expect(
      withRetry(async () => { throw new Error('always'); }, {
        maxAttempts: 2,
        initialDelayMs: 1,
        onRetry,
      }),
    ).rejects.toThrow('always');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('rejects with AbortError when signal aborts mid-wait', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5);
    await expect(
      withRetry(
        async () => { throw new Error('fail'); },
        { maxAttempts: 5, initialDelayMs: 50, signal: ac.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately when signal already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const task = vi.fn().mockResolvedValue('ok');
    await expect(
      withRetry(task, { maxAttempts: 3, signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(task).not.toHaveBeenCalled();
  });

  it('throws when AbortError raised from inside task', async () => {
    const err = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const task = vi.fn().mockRejectedValue(err);
    await expect(withRetry(task, { maxAttempts: 5, initialDelayMs: 1 })).rejects.toBe(err);
    expect(task).toHaveBeenCalledTimes(1); // 不重试
  });

  it('rejects on invalid maxAttempts', async () => {
    await expect(withRetry(async () => 1, { maxAttempts: 0 })).rejects.toThrow(/maxAttempts/);
  });
});
