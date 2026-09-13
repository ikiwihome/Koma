# Workflow Module

The workflow module orchestrates multi-step AI generation tasks for video production. It manages asynchronous operations, progress tracking, and integrates with various AI providers.

## Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      Workflow Module                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐                                             │
│  │ WorkflowManager │ ◄── Central orchestrator                    │
│  │  • Queue mgmt   │     • Max 2 concurrent tasks                │
│  │  • Progress     │     • Observer pattern for UI updates       │
│  │  • Cancellation │                                             │
│  └────────┬────────┘                                             │
│           │                                                       │
│           │ registers handlers                                    │
│           ▼                                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Workflow Handlers                        │  │
│  ├────────────────┬────────────────┬────────────────────────┬─┤  │
│  │ scriptGenerator│ shotListGen    │ characterAssetWorkflow │ │  │
│  │ • Random script│ • Script→Shots │ • Costume photos       │ │  │
│  │ • From idea    │ • LLM parsing  │ • Preview videos       │ │  │
│  │ • Polish       │                │ • Character extraction │ │  │
│  ├────────────────┼────────────────┼────────────────────────┤ │  │
│  │scenePropAsset  │ shotRender     │                        │ │  │
│  │• Scene images  │ • TTS audio    │                        │ │  │
│  │• Prop images   │ • ITV video    │                        │ │  │
│  │• Prop videos   │ • Batch render │                        │ │  │
│  │• Prop extract  │                │                        │ │  │
│  └────────────────┴────────────────┴────────────────────────┴─┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `workflowManager.ts` | Central queue manager with concurrent execution |
| `scriptGenerator.ts` | LLM-based script generation and polishing |
| `shotListGenerator.ts` | Convert scripts to shot breakdowns |
| `characterAssetWorkflow.ts` | Generate character images, videos, and Sora2 binding |
| `scenePropAssetWorkflow.ts` | Generate scene/prop images and videos |
| `shotRenderWorkflow.ts` | Render shots with ITV and TTS |
| `index.ts` | Module exports and handler registration |

---

## WorkflowManager

The central orchestrator for all workflow tasks.

### Features

- **Concurrent execution**: Max 2 workflows run simultaneously
- **Queue management**: Tasks wait in queue when at capacity
- **Progress tracking**: Real-time progress updates via observer pattern
- **Cancellation**: Cancel pending or running workflows
- **Auto-cleanup**: Completed tasks removed after 5 seconds

### Usage

```typescript
import { workflowManager } from './workflow';

// Submit a workflow
const result = await workflowManager.submit('shot-render', {
  projectId: 'proj-123',
  shot: shotData,
  mediaSelections: { itvSelection: 'vidu-main::vidu-q1' },
});

// Monitor all workflows
const unsubscribe = workflowManager.subscribe((workflows) => {
  workflows.forEach(w => {
    console.log(`${w.workflowId}: ${w.status} ${w.progress}%`);
  });
});

// Cancel a workflow
workflowManager.cancel('workflow-12345');

// Get current state
const allWorkflows = workflowManager.getAll();
```

### WorkflowProgress Interface

```typescript
interface WorkflowProgress {
  workflowId: string;
  type: WorkflowType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;        // 0-100
  currentStep?: string;    // Human-readable step description
  startedAt?: number;
  completedAt?: number;
  error?: string;
}
```

---

## Script Generation

### generateRandomScript

Generate a complete script from scratch with random topic and style.

```typescript
import { generateRandomScript } from './workflow';

const script = await generateRandomScript(
  '3',  // duration in minutes
  (progress, step) => console.log(`${progress}%: ${step}`)
);
```

### generateScriptFromIdea

Generate a script from a user-provided concept.

```typescript
import { generateScriptFromIdea } from './workflow';

const script = await generateScriptFromIdea({
  settings: appSettings,
  idea: 'A detective solves a mystery in a small town',
  style: '悬疑',
  duration: '5',
}, (progress, step) => console.log(`${progress}%: ${step}`));
```

### polishScript

Refine and improve an existing script.

```typescript
import { polishScript } from './workflow';

const polished = await polishScript(
  appSettings,
  originalScript,
  '使语言更加生动，对话更自然',
  (progress, step) => console.log(`${progress}%: ${step}`)
);
```

---

## Shot List Generation

Convert a script into a structured shot breakdown.

```typescript
import { generateShotList } from './workflow';

const shots = await generateShotList({
  settings: appSettings,
  scriptText: '# 场景1 - 白天\n...',
  characters: projectCharacters,
  scenes: projectScenes,
}, (progress, step) => console.log(`${progress}%: ${step}`));

// Returns Shot[] with:
// - id, scriptContent, shotType, cameraMovement
// - duration, description, characters, dialogue, emotion
```

