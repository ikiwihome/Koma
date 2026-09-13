# Providers

This folder contains all built-in model providers used by Koma Studio.

OpenSpec note (media pipeline):
- Media generation MUST use the unified request-based contract and the `start()` / `getTaskSnapshot()` lifecycle.
- Workflows/UI MUST NOT call provider-specific legacy methods like `generateImage()` / `generateVideo()` / `checkProgress()`.
- Persistence and project-path writes MUST be handled by the service layer (`mediaPersistenceService`), not by providers.

## Folder Layout

- `./tti/` Text-to-Image providers
- `./itv/` Image-to-Video providers
- `./tts/` Text-to-Speech providers
- `./llm/` LLM providers (chat / analysis)
- `./registry.ts` Provider registry and factories

## Shared Media Contract

All media providers share the same lifecycle types defined in [types/media.ts](../../types/media.ts):

```ts
export type ProviderStartResult<T> =
  | { mode: 'immediate'; output: T }
  | { mode: 'async'; taskId: string };

export interface ProviderTaskSnapshot<T> {
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  progress?: number;
  output?: T;
  error?: string;
}
```

### Asset Input

Providers MUST accept assets only as `ProviderAssetInput` (normalized by the host):

```ts
export interface ProviderAssetInput {
  transport: 'remote-url' | 'data-url';
  value: string;
  mimeType?: string;
}
```

Notes:
- Providers MUST NOT depend on Electron project paths.
- Providers MUST NOT require the workflow/UI layer to pass `blob:` / local file paths.
- The host normalizes assets via `mediaAssetResolver` and persists results via `mediaPersistenceService`.

## TTI (Text-to-Image)

Type definitions live in [tti/types.ts](./tti/types.ts) and use the shared request contract:

```ts
export interface TTIProvider {
  type: string;
  config: TTIModelConfig;

  validate(): boolean;
  testConnection(): Promise<boolean>;

  start(request: TTIRequest): Promise<ProviderStartResult<ImageResult>>;
  getTaskSnapshot?(taskId: string): Promise<ProviderTaskSnapshot<ImageResult>>;
  cancelTask?(taskId: string): Promise<void>;

  polling?: PollingConfig;
}
```

## ITV (Image-to-Video)

Type definitions live in [itv/types.ts](./itv/types.ts).

Key points:
- `primaryImage` is required and already normalized to `ProviderAssetInput`.
- `additionalReferences` is the canonical place for extra reference images.

```ts
export interface ITVProvider {
  type: ITVProviderType;
  config: ITVConfig;

  validate(): boolean;
  testConnection(): Promise<boolean>;

  start(request: ITVRequest): Promise<ProviderStartResult<ITVResult>>;
  getTaskSnapshot?(taskId: string): Promise<ProviderTaskSnapshot<ITVResult>>;
  cancelTask?(taskId: string): Promise<void>;

  polling?: PollingConfig;
}
```

## TTS (Text-to-Speech)

Type definitions live in [tts/types.ts](./tts/types.ts).

```ts
export interface TTSProvider {
  type: TTSProviderType;
  config: TTSConfig;

  validate(): boolean;
  testConnection(): Promise<boolean>;

  start(request: TTSRequest): Promise<ProviderStartResult<AudioResult>>;
  getTaskSnapshot?(taskId: string): Promise<ProviderTaskSnapshot<AudioResult>>;
  cancelTask?(taskId: string): Promise<void>;

  listVoices(): Promise<Voice[]>;
  polling?: PollingConfig;
}
```

## Polling Guidance

For async providers (`start()` returns `{ mode: 'async' }`):
- Providers SHOULD implement `getTaskSnapshot(taskId)` and return:
  - `state: queued|running|succeeded|failed`
  - `progress` in `[0..100]` when possible
  - `output` only when `state === 'succeeded'`
- Providers MAY provide `polling` hints (interval / maxDuration / initialDelay).

The host orchestrator is responsible for:
- creating a persisted task (`taskQueueStore`)
- polling snapshots
- persisting the final media into project storage
- binding results back to entities by `ownerRef`

