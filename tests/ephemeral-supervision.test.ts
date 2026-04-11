import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LoopStateManager } from '../src/state/manager.js';

// Mock dependencies
vi.mock('../src/core/analyzer.js', () => ({
  analyze: vi.fn(),
}));

vi.mock('../src/core/inference.js', () => ({
  inferOutcome: vi.fn(),
}));

vi.mock('../src/core/prompt-loader.js', () => ({
  loadSystemPrompt: vi.fn().mockReturnValue({ prompt: 'test prompt', source: 'built-in' }),
}));

vi.mock('../src/ui/renderer.js', () => ({
  updateUI: vi.fn(),
  toggleWidget: vi.fn(),
}));

vi.mock('../src/ui/model-picker.js', () => ({
  pickModel: vi.fn(),
}));

vi.mock('../src/ui/settings-panel.js', () => ({
  openSettings: vi.fn(),
}));

vi.mock('../src/global-config.js', () => ({
  loadGlobalModel: vi.fn().mockReturnValue(null),
  saveGlobalModel: vi.fn(),
}));

vi.mock('../src/session/client.js', () => ({
  disposeSession: vi.fn(),
}));

vi.mock('../src/subagent-detector.js', () => ({
  checkChildPiProcesses: vi.fn().mockResolvedValue({ hasActiveSubagents: false, count: 0 }),
  waitForSubagents: vi
    .fn()
    .mockResolvedValue({ completed: true, finalStatus: { hasActiveSubagents: false, count: 0 } }),
}));

import { updateUI } from '../src/ui/renderer.js';
import { disposeSession } from '../src/session/client.js';

// Mock ExtensionAPI
function createMockApi() {
  return {
    appendEntry: vi.fn(),
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    sendUserMessage: vi.fn(),
    sendMessage: vi.fn(),
    events: { emit: vi.fn(), on: vi.fn() },
  } as any;
}

function createMockContext(entries: any[] = [], isIdle = true) {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      setWorkingMessage: vi.fn(),
    },
    hasUI: true,
    cwd: '/test',
    sessionManager: {
      getBranch: vi.fn().mockReturnValue(entries),
    },
    modelRegistry: {},
    model: undefined,
    isIdle: vi.fn().mockReturnValue(isIdle),
    abort: vi.fn(),
    hasPendingMessages: vi.fn().mockReturnValue(false),
    shutdown: vi.fn(),
    getContextUsage: vi.fn(),
    compact: vi.fn(),
    getSystemPrompt: vi.fn().mockReturnValue('test'),
  } as any;
}

describe('Ephemeral Supervision - idle agent clears supervision', () => {
  let api: ReturnType<typeof createMockApi>;
  let state: LoopStateManager;

  beforeEach(() => {
    api = createMockApi();
    state = new LoopStateManager(api);
    vi.clearAllMocks();
  });

  function startActiveSupervision() {
    state.start('Test goal', 'anthropic', 'claude-haiku');
    state.incrementTurnCount();
    expect(state.isActive()).toBe(true);
  }

  function createSessionWithSupervision() {
    return [
      { type: 'message', message: { role: 'user', content: 'Hello' } },
      {
        type: 'custom',
        customType: 'loop-state',
        data: {
          active: true,
          outcome: 'Test goal',
          provider: 'anthropic',
          modelId: 'claude-haiku',
          interventions: [],
          startedAt: Date.now(),
          turnCount: 1,
          reframeTier: 0,
          lastSteerTurn: 0,
        },
      },
    ];
  }

  describe('session_start (crash resume)', () => {
    it('clears supervision when agent is idle', () => {
      startActiveSupervision();

      // Simulate session_start with idle agent (e.g., after crash)
      const entries = createSessionWithSupervision();
      const ctx = createMockContext(entries, true /* idle */);

      state.loadFromSession(ctx);

      // Ephemeral rule: idle agent means supervision is cleared
      expect(state.isActive()).toBe(true); // Still active after load

      // But onSessionLoad handler should stop it
      if (state.isActive() && ctx.isIdle()) {
        state.stop();
        disposeSession();
      }

      expect(state.isActive()).toBe(false);
    });

    it('keeps supervision when agent is working', () => {
      startActiveSupervision();

      // Simulate session_start with working agent
      const entries = createSessionWithSupervision();
      const ctx = createMockContext(entries, false /* working */);

      state.loadFromSession(ctx);

      // Ephemeral rule: working agent means supervision continues
      expect(state.isActive()).toBe(true);
    });
  });

  describe('session_start with resume reason (resume another session)', () => {
    it('clears supervision when agent is idle', () => {
      startActiveSupervision();

      const entries = createSessionWithSupervision();
      const ctx = createMockContext(entries, true /* idle */);

      state.loadFromSession(ctx);

      // Ephemeral rule applies
      if (state.isActive() && ctx.isIdle()) {
        state.stop();
        disposeSession();
      }

      expect(state.isActive()).toBe(false);
    });

    it('keeps supervision when agent is working', () => {
      startActiveSupervision();

      const entries = createSessionWithSupervision();
      const ctx = createMockContext(entries, false /* working */);

      state.loadFromSession(ctx);

      expect(state.isActive()).toBe(true);
    });
  });

  describe('session_tree (navigate history)', () => {
    it('clears supervision when navigating to history while idle', () => {
      startActiveSupervision();

      const entries = createSessionWithSupervision();
      const ctx = createMockContext(entries, true /* idle */);

      state.loadFromSession(ctx);

      // Ephemeral rule: viewing history + idle = no supervision
      if (state.isActive() && ctx.isIdle()) {
        state.stop();
        disposeSession();
      }

      expect(state.isActive()).toBe(false);
    });

    it('keeps supervision when at current head with working agent', () => {
      startActiveSupervision();

      const entries = createSessionWithSupervision();
      const ctx = createMockContext(entries, false /* working */);

      state.loadFromSession(ctx);

      expect(state.isActive()).toBe(true);
    });
  });

  describe('session_start with fork reason (fork session)', () => {
    it('clears supervision when agent is idle', () => {
      startActiveSupervision();

      const entries = createSessionWithSupervision();
      const ctx = createMockContext(entries, true /* idle */);

      state.loadFromSession(ctx);

      if (state.isActive() && ctx.isIdle()) {
        state.stop();
        disposeSession();
      }

      expect(state.isActive()).toBe(false);
    });

    it('keeps supervision when agent is working', () => {
      startActiveSupervision();

      const entries = createSessionWithSupervision();
      const ctx = createMockContext(entries, false /* working */);

      state.loadFromSession(ctx);

      expect(state.isActive()).toBe(true);
    });
  });
});

