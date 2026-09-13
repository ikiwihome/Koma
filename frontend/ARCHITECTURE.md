# Koma Frontend Architecture

## Overview

Koma is an AI-powered video creation platform that transforms scripts into storyboards and videos. The frontend is built with React, TypeScript, and Ant Design, running in an Electron environment.

## Technology Stack

- **Framework**: React 18 + TypeScript
- **State Management**: Zustand + localStorage hybrid
- **UI Library**: Ant Design 5.x + Tailwind CSS
- **Build Tool**: Vite
- **Runtime**: Electron (with web fallback)
- **Internationalization**: react-i18next

---

## Directory Structure

```
src/
├── App.tsx                 # Root component, routing & global state
├── index.tsx               # Entry point, provider initialization
├── types.ts                # Central type definitions (600+ lines)
│
├── chat/                   # AI conversation system
│   ├── adapters/           # LLM provider adapters (Claude, OpenAI, Gemini)
│   ├── components/         # Chat UI components
│   ├── hooks/              # Chat state hooks
│   ├── ipc/                # Electron IPC bridge
│   └── plugins/            # Function calling, file upload
│
├── components/             # React UI components
│   ├── asset/              # Character, Scene, Prop management
│   ├── chat/               # Chat interface
│   ├── common/             # Shared components (Header, Sidebar)
│   ├── editor/             # Timeline, keyframe editors
│   ├── plugins/            # Plugin management UI
│   ├── project/            # Project list, overview, episodes
│   ├── settings/           # Configuration managers
│   ├── storyboard/         # Shot cards, storyboard layout
│   └── video/              # Video remix, stage player
│
├── config/                 # Configuration files
│   └── themePresets.ts     # Visual style presets
│
├── constants/              # Application constants
│
├── editor/                 # Script editor utilities
│
├── engine/                 # Media playback & rendering
│   ├── AudioController.ts  # Audio playback control
│   ├── MediaEngine.ts      # Media loading/caching
│   ├── PlaybackEngine.ts   # Playback state machine
│   ├── simpleEngine.ts     # Export rendering pipeline
│   ├── SnapEngine.ts       # Timeline snapping
│   └── VideoRenderer.ts    # Canvas rendering
│
├── hooks/                  # Custom React hooks
│
├── i18n/                   # Internationalization
│   └── locales/            # zh-CN, en-US translations
│
├── manju-dsl/              # DSL protocol for serialization
│
├── providers/              # AI/Media provider system
│   ├── llm/                # Language model providers
│   ├── tti/                # Text-to-image providers
│   ├── itv/                # Image-to-video providers
│   ├── tts/                # Text-to-speech providers
│   ├── channel/            # Channel configuration types
│   └── registry.ts         # Provider registration
│
├── services/               # Business logic layer
│   ├── plugin/             # Plugin system
│   ├── draftExport/        # Jianying export
│   └── *.ts                # Various services
│
├── store/                  # State management
│   ├── project/            # Project data persistence
│   ├── settings/           # App settings persistence
│   └── *.ts                # Various stores
│
├── theme/                  # UI theming
│
├── types/                  # Additional type definitions
│
├── utils/                  # Utility functions
│
└── workflow/               # Multi-step generation workflows
```

---

## Core Concepts

### 1. Project Model

```
Project
├── Episodes[]              # Multiple episodes per project
│   ├── scriptText          # Raw script content
│   └── stepProgress        # assets → storyboard → video
│
├── Characters[]            # Shared across episodes
├── Scenes[]                # Shared across episodes
├── Props[]                 # Shared across episodes
│
└── Shots[]                 # Per-episode, derived from script
    ├── imagePrompt         # TTI generation prompt
    ├── videoPrompt         # ITV generation prompt
    ├── imagePaths[]        # Generated image candidates
    └── videos[]            # Generated video versions
```

### 2. Three-Step Workflow

Each episode follows a three-step production flow:

