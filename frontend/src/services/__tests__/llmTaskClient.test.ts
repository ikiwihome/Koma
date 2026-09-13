import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llmQueryViaTask } from '../llmTaskClient';
import type { TaskRecord } from '../tasksIPC';

describe('llmQueryViaTask', () => {
  let listener: ((event: unknown, data: { record: TaskRecord; kind: 'upsert' | 'delete' }) => void) | null = null;
  let submittedRecord: TaskRecord | null = null;

  beforeEach(() => {
    listener = null;
    submittedRecord = null;

    (window as any).electronAPI = {
      tasks: {
        submit: vi.fn(async (input: any) => {
          submittedRecord = {
            id: 'llm-task-1',
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
        }),
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

  it('submits a llm:complete task and resolves with result on completion', async () => {
    const promise = llmQueryViaTask(
      {
        messages: [{ role: 'user', content: 'hi' }],
        config: { modelProvider: 'openai-compatible', modelName: 'gpt-4o' },
      },
      { scope: 'global', taskName: '测试 LLM' }
    );

    // 等 submit + 监听器注册
    await new Promise(r => setTimeout(r, 0));
    expect(submittedRecord?.type).toBe('llm:complete');

    // 模拟 main 完成广播
    submittedRecord = {
      ...submittedRecord!,
      status: 'completed',
      progress: 100,
      payload: {
        ...submittedRecord!.payload,
        output: {
          content: 'hello',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
      completedAt: 2,
    };
    if (listener) listener({}, { record: submittedRecord, kind: 'upsert' });

    const { result, taskId } = await promise;
    expect(result.content).toBe('hello');
    expect(result.usage?.totalTokens).toBe(2);
    expect(taskId).toBe('llm-task-1');
  });

  it('rejects when task fails', async () => {
    const promise = llmQueryViaTask({
      messages: [{ role: 'user', content: 'fail' }],
      config: { modelProvider: 'openai-compatible', modelName: 'gpt-4o' },
    });

    await new Promise(r => setTimeout(r, 0));

    submittedRecord = {
      ...submittedRecord!,
      status: 'failed',
      error: 'rate limited',
      completedAt: 2,
    };
    if (listener) listener({}, { record: submittedRecord, kind: 'upsert' });

    await expect(promise).rejects.toThrow('rate limited');
  });

  it('passes scope/targetKind/targetId for filtering by hooks', async () => {
    const promise = llmQueryViaTask(
      {
        messages: [{ role: 'user', content: 'x' }],
        config: { modelName: 'm' },
      },
      { scope: 'project:p1', targetKind: 'episode', targetId: 'ep-1' }
    );

    await new Promise(r => setTimeout(r, 0));

    expect(submittedRecord?.scope).toBe('project:p1');
    expect(submittedRecord?.targetKind).toBe('episode');
    expect(submittedRecord?.targetId).toBe('ep-1');

    submittedRecord = {
      ...submittedRecord!,
      status: 'completed',
      payload: { ...submittedRecord!.payload, output: { content: 'ok' } },
    };
    if (listener) listener({}, { record: submittedRecord, kind: 'upsert' });

    const { result } = await promise;
    expect(result.content).toBe('ok');
  });
});
