# Store Module

The store module provides centralized state management and data persistence for the Koma application. It uses a hybrid approach combining Zustand for reactive state, Electron filesystem for project data, and localStorage for browser-compatible persistence.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Store Module                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                     Persistence Layer                                   │ │
│  │                                                                         │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │ │
│  │  │ Electron FS  │  │ localStorage │  │   In-Memory  │                 │ │
│  │  │              │  │              │  │   (Zustand)  │                 │ │
│  │  │ • Projects   │  │ • Plugins    │  │ • Resources  │                 │ │
│  │  │ • Settings   │  │ • Chat       │  │ • Tracks     │                 │ │
│  │  │ • Tasks      │  │ • Config     │  │ • Selection  │                 │ │
│  │  │ • Logs       │  │              │  │              │                 │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      Domain Stores                                      │ │
│  │                                                                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │ │
│  │  │projectStore │  │globalStore  │  │ trackStore  │  │resourceStore│  │ │
│  │  │             │  │ (settings)  │  │ (timeline)  │  │  (media)    │  │ │
│  │  ├─────────────┤  ├─────────────┤  ├─────────────┤  ├─────────────┤  │ │
│  │  │• Projects   │  │• LLM Config │  │• Tracks     │  │• Resources  │  │ │
│  │  │• Episodes   │  │• TTI Config │  │• Items      │  │• Selection  │  │ │
│  │  │• Entities   │  │• ITV Config │  │• Keyframes  │  │• Filtering  │  │ │
│  │  │• Assets     │  │• TTS Config │  │• Playback   │  │• Import     │  │ │
│  │  │• Shots      │  │• Presets    │  │• Undo/Redo  │  │             │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │ │
│  │                                                                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                    │ │
│  │  │pluginStore  │  │chatHistory  │  │taskQueue    │                    │ │
│  │  │             │  │   Store     │  │   Store     │                    │ │
│  │  ├─────────────┤  ├─────────────┤  ├─────────────┤                    │ │
│  │  │• Registry   │  │• Sessions   │  │• Tasks      │                    │ │
│  │  │• Runtime    │  │• Messages   │  │• Progress   │                    │ │
│  │  │• Toggle     │  │• Migration  │  │• Recovery   │                    │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        Services                                         │ │
│  │                                                                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │ │
│  │  │autoSave     │  │  logger     │  │taskRecovery │  │assetDownload│  │ │
│  │  │  Service    │  │             │  │  Service    │  │  Service    │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
store/
├── index.ts                 # Central exports
├── storageConfig.ts         # Storage path management
├── globalStore.ts           # → Re-exports from settings/
├── projectStore.ts          # → Re-exports from project/
├── taskQueueStore.ts        # Async task persistence
├── autoSaveService.ts       # Debounced auto-save
├── logger.ts                # Centralized logging
├── resourceStore.ts         # Media resource state (Zustand)
├── pluginStore.ts           # Plugin management (Zustand)
├── chatHistoryStore.ts      # Chat persistence (Zustand)
├── trackStore.ts            # Timeline editing (Zustand)
├── promptTemplates.ts       # AI prompt templates
├── aiCallLogger.ts          # AI call auditing
├── encryption.ts            # Data encryption utilities
├── assetDownloadService.ts  # Remote asset downloading
├── taskRecoveryService.ts   # Task recovery mechanism
├── projectOpenService.ts    # Project loading service
│
├── settings/                # Configuration management
│   ├── index.ts             # Settings exports
│   ├── core.ts              # Settings I/O
│   ├── llmConfig.ts         # LLM provider configs
│   ├── mediaConfig.ts       # TTI/ITV/TTS configs
│   ├── presets.ts           # Provider presets
│   ├── recentProjects.ts    # Recent projects list
│   ├── modelPresets.ts      # Model parameter presets
│   ├── themePresets.ts      # Visual style presets
│   ├── channelConfig.ts     # Provider channel configs
│   └── imageHostingConfig.ts# Image CDN configuration
│
└── project/                 # Project data management
    ├── index.ts             # Project exports
    ├── core.ts              # Project CRUD
    ├── timeline.ts          # Timeline persistence
    ├── assets.ts            # Asset import & metadata
    ├── shots.ts             # Shot versioning
    ├── episodes.ts          # Episode management
    ├── analysis.ts          # Episode analysis results
    ├── entities.ts          # Characters/Scenes/Props
    ├── assetStorage.ts      # Asset file storage
    ├── refs.ts              # Entity references
    ├── cache.ts             # Media cache (thumbnails, waveforms)
    ├── temp.ts              # Temporary files
    └── manju.ts             # Manju-DSL support
