import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { subscribeChannelChanges, type ChannelChangedEvent } from './channelConfig';

type Listener = (event: unknown, payload: ChannelChangedEvent) => void;

describe('subscribeChannelChanges', () => {
  let listeners: Map<string, Set<Listener>>;
  const originalElectron = (window as any).electron;

  beforeEach(() => {
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
    if (originalElectron === undefined) {
      delete (window as any).electron;
    } else {
      (window as any).electron = originalElectron;
    }
  });

  it('returns noop unsubscribe when window.electron is missing', () => {
    delete (window as any).electron;
    const handler = vi.fn();
    const unsubscribe = subscribeChannelChanges(handler);
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });

  it('registers listener and forwards payload only (drops electron event arg)', () => {
    const handler = vi.fn();
    subscribeChannelChanges(handler);
    const fn = [...(listeners.get('channel:changed') ?? new Set())][0]!;
    fn({} /* IpcRendererEvent */, { type: 'create', id: 'ch-1', category: 'tti' });
    expect(handler).toHaveBeenCalledWith({ type: 'create', id: 'ch-1', category: 'tti' });
  });

  it('catches handler exceptions so other subscribers can fire', () => {
    const failing = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    subscribeChannelChanges(failing);
    subscribeChannelChanges(ok);
    const subs = [...(listeners.get('channel:changed') ?? new Set())];
    for (const fn of subs) fn({}, { type: 'update', id: 'ch-2' });
    expect(failing).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();
  });

  it('unsubscribe removes the listener', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeChannelChanges(handler);
    expect(listeners.get('channel:changed')?.size).toBe(1);
    unsubscribe();
    expect(listeners.get('channel:changed')?.size).toBe(0);
  });

  it('multiple subscribers each receive payload', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeChannelChanges(a);
    subscribeChannelChanges(b);
    const subs = [...(listeners.get('channel:changed') ?? new Set())];
    for (const fn of subs) fn({}, { type: 'delete', id: 'ch-3' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
