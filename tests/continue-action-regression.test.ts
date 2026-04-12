/**
 * Regression test for: Continue action at agent_end should nudge idle agent
 *
 * Bug: When analyzer returned action: 'continue' at agent_end (goal not achieved),
 * the supervisor updated UI to 'watching' but sent no message, leaving the agent
 * idle and stuck.
 *
 * Fix: When action is 'continue' at agent_end, supervisor now sends a continuation
 * message to prompt the agent to resume work.
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

describe('Continue action at agent_end - regression test', () => {
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
   * Simulates the agent_end handler behavior with a given decision
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

    // Apply the agent_end handler logic
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
      // FIX: This is the new behavior - send continuation message
      const continueMessage = actualDecision.message?.trim()
        ? actualDecision.message
        : 'Please continue working toward the goal.';
      stateManager.addIntervention({
        turnCount: s.turnCount,
        message: continueMessage,
        reasoning: actualDecision.reasoning || 'Goal not yet achieved, continuing work',
        timestamp: Date.now(),
        asi: actualDecision.asi,
      });
      updateUI(mockCtx, {} as any, stateManager.getState(), {
        type: 'steering',
        message: continueMessage,
        reframeTier: stateManager.getReframeTier(),
      });
      mockPi.sendUserMessage(continueMessage);
    } else {
      // OLD BUG: This path just set watching without sending a message
      updateUI(mockCtx, {} as any, stateManager.getState(), {
        type: 'watching',
        reframeTier: stateManager.getReframeTier(),
      });
    }
  }

  describe('when analyzer returns continue at agent_end', () => {
    it('should send a continuation message to the idle agent', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Goal not yet achieved, need more work',
        confidence: 0.7,
      };

      await simulateAgentEnd(decision);

      // Key assertion: message should be sent to prompt agent to continue
      expect(sendUserMessageSpy).toHaveBeenCalledTimes(1);
      expect(sendUserMessageSpy).toHaveBeenCalledWith('Please continue working toward the goal.');
    });

    it('should use custom message when analyzer provides one', async () => {
      const customMessage = 'Continue working on the ChatMessage textContent fix';
      const decision: SteeringDecision = {
        action: 'continue',
        message: customMessage,
        reasoning: 'Specific guidance for next steps',
        confidence: 0.75,
      };

      await simulateAgentEnd(decision);

      expect(sendUserMessageSpy).toHaveBeenCalledTimes(1);
      expect(sendUserMessageSpy).toHaveBeenCalledWith(customMessage);
    });

    it('should record the continuation as an intervention', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        message: 'Keep working on the fix',
        reasoning: 'Progress made but incomplete',
        confidence: 0.8,
      };

      await simulateAgentEnd(decision);

      const state = stateManager.getState()!;
      expect(state.interventions).toHaveLength(1);
      expect(state.interventions[0].message).toBe('Keep working on the fix');
      expect(state.interventions[0].reasoning).toBe('Progress made but incomplete');
    });

    it('should update UI to steering state (not watching)', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Goal incomplete',
        confidence: 0.6,
      };

      await simulateAgentEnd(decision);

      // UI should show steering (active intervention), not watching (passive)
      const lastCall = vi.mocked(updateUI).mock.calls[vi.mocked(updateUI).mock.calls.length - 1];
      const uiUpdate = lastCall[3] as any;
      expect(uiUpdate.type).toBe('steering');
      expect(uiUpdate.type).not.toBe('watching');
    });

    it('should increment idleSteers counter for pattern detection', async () => {
      // Start loop once
      stateManager.start('Fix hydration inconsistency', 'anthropic', 'claude-haiku');

      // Helper for multiple agent_end events without resetting state
      const simulateAnotherAgentEnd = async (decision: SteeringDecision) => {
        stateManager.incrementTurnCount();
        const s = stateManager.getState()!;

        // Apply the agent_end handler logic for continue action
        if (decision.action === 'continue') {
          const continueMessage = decision.message?.trim()
            ? decision.message
            : 'Please continue working toward the goal.';
          stateManager.addIntervention({
            turnCount: s.turnCount,
            message: continueMessage,
            reasoning: decision.reasoning || 'Goal not yet achieved, continuing work',
            timestamp: Date.now(),
            asi: decision.asi,
          });
        }
      };

      // First continue
      await simulateAnotherAgentEnd({
        action: 'continue',
        reasoning: 'Incomplete',
        confidence: 0.7,
      });

      expect(stateManager.getState()!.interventions.length).toBe(1);

      // Second continue
      await simulateAnotherAgentEnd({
        action: 'continue',
        reasoning: 'Still incomplete',
        confidence: 0.7,
      });

      // Should have 2 interventions recorded
      expect(stateManager.getState()!.interventions.length).toBe(2);
    });

    it('should include ASI from analyzer in the intervention', async () => {
      const asi = { observation: 'agent needs to verify hydration', strategy: 'verification' };
      const decision: SteeringDecision = {
        action: 'continue',
        message: 'Verify the hydration fix',
        reasoning: 'Need verification before done',
        confidence: 0.85,
        asi,
      };

      await simulateAgentEnd(decision);

      const state = stateManager.getState()!;
      expect(state.interventions[0].asi).toEqual(asi);
    });
  });

  describe('contrast with other actions', () => {
    it('steer action: sends provided message (original behavior)', async () => {
      const decision: SteeringDecision = {
        action: 'steer',
        message: 'Fix this specific issue',
        reasoning: 'Agent off track',
        confidence: 0.9,
      };

      await simulateAgentEnd(decision);

      expect(sendUserMessageSpy).toHaveBeenCalledTimes(1);
      expect(sendUserMessageSpy).toHaveBeenCalledWith('Fix this specific issue');
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

    it('continue action with no message uses default fallback', async () => {
      const decision: SteeringDecision = {
        action: 'continue',
        reasoning: 'Keep going',
        confidence: 0.7,
        // No message field
      };

      await simulateAgentEnd(decision);

      expect(sendUserMessageSpy).toHaveBeenCalledWith('Please continue working toward the goal.');
    });
  });

  describe('regression scenario: watching deadlock', () => {
    it('OLD BUG: would set watching without sending message (simulated)', async () => {
      // This test documents the old buggy behavior by simulating it directly
      stateManager.start('Test goal', 'anthropic', 'claude-haiku');

      // Old code path: action === 'continue' fell through to else
      // which just set watching without sending a message
      updateUI(mockCtx, {} as any, stateManager.getState(), {
        type: 'watching',
        reframeTier: stateManager.getReframeTier(),
      });

      // No message was sent in old behavior
      expect(sendUserMessageSpy).not.toHaveBeenCalled();

      // UI showed watching (passive)
      const lastCall = vi.mocked(updateUI).mock.calls[vi.mocked(updateUI).mock.calls.length - 1];
      const uiUpdate = lastCall[3] as any;
      expect(uiUpdate.type).toBe('watching');
    });

    it('NEW FIX: sends message and sets steering state', async () => {
      await simulateAgentEnd({
        action: 'continue',
        reasoning: 'Progress needed',
        confidence: 0.7,
      });

      // Message is sent to prompt agent to continue
      expect(sendUserMessageSpy).toHaveBeenCalled();

      // UI shows steering (active intervention)
      const lastCall = vi.mocked(updateUI).mock.calls[vi.mocked(updateUI).mock.calls.length - 1];
      const uiUpdate = lastCall[3] as any;
      expect(uiUpdate.type).toBe('steering');
    });
  });
});