describe('Ephemeral Supervision - compaction behavior', () => {
  let api: ReturnType<typeof createMockApi>;
  let state: LoopStateManager;

  beforeEach(() => {
    api = createMockApi();
    state = new LoopStateManager(api);
    vi.clearAllMocks();
  });

  function createSessionWithSupervision() {
    return [
      { type: 'compaction', summary: 'Earlier conversation' },
      { type: 'message', message: { role: 'user', content: 'Continue' } },
      {
        type: 'custom',
        customType: 'loop-state',
        data: {
          active: true,
          outcome: 'Test goal',
          provider: 'anthropic',
          modelId: 'claude-haiku',
          interventions: [],
          startedAt: Date.now(),
          turnCount: 5,
          reframeTier: 1,
          lastSteerTurn: 3,
        },
      },
    ];
  }

  it('continues supervision when agent is working after compaction (long-horizon sessions)', () => {
    // Start supervision
    state.start('Test goal', 'anthropic', 'claude-haiku');
    state.incrementTurnCount();
    expect(state.isActive()).toBe(true);

    // Simulate post-compaction state with WORKING agent
    const entries = createSessionWithSupervision();
    const ctx = createMockContext(entries, false /* working, not idle */);

    state.loadFromSession(ctx);

    // Ephemeral rule: working agent means supervision continues
    // This enables long-horizon supervised sessions that auto-compact
    expect(state.isActive()).toBe(true);
    expect(state.getState()?.turnCount).toBe(5);
    expect(state.getReframeTier()).toBe(1);
  });

  it('clears supervision when agent is idle after compaction', () => {
    // Start supervision
    state.start('Test goal', 'anthropic', 'claude-haiku');
    state.incrementTurnCount();
    expect(state.isActive()).toBe(true);

    // Simulate post-compaction state with IDLE agent
    const entries = createSessionWithSupervision();
    const ctx = createMockContext(entries, true /* idle */);

    state.loadFromSession(ctx);

    // Ephemeral rule: idle agent means supervision is cleared
    if (state.isActive() && ctx.isIdle()) {
      state.stop();
      disposeSession();
    }

    expect(state.isActive()).toBe(false);
  });
});

describe('Ephemeral Supervision - UI notifications', () => {
  let api: ReturnType<typeof createMockApi>;
  let state: LoopStateManager;

  beforeEach(() => {
    api = createMockApi();
    state = new LoopStateManager(api);
    vi.clearAllMocks();
  });

  function createSessionWithSupervision() {
    return [
      {
        type: 'custom',
        customType: 'loop-state',
        data: {
          active: true,
          outcome: 'Test goal',
          provider: 'anthropic',
          modelId: 'claude-haiku',
          interventions: [],
          startedAt: Date.now(),
          turnCount: 1,
          reframeTier: 0,
          lastSteerTurn: 0,
        },
      },
    ];
  }

  it('notifies user when supervision is cleared on idle session load', () => {
    const entries = createSessionWithSupervision();
    const notify = vi.fn();
    const ctx = {
      ...createMockContext(entries, true /* idle */),
      ui: { ...createMockContext().ui, notify },
    };

    state.loadFromSession(ctx);

    // Simulate onSessionLoad notification
    if (state.isActive() && ctx.isIdle()) {
      notify('Supervision cleared: agent is idle', 'info');
    }

    expect(notify).toHaveBeenCalledWith('Supervision cleared: agent is idle', 'info');
  });

  it('notifies user when supervision is cleared after compaction', () => {
    const entries = createSessionWithSupervision();
    const notify = vi.fn();
    const ctx = {
      ...createMockContext(entries, true /* idle */),
      ui: { ...createMockContext().ui, notify },
    };

    state.loadFromSession(ctx);

    // Simulate session_compact handler notification
    if (state.isActive() && ctx.isIdle()) {
      notify('Supervision cleared: compaction complete, agent idle', 'info');
    }

    expect(notify).toHaveBeenCalledWith(
      'Supervision cleared: compaction complete, agent idle',
      'info'
    );
  });
});
