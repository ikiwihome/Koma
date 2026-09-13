import { describe, expect, it } from 'vitest';

import {
  buildScriptAnalysisOverallProgress,
  buildScriptAnalysisStatusLine,
  createInitialScriptAnalysisStageStates,
  getPrimaryScriptAnalysisStage,
} from './scriptAnalysisProgress';

describe('scriptAnalysisProgress', () => {
  it('builds weighted progress without plan stage', () => {
    const states = createInitialScriptAnalysisStageStates();
    states.characters = { status: 'running', progress: 0.5, chunkIndex: 1, chunkTotal: 2 };
    states.scenes = { status: 'running', progress: 0.25, chunkIndex: 1, chunkTotal: 4 };
    states.props = { status: 'pending', progress: 0 };

    expect(buildScriptAnalysisOverallProgress(states)).toBe(27);
  });

  it('builds retry-aware status line', () => {
    const states = createInitialScriptAnalysisStageStates({ includePlan: true });
    states.plan = { status: 'completed', progress: 1 };
    states.characters = {
      status: 'running',
      progress: 0.5,
      chunkIndex: 1,
      chunkTotal: 2,
      retryDelayMs: 1200,
    };
    states.scenes = { status: 'running', progress: 0.5, chunkIndex: 1, chunkTotal: 2 };
    states.props = { status: 'pending', progress: 0 };

    expect(buildScriptAnalysisStatusLine(states, { includePlan: true })).toBe('角色重试 1/2（1.2s后） · 场景 1/2');
  });

  it('prefers failed stage as primary stage', () => {
    const states = createInitialScriptAnalysisStageStates();
    states.characters = { status: 'completed', progress: 1 };
    states.scenes = { status: 'failed', progress: 0.5 };
    states.props = { status: 'running', progress: 0.5 };

    expect(getPrimaryScriptAnalysisStage(states)).toBe('scenes');
  });
});