```
┌─────────────────────────────────────────────────────────────┐
│  1. ASSETS          2. STORYBOARD        3. VIDEO           │
│  ────────────       ─────────────        ─────────          │
│  • Extract          • Generate shots     • Render videos    │
│    characters       • Create image       • Add audio        │
│  • Extract scenes     prompts            • Export timeline  │
│  • Extract props    • Generate images                       │
│  • Generate         • Arrange layout                        │
│    costume photos                                           │
└─────────────────────────────────────────────────────────────┘
```

### 3. Editor Steps

The `EditorStep` type defines the current phase:

```typescript
type EditorStep = 'assets' | 'storyboard' | 'video';
```

---

## Data Flow

### Script Analysis Flow

```
User Input (Script)
       │
       ▼
┌──────────────────┐
│ ScriptAnalysis   │ ← Uses LLM provider with JSON Schema
│ Service          │
└────────┬─────────┘
         │
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
Characters  Scenes       Props
    │         │            │
    └────┬────┴────────────┘
         │
         ▼
┌──────────────────┐
│ ShotAnalysis     │ ← Breaks script into shots
│ Service          │
└────────┬─────────┘
         │
         ▼
    Shots[] with
    prompts & metadata
```

### Asset Generation Flow

```
User triggers generation
         │
         ▼
┌──────────────────┐
│ TaskManager      │ ← Creates tracked async task
│ createTask()     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ TTI/ITV Provider │ ← External API call
│ generateImage()  │
└────────┬─────────┘
         │
    ┌────┴────┐
    │ Polling │ ← For async providers
    └────┬────┘
         │
         ▼
┌──────────────────┐
│ Download &       │ ← Cache locally
│ Cache Asset      │
└────────┬─────────┘
         │
         ▼
    Update UI via
    task listeners
```

### Export Flow

```
EditorView
    │
    ▼
ExportDialog
    │
    ├─── MP4/WebM Export ──► simpleExportRenderer
    │                              │
    │                         Canvas → FFmpeg
    │
    └─── Jianying Export ──► JianyingExporter
                                   │
                            Coordinate transforms
                            + Draft JSON
```

---

## Provider System

### Architecture

The provider system uses a **factory pattern** with **dynamic registration**:

```
┌─────────────────────────────────────────────────────────┐
│                    Provider Registry                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │   TTI   │  │   ITV   │  │   TTS   │  │   LLM   │    │
│  │Registry │  │Registry │  │Registry │  │ (direct)│    │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘    │
└───────┼────────────┼────────────┼────────────┼──────────┘
        │            │            │            │
   ┌────┴────┐  ┌────┴────┐  ┌────┴────┐  ┌────┴────┐
   │ComfyUI  │  │ Sora2   │  │EdgeTTS  │  │ Claude  │
   │Jimeng   │  │ Kling   │  │FishAudio│  │ Gemini  │
   │DALL-E   │  │ Pika    │  │DoubaoTTS│  │ OpenAI  │
   └─────────┘  └─────────┘  └─────────┘  └─────────┘
```

### Provider Types

| Type | Purpose | Key Interface |
|------|---------|---------------|
| **LLM** | Text generation, script analysis | `chat(messages): Promise<string>` |
| **TTI** | Text-to-image generation | `generateImage(prompt, options): Promise<ImageResult>` |
| **ITV** | Image-to-video generation | `generateVideo(input): Promise<VideoResult>` |
| **TTS** | Text-to-speech synthesis | `synthesize(text, voiceId): Promise<AudioResult>` |

### Configuration Flow

```typescript
// 1. User configures provider in Settings
TTIModelConfig {
  id: string;
  provider: 'comfyui' | 'jimeng' | ...;
  apiKey: string;
  baseUrl: string;
}

// 2. Factory creates instance
const provider = await getTTIProvider(configId);

// 3. Service uses provider
const result = await provider.generateImage(prompt, options);
```