---

## Character Asset Workflow

Generate visual assets for characters.

### Costume Photo (Three-View Sheet)

Generates a character turnaround sheet with front/side/back views.

```typescript
import { generateCostumePhoto } from './workflow';

const result = await generateCostumePhoto({
  projectId: 'proj-123',
  character: characterData,
  theme: 'anime',
  ttiSelection: 'comfyui-main::flux-dev',
  onProgress: (progress, step) => console.log(`${progress}%: ${step}`),
});

// Returns: { success: boolean, path?: string, url?: string, error?: string }
```

### Preview Video

Generate a short video introducing the character.

```typescript
import { generateCharacterPreviewVideo } from './workflow';

const result = await generateCharacterPreviewVideo({
  projectId: 'proj-123',
  character: characterData,
  itvSelection: 'vidu-main::vidu-q1',
  onProgress: (progress, step) => console.log(`${progress}%: ${step}`),
});

// Returns: { success: boolean, path?: string, taskId?: string, error?: string }
```

### Character Extraction (Sora2)

Extract character from preview video and bind to Sora2 character ID.

```typescript
import { extractAndBindCharacter } from './workflow';

const result = await extractAndBindCharacter(
  'proj-123',
  characterData,       // Must have media.previewVideo.providerTaskId
  'itv-sora2',
  (progress, step) => console.log(`${progress}%: ${step}`)
);

// Returns: { success: boolean, characterId?: string, error?: string }
// Saves sora2CharacterId to character data
```

### Prompt Building

```typescript
import { buildCostumePhotoPrompt, getCharacterPrompt } from './workflow';

// Get auto-generated prompt
const prompt = buildCostumePhotoPrompt(character, 'anime style, ');

// Get prompt with fallback to custom
const finalPrompt = getCharacterPrompt(character, 'anime', customStylePrompt);
```

---

## Scene & Prop Asset Workflow

### Scene Image

Generate environment/location preview images.

```typescript
import { generateSceneImage, generateAllSceneImages } from './workflow';

// Single scene
const result = await generateSceneImage({
  projectId: 'proj-123',
  scene: sceneData,
  theme: 'realistic',
  ttiSelection: 'openai-images::gpt-image-1',
  onProgress: (progress, step) => console.log(`${progress}%: ${step}`),
});

// Batch generation
const batchResult = await generateAllSceneImages({
  projectId: 'proj-123',
  scenes: allScenes,
  theme: 'realistic',
  onProgress: (progress, step) => console.log(`${progress}%: ${step}`),
});
// Returns: { success: number, failed: number, results: [...] }
```

### Prop Image

Generate item/object reference images.

```typescript
import { generatePropImage, generateAllPropImages } from './workflow';

const result = await generatePropImage({
  projectId: 'proj-123',
  prop: propData,
  theme: 'realistic',
  ttiSelection: 'midjourney-main::midjourney-v7',
  onProgress: (progress, step) => console.log(`${progress}%: ${step}`),
});
```

### Prop Preview Video & Extraction

```typescript
import { generatePropPreviewVideo, extractAndBindProp } from './workflow';

// Generate showcase video
const videoResult = await generatePropPreviewVideo({
  projectId: 'proj-123',
  prop: propData,
  itvSelection: 'vidu-main::vidu-q1',
  onProgress: (progress, step) => console.log(`${progress}%: ${step}`),
});

// Extract and bind to Sora2
const extractResult = await extractAndBindProp(
  'proj-123',
  propData,  // Must have media.previewVideo.providerTaskId
  'vidu-main::vidu-q1'
);
```

### Prompt Utilities

```typescript
import { getScenePrompt, getPropPrompt } from './workflow';

const scenePrompt = getScenePrompt(scene, 'anime');
const propPrompt = getPropPrompt(prop, 'realistic', customStyle);
```

---

## Shot Render Workflow

Render individual shots or batches with video generation.

### Single Shot

```typescript
import { shotRenderWorkflow } from './workflow';

const result = await shotRenderWorkflow({
  projectId: 'proj-123',
  shot: shotData,
  mediaSelections: {
    ttsSelection: 'edge-main::zh-CN-XiaoxiaoNeural',
    itvSelection: 'vidu-main::vidu-q1',
  },
  theme: 'anime',
  stylePrompt: 'cinematic lighting, ',
}, (progress, step) => console.log(`${progress}%: ${step}`));

// Returns: { shotId, version: ShotVersion, success, error? }
```

