import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useChannelChangesVersion,
  __resetChannelChangesVersionForTest,
} from './useChannelChangesVersion';

type Listener = (event: unknown, payload: unknown) => void;

describe('useChannelChangesVersion', () => {
  let listeners: Map<string, Set<Listener>>;
  const originalElectron = (window as any).electron;

  beforeEach(() => {
    __resetChannelChangesVersionForTest();
    listeners = new Map();
    (window as any).electron = {
      ipcRenderer: {
        on: (channel: string, fn: Listener) => {
          if (!listeners.has(channel)) listeners.set(channel, new Set());
          listeners.get(channel)!.add(fn);
        },
        removeListener: (channel: string, fn: Listener) => {
          listeners.get(channel)?.delete(fn);
        },
      },
    };
  });

  afterEach(() => {
    __resetChannelChangesVersionForTest();
    if (originalElectron === undefined) {
      delete (window as any).electron;
    } else {
      (window as any).electron = originalElectron;
    }
  });

  it('returns 0 initially', () => {
    const { result } = renderHook(() => useChannelChangesVersion());
    expect(result.current).toBe(0);
  });

  it('increments version on channel:changed', () => {
    const { result } = renderHook(() => useChannelChangesVersion());
    expect(result.current).toBe(0);
    act(() => {
      const subs = [...(listeners.get('channel:changed') ?? new Set())];
      for (const fn of subs) fn({}, { type: 'create', id: 'ch-1' });
    });
    expect(result.current).toBe(1);
  });

  it('shares version across multiple components', () => {
    const a = renderHook(() => useChannelChangesVersion());
    const b = renderHook(() => useChannelChangesVersion());
    act(() => {
      const subs = [...(listeners.get('channel:changed') ?? new Set())];
      for (const fn of subs) fn({}, { type: 'update', id: 'ch-2' });
    });
    expect(a.result.current).toBe(1);
    expect(b.result.current).toBe(1);
  });

  it('registers IPC listener only once for multiple subscribers', () => {
    renderHook(() => useChannelChangesVersion());
    renderHook(() => useChannelChangesVersion());
    expect(listeners.get('channel:changed')?.size).toBe(1);
  });

  it('removes IPC listener when last subscriber unmounts', () => {
    const a = renderHook(() => useChannelChangesVersion());
    const b = renderHook(() => useChannelChangesVersion());
    expect(listeners.get('channel:changed')?.size).toBe(1);
    a.unmount();
    expect(listeners.get('channel:changed')?.size).toBe(1);
    b.unmount();
    expect(listeners.get('channel:changed')?.size).toBe(0);
  });
});
