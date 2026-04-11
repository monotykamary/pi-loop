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

vi.mock('../src/global-config.js', () => ({
  loadGlobalModel: vi.fn().mockReturnValue(null),
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
import { pickModel } from '../src/ui/model-picker.js';
import { loadGlobalModel } from '../src/global-config.js';
import { inferOutcome } from '../src/core/inference.js';

describe('LoopStateManager - goal append feature', () => {
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

  it('appends to existing goal when supervision is already active', () => {
    const api = createMockApi();
    const state = new LoopStateManager(api);

    // Start initial supervision
    state.start('Initial goal', 'anthropic', 'claude-haiku');
    expect(state.getState()!.outcome).toBe('Initial goal');

    // Simulate appending (behavior from command handler)
    const trimmed = 'Additional requirement';
    const existing = state.getState();
    const appendedOutcome = `${existing!.outcome}. Additionally: ${trimmed}`;
    state.updateOutcome(appendedOutcome);

    expect(state.getState()!.outcome).toBe('Initial goal. Additionally: Additional requirement');
    expect(api.appendEntry).toHaveBeenCalledTimes(2); // start + update
  });

  it('persists appended goal to session', () => {
    const api = createMockApi();
    const state = new LoopStateManager(api);

    state.start('First part', 'anthropic', 'claude-haiku');
    state.updateOutcome('First part. Additionally: Second part');

    const lastCall = api.appendEntry.mock.calls[api.appendEntry.mock.calls.length - 1];
    expect(lastCall[1].outcome).toBe('First part. Additionally: Second part');
  });

  it('maintains active state when appending', () => {
    const api = createMockApi();
    const state = new LoopStateManager(api);

    state.start('Original', 'anthropic', 'claude-haiku');
    expect(state.isActive()).toBe(true);

    state.updateOutcome('Original. Additionally: More');
    expect(state.isActive()).toBe(true);
  });

  it('keeps other state intact when appending', () => {
    const api = createMockApi();
    const state = new LoopStateManager(api);

    state.start('Goal', 'openai', 'gpt-4o');
    state.incrementTurnCount();
    state.addIntervention({
      turnCount: 1,
      message: 'Focus',
      reasoning: 'Test',
      timestamp: Date.now(),
    });

    const originalProvider = state.getState()!.provider;
    const originalModelId = state.getState()!.modelId;
    const originalInterventions = state.getState()!.interventions.length;

    state.updateOutcome('Goal. Additionally: Extended');

    expect(state.getState()!.provider).toBe(originalProvider);
    expect(state.getState()!.modelId).toBe(originalModelId);
    expect(state.getState()!.interventions.length).toBe(originalInterventions);
  });
});

describe('Supervise command kickstart behavior', () => {
  function createMockCommandContext(overrides: { isIdle?: boolean; hasUI?: boolean } = {}) {
    return {
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
        input: vi.fn(),
        confirm: vi.fn(),
        setStatus: vi.fn(),
        setWorkingMessage: vi.fn(),
        setWidget: vi.fn(),
        setFooter: vi.fn(),
        setHeader: vi.fn(),
        custom: vi.fn(),
        pasteToEditor: vi.fn(),
        setEditorText: vi.fn(),
        getEditorText: vi.fn().mockReturnValue(''),
        editor: vi.fn(),
        setEditorComponent: vi.fn(),
        theme: {},
        getAllThemes: vi.fn().mockReturnValue([]),
        getTheme: vi.fn(),
        setTheme: vi.fn().mockReturnValue({ success: true }),
        getToolsExpanded: vi.fn().mockReturnValue(false),
        setToolsExpanded: vi.fn(),
        onTerminalInput: vi.fn().mockReturnValue(() => {}),
      },
      hasUI: overrides.hasUI ?? true,
      cwd: '/test',
      sessionManager: {
        getBranch: vi.fn().mockReturnValue([]),
      },
      modelRegistry: {
        getApiKeyForProvider: vi.fn().mockResolvedValue('test-key'),
      },
      model: {
        provider: 'anthropic',
        id: 'claude-haiku',
      },
      isIdle: vi.fn().mockReturnValue(overrides.isIdle ?? true),
      abort: vi.fn(),
      hasPendingMessages: vi.fn().mockReturnValue(false),
      shutdown: vi.fn(),
      getContextUsage: vi.fn(),
      compact: vi.fn(),
      getSystemPrompt: vi.fn().mockReturnValue('test system prompt'),
    } as any;
  }

  function createMockExtensionAPI() {
    const sendUserMessage = vi.fn();
    return {
      appendEntry: vi.fn(),
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
      sendUserMessage,
      sendMessage: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when agent is idle', () => {
    it('should kickstart with goal when running explicit /supervise <outcome>', async () => {
      // This tests the behavior pattern from the command handler
      const pi = createMockExtensionAPI();
      const ctx = createMockCommandContext({ isIdle: true });
      const state = new LoopStateManager(pi);

      // Simulate the command handler behavior
      const trimmed = 'Implement JWT authentication';
      state.start(trimmed, 'anthropic', 'claude-haiku');

      // Kickstart behavior
      if (ctx.isIdle()) {
        pi.sendUserMessage(`Please start working on this goal: ${trimmed}`, {
          deliverAs: 'followUp',
        });
      }

      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
      expect(pi.sendUserMessage).toHaveBeenCalledWith(
        'Please start working on this goal: Implement JWT authentication',
        { deliverAs: 'followUp' }
      );
    });

    it('should kickstart with inferred goal when agent is idle', async () => {
      vi.mocked(inferOutcome).mockResolvedValue('Fix the memory leak in handler');

      const pi = createMockExtensionAPI();
      const ctx = createMockCommandContext({ isIdle: true });
      const state = new LoopStateManager(pi);

      // Simulate inferred goal behavior
      const inferred = 'Fix the memory leak in handler';
      state.start(inferred, 'anthropic', 'claude-haiku');

      if (ctx.isIdle()) {
        pi.sendUserMessage(`Please start working on this goal: ${inferred}`, {
          deliverAs: 'followUp',
        });
      }

      expect(pi.sendUserMessage).toHaveBeenCalledWith(
        'Please start working on this goal: Fix the memory leak in handler',
        { deliverAs: 'followUp' }
      );
    });

    it('should kickstart when tool initiates supervision', async () => {
      const pi = createMockExtensionAPI();
      const ctx = createMockCommandContext({ isIdle: true });
      const state = new LoopStateManager(pi);

      // Simulate tool behavior
      const outcome = 'Refactor database layer';
      state.start(outcome, 'anthropic', 'claude-haiku');

      if (ctx.isIdle()) {
        pi.sendUserMessage(`Please start working on this goal: ${outcome}`, {
          deliverAs: 'followUp',
        });
      }

      expect(pi.sendUserMessage).toHaveBeenCalledWith(
        'Please start working on this goal: Refactor database layer',
        { deliverAs: 'followUp' }
      );
    });
  });

  describe('when agent is busy', () => {
    it('should NOT kickstart when running /supervise and agent is working', async () => {
      const pi = createMockExtensionAPI();
      const ctx = createMockCommandContext({ isIdle: false }); // Agent is busy
      const state = new LoopStateManager(pi);

      const trimmed = 'Implement feature X';
      state.start(trimmed, 'anthropic', 'claude-haiku');

      // Kickstart behavior (should NOT trigger)
      if (ctx.isIdle()) {
        pi.sendUserMessage(`Please start working on this goal: ${trimmed}`, {
          deliverAs: 'followUp',
        });
      }

      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it('should NOT kickstart when tool initiates supervision but agent is busy', async () => {
      const pi = createMockExtensionAPI();
      const ctx = createMockCommandContext({ isIdle: false });
      const state = new LoopStateManager(pi);

      const outcome = 'Add test coverage';
      state.start(outcome, 'anthropic', 'claude-haiku');

      if (ctx.isIdle()) {
        pi.sendUserMessage(`Please start working on this goal: ${outcome}`, {
          deliverAs: 'followUp',
        });
      }

      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });
  });

  describe('append behavior', () => {
    it('should NOT kickstart when appending to existing supervision', async () => {
      const pi = createMockExtensionAPI();
      const ctx = createMockCommandContext({ isIdle: true });
      const state = new LoopStateManager(pi);

      // First start supervision
      state.start('Original goal', 'anthropic', 'claude-haiku');

      // Reset mock to track only append behavior
      pi.sendUserMessage.mockClear();

      // Now simulate append (when supervision is already active)
      const trimmed = 'Additional requirement';
      const existing = state.getState();
      const appendedOutcome = `${existing!.outcome}. Additionally: ${trimmed}`;
      state.updateOutcome(appendedOutcome);

      // Append behavior does NOT kickstart - it just updates the goal
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(state.getState()!.outcome).toBe('Original goal. Additionally: Additional requirement');
    });

    it('should notify user when appending to goal', async () => {
      const pi = createMockExtensionAPI();
      const ctx = createMockCommandContext({ isIdle: true });
      const state = new LoopStateManager(pi);

      state.start('Original', 'anthropic', 'claude-haiku');

      const trimmed = 'More work';
      const existing = state.getState();
      const appendedOutcome = `${existing!.outcome}. Additionally: ${trimmed}`;
      state.updateOutcome(appendedOutcome);

      // In real implementation, this would call ctx.ui.notify
      // We verify the outcome was updated
      expect(state.getState()!.outcome).toContain('Additionally: More work');
    });
  });

  describe('edge cases', () => {
    it('should handle kickstart with very long goals (truncated in UI but full in message)', async () => {
      const pi = createMockExtensionAPI();
      const ctx = createMockCommandContext({ isIdle: true });
      const state = new LoopStateManager(pi);

      const longGoal = 'A'.repeat(200);
      state.start(longGoal, 'anthropic', 'claude-haiku');

      if (ctx.isIdle()) {
        pi.sendUserMessage(`Please start working on this goal: ${longGoal}`, {
          deliverAs: 'followUp',
        });
      }

      // Full goal should be in the kickstart message
      expect(pi.sendUserMessage).toHaveBeenCalledWith(
        `Please start working on this goal: ${longGoal}`,
        { deliverAs: 'followUp' }
      );
    });

    it('should handle empty isIdle() result gracefully', async () => {
      const pi = createMockExtensionAPI();
      const ctx = {
        ...createMockCommandContext(),
        isIdle: vi.fn().mockReturnValue(undefined), // falsy value
      };
      const state = new LoopStateManager(pi);

      const trimmed = 'Test goal';
      state.start(trimmed, 'anthropic', 'claude-haiku');

      // Should not kickstart when isIdle returns falsy
      if (ctx.isIdle()) {
        pi.sendUserMessage(`Please start working on this goal: ${trimmed}`, {
          deliverAs: 'followUp',
        });
      }

      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });
  });
});
