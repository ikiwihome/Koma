import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wrapTaskBackedLLM } from './TaskBackedLLMProvider';
import type { LLMProvider } from './types';
import type { TaskRecord } from '../../services/tasksIPC';

function makeFakeProvider(): LLMProvider {
  return {
    type: 'fake',
    config: {
      provider: 'openai-compatible',
      modelName: 'gpt-4o',
      apiKey: 'sk',
    } as any,
    validate: () => true,
    testConnection: async () => true,
    generateText: vi.fn(async () => 'fake-direct'),
    chat: vi.fn(async () => 'fake-direct-chat'),
  };
}

describe('TaskBackedLLMProvider', () => {
  let listener: ((event: unknown, data: { record: TaskRecord; kind: 'upsert' | 'delete' }) => void) | null = null;
  let submittedRecord: TaskRecord | null = null;
  const submitSpy = vi.fn();

  beforeEach(() => {
    listener = null;
    submittedRecord = null;
    submitSpy.mockReset();
    submitSpy.mockImplementation(async (input: any) => {
      submittedRecord = {
        id: 't1',
        scope: input.scope,
        type: input.type,
        status: 'pending',
        progress: 0,
        targetKind: input.targetKind ?? null,
        targetId: input.targetId ?? null,
        remoteTaskId: null,
        attempt: 0,
        maxRetries: 3,
        error: null,
        payload: { ...input.initialPayload, input: input.input },
        createdAt: 1,
        updatedAt: 1,
        heartbeatAt: null,
        completedAt: null,
      };
      return submittedRecord;
    });

    (window as any).electronAPI = {
      tasks: {
        submit: submitSpy,
        get: vi.fn(async () => submittedRecord),
        list: vi.fn(async () => []),
        upsert: vi.fn(async () => null),
        delete: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
        removeByScope: vi.fn(async () => 0),
        removeByTarget: vi.fn(async () => 0),
        gc: vi.fn(async () => ({ purgedByAge: 0, purgedByLimit: 0 })),
        getRetention: vi.fn(async () => ({ retentionDays: 7, perScopeLimit: 200 })),
        setRetention: vi.fn(async () => ({ retentionDays: 7, perScopeLimit: 200 })),
        getWebContentsId: vi.fn(async () => 1),
        onUpdated: vi.fn((cb: typeof listener) => {
          listener = cb;
          return () => { listener = null; };
        }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  function completeTask(content: string): void {
    submittedRecord = {
      ...submittedRecord!,
      status: 'completed',
      progress: 100,
      payload: { ...submittedRecord!.payload, output: { content } },
    };
    if (listener) listener({}, { record: submittedRecord, kind: 'upsert' });
  }

  it('non-streaming generateText goes through tasks IPC', async () => {
    const inner = makeFakeProvider();
    const wrapped = wrapTaskBackedLLM(inner, { scope: 'project:p1' });

    const promise = wrapped.generateText('hi', 'sys', { operation: 'shot-analysis' });
    await new Promise(r => setTimeout(r, 0));
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submittedRecord?.scope).toBe('project:p1');
    expect(submittedRecord?.type).toBe('llm:complete');
    expect((inner.generateText as any)).not.toHaveBeenCalled();

    completeTask('via-task-text');
    await expect(promise).resolves.toBe('via-task-text');
  });

  it('streaming generateText falls back to inner provider', async () => {
    const inner = makeFakeProvider();
    const wrapped = wrapTaskBackedLLM(inner);

    const out = await wrapped.generateText('hi', 'sys', { stream: true });
    expect(out).toBe('fake-direct');
    expect(inner.generateText).toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('chat with onChunk falls back to inner provider', async () => {
    const inner = makeFakeProvider();
    const wrapped = wrapTaskBackedLLM(inner);

    const out = await wrapped.chat([{ role: 'user', content: 'hi' }], undefined, () => {});
    expect(out).toBe('fake-direct-chat');
    expect(inner.chat).toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('chat without streaming goes through tasks IPC', async () => {
    const inner = makeFakeProvider();
    const wrapped = wrapTaskBackedLLM(inner, { scope: () => 'global' });

    const promise = wrapped.chat([{ role: 'user', content: 'q' }], { operation: 'shot-analysis' });
    await new Promise(r => setTimeout(r, 0));
    expect(submittedRecord?.type).toBe('llm:complete');
    expect(submittedRecord?.scope).toBe('global');

    completeTask('chat-result');
    await expect(promise).resolves.toBe('chat-result');
  });
});