```

---

## Core Stores

### Storage Configuration

Manages the root storage directory and migrations.

```typescript
import {
  getStorageConfig,
  setStorageConfig,
  initStorageConfig,
  validateStoragePath,
  migrateStorage,
  updateStoragePath,
} from './store';

// Get current config
const config = getStorageConfig();
console.log(config.rootPath); // ~/.koma

// Initialize on first run
await initStorageConfig();

// Validate a new path
const valid = await validateStoragePath('/new/path');

// Migrate to new location with progress
await migrateStorage('/old/path', '/new/path', (progress, file) => {
  console.log(`${progress}%: ${file}`);
});
```

**Default Storage Locations:**
- Electron: `~/.koma`
- Web: Browser localStorage

### Global Store (Settings)

Manages application-wide configuration including AI provider settings.

```typescript
import {
  loadSettings,
  saveSettings,
  addLLMConfig,
  updateLLMConfig,
  deleteLLMConfig,
  getDefaultLLMConfig,
  setDefaultLLMConfig,
  addTTIConfig,
  addITVConfig,
  addTTSConfig,
} from './store';

// Load all settings
const settings = await loadSettings();

// LLM Configuration
const llmConfig = await addLLMConfig({
  provider: 'openai',
  apiKey: 'sk-...',
  modelName: 'gpt-4',
  baseUrl: 'https://api.openai.com/v1',
});

await setDefaultLLMConfig(llmConfig.id);
const defaultLLM = await getDefaultLLMConfig();

// Media Provider Configuration
await addTTIConfig({
  provider: 'comfyui',
  baseUrl: 'http://localhost:8188',
});

await addITVConfig({
  provider: 'sora2',
  apiKey: 'key...',
});

await addTTSConfig({
  provider: 'edge-tts',
});
```

**Settings Structure:**

```typescript
interface AppSettings {
  channelConfigs: ChannelConfig[];
  mediaDefaults?: MediaDefaults;
  promptTemplates?: Record<string, { template: string; updatedAt: number }>;
  customThemePresets?: ThemePreset[];
  stylePrompts?: { prompt: string; isDefault?: boolean }[];
}
```

### Project Store

Manages project data, episodes, and assets.

```typescript
import {
  createProject,
  loadProject,
  saveProject,
  deleteProject,
  listProjects,
  loadTimeline,
  saveTimeline,
  loadCharacters,
  saveCharacters,
  loadScenes,
  saveScenes,
  loadShots,
  saveShots,
  importAsset,
  saveShotVersion,
} from './store';

// Project lifecycle
const project = await createProject({
  title: 'My Video Project',
  description: 'A short film',
});

const projects = await listProjects();
const loaded = await loadProject(project.id);
await saveProject(project);
await deleteProject(project.id);

// Timeline operations
const timeline = await loadTimeline(project.id);
timeline.tracks.push(newTrack);
await saveTimeline(project.id, timeline);

// Entity management
const characters = await loadCharacters(project.id);
characters.push({ id: 'char-1', name: 'Alice', ... });
await saveCharacters(project.id, characters);

// Asset import with deduplication
const asset = await importAsset(project.id, '/path/to/video.mp4');
// Returns existing asset if duplicate (based on hash)
```

**Project Directory Structure:**

```
{projectId}/
├── project.json        # Project metadata
├── timeline.json       # Timeline data
├── characters.json     # Character entities
├── scenes.json         # Scene entities
├── props.json          # Prop entities
├── tasks.json          # Task queue
├── assets/
│   ├── images/
│   ├── videos/
│   ├── audio/
│   └── fonts/
├── shots/
│   └── {shotId}/
│       └── v{n}.json   # Shot versions
├── cache/
│   ├── thumbnails/
│   ├── waveforms/
│   └── previews/
├── exports/
└── temp/
```

### Task Queue Store

Manages long-running async tasks (TTI/ITV/TTS generation).

```typescript
import {
  createTask,
  updateTask,
  getTask,
  deleteTask,
  markTaskProcessing,
  markTaskCompleted,
  markTaskFailed,
  getPendingTasks,
  getFailedTasks,
  retryTask,
  updateTaskProgress,
  getTaskStats,
  clearCompletedTasks,
} from './store';