---

## State Management

### Hybrid Approach

Koma uses a **Zustand + localStorage hybrid**:

| Store Type | Use Case | Persistence |
|------------|----------|-------------|
| **Zustand** | UI state, real-time updates | Memory only |
| **localStorage** | Chat history, task queue | Browser storage |
| **Filesystem** | Projects, assets, settings | Electron fs |

### Key Stores

```
┌─────────────────────────────────────────────────────────┐
│                      State Layer                         │
├─────────────────┬─────────────────┬─────────────────────┤
│   trackStore    │  pluginStore    │   resourceStore     │
│   (Zustand)     │  (Zustand)      │   (Functions)       │
│                 │                 │                     │
│ • Timeline      │ • Installed     │ • Asset cache       │
│ • Tracks        │   plugins       │ • Media preload     │
│ • Clips         │ • Runtime       │                     │
│ • Selection     │   states        │                     │
├─────────────────┴─────────────────┴─────────────────────┤
│                   Persistence Layer                      │
├─────────────────┬─────────────────┬─────────────────────┤
│  projectStore   │  globalStore    │  taskQueueStore     │
│  (Filesystem)   │  (Filesystem)   │  (localStorage)     │
│                 │                 │                     │
│ • Projects      │ • LLM configs   │ • Pending tasks     │
│ • Episodes      │ • TTI configs   │ • Task recovery     │
│ • Assets        │ • Theme prefs   │                     │
└─────────────────┴─────────────────┴─────────────────────┘
```

### Project Storage Structure

```
{storagePath}/
├── settings.json           # Global app settings
├── recent-projects.json    # Recently opened projects
└── projects/
    └── {projectId}/
        ├── meta.json       # Project metadata
        ├── characters.json # Character definitions
        ├── scenes.json     # Scene definitions
        ├── props.json      # Prop definitions
        ├── assets/         # Generated images/videos
        ├── cache/          # Thumbnails, waveforms
        └── episodes/
            └── {episodeId}/
                ├── episode.json
                ├── analysis.json
                ├── shots.json
                └── timeline.json
```

---

## Plugin System

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Plugin Host                           │
│  ┌────────────────┐  ┌────────────────┐                  │
│  │ PluginLoader   │  │ PluginSandbox  │                  │
│  │ (Dynamic ESM)  │  │ (Security)     │                  │
│  └───────┬────────┘  └───────┬────────┘                  │
│          │                   │                            │
│          ▼                   ▼                            │
│  ┌────────────────────────────────────┐                  │
│  │           PluginAPI                │                  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐       │                  │
│  │  │core  │ │store │ │channel│      │                  │
│  │  │.host │ │.get  │ │.reg   │      │                  │
│  │  └──────┘ └──────┘ └──────┘       │                  │
│  └────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────┘
```

### Plugin Categories

| Category | Purpose | Example |
|----------|---------|---------|
| **provider** | Custom TTI/ITV/TTS providers | Sora2 Plugin |
| **global** | Full-page UI extensions | Custom dashboard |
| **tool** | Editor tools | Batch operations |
| **mcp** | MCP server integration | External tools |

### Permission Scopes

```typescript
type PluginScope =
  | 'settings:read'      // Read app settings
  | 'settings:write'     // Modify settings
  | 'projects:read'      // Read project data
  | 'projects:write'     // Modify projects
  | 'storage:limited'    // Plugin-sandboxed storage
  | 'network:external'   // External API calls
  | 'prompts:override';  // Override prompt templates