### Batch Rendering

```typescript
import { batchRenderShots } from './workflow';

const result = await batchRenderShots({
  projectId: 'proj-123',
  shots: selectedShots,
  mediaSelections: {
    ttsSelection: 'edge-main::zh-CN-XiaoxiaoNeural',
    itvSelection: 'vidu-main::vidu-q1',
  },
  theme: 'anime',
  concurrency: 1,  // Sequential for now
}, (overall, current) => {
  console.log(`Overall: ${overall}%`);
  console.log(`Current: ${current.shotId} - ${current.progress}% ${current.step}`);
});

// Returns: { total, success, failed, results: ShotRenderResult[] }
```

### Render Pipeline

```
Shot Render Workflow
       │
       ├─► Step 1: TTS (0-20%)
       │   • Generate dialogue audio if shot.dialogue exists
       │   • Skip if no dialogue
       │
       ├─► Step 2: ITV Video (20-95%)
       │   • Build video prompt from shot.videoPrompt or description
       │   • Process @mentions for Sora2 character references
       │   • Collect additional reference images
       │   • Call ITV provider with reference image (if available)
       │
       └─► Step 3: Save Version (95-100%)
           • Create ShotVersion with paths and metadata
           • Store remote URLs for future reference
```

### Mention Processing

The `processVideoPromptAssets` function handles `@mentions` in video prompts:

```
@CharacterName → @sora2CharacterId (if bound)
               → [CharacterName: description] + collect image URL (if not bound)

@PropName     → @sora2PropId (if bound)
              → [PropName: description] + collect image URL (if not bound)
```

---

## Progress Callback Pattern

All workflows use a consistent progress callback signature:

```typescript
type ProgressCallback = (progress: number, step?: string) => void;
```

**Best practices:**

1. Progress is 0-100 percentage
2. Step descriptions are human-readable Chinese strings
3. Update frequency: major state changes, not every millisecond

**Typical progress ranges:**

| Phase | Range | Description |
|-------|-------|-------------|
| Initialization | 0-10% | Loading templates, checking providers |
| Processing | 10-90% | API calls, polling, downloading |
| Finalization | 90-100% | Saving files, updating database |

---

## Integration Points

### Task Queue

Workflows create tasks in `taskQueueStore` for tracking and recovery:

```typescript
const task = await createTask(projectId, {
  type: 'tti' | 'itv' | 'tts',
  targetType: 'character' | 'scene' | 'prop' | 'shot',
  targetId: assetId,
  // ...
});
```

### Provider System

Workflows use the provider factory to get configured instances:

```typescript
import { getProjectTTIProvider, getProjectITVProvider, getProjectTTSProvider } from '../providers';

const ttiProvider = await getProjectTTIProvider(configId);
const itvProvider = await getProjectITVProvider(configId);
const ttsProvider = await getProjectTTSProvider(configId);
```

### Prompt Templates

Dynamic prompts loaded from `promptTemplates` store:

```typescript
import { getPromptTemplate, fillTemplate } from '../store/promptTemplates';

const template = await getPromptTemplate('tti_character_costume');
const prompt = fillTemplate(template.template, { stylePrefix, appearance });
```

### AI Call Logging

All provider calls are logged for debugging:

```typescript
import { logTTICall, logITVCall, logTTSCall } from '../store/aiCallLogger';

logTTICall(providerName, prompt, options, context);
logITVCall(providerName, imageUrl, prompt, options, context);
logTTSCall(providerName, text, voiceId, options, context);
```

---

## Error Handling

Workflows handle errors gracefully:

1. **Provider not configured**: Throws with clear message
2. **API failures**: Logged and returned in result.error
3. **Download failures**: Task marked as failed, error propagated
4. **Polling timeout**: Returns failure after max attempts

```typescript
try {
  const result = await someWorkflow(params, onProgress);
  if (!result.success) {
    console.error('Workflow failed:', result.error);
  }
} catch (err) {
  // Provider/config errors throw
  console.error('Fatal error:', err.message);
}
```

---

## Adding New Workflows

1. Create handler function with signature:
   ```typescript
   async function myWorkflow(
     params: MyParams,
     onProgress: (progress: number, step?: string) => void
   ): Promise<MyResult>
   ```

2. Register with WorkflowManager:
   ```typescript
   // In index.ts
   workflowManager.registerHandler('my-workflow', myWorkflow);
   ```

3. Export from index.ts:
   ```typescript
   export { myWorkflow } from './myWorkflow';
   ```

4. Submit via manager:
   ```typescript
   const result = await workflowManager.submit('my-workflow', params);
   ```