// Create a new task
const task = await createTask(projectId, {
  type: 'tti',
  targetType: 'character',
  targetId: 'char-1',
  targetName: 'Alice costume photo',
  remoteTaskId: 'api-task-123',
  status: 'pending',
  progress: 0,
  maxRetries: 3,
});

// Update task progress
await updateTaskProgress(projectId, task.id, 50);

// Mark task status
await markTaskProcessing(projectId, task.id);
await markTaskCompleted(projectId, task.id, resultAsset);
await markTaskFailed(projectId, task.id, 'API error');

// Task recovery
const pending = await getPendingTasks(projectId);
const failed = await getFailedTasks(projectId);
await retryTask(projectId, task.id);

// Analytics
const stats = await getTaskStats(projectId);
// { total, pending, processing, completed, failed }

// Cleanup old tasks (7+ days)
await clearCompletedTasks(projectId);
```

**Task Lifecycle:**

```
pending → processing → completed
                    ↘ failed → retry → processing
```

---

## Zustand Stores (Reactive State)

### Resource Store

In-memory media resource management for the editor.

```typescript
import { useResourceStore } from './store/resourceStore';

// In React component
const {
  resources,
  selectedIds,
  filter,
  sort,
  viewMode,
  addResource,
  removeResource,
  updateResource,
  selectResource,
  deselectResource,
  setFilter,
  setSort,
  setViewMode,
  importFiles,
  clear,
} = useResourceStore();

// Add resource
addResource({
  id: 'res-1',
  type: 'video',
  name: 'intro.mp4',
  path: '/path/to/video.mp4',
  duration: 120000,
  width: 1920,
  height: 1080,
});

// Import files with FFmpeg processing
await importFiles([file1, file2]);

// Selection management
selectResource('res-1');
deselectResource('res-1');

// Filtering and sorting
setFilter({ type: 'video' });
setSort({ field: 'name', direction: 'asc' });
setViewMode('grid'); // or 'list'
```

### Track Store

Timeline editing with full manipulation and undo/redo support.

```typescript
import { useTrackStore } from './store/trackStore';

const {
  tracks,
  config,
  currentTime,
  isPlaying,
  scale,
  scroll,
  history,
  // Track operations
  addTrack,
  removeTrack,
  updateTrack,
  reorderTracks,
  // Item operations
  addItem,
  removeItem,
  updateItem,
  moveItem,
  moveItemToTrack,
  trimItemStart,
  trimItemEnd,
  splitItem,
  // Keyframe operations
  addKeyframeToItem,
  updateKeyframeInItem,
  removeKeyframeFromItem,
  // Playback
  setCurrentTime,
  play,
  pause,
  setPlaybackRate,
  // View
  setScale,
  setScroll,
  // History
  undo,
  redo,
  // Snapping
  updateSnapPoints,
  findSnapPosition,
} = useTrackStore();

// Add a video track
addTrack({
  id: 'track-1',
  type: 'video',
  name: 'Main Video',
  items: [],
  visible: true,
  muted: false,
  order: 0,
});

// Add an item
addItem('track-1', {
  id: 'item-1',
  type: 'video',
  start: 0,
  end: 300,
  offsetL: 0,
  source: '/path/to/video.mp4',
  keyframes: [],
});

// Trim and split
trimItemStart('track-1', 'item-1', 30);
trimItemEnd('track-1', 'item-1', 270);
splitItem('track-1', 'item-1', 150);

// Add keyframe
addKeyframeToItem('track-1', 'item-1', {
  time: 0,
  properties: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  easing: 'ease-in-out',
});

// Playback control
setCurrentTime(1000);
play();
setPlaybackRate(1.5);

// Undo/Redo
undo();
redo();
```

### Plugin Store

Plugin lifecycle management with persistence.

```typescript
import { usePluginStore, useGlobalPlugins, useProviderPlugins } from './store/pluginStore';

const {
  plugins,
  runtimeStates,
  registerPlugin,
  unregisterPlugin,
  togglePlugin,
  setRuntimeState,
  clearRuntimeState,
  getActivePlugins,
  getProviderPlugins,
  getToolPlugins,
} from usePluginStore();

// Register a plugin
registerPlugin({
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  category: 'provider',
  enabled: true,
  config: { ... },
});

// Toggle enable/disable
togglePlugin('my-plugin');

// Set runtime state (memory-only)
setRuntimeState('my-plugin', {
  initialized: true,
  connections: 3,
});