```

---

## Engine System

### Playback Pipeline

```
┌─────────────────────────────────────────────────────────┐
│                   MediaEngine                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │VideoRenderer│  │AudioControl │  │PlaybackState│     │
│  │(Canvas)     │  │(Web Audio)  │  │Machine      │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │              │
│         └────────┬───────┴────────────────┘              │
│                  ▼                                       │
│         ┌─────────────────┐                             │
│         │ requestAnimFrame│                             │
│         │ render loop     │                             │
│         └─────────────────┘                             │
└──────────────────────────────────────────────────────────┘
```

### Timeline Model

```typescript
Timeline {
  id: string;
  duration: number;        // Total duration (ms)
  fps: number;             // Frame rate
  resolution: { width, height };
  tracks: Track[];
}

Track {
  id: string;
  type: 'video' | 'audio' | 'subtitle';
  clips: Clip[];
  muted: boolean;
  locked: boolean;
}

Clip {
  id: string;
  startTime: number;       // Position on timeline (ms)
  duration: number;        // Clip duration (ms)
  sourcePath: string;      // Media file path
  keyframes: Keyframe[];   // Animation data
  position: { x, y };
  scale: number;
  rotation: number;
  opacity: number;
}
```

---

## Task System

### Task Lifecycle

```
┌─────────┐     ┌──────────┐     ┌───────────┐     ┌───────────┐
│ pending │ ──► │processing│ ──► │ completed │  or │  failed   │
└─────────┘     └──────────┘     └───────────┘     └───────────┘
     │               │                                    │
     │               │                                    │
     └───────────────┴────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │   Recovery  │
                    │   Service   │
                    └─────────────┘
```

### Task Types

```typescript
type AsyncTaskType = 'tti' | 'itv' | 'tts' | 'character-extraction';

interface AsyncTask {
  id: string;
  projectId: string;
  type: AsyncTaskType;
  targetType: 'character' | 'scene' | 'prop' | 'shot';
  targetId: string;
  remoteTaskId: string;    // External API task ID
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;        // 0-100
  retryCount: number;
}
```

---

## Electron Integration

### IPC Bridge

```
┌─────────────────┐         ┌─────────────────┐
│    Renderer     │         │      Main       │
│    Process      │         │     Process     │
│                 │         │                 │
│ electronService │ ◄─IPC─► │  preload.js     │
│                 │         │                 │
│ • fs operations │         │ • Native fs     │
│ • dialog        │         │ • Shell         │
│ • clipboard     │         │ • Child process │
│ • path utils    │         │                 │
└─────────────────┘         └─────────────────┘
```

### Key IPC Channels

| Channel | Purpose |
|---------|---------|
| `fs.*` | File system operations |
| `dialog.*` | Native dialogs (open, save) |
| `shell.*` | Open external links |
| `clipboard.*` | Clipboard operations |
| `chat.*` | LLM chat via main process |
| `mcp.*` | MCP server management |

---

## Key Design Decisions

### 1. Why Zustand + localStorage Hybrid?

- **Zustand**: Fast reactive updates for UI state
- **localStorage**: Persist tasks across sessions without file I/O
- **Filesystem**: Project data needs proper file management

### 2. Why Provider Factory Pattern?

- Multiple provider implementations per category
- Runtime provider switching based on user config
- Plugin providers can register dynamically

### 3. Why Three-Step Workflow?

- Matches creative video production mental model
- Allows iteration at each stage
- Clear progress tracking per episode

### 4. Why Electron?

- Local file system access for assets
- FFmpeg integration for video export
- Native dialog support
- MCP server process management

---

## Performance Considerations

### Media Caching

- Thumbnails generated on-demand, cached in project
- Video frames decoded per-request
- Waveforms pre-computed for audio tracks

### State Updates

- Zustand selectors prevent unnecessary re-renders
- Timeline updates use immutable patterns
- Large lists use virtualization

### Asset Generation

- Tasks polled with exponential backoff
- Failed tasks auto-retry (configurable)
- Results downloaded and cached locally

---

## See Also

- `src/engine/README.md` - Rendering pipeline details
- `src/providers/README.md` - Provider implementation guide
- `src/store/README.md` - State management patterns
- `src/workflow/README.md` - Workflow orchestration
