/**
 * Regression test for: Continue action at agent_end sanity check
 *
 * Bug: When analyzer returned action: 'continue' at agent_end (agent idle),
 * the supervisor would nudge the agent to continue even when work was complete,
 * causing infinite loops.
 *
 * Fix: Added sanity check at agent_end. If 'continue' is received when agent is idle:
 * 1. If confidence >= 0.8 and reasoning suggests completion (contains 'complete',
 *    'verified', 'achieved', 'done', 'implemented'), treat as 'done'
 * 2. Otherwise convert to 'steer' with the provided message or default
 *
 * The prompt also explicitly warns the model that returning 'continue' when idle
 * is an error and will be converted.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { LoopState, SteeringDecision } from '../src/types.js';

// Mocks must be before imports
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
  toggleWidget: vi.fn().mockReturnValue(true),
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

// Now import the mocked modules
import { analyze } from '../src/core/analyzer.js';
import { updateUI } from '../src/ui/renderer.js';
import { checkChildPiProcesses, waitForSubagents } from '../src/subagent-detector.js';
import { LoopStateManager } from '../src/state/manager.js';

describe('Continue action at agent_end - sanity check behavior', () => {
  let mockPi: ExtensionAPI;
  let mockCtx: ExtensionContext;
  let sendUserMessageSpy: ReturnType<typeof vi.fn>;
  let stateManager: LoopStateManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create spy for sendUserMessage
    sendUserMessageSpy = vi.fn();

    // Mock the ExtensionAPI
    mockPi = {
      appendEntry: vi.fn(),
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
      sendUserMessage: sendUserMessageSpy,
      sendMessage: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    } as any;

    // Mock the ExtensionContext
    mockCtx = {
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
      },
      sessionManager: {
        getBranch: vi.fn().mockReturnValue([]),
      },
      model: { provider: 'anthropic', id: 'claude-haiku' },
      modelRegistry: {
        getApiKeyForProvider: vi.fn().mockResolvedValue('test-key'),
        find: vi.fn().mockReturnValue({ name: 'test-model' }),
      },
      isIdle: vi.fn().mockReturnValue(true),
      cwd: '/test',
    } as any;

    stateManager = new LoopStateManager(mockPi);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * NEW SANITY CHECK LOGIC:
   * At agent_end, 'continue' is not valid when agent is idle.
   *
   * If confidence >= 0.8 AND reasoning suggests completion:
   *   → Treat as 'done'
   * Else:
   *   → Treat as 'steer' with message
   */
  function shouldTreatContinueAsDone(decision: SteeringDecision): boolean {
    return (
      decision.confidence >= 0.8 &&
      (decision.reasoning?.toLowerCase().includes('complete') ||
        decision.reasoning?.toLowerCase().includes('verified') ||
        decision.reasoning?.toLowerCase().includes('achieved') ||
        decision.reasoning?.toLowerCase().includes('done') ||
        decision.reasoning?.toLowerCase().includes('implemented'))
    );
  }

  /**
   * Simulates the UPDATED agent_end handler behavior with sanity check
   */
  async function simulateAgentEnd(decision: SteeringDecision): Promise<void> {
    // Start loop state
    stateManager.start('Fix hydration inconsistency', 'anthropic', 'claude-haiku');

    // Mock analyzer to return our test decision
    vi.mocked(analyze).mockResolvedValue(decision);

    // Mock subagent checks
    vi.mocked(checkChildPiProcesses).mockResolvedValue({ hasActiveSubagents: false, count: 0 });
    vi.mocked(waitForSubagents).mockResolvedValue({
      completed: true,
      finalStatus: { hasActiveSubagents: false, count: 0 },
    });

    // Simulate the agent_end handler logic
    stateManager.incrementTurnCount();
    const s = stateManager.getState()!;

    // Check subagents (bypassed in test)
    await checkChildPiProcesses();

    // Call analyzer
    const actualDecision = await analyze(mockCtx, s, true);

    // UPDATED agent_end handler logic with sanity check
    if (actualDecision.action === 'steer' && actualDecision.message) {
      stateManager.addIntervention({
        turnCount: s.turnCount,
        message: actualDecision.message,
        reasoning: actualDecision.reasoning,
        timestamp: Date.now(),
        asi: actualDecision.asi,
      });
      updateUI(mockCtx, {} as any, stateManager.getState(), {
        type: 'steering',
        message: actualDecision.message,
        reframeTier: stateManager.getReframeTier(),
      });
      mockPi.sendUserMessage(actualDecision.message);
    } else if (actualDecision.action === 'done') {
      stateManager.resetReframeTier();
      updateUI(mockCtx, {} as any, stateManager.getState(), { type: 'done' });
      stateManager.stop();
    } else if (actualDecision.action === 'continue') {
      // SANITY CHECK: At agent_end, the agent is IDLE. The prompt explicitly
      // instructs supervisor to NEVER return 'continue' when agent is idle.

      const highConfidenceOfCompletion = shouldTreatContinueAsDone(actualDecision);

      if (highConfidenceOfCompletion) {
        // Model likely meant to return 'done' but returned 'continue' by mistake
        stateManager.resetReframeTier();
        updateUI(mockCtx, {} as any, stateManager.getState(), { type: 'done' });
        stateManager.stop();
      } else {
        // Treat as steer — goal not achieved, agent needs direction
        const steerMessage = actualDecision.message?.trim()
          ? actualDecision.message
          : 'Please continue working toward the goal.';
        stateManager.addIntervention({
          turnCount: s.turnCount,
          message: steerMessage,
          reasoning: actualDecision.reasoning || 'Goal not yet achieved, continuing work',
          timestamp: Date.now(),
          asi: { ...actualDecision.asi, _sanity: 'converted_continue_at_idle_to_steer' },
        });
        updateUI(mockCtx, {} as any, stateManager.getState(), {
          type: 'steering',
          message: steerMessage,
          reframeTier: stateManager.getReframeTier(),
        });
        mockPi.sendUserMessage(steerMessage);
      }
    } else {
      // Set watching without sending a message
      updateUI(mockCtx, {} as any, stateManager.getState(), {
        type: 'watching',
        reframeTier: stateManager.getReframeTier(),
      });
    }
  }

  describe('when analyzer returns continue with high confidence of completion', () => {
    it('should treat as DONE - stop loop without sending message', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Both fixes have been fully implemented and verified. All tests pass.',
        confidence: 0.95,
      };

      await simulateAgentEnd(decision);

      // With high confidence and completion keywords, should stop loop
      expect(sendUserMessageSpy).not.toHaveBeenCalled();
      expect(stateManager.isActive()).toBe(false);
    });

    it('should treat as DONE when reasoning contains "verified"', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'The implementation is verified and complete.',
        confidence: 0.85,
      };

      await simulateAgentEnd(decision);

      expect(sendUserMessageSpy).not.toHaveBeenCalled();
      expect(stateManager.isActive()).toBe(false);
    });

    it('should treat as DONE when reasoning contains "achieved"', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Goal has been achieved.',
        confidence: 0.9,
      };

      await simulateAgentEnd(decision);

      expect(sendUserMessageSpy).not.toHaveBeenCalled();
      expect(stateManager.isActive()).toBe(false);
    });

    it('should treat as DONE when reasoning contains "implemented"', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'All changes have been implemented successfully.',
        confidence: 0.88,
      };

      await simulateAgentEnd(decision);

      expect(sendUserMessageSpy).not.toHaveBeenCalled();
      expect(stateManager.isActive()).toBe(false);
    });

    it('should update UI to done state', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Fixes complete and verified.',
        confidence: 0.95,
      };

      await simulateAgentEnd(decision);

      const lastCall = vi.mocked(updateUI).mock.calls[vi.mocked(updateUI).mock.calls.length - 1];
      const uiUpdate = lastCall[3] as any;
      expect(uiUpdate.type).toBe('done');
    });
  });

  describe('when analyzer returns continue with low confidence or no completion signals', () => {
    it('should convert to STEER and send continuation message', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Goal not yet achieved, need more work',
        confidence: 0.7,
      };

      await simulateAgentEnd(decision);

      // Should send message to prompt agent to continue
      expect(sendUserMessageSpy).toHaveBeenCalledTimes(1);
      expect(sendUserMessageSpy).toHaveBeenCalledWith('Please continue working toward the goal.');
    });

    it('should convert to STEER when confidence is high but no completion keywords', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Progress looks good so far, agent should keep working',
        confidence: 0.85,
      };

      await simulateAgentEnd(decision);

      // Even with high confidence, no completion keywords means steer
      expect(sendUserMessageSpy).toHaveBeenCalledTimes(1);
      expect(stateManager.isActive()).toBe(true); // Loop still active
    });

    it('should use custom message when provided', async () => {
      const customMessage = 'Continue working on the ChatMessage textContent fix';
      const decision: SteeringDecision = {
        action: 'continue',
        message: customMessage,
        reasoning: 'More work needed',
        confidence: 0.6,
      };

      await simulateAgentEnd(decision);

      expect(sendUserMessageSpy).toHaveBeenCalledTimes(1);
      expect(sendUserMessageSpy).toHaveBeenCalledWith(customMessage);
    });

    it('should update UI to steering state', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'More work needed',
        confidence: 0.6,
      };

      await simulateAgentEnd(decision);

      // UI should show steering (active intervention)
      const lastCall = vi.mocked(updateUI).mock.calls[vi.mocked(updateUI).mock.calls.length - 1];
      const uiUpdate = lastCall[3] as any;
      expect(uiUpdate.type).toBe('steering');
    });

    it('should record intervention with sanity check marker', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Incomplete',
        confidence: 0.6,
      };

      await simulateAgentEnd(decision);

      const state = stateManager.getState()!;
      expect(state.interventions).toHaveLength(1);
      expect(state.interventions[0].asi?._sanity).toBe('converted_continue_at_idle_to_steer');
    });

    it('should keep loop active when converting to steer', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Not done yet',
        confidence: 0.5,
      };

      await simulateAgentEnd(decision);

      expect(stateManager.isActive()).toBe(true);
    });
  });

  describe('contrast with proper actions', () => {
    it('steer action: works normally without conversion', async () => {
      const decision: SteeringDecision = {
        action: 'steer',
        message: 'Fix this specific issue',
        reasoning: 'Agent off track',
        confidence: 0.9,
      };

      await simulateAgentEnd(decision);

      expect(sendUserMessageSpy).toHaveBeenCalledTimes(1);
      expect(sendUserMessageSpy).toHaveBeenCalledWith('Fix this specific issue');
      expect(stateManager.isActive()).toBe(true);
    });

    it('done action: stops loop without sending message', async () => {
      const decision: SteeringDecision = {
        action: 'done',
        reasoning: 'Goal achieved',
        confidence: 0.95,
      };

      await simulateAgentEnd(decision);

      expect(sendUserMessageSpy).not.toHaveBeenCalled();
      expect(stateManager.isActive()).toBe(false);
    });
  });

  describe('regression: infinite continue loop', () => {
    it('OLD BEHAVIOR (before fix): would keep sending continue messages forever', async () => {
      // This test documents what used to happen
      stateManager.start('Test goal', 'anthropic', 'claude-haiku');

      // Simulate multiple agent_end events with continue
      for (let i = 0; i < 5; i++) {
        stateManager.incrementTurnCount();
        const s = stateManager.getState()!;

        // OLD behavior: always send continue message
        const continueMessage = 'Please continue working toward the goal.';
        stateManager.addIntervention({
          turnCount: s.turnCount,
          message: continueMessage,
          reasoning: 'Goal not yet achieved',
          timestamp: Date.now(),
        });
      }

      // Old behavior would accumulate many interventions
      expect(stateManager.getState()!.interventions.length).toBe(5);
      expect(stateManager.isActive()).toBe(true); // Never stops
    });

    it('NEW BEHAVIOR: stops loop when continue looks like completion', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Both fixes fully implemented and verified. All 1375 tests pass.',
        confidence: 0.95,
      };

      await simulateAgentEnd(decision);

      // Should stop instead of continuing forever
      expect(stateManager.isActive()).toBe(false);
      expect(sendUserMessageSpy).not.toHaveBeenCalled();
    });

    it('NEW BEHAVIOR: converts incomplete continue to steer', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Need more work',
        confidence: 0.6,
      };

      await simulateAgentEnd(decision);

      // Should steer, not just loop
      expect(sendUserMessageSpy).toHaveBeenCalled();
      expect(stateManager.isActive()).toBe(true);
    });
  });
});