// Hooks for specific categories
const globalPlugins = useGlobalPlugins();
const providerPlugins = useProviderPlugins();
```

### Chat History Store

Persistent chat sessions with message storage.

```typescript
import { useChatHistoryStore } from './store/chatHistoryStore';

const {
  sessions,
  createSession,
  updateSession,
  deleteSession,
  saveMessages,
  loadMessages,
  getSortedSessions,
} = useChatHistoryStore();

// Create a new session
const session = createSession({
  title: 'Script Discussion',
  systemPrompt: 'You are a screenplay consultant.',
});

// Save messages
saveMessages(session.id, [
  { role: 'user', content: 'Help me write a scene' },
  { role: 'assistant', content: 'Sure! What genre?' },
]);

// Load messages (lazy, with migration)
const messages = loadMessages(session.id);

// Get sorted sessions (newest first)
const sorted = getSortedSessions();
```

---

## Services

### Auto-Save Service

Debounced auto-save with manual save and exit handling.

```typescript
import {
  markDirty,
  saveProjectNow,
  subscribeSaveState,
  setPendingData,
  saveAllBeforeExit,
  initSaveHooks,
  type SaveStatus,
  type ProjectSaveState,
} from './store/autoSaveService';

// Initialize keyboard shortcuts (Ctrl+S / Cmd+S)
initSaveHooks();

// Mark project as modified (triggers 1s debounced save)
markDirty(projectId);

// Set data to be saved
setPendingData(projectId, projectData);

// Manual immediate save
await saveProjectNow(projectId);

// Listen to save state changes
const unsubscribe = subscribeSaveState(projectId, (state: ProjectSaveState) => {
  console.log(`Status: ${state.status}`); // 'saved' | 'dirty' | 'saving' | 'error'
  if (state.error) console.error(state.error);
});

// Save all dirty projects before exit
await saveAllBeforeExit();
```

**Save Status Flow:**

```
saved → dirty → saving → saved
                     ↘ error
```

### Logger

Centralized logging with file rotation.

```typescript
import { createLogger, configureLogger, cleanOldLogs, getLogFiles } from './store/logger';

// Create a named logger
const logger = createLogger('MyComponent');

logger.debug('Debug message');
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message', { details: '...' });

// Configure global options
configureLogger({
  level: 'info',
  console: true,
  file: true,
});

// Maintenance
await cleanOldLogs(30); // Keep 30 days
const logs = await getLogFiles();
```

**Log File Details:**
- Location: `~/.koma/logs/koma-YYYY-MM-DD.log`
- Rotation: 5MB per file, keeps 5 files

### AI Call Logger

Audits all AI provider calls for debugging.

```typescript
import { logTTICall, logITVCall, logTTSCall, logLLMCall } from './store/aiCallLogger';

logTTICall(
  'ComfyUI',
  'a beautiful sunset',
  { width: 1024, height: 1024 },
  { projectId: 'proj-1', targetId: 'char-1' }
);

logITVCall(
  'Sora2',
  'https://example.com/image.png',
  'a person walking',
  { duration: 5 },
  { projectId: 'proj-1', targetId: 'shot-1' }
);
```

### Task Recovery Service

Recovers interrupted tasks on startup.

```typescript
import { recoverTasks, TaskRecoveryResult } from './store/taskRecoveryService';

// Called on app startup
const results: TaskRecoveryResult[] = await recoverTasks(projectId);

for (const result of results) {
  if (result.recovered) {
    console.log(`Recovered: ${result.taskId}`);
  } else {
    console.error(`Failed: ${result.taskId} - ${result.error}`);
  }
}
```

### Asset Download Service

Downloads and caches remote assets.

```typescript
import { downloadAsset, downloadAssetWithProgress } from './store/assetDownloadService';

// Simple download
const localPath = await downloadAsset(projectId, remoteUrl, 'images');

// Download with progress
const localPath = await downloadAssetWithProgress(
  projectId,
  remoteUrl,
  'videos',
  (progress) => console.log(`${progress}%`)
);
```

---

## Settings Submodule

### Provider Presets

Built-in configuration presets for AI providers.

```typescript
import {
  LLM_CHANNEL_PRESETS,
  TTI_PRESETS,
  ITV_PRESETS,
  TTS_PRESETS,
} from './store/settings/presets';

// Available LLM providers
// OpenAI, Claude, Gemini, OpenAI-Compatible

