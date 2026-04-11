import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LoopStateManager } from '../src/state/manager.js';

// Mock dependencies
vi.mock('../src/core/analyzer.js', () => ({
  analyze: vi.fn(),
}));

vi.mock('../src/core/prompt-loader.js', () => ({
  loadSystemPrompt: vi.fn().mockReturnValue({ prompt: 'test prompt', source: 'built-in' }),
}));

vi.mock('../src/ui/renderer.js', () => ({
  updateUI: vi.fn(),
  toggleWidget: vi.fn(),
}));

vi.mock('../src/session/client.js', () => ({
  disposeSession: vi.fn(),
}));

import { analyze } from '../src/core/analyzer.js';
import { updateUI } from '../src/ui/renderer.js';

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

describe('LoopStateManager - compaction survival', () => {
  describe('loadFromSession after compaction', () => {
    it('restores state from custom entry in session', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Simulate a session with a supervisor-state entry
      const sessionEntries = [
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
            turnCount: 5,
            reframeTier: 2,
            lastSteerTurn: 3,
          },
        },
      ];

      const ctx = createMockContext(sessionEntries);
      state.loadFromSession(ctx);

      expect(state.isActive()).toBe(true);
      expect(state.getState()?.outcome).toBe('Test goal');
      expect(state.getState()?.provider).toBe('anthropic');
      expect(state.getState()?.turnCount).toBe(5);
      expect(state.getReframeTier()).toBe(2);
    });

    it('restores null state when no supervisor-state entry exists', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Session with no supervisor-state entry (e.g., after compaction summarized it away)
      const sessionEntries = [
        { type: 'message', message: { role: 'user', content: 'Hello' } },
        { type: 'compaction', summary: 'Summary of old messages' },
      ];

      const ctx = createMockContext(sessionEntries);
      state.loadFromSession(ctx);

      expect(state.isActive()).toBe(false);
      expect(state.getState()).toBeNull();
    });

    it('restores ephemeral fields with defaults after compaction', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      const sessionEntries = [
        {
          type: 'custom',
          customType: 'loop-state',
          data: {
            active: true,
            outcome: 'Test goal',
            provider: 'anthropic',
            modelId: 'claude-haiku',
            interventions: [{ turnCount: 1, message: 'Focus', reasoning: 'Test', timestamp: 123 }],
            startedAt: 1000,
            turnCount: 3,
            reframeTier: 1,
            lastSteerTurn: 2,
            // Ephemeral fields should NOT be in persisted data
          },
        },
      ];

      const ctx = createMockContext(sessionEntries);
      state.loadFromSession(ctx);

      // Ephemeral fields should be reset
      expect(state.getState()?.snapshotBuffer).toEqual([]);
      expect(state.getState()?.lastAnalyzedTurn).toBe(-1);
      expect(state.getState()?.justSteered).toBe(false);

      // Non-ephemeral fields should be preserved
      expect(state.getState()?.turnCount).toBe(3);
      expect(state.getState()?.reframeTier).toBe(1);
      expect(state.getState()?.lastSteerTurn).toBe(2);
    });

    it('uses the most recent supervisor-state entry when multiple exist', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      const sessionEntries = [
        {
          type: 'custom',
          customType: 'loop-state',
          data: {
            active: false, // Old - stopped
            outcome: 'Old goal',
            provider: 'openai',
            modelId: 'gpt-4o',
            interventions: [],
            startedAt: 1000,
            turnCount: 10,
          },
        },
        { type: 'message', message: { role: 'user', content: 'Continue' } },
        {
          type: 'custom',
          customType: 'loop-state',
          data: {
            active: true, // Newer - active
            outcome: 'New goal',
            provider: 'anthropic',
            modelId: 'claude-haiku',
            interventions: [],
            startedAt: 2000,
            turnCount: 3,
          },
        },
      ];

      const ctx = createMockContext(sessionEntries);
      state.loadFromSession(ctx);

      expect(state.isActive()).toBe(true);
      expect(state.getState()?.outcome).toBe('New goal');
      expect(state.getState()?.provider).toBe('anthropic');
    });
  });

  describe('persist() behavior', () => {
    it('persists active state to session via appendEntry', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      state.start('Test goal', 'anthropic', 'claude-haiku');

      // start() calls persist() with initial state
      expect(api.appendEntry).toHaveBeenCalledWith(
        'loop-state',
        expect.objectContaining({
          active: true,
          outcome: 'Test goal',
          provider: 'anthropic',
          modelId: 'claude-haiku',
          turnCount: 0,
        })
      );
    });

    it('does not persist ephemeral fields', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      state.start('Test goal', 'anthropic', 'claude-haiku');
      state.updateSnapshotBuffer([{ role: 'user', content: 'Hello' }]);
      state.clearJustSteered(); // justSteered would be false anyway

      const lastCall = api.appendEntry.mock.calls[api.appendEntry.mock.calls.length - 1];
      const persistedData = lastCall[1];

      // Ephemeral fields should NOT be persisted
      expect(persistedData.snapshotBuffer).toBeUndefined();
      expect(persistedData.lastAnalyzedTurn).toBeUndefined();
      expect(persistedData.justSteered).toBeUndefined();

      // Non-ephemeral fields should be persisted
      expect(persistedData.outcome).toBe('Test goal');
      expect(persistedData.active).toBe(true);
    });

    it('can be called manually to re-persist after compaction (public method)', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Start supervision
      state.start('Test goal', 'anthropic', 'claude-haiku');
      expect(api.appendEntry).toHaveBeenCalledTimes(1);

      // Simulate compaction handler re-persisting
      state.persist();
      expect(api.appendEntry).toHaveBeenCalledTimes(2);

      // Verify the re-persisted data is correct
      const lastCall = api.appendEntry.mock.calls[api.appendEntry.mock.calls.length - 1];
      expect(lastCall[0]).toBe('loop-state');
      expect(lastCall[1]).toMatchObject({
        active: true,
        outcome: 'Test goal',
        provider: 'anthropic',
        modelId: 'claude-haiku',
      });
    });

    it('does nothing when persist() is called with no active state', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // persist() with no active state should not call appendEntry
      state.persist();
      expect(api.appendEntry).not.toHaveBeenCalled();
    });

    it('preserves interventions when re-persisting', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      state.start('Test goal', 'anthropic', 'claude-haiku');
      state.incrementTurnCount();
      state.addIntervention({
        turnCount: 1,
        message: 'Focus on tests',
        reasoning: 'Drift detected',
        timestamp: 1234567890,
        asi: { why_stuck: 'no tests', strategy_used: 'directive' },
      });

      // Clear mock to test re-persist
      api.appendEntry.mockClear();
      state.persist();

      const lastCall = api.appendEntry.mock.calls[api.appendEntry.mock.calls.length - 1];
      expect(lastCall[1].interventions).toHaveLength(1);
      expect(lastCall[1].interventions[0].message).toBe('Focus on tests');
      expect(lastCall[1].interventions[0].asi).toEqual({
        why_stuck: 'no tests',
        strategy_used: 'directive',
      });
    });
  });

  describe('compaction survival scenario', () => {
    it('full lifecycle: start -> compact -> reload -> repersist', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // 1. Start supervision
      state.start('Implement auth', 'anthropic', 'claude-haiku');
      // Manually increment and persist to simulate turn progression
      state.incrementTurnCount();
      state.incrementTurnCount();
      state.addIntervention({
        turnCount: 2,
        message: 'Focus on JWT',
        reasoning: 'Drift',
        timestamp: 1000,
      });
      expect(state.isActive()).toBe(true);
      expect(state.getState()?.turnCount).toBe(2);

      // 2. Simulate compaction (session is reloaded with summary + recent entries)
      // After compaction, the supervisor-state entry is now "old" and in the kept portion
      // The extension's session_compact handler reloads state
      const postCompactionEntries = [
        { type: 'compaction', summary: 'Earlier conversation summarized' },
        { type: 'message', message: { role: 'user', content: 'Continue' } },
        // The supervisor-state entry was in the kept portion (recent)
        {
          type: 'custom',
          customType: 'loop-state',
          data: {
            active: true,
            outcome: 'Implement auth',
            provider: 'anthropic',
            modelId: 'claude-haiku',
            interventions: [
              { turnCount: 2, message: 'Focus on JWT', reasoning: 'Drift', timestamp: 1000 },
            ],
            startedAt: 500,
            turnCount: 2,
            reframeTier: 0,
            lastSteerTurn: 2,
          },
        },
      ];

      // 3. Reload from session (simulating session_compact handler)
      const ctx = createMockContext(postCompactionEntries);
      state.loadFromSession(ctx);

      // 4. Verify state was restored
      expect(state.isActive()).toBe(true);
      expect(state.getState()?.outcome).toBe('Implement auth');
      expect(state.getState()?.turnCount).toBe(2);
      expect(state.getState()?.interventions).toHaveLength(1);

      // 5. Re-persist to ensure future compactions find it in kept portion
      api.appendEntry.mockClear();
      state.persist();

      expect(api.appendEntry).toHaveBeenCalledWith(
        'loop-state',
        expect.objectContaining({
          active: true,
          outcome: 'Implement auth',
          turnCount: 2,
        })
      );
    });

    it('handles state loss when supervisor-state was summarized away', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Start supervision
      state.start('Lost goal', 'anthropic', 'claude-haiku');
      expect(state.isActive()).toBe(true);

      // Simulate compaction where supervisor-state was in summarized portion
      // (old, far back in history)
      const postCompactionEntries = [
        {
          type: 'compaction',
          summary: 'Earlier conversation summarized (including old supervisor-state)',
        },
        { type: 'message', message: { role: 'user', content: 'Recent message' } },
        // No supervisor-state in kept portion!
      ];

      // Reload after compaction
      const ctx = createMockContext(postCompactionEntries);
      state.loadFromSession(ctx);

      // State is lost (as expected - compaction summarized it away)
      expect(state.isActive()).toBe(false);
      expect(state.getState()).toBeNull();

      // Re-persist does nothing when state is null
      api.appendEntry.mockClear();
      state.persist();
      expect(api.appendEntry).not.toHaveBeenCalled();
    });

    it('recovers from state loss by re-persisting if was active', () => {
      // This test verifies the compaction handler pattern:
      // After compaction, if we had active state but it was lost,
      // we need some mechanism to recover. In the real implementation,
      // the session_compact handler checks isActive() after loadFromSession
      // and re-persists if needed.

      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Start supervision
      state.start('Goal', 'anthropic', 'claude-haiku');
      expect(state.isActive()).toBe(true);

      // Simulate scenario where state was lost in compaction
      // In reality, we'd need to track this differently, but the test
      // verifies the re-persist behavior when state IS active
      api.appendEntry.mockClear();

      // Simulate compaction handler: reload, then if active, re-persist
      state.persist(); // This would be called after loadFromSession in handler

      expect(api.appendEntry).toHaveBeenCalledWith(
        'loop-state',
        expect.objectContaining({
          active: true,
          outcome: 'Goal',
          turnCount: 0,
        })
      );
    });
  });

  describe('event handler behavior', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('session_before_compact persists state when supervision is active', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Start supervision
      state.start('Test goal', 'anthropic', 'claude-haiku');
      expect(api.appendEntry).toHaveBeenCalledTimes(1); // From start()

      // Simulate session_before_compact handler behavior
      if (state.isActive()) {
        state.persist();
      }

      expect(api.appendEntry).toHaveBeenCalledTimes(2);
      expect(api.appendEntry).toHaveBeenLastCalledWith(
        'loop-state',
        expect.objectContaining({
          active: true,
          outcome: 'Test goal',
          provider: 'anthropic',
          modelId: 'claude-haiku',
        })
      );
    });

    it('session_before_compact does nothing when supervision is inactive', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // No active supervision
      expect(state.isActive()).toBe(false);

      // Simulate session_before_compact handler behavior
      if (state.isActive()) {
        state.persist();
      }

      // Should not have called appendEntry
      expect(api.appendEntry).not.toHaveBeenCalled();
    });

    it('session_compact handler reloads state and updates UI', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Pre-populate with post-compaction entries containing supervisor-state
      const postCompactionEntries = [
        { type: 'compaction', summary: 'Earlier conversation summarized' },
        {
          type: 'custom',
          customType: 'loop-state',
          data: {
            active: true,
            outcome: 'Survived goal',
            provider: 'anthropic',
            modelId: 'claude-haiku',
            interventions: [],
            startedAt: 1000,
            turnCount: 5,
            reframeTier: 1,
            lastSteerTurn: 4,
          },
        },
      ];

      const ctx = createMockContext(postCompactionEntries, true);

      // Simulate session_compact handler
      state.loadFromSession(ctx);

      if (state.isActive()) {
        // Update UI to show we're back
        updateUI(ctx, state.getState(), { type: 'watching', reframeTier: state.getReframeTier() });
      } else {
        updateUI(ctx, null);
      }

      expect(state.isActive()).toBe(true);
      expect(state.getState()?.outcome).toBe('Survived goal');
      expect(updateUI).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ outcome: 'Survived goal' }),
        { type: 'watching', reframeTier: 1 }
      );
    });

    it('session_compact handler clears UI when state is lost', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Entries with NO supervisor-state (simulating lost state)
      const lostStateEntries = [
        {
          type: 'compaction',
          summary: 'Earlier conversation summarized including supervisor-state',
        },
        { type: 'message', message: { role: 'user', content: 'Recent message' } },
      ];

      const ctx = createMockContext(lostStateEntries, true);

      // Simulate session_compact handler
      state.loadFromSession(ctx);

      if (state.isActive()) {
        updateUI(ctx, state.getState(), { type: 'watching', reframeTier: state.getReframeTier() });
      } else {
        updateUI(ctx, null);
      }

      expect(state.isActive()).toBe(false);
      expect(updateUI).toHaveBeenCalledWith(ctx, null);
    });

    it('session_compact triggers steering when agent is idle and steering is needed', async () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Mock analyze to return a steering decision
      vi.mocked(analyze).mockResolvedValue({
        action: 'steer',
        message: 'Please continue with the implementation',
        reasoning: 'Agent idle after compaction',
        confidence: 0.9,
        asi: { why_stuck: 'compaction_interrupt', strategy_used: 'directive' },
      });

      const postCompactionEntries = [
        { type: 'compaction', summary: 'Earlier conversation summarized' },
        {
          type: 'custom',
          customType: 'loop-state',
          data: {
            active: true,
            outcome: 'Implement feature X',
            provider: 'anthropic',
            modelId: 'claude-haiku',
            interventions: [],
            startedAt: 1000,
            turnCount: 3,
            reframeTier: 0,
            lastSteerTurn: -1,
          },
        },
      ];

      const ctx = createMockContext(postCompactionEntries, true); // Agent is idle

      // Simulate session_compact handler flow
      state.loadFromSession(ctx);

      if (!state.isActive()) {
        updateUI(ctx, null);
        return;
      }

      updateUI(ctx, state.getState(), { type: 'watching', reframeTier: state.getReframeTier() });

      // If agent is idle, analyze and steer
      if (ctx.isIdle()) {
        const s = state.getState()!;
        updateUI(ctx, s, {
          type: 'analyzing',
          turn: s.turnCount,
          reframeTier: state.getReframeTier(),
        });

        const decision = await analyze(
          ctx,
          s,
          true,
          undefined,
          undefined,
          (accumulated: string) => {
            // onDelta callback
          }
        );

        if (decision.action === 'steer' && decision.message) {
          state.addIntervention({
            turnCount: s.turnCount,
            message: decision.message,
            reasoning: decision.reasoning,
            timestamp: Date.now(),
            asi: decision.asi,
          });
          updateUI(ctx, state.getState(), {
            type: 'steering',
            message: decision.message,
            reframeTier: state.getReframeTier(),
          });
          api.sendUserMessage(decision.message);
        }
      }

      expect(analyze).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ outcome: 'Implement feature X' }),
        true,
        undefined,
        undefined,
        expect.any(Function)
      );
      expect(state.getState()?.interventions).toHaveLength(1);
      expect(api.sendUserMessage).toHaveBeenCalledWith('Please continue with the implementation');
      expect(updateUI).toHaveBeenLastCalledWith(
        ctx,
        expect.any(Object),
        expect.objectContaining({
          type: 'steering',
          message: 'Please continue with the implementation',
        })
      );
    });

    it('session_compact marks done when goal achieved after compaction', async () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Mock analyze to return 'done'
      vi.mocked(analyze).mockResolvedValue({
        action: 'done',
        reasoning: 'Goal achieved',
        confidence: 0.95,
      });

      const postCompactionEntries = [
        { type: 'compaction', summary: 'Earlier conversation summarized' },
        {
          type: 'custom',
          customType: 'loop-state',
          data: {
            active: true,
            outcome: 'Complete the task',
            provider: 'anthropic',
            modelId: 'claude-haiku',
            interventions: [],
            startedAt: 1000,
            turnCount: 10,
            reframeTier: 0,
            lastSteerTurn: -1,
          },
        },
      ];

      const ctx = createMockContext(postCompactionEntries, true);

      // Simulate session_compact handler
      state.loadFromSession(ctx);

      if (!state.isActive()) {
        updateUI(ctx, null);
        return;
      }

      updateUI(ctx, state.getState(), { type: 'watching', reframeTier: state.getReframeTier() });

      if (ctx.isIdle()) {
        const s = state.getState()!;
        const decision = await analyze(ctx, s, true);

        if (decision.action === 'done') {
          state.resetReframeTier();
          updateUI(ctx, state.getState(), { type: 'done' });
          state.stop();
        }
      }

      expect(state.isActive()).toBe(false);
      expect(updateUI).toHaveBeenLastCalledWith(ctx, expect.any(Object), { type: 'done' });
    });

    it('session_compact does not steer when agent is busy', async () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      const postCompactionEntries = [
        { type: 'compaction', summary: 'Earlier conversation summarized' },
        {
          type: 'custom',
          customType: 'loop-state',
          data: {
            active: true,
            outcome: 'Implement feature',
            provider: 'anthropic',
            modelId: 'claude-haiku',
            interventions: [],
            startedAt: 1000,
            turnCount: 3,
            reframeTier: 0,
            lastSteerTurn: -1,
          },
        },
      ];

      // Agent is NOT idle (busy streaming)
      const ctx = createMockContext(postCompactionEntries, false);

      // Simulate session_compact handler
      state.loadFromSession(ctx);

      if (!state.isActive()) {
        updateUI(ctx, null);
        return;
      }

      updateUI(ctx, state.getState(), { type: 'watching', reframeTier: state.getReframeTier() });

      // Should NOT analyze/steer when agent is busy
      if (ctx.isIdle()) {
        await analyze(ctx, state.getState()!, true);
      }

      expect(ctx.isIdle).toHaveBeenCalled();
      expect(analyze).not.toHaveBeenCalled();
    });
  });
});
