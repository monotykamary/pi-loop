import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { LoopFailsafeGuard } from '../src/core/failsafe.js';
import { LoopStateManager } from '../src/state/manager.js';

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

describe('LoopFailsafeGuard', () => {
  const originalEnv = process.env.PI_LOOP_MAX_STEERS;

  beforeEach(() => {
    delete process.env.PI_LOOP_MAX_STEERS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PI_LOOP_MAX_STEERS = originalEnv;
    } else {
      delete process.env.PI_LOOP_MAX_STEERS;
    }
  });

  describe('cycle and oscillation detection', () => {
    it('allows normal progress with distinct steering directives', () => {
      const guard = new LoopFailsafeGuard({ maxConsecutiveSteers: 6 });
      const check1 = guard.check('Fix syntax error at line 10');
      expect(check1.veto).toBe(false);
      guard.recordDispatched(check1.fingerprint!);

      const check2 = guard.check('Fix AssertionError on test_50_ticks');
      expect(check2.veto).toBe(false);
      guard.recordDispatched(check2.fingerprint!);

      // Verified and done -> reset
      guard.reset();
      expect(guard.getConsecutiveSteers()).toBe(0);
      expect(guard.getHistory()).toEqual([]);
    });

    it('vetoes immediate repeated directives (stagnation)', () => {
      const guard = new LoopFailsafeGuard({ cycleThreshold: 2 });
      const check1 = guard.check('Test failed: AssertionError: expected 42 but got 0');
      expect(check1.veto).toBe(false);
      guard.recordDispatched(check1.fingerprint!);

      // Immediate identical directive emitted on next turn
      const check2 = guard.check('Test failed: AssertionError: expected 42 but got 0');
      expect(check2.veto).toBe(true);
      expect(check2.reason).toBe('CYCLIC_OSCILLATION');
      expect(check2.period).toBe(1);
      expect(check2.message).toContain('Cyclic error oscillation detected');
    });

    it('vetoes alternating 2-step oscillation (A -> B -> A -> B)', () => {
      const guard = new LoopFailsafeGuard({ cycleThreshold: 2 });
      const a = 'Fix test_a assertion';
      const b = 'Fix test_b type error';

      // Turn 1: A
      const c1 = guard.check(a);
      expect(c1.veto).toBe(false);
      guard.recordDispatched(c1.fingerprint!);

      // Turn 2: B
      const c2 = guard.check(b);
      expect(c2.veto).toBe(false);
      guard.recordDispatched(c2.fingerprint!);

      // Turn 3: A (Allowed: first repetition of A, cycle not completed yet)
      const c3 = guard.check(a);
      expect(c3.veto).toBe(false);
      guard.recordDispatched(c3.fingerprint!);

      // Turn 4: B (Completed cycle A -> B -> A -> B -> VETO)
      const c4 = guard.check(b);
      expect(c4.veto).toBe(true);
      expect(c4.reason).toBe('CYCLIC_OSCILLATION');
      expect(c4.period).toBe(2);
    });

    it('normalizes formatting, ANSI escape codes, and unicode', () => {
      const m1 = '\u001b[31mError: fallita verifica su «modello»!\u001b[0m';
      const m2 = 'error fallita verifica su modello';
      const fp1 = LoopFailsafeGuard.computeFingerprint(m1);
      const fp2 = LoopFailsafeGuard.computeFingerprint(m2);
      expect(fp1).toBe(fp2);

      const sym1 = '⚠️ ❌';
      const sym2 = '🔥 🚀';
      const fps1 = LoopFailsafeGuard.computeFingerprint(sym1);
      const fps2 = LoopFailsafeGuard.computeFingerprint(sym2);
      expect(fps1).not.toBe(fps2);
    });
  });

  describe('iteration ceiling', () => {
    it('allows unbounded steering by default', () => {
      const guard = new LoopFailsafeGuard(); // default config, no env var
      // Can steer 15+ times without triggering iteration ceiling as long as directives vary
      for (let i = 0; i < 15; i++) {
        const res = guard.check(`Unique directive step ${i}`);
        expect(res.veto).toBe(false);
        guard.recordDispatched(res.fingerprint!);
      }
      expect(guard.getConsecutiveSteers()).toBe(15);
    });

    it('vetoes when consecutive steers reach configured ceiling', () => {
      const guard = new LoopFailsafeGuard({ maxConsecutiveSteers: 3 });
      const msgs = ['Directive A', 'Directive B', 'Directive C'];
      for (const msg of msgs) {
        const res = guard.check(msg);
        expect(res.veto).toBe(false);
        guard.recordDispatched(res.fingerprint!);
      }
      expect(guard.getConsecutiveSteers()).toBe(3);

      // Attempt 4 should be vetoed
      const check4 = guard.check('Directive D');
      expect(check4.veto).toBe(true);
      expect(check4.reason).toBe('MAX_ITERATION_CEILING');
      expect(check4.message).toContain('Maximum iteration ceiling reached');
    });

    it('respects PI_LOOP_MAX_STEERS environment variable', () => {
      process.env.PI_LOOP_MAX_STEERS = '4';
      const guard = new LoopFailsafeGuard();
      for (let i = 0; i < 4; i++) {
        const res = guard.check(`Directive ${i}`);
        expect(res.veto).toBe(false);
        guard.recordDispatched(res.fingerprint!);
      }
      const check5 = guard.check('Directive 5');
      expect(check5.veto).toBe(true);
      expect(check5.reason).toBe('MAX_ITERATION_CEILING');
    });
  });

  describe('LoopStateManager integration and persistence', () => {
    it('initializes failsafe state on start and clears on stop', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      const check = state.checkFailsafe('Directive A');
      expect(check.veto).toBe(false);
      state.recordSteer(check.fingerprint!);

      expect(state.getState()!.consecutiveSteers).toBe(1);
      expect(state.getState()!.fingerprintHistory).toEqual([check.fingerprint!]);

      state.stop();
      expect(state.getState()!.consecutiveSteers).toBe(0);
      expect(state.getState()!.fingerprintHistory).toEqual([]);
    });

    it('resets failsafe state on resetFailsafe (e.g. human user input)', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      const check = state.checkFailsafe('Directive 1');
      state.recordSteer(check.fingerprint!);
      expect(state.getState()!.consecutiveSteers).toBe(1);

      const persistCountBefore = api.appendEntry.mock.calls.length;
      state.resetFailsafe();
      expect(state.getState()!.consecutiveSteers).toBe(0);
      expect(state.getState()!.fingerprintHistory).toEqual([]);
      expect(api.appendEntry.mock.calls.length).toBe(persistCountBefore + 1);

      // Repeated reset without state change should not trigger extra persist
      state.resetFailsafe();
      expect(api.appendEntry.mock.calls.length).toBe(persistCountBefore + 1);
    });

    it('restores failsafe counters and history from session entry', () => {
      const api = createMockApi();
      const state = new LoopStateManager(api);
      state.start('Test goal', 'anthropic', 'claude-haiku');

      const fp1 = LoopFailsafeGuard.computeFingerprint('Directive 1');
      const fp2 = LoopFailsafeGuard.computeFingerprint('Directive 2');
      state.recordSteer(fp1);
      state.recordSteer(fp2);

      expect(api.appendEntry).toHaveBeenCalledWith(
        'loop-state',
        expect.objectContaining({
          consecutiveSteers: 2,
          fingerprintHistory: [fp1, fp2],
        })
      );

      // Simulate session load (compaction recovery)
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
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
                turnCount: 2,
                consecutiveSteers: 2,
                fingerprintHistory: [fp1, fp2],
              },
            },
          ],
        },
      } as any;

      const restoredState = new LoopStateManager(api);
      restoredState.loadFromSession(mockCtx);

      expect(restoredState.getState()!.consecutiveSteers).toBe(2);
      expect(restoredState.getState()!.fingerprintHistory).toEqual([fp1, fp2]);
    });
  });
});