// Available TTI providers
// ComfyUI, NanoBanana, Gemini-3-Pro

// Available ITV providers
// Sora2, Kling, Runway, Pika, ComfyUI-AnimateDiff

// Available TTS providers
// Edge-TTS, OpenAI-TTS, Fish-Audio, GPT-SoVITS
```

### Channel Configuration

Manages provider channel instances.

```typescript
import {
  getChannelConfigs,
  getChannelsByCapability,
  addChannelConfig,
  updateChannelConfig,
  deleteChannelConfig,
  deleteChannelsByPlugin,
} from './store/settings/channelConfig';

// Get all channels
const channels = await getChannelConfigs();

// Filter by capability
const ttiChannels = await getChannelsByCapability('tti');
const itvChannels = await getChannelsByCapability('itv');

// Add custom channel
await addChannelConfig({
  name: 'My ComfyUI',
  providerType: 'comfyui',
  providerConfig: { baseUrl: 'http://localhost:8188' },
  capabilities: ['tti'],
  enabled: true,
  source: 'builtin',
});

// Cleanup plugin channels on uninstall
await deleteChannelsByPlugin('plugin-id');
```

### Recent Projects

Tracks recently opened projects.

```typescript
import {
  loadRecentProjects,
  saveRecentProjects,
  addRecentProject,
  removeRecentProject,
} from './store/settings/recentProjects';

// Load recent projects
const recent = await loadRecentProjects();

// Add to recent list
await addRecentProject({
  id: 'proj-1',
  title: 'My Project',
  path: '/path/to/project',
  lastOpened: Date.now(),
});

// Remove from list
await removeRecentProject('proj-1');
```

---

## Project Submodule

### Episode Management

Manages episodes within a project.

```typescript
import {
  createEpisode,
  loadEpisode,
  saveEpisode,
  deleteEpisode,
  listEpisodes,
} from './store/project/episodes';

// Create episode
const episode = await createEpisode(projectId, {
  title: 'Episode 1',
  scriptText: '# Scene 1\n...',
});

// List all episodes
const episodes = await listEpisodes(projectId);

// Load/save episode
const ep = await loadEpisode(projectId, episodeId);
await saveEpisode(projectId, ep);
```

### Episode Analysis

Stores AI-generated analysis results.

```typescript
import {
  saveEpisodeAnalysis,
  loadEpisodeAnalysis,
  saveEpisodeShots,
  loadEpisodeShots,
  saveEpisodeTimeline,
  loadEpisodeTimeline,
  updateShot,
} from './store/project/analysis';

// Save analysis results
await saveEpisodeAnalysis(projectId, episodeId, {
  characters: [...],
  scenes: [...],
  props: [...],
});

// Save generated shots
await saveEpisodeShots(projectId, episodeId, shots);

// Update individual shot
await updateShot(projectId, episodeId, shotId, { videoPrompt: '...' });

// Save episode timeline
await saveEpisodeTimeline(projectId, episodeId, timeline);
```

### Shot Versioning

Manages shot versions for iteration.

```typescript
import {
  saveShotVersion,
  loadShotMeta,
  listShots,
  getShotVersionHistory,
  switchShotVersion,
  deleteShotVersion,
} from './store/project/shots';

// Save new version
const version = await saveShotVersion(projectId, shotId, {
  imagePath: '/path/to/image.png',
  videoPath: '/path/to/video.mp4',
  audioPath: '/path/to/audio.mp3',
  prompt: 'a person walking...',
  seed: 12345,
  model: 'sora2',
});

// Get version history
const history = await getShotVersionHistory(projectId, shotId);

// Switch to older version
await switchShotVersion(projectId, shotId, 2);

// Delete a version
await deleteShotVersion(projectId, shotId, 3);
```

### Asset Management

Import and manage project assets.

```typescript
import {
  importAsset,
  loadAssets,
  findDuplicateAsset,
  incrementAssetRef,
  decrementAssetRef,
  getUnusedAssets,
  cleanUnusedAssets,
} from './store/project/assets';

// Import with deduplication
const asset = await importAsset(projectId, '/path/to/file.mp4');
// Returns existing if hash matches

// Reference counting
await incrementAssetRef(projectId, asset.id);
await decrementAssetRef(projectId, asset.id);

// Find orphaned assets
const unused = await getUnusedAssets(projectId);

