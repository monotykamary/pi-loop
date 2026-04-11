import { describe, expect, it, vi } from 'vitest';
import { LoopStateManager } from '../src/state/manager.js';

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

describe('LoopStateManager', () => {
  describe('reframe tier management', () => {
    it('initializes reframe tier to 0 on start', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      expect(state.getReframeTier()).toBe(0);
      expect(state.getState()!.reframeTier).toBe(0);
      expect(state.getState()!.lastSteerTurn).toBe(-1);
    });

    it('escalates reframe tier up to max of 4', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      expect(state.getReframeTier()).toBe(0);

      state.escalateReframeTier();
      expect(state.getReframeTier()).toBe(1);

      state.escalateReframeTier();
      expect(state.getReframeTier()).toBe(2);

      state.escalateReframeTier();
      expect(state.getReframeTier()).toBe(3);

      state.escalateReframeTier();
      expect(state.getReframeTier()).toBe(4);

      // Should not go above 4
      state.escalateReframeTier();
      expect(state.getReframeTier()).toBe(4);
    });

    it('resets reframe tier to 0', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.escalateReframeTier();
      state.escalateReframeTier();
      expect(state.getReframeTier()).toBe(2);

      state.resetReframeTier();
      expect(state.getReframeTier()).toBe(0);
    });

    it('returns 0 when not active', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      expect(state.getReframeTier()).toBe(0);
    });

    it('persists reframe tier changes', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.escalateReframeTier();

      expect(api.appendEntry).toHaveBeenLastCalledWith(
        'loop-state',
        expect.objectContaining({ reframeTier: 1 })
      );
    });

    it('tracks lastSteerTurn when adding intervention', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');
      state.incrementTurnCount();
      state.incrementTurnCount();

      state.addIntervention({
        turnCount: 2,
        message: 'Please focus on X',
        reasoning: 'Agent drifted',
        timestamp: Date.now(),
      });

      expect(state.getState()!.lastSteerTurn).toBe(2);
    });
  });

  describe('ineffective pattern detection', () => {
    it('returns no pattern with less than 2 interventions', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      const pattern = state.detectIneffectivePattern();
      expect(pattern.detected).toBe(false);
      expect(pattern.similarCount).toBe(0);
    });

    it('detects similar messages', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      // Add similar interventions
      state.incrementTurnCount();
      state.addIntervention({
        turnCount: 1,
        message: 'Please implement the auth middleware',
        reasoning: 'Not done yet',
        timestamp: Date.now(),
      });

      state.incrementTurnCount();
      state.addIntervention({
        turnCount: 2,
        message: 'Please implement the auth middleware now',
        reasoning: 'Still not done',
        timestamp: Date.now(),
      });

      const pattern = state.detectIneffectivePattern();
      expect(pattern.detected).toBe(true);
      expect(pattern.similarCount).toBe(2);
    });

    it('detects lack of progress (3+ turns since steer)', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      // Add intervention
      state.incrementTurnCount();
      state.addIntervention({
        turnCount: 1,
        message: 'Focus on X',
        reasoning: 'Test',
        timestamp: Date.now(),
      });

      // Advance 3 turns without steering
      state.incrementTurnCount(); // turn 2
      state.incrementTurnCount(); // turn 3
      state.incrementTurnCount(); // turn 4

      const pattern = state.detectIneffectivePattern();
      expect(pattern.detected).toBe(true);
      expect(pattern.turnsSinceLastSteer).toBe(3);
    });

    it('does not detect pattern when progress is being made', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      // Add intervention
      state.incrementTurnCount();
      state.addIntervention({
        turnCount: 1,
        message: 'Focus on X',
        reasoning: 'Test',
        timestamp: Date.now(),
      });

      // Only 2 turns since steer
      state.incrementTurnCount();
      state.incrementTurnCount();

      const pattern = state.detectIneffectivePattern();
      expect(pattern.detected).toBe(false);
      expect(pattern.turnsSinceLastSteer).toBe(2);
    });

    it('detects dissimilar messages as different', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.incrementTurnCount();
      state.addIntervention({
        turnCount: 1,
        message: 'Implement the database layer',
        reasoning: 'Need DB',
        timestamp: Date.now(),
      });

      state.incrementTurnCount();
      state.addIntervention({
        turnCount: 2,
        message: 'Now create the API endpoints',
        reasoning: 'Need API',
        timestamp: Date.now(),
      });

      const pattern = state.detectIneffectivePattern();
      expect(pattern.detected).toBe(false);
      expect(pattern.similarCount).toBe(1);
    });
  });

  describe('basic lifecycle', () => {
    it('starts inactive', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      expect(state.isActive()).toBe(false);
      expect(state.getState()).toBeNull();
    });

    it('starts supervision with correct initial state', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      state.start('Test goal', 'anthropic', 'claude-haiku');

      expect(state.isActive()).toBe(true);
      const s = state.getState();
      expect(s).not.toBeNull();
      expect(s!.outcome).toBe('Test goal');
      expect(s!.provider).toBe('anthropic');
      expect(s!.modelId).toBe('claude-haiku');
      expect(s!.interventions).toEqual([]);
      expect(s!.turnCount).toBe(0);
      expect(s!.snapshotBuffer).toEqual([]);
      expect(s!.justSteered).toBe(false);
    });

    it('stops supervision and marks inactive and clears outcome', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      state.start('Test goal', 'anthropic', 'claude-haiku');
      expect(state.isActive()).toBe(true);
      expect(state.getState()!.outcome).toBe('Test goal');

      state.stop();
      expect(state.isActive()).toBe(false);
      expect(state.getState()!.active).toBe(false);
      expect(state.getState()!.outcome).toBe(''); // Goal cleared for fresh start
    });

    it('persists state on start and stop with cleared outcome', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      state.start('Test goal', 'anthropic', 'claude-haiku');
      expect(api.appendEntry).toHaveBeenCalledTimes(1);
      expect(api.appendEntry).toHaveBeenCalledWith(
        'loop-state',
        expect.objectContaining({
          active: true,
          outcome: 'Test goal',
        })
      );

      state.stop();
      expect(api.appendEntry).toHaveBeenCalledTimes(2);
      expect(api.appendEntry).toHaveBeenLastCalledWith(
        'loop-state',
        expect.objectContaining({
          active: false,
          outcome: '', // Goal cleared on stop
        })
      );
    });
  });

  describe('turn management', () => {
    it('increments turn count', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      expect(state.getState()!.turnCount).toBe(0);
      state.incrementTurnCount();
      expect(state.getState()!.turnCount).toBe(1);
      state.incrementTurnCount();
      expect(state.getState()!.turnCount).toBe(2);
    });
  });

  describe('interventions', () => {
    it('adds intervention with correct data', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');
      state.incrementTurnCount();

      const intervention = {
        turnCount: 1,
        message: 'Please focus on X',
        reasoning: 'Agent drifted',
        timestamp: Date.now(),
      };

      state.addIntervention(intervention);

      const s = state.getState()!;
      expect(s.interventions).toHaveLength(1);
      expect(s.interventions[0]).toEqual(intervention);
      expect(s.justSteered).toBe(true);
    });

    it('clears justSteered flag', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.addIntervention({
        turnCount: 1,
        message: 'Steer',
        reasoning: 'Test',
        timestamp: Date.now(),
      });
      expect(state.getState()!.justSteered).toBe(true);

      state.clearJustSteered();
      expect(state.getState()!.justSteered).toBe(false);
    });

    it('does not add intervention when not active', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      state.addIntervention({
        turnCount: 1,
        message: 'Steer',
        reasoning: 'Test',
        timestamp: Date.now(),
      });

      // Should not throw, should just return
      expect(state.getState()).toBeNull();
    });
  });

  describe('shouldAnalyzeMidRun', () => {
    it('returns false when justSteered is false and turn not divisible by 8', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      expect(state.shouldAnalyzeMidRun(1)).toBe(false);
      expect(state.shouldAnalyzeMidRun(2)).toBe(false);
      expect(state.shouldAnalyzeMidRun(7)).toBe(false);
    });

    it('returns true when justSteered is true', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.addIntervention({
        turnCount: 1,
        message: 'Steer',
        reasoning: 'Test',
        timestamp: Date.now(),
      });

      expect(state.shouldAnalyzeMidRun(1)).toBe(true);
    });

    it('returns true every 8th turn (safety valve)', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      expect(state.shouldAnalyzeMidRun(8)).toBe(true);
      expect(state.shouldAnalyzeMidRun(16)).toBe(true);
      expect(state.shouldAnalyzeMidRun(24)).toBe(true);
    });

    it('returns true when both conditions met', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.addIntervention({
        turnCount: 1,
        message: 'Steer',
        reasoning: 'Test',
        timestamp: Date.now(),
      });

      // Both justSteered and 8th turn
      expect(state.shouldAnalyzeMidRun(8)).toBe(true);
    });

    it('returns false when not active', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      expect(state.shouldAnalyzeMidRun(8)).toBe(false);
    });
  });

  describe('intervention ASI persistence', () => {
    it('stores intervention with ASI', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.addIntervention({
        turnCount: 1,
        message: 'Focus on tests',
        reasoning: 'Drift detected',
        timestamp: Date.now(),
        asi: {
          why_stuck: 'refactoring without tests',
          strategy_used: 'directive',
          pattern_detected: 'test_skipping',
        },
      });

      const s = state.getState()!;
      expect(s.interventions).toHaveLength(1);
      expect(s.interventions[0].asi).toBeDefined();
      expect(s.interventions[0].asi!.why_stuck).toBe('refactoring without tests');
      expect(s.interventions[0].asi!.strategy_used).toBe('directive');
    });

    it('stores intervention without ASI (backward compat)', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.addIntervention({
        turnCount: 1,
        message: 'Focus',
        reasoning: 'Test',
        timestamp: Date.now(),
      });

      const s = state.getState()!;
      expect(s.interventions).toHaveLength(1);
      expect(s.interventions[0].asi).toBeUndefined();
    });

    it('persists ASI to session via appendEntry', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.addIntervention({
        turnCount: 1,
        message: 'Focus on tests',
        reasoning: 'Drift',
        timestamp: 1234567890,
        asi: {
          why_stuck: 'no tests',
          custom_field: 'custom_value',
        },
      });

      expect(api.appendEntry).toHaveBeenCalled();
      const lastCall = api.appendEntry.mock.calls[api.appendEntry.mock.calls.length - 1];
      const persistedData = lastCall[1];
      expect(persistedData.interventions).toHaveLength(1);
      expect(persistedData.interventions[0].asi).toBeDefined();
      expect(persistedData.interventions[0].asi.why_stuck).toBe('no tests');
      expect(persistedData.interventions[0].asi.custom_field).toBe('custom_value');
    });
  });

  describe('model management', () => {
    it('updates model when active', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      state.setModel('openai', 'gpt-4o');

      const s = state.getState()!;
      expect(s.provider).toBe('openai');
      expect(s.modelId).toBe('gpt-4o');
    });

    it('does not update model when not active', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      // Should not throw
      state.setModel('openai', 'gpt-4o');
      expect(state.getState()).toBeNull();
    });
  });

  describe('snapshot buffer', () => {
    it('updates and retrieves snapshot buffer', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there' },
      ];

      state.updateSnapshotBuffer(messages);

      expect(state.getSnapshotBuffer()).toEqual(messages);
      expect(state.getState()!.lastAnalyzedTurn).toBe(0);
    });

    it('returns empty array when not active', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);

      expect(state.getSnapshotBuffer()).toEqual([]);
    });
  });
});