// Clean up
await cleanUnusedAssets(projectId);
```

### Cache Management

Manage thumbnails, waveforms, and previews.

```typescript
import {
  saveThumbnail,
  getThumbnail,
  saveWaveform,
  getWaveform,
  savePreviewFrame,
  getPreviewFrame,
  getCacheStats,
  clearCacheByType,
  clearCache,
} from './store/project/cache';

// Thumbnails
await saveThumbnail(projectId, assetId, imageBuffer);
const thumb = await getThumbnail(projectId, assetId);

// Waveforms (audio visualization data)
await saveWaveform(projectId, assetId, waveformData); // number[]
const waveform = await getWaveform(projectId, assetId);

// Preview frames
await savePreviewFrame(projectId, assetId, frameIndex, imageBuffer);
const frame = await getPreviewFrame(projectId, assetId, frameIndex);

// Cache statistics
const stats = await getCacheStats(projectId);
// { thumbnails: { count, size }, waveforms: {...}, previews: {...} }

// Cleanup
await clearCacheByType(projectId, 'thumbnails');
await clearCache(projectId); // Clear all
```

### Manju-DSL Support

Import/export projects in Manju-DSL format.

```typescript
import {
  saveProjectAsManju,
  loadProjectFromManju,
  exportProjectToManjuFile,
  importProjectFromManjuFile,
} from './store/project/manju';

// In-memory conversion
const manjuProject = await saveProjectAsManju(project, timeline, assets);
const { project, timeline, assets } = await loadProjectFromManju(manjuProject);

// File I/O
await exportProjectToManjuFile(projectId, '/path/to/export.manju');
const imported = await importProjectFromManjuFile('/path/to/import.manju');
```

---

## Persistence Summary

| Store | Persistence | Location | Format |
|-------|-------------|----------|--------|
| **Settings** | Electron FS | `~/.koma/settings.json` | JSON |
| **Settings** | Web | localStorage | JSON |
| **Projects** | Electron FS | `~/.koma/projects/{id}/` | Hierarchical JSON |
| **Tasks** | Electron FS | `{project}/tasks.json` | JSON array |
| **Cache** | Electron FS | `{project}/cache/` | JPG + JSON |
| **Logs** | Electron FS | `~/.koma/logs/` | Text (daily rotation) |
| **Plugins** | localStorage | Browser | JSON (Zustand persist) |
| **Chat** | localStorage | Browser | JSON (Zustand persist) |
| **Resources** | Memory | Runtime | Zustand state |
| **Tracks** | Memory | Runtime | Zustand state |

---

## Key Patterns & Best Practices

### 1. Environment Detection

Always check for Electron before file operations:

```typescript
import { electronService } from '../services/electronService';

if (electronService.isElectron()) {
  // File system operations
  await electronService.fs.writeFile(path, data);
} else {
  // Fallback to localStorage
  localStorage.setItem(key, JSON.stringify(data));
}
```

### 2. Async/Await Pattern

All file I/O operations are async:

```typescript
// Good
const project = await loadProject(projectId);

// Bad
loadProject(projectId).then(project => ...); // Avoid promise chains
```

### 3. Reference Counting

Track asset usage to prevent orphaning:

```typescript
// When adding to timeline
await incrementAssetRef(projectId, assetId);

// When removing from timeline
await decrementAssetRef(projectId, assetId);

// Periodic cleanup
const unused = await getUnusedAssets(projectId);
await cleanUnusedAssets(projectId);
```

### 4. Debounced Saves

Use auto-save service for frequent updates:

```typescript
// Instead of saving on every change
markDirty(projectId);
setPendingData(projectId, data);

// Auto-save will batch changes with 1s debounce
```

### 5. Zustand Selectors

Use selectors to prevent unnecessary re-renders:

```typescript
// Good - only re-renders when selectedIds changes
const selectedIds = useResourceStore(state => state.selectedIds);

// Bad - re-renders on any state change
const store = useResourceStore();
```

### 6. History for Undo/Redo

Track store maintains operation history:

```typescript
// Operations automatically add to history
addItem(trackId, item);
moveItem(trackId, itemId, newStart);

// Undo/redo
undo();
redo();

// Check history state
const { canUndo, canRedo } = useTrackStore(state => ({
  canUndo: state.history.past.length > 0,
  canRedo: state.history.future.length > 0,
}));
```

---

## See Also

- `src/providers/README.md` - AI provider integration
- `src/workflow/README.md` - Multi-step generation workflows
- `src/engine/README.md` - Media playback engine
- `ARCHITECTURE.md` - Overall system architecture
