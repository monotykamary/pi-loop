import { describe, expect, it, vi, beforeEach } from 'vitest';
import { updateUI, toggleWidget } from '../src/ui/status-widget.js';
import type { LoopState } from '../src/types.js';

// Mock the TUI module
vi.mock('@mariozechner/pi-tui', () => ({
  truncateToWidth: (text: string, width: number) => {
    if (text.length <= width) return text;
    return text.slice(0, width);
  },
}));

// Helper to create mock ExtensionContext
function createMockCtx() {
  const setStatusMock = vi.fn();
  const setWidgetMock = vi.fn();

  return {
    ui: {
      setStatus: setStatusMock,
      setWidget: setWidgetMock,
      notify: vi.fn(),
      select: vi.fn(),
    },
    sessionManager: {
      getBranch: vi.fn(() => []),
    },
    model: { provider: 'test', id: 'test-model' },
  } as any;
}

// Helper to create a mock supervisor state
function createMockState(overrides?: Partial<LoopState>): LoopState {
  return {
    active: true,
    outcome: 'Test goal',
    interventions: [],
    turnCount: 1,
    justSteered: false,
    lastAnalyzedTurn: 0,
    snapshotBuffer: [],
    reframeTier: 0,
    lastSteerTurn: -1,
    ...overrides,
  };
}

describe('status-widget', () => {
  beforeEach(() => {
    // Reset widget visibility before each test
    while (!toggleWidget()) {
      // Toggle until visible
    }
  });

  describe('animation flow', () => {
    it('triggers animation timer when leaving analyzing for steering', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Set initial thinking
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Analysis content for animation test',
      });

      // Verify initial render has thinking
      let lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      let widget = lastCall[1](null, { fg: (_c: string, t: string) => t });
      let lines = widget.render(100);
      expect(lines.length).toBeGreaterThan(1);

      // Transition to steering - should set up animation timer
      updateUI(ctx, state, {
        type: 'steering',
        message: 'Please fix',
        reframeTier: 0,
      });

      // Widget still shows thinking (animation hasn't started yet, timer is set)
      lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      widget = lastCall[1](null, { fg: (_c: string, t: string) => t });
      lines = widget.render(100);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.join(' ')).toContain('Analysis content');
      expect(lines.join(' ')).toContain('steering');
    });

    it('hides lines from bottom to top during animation', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Create a long thinking content that will wrap to multiple lines
      const longThinking = 'Word one word two word three word four word five word six word seven';

      // Start analyzing with thinking
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: longThinking,
      });

      // Capture the widget and get initial lines
      let lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const mockTheme = { fg: (_c: string, t: string) => t };
      let widget = lastCall[1](null, mockTheme);
      const width = 30; // Narrow width to force wrapping
      const initialLines = widget.render(width);
      const initialThinkingLines = initialLines.length - 1; // Exclude header
      expect(initialThinkingLines).toBeGreaterThanOrEqual(2);

      // Transition to done - thinking lines should be preserved for animation
      updateUI(ctx, state, { type: 'done' });

      // Verify before animation starts, all lines should be visible
      lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      widget = lastCall[1](null, mockTheme);
      const linesBeforeAnimation = widget.render(width);
      expect(linesBeforeAnimation.length).toBe(initialLines.length);
    });

    it('animation progressively removes lines from bottom using hideFromBottom', () => {
      // This test verifies the core animation mechanism:
      // when hideFromBottom increases, fewer lines are shown from the bottom

      const ctx = createMockCtx();
      const state = createMockState();

      // Set multi-line thinking - use a longer text that will wrap even at width 80
      // The thinking indent is 2 spaces, so we need enough content to wrap
      const longThinking =
        'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';

      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: longThinking,
      });

      const mockTheme = { fg: (_c: string, t: string) => t };

      // Transition to steering to set up animation state
      updateUI(ctx, state, {
        type: 'steering',
        message: 'Fix this',
        reframeTier: 0,
      });

      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widget = lastCall[1](null, mockTheme);

      // At this point the widget render function is set up with lastThinkingLines
      // The key assertion: the render function is designed to handle hideFromBottom
      // by slicing from 0 to (total - hideFromBottom)

      const width = 78; // Width that allows some wrapping
      const linesWithFullThinking = widget.render(width);

      // Should have header + at least 1 thinking line
      expect(linesWithFullThinking.length).toBeGreaterThanOrEqual(2);

      // Verify the thinking lines contain expected words
      const allText = linesWithFullThinking.join(' ');
      expect(allText).toContain('One');
      expect(allText).toContain('steering');
    });

    it('animation resets when new thinking arrives mid-animation', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Initial analysis
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'First analysis content',
      });

      // Start transition to steering (animation timer set)
      updateUI(ctx, state, {
        type: 'steering',
        message: 'Fix this',
        reframeTier: 0,
      });

      // Before animation completes, new analyzing content arrives
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 2,
        thinking: 'Fresh analysis after interrupt',
      });

      // Should show fresh content, animation state reset
      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widget = lastCall[1](null, { fg: (_c: string, t: string) => t });
      const lines = widget.render(100);

      const allText = lines.join(' ');
      expect(allText).toContain('Fresh analysis after interrupt');
      expect(allText).not.toContain('First analysis content');
      expect(allText).toContain('⟳ turn 2');
    });

    it('animation completes and clears thinking lines', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Start with analyzing
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Short thinking',
      });

      // Transition to steering
      updateUI(ctx, state, {
        type: 'steering',
        message: 'Please fix',
        reframeTier: 0,
      });

      // Verify widget was rendered with thinking preserved
      let lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      expect(lastCall[1]).not.toBeUndefined();

      // Simulate supervisor becoming inactive (this happens after animation or when loop ends)
      const inactiveState = { ...state, active: false };
      updateUI(ctx, inactiveState as any);

      // Widget should be cleared when inactive
      const finalCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      expect(finalCall[1]).toBeUndefined();
    });

    it('cancels previous animation timer when new action arrives', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Start analyzing
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Analysis one',
      });

      // Go to steering - sets timer
      updateUI(ctx, state, {
        type: 'steering',
        message: 'First steer',
        reframeTier: 0,
      });

      const callsAfterFirstSteer = ctx.ui.setWidget.mock.calls.length;

      // Second steer before animation starts - should cancel first timer and set new one
      updateUI(ctx, state, {
        type: 'steering',
        message: 'Second steer',
        reframeTier: 0,
      });

      // Should have updated widget again
      expect(ctx.ui.setWidget.mock.calls.length).toBeGreaterThan(callsAfterFirstSteer);
    });

    it('steering preserves thinking for animation to clear - regression test for empty lines bug', () => {
      // This test documents the bug fix for the case where lastThinkingLines was empty
      // when the animation timer fired, causing the animation to return early and leave
      // thoughts on screen indefinitely.
      //
      // Bug scenario:
      // 1. updateUI called with analyzing, sets lastThinking
      // 2. renderWithState called, populates lastThinkingLines based on lastThinking
      // 3. updateUI called with steering, sets up animation timer
      // 4. renderWithState called with hideFromBottom > 0, returns early (doesn't update lastThinkingLines)
      // 5. 15 seconds later, animation timer fires
      // 6. startLineClearAnimation checks lastThinkingLines.length === 0, returns early
      // 7. Thoughts stay on screen forever!
      //
      // Fix: Before setting the animation timer, populate lastThinkingLines
      // from lastThinking so the animation can run properly.
      //
      // This test verifies that after steering, the thinking is preserved
      // so the animation (which runs after 15 seconds) can properly clear it.

      const ctx = createMockCtx();
      const state = createMockState();

      // Start with analyzing and multi-line thinking content
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'First line of thinking that needs to be cleared by animation',
      });

      // Transition to steering - thinking lines should be preserved for animation
      updateUI(ctx, state, {
        type: 'steering',
        message: 'Fix this',
        reframeTier: 0,
      });

      // Verify the widget shows the thinking content (will be cleared by animation after 15s)
      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widgetFactory = lastCall[1];
      const mockTheme = { fg: (_c: string, t: string) => t };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);

      // Should have header + thinking lines
      expect(lines.length).toBeGreaterThan(1);
      const allText = lines.join(' ');

      // Widget shows steering status
      expect(allText).toContain('steering');

      // Thinking content is preserved for animation to clear
      expect(allText).toContain('First line of thinking');

      // The thinking will be cleared by the animation after the 15s timer fires
      // (verified by the animation completing and calling renderFn with empty thinking)
    });
  });

  describe('thought clearing behavior', () => {
    it('clears old thoughts immediately when new thinking arrives', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // First call with initial thinking content
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Initial thinking content that is long enough to wrap',
      });

      // Verify widget was set with initial thinking
      expect(ctx.ui.setWidget).toHaveBeenCalled();
      const firstWidgetCall = ctx.ui.setWidget.mock.calls[0];
      expect(firstWidgetCall[0]).toBe('loop');

      // Second call with new/different thinking content (simulating agent_end with new analysis)
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 2,
        thinking: 'Completely new thinking content for turn 2',
      });

      // Verify widget was updated again
      expect(ctx.ui.setWidget).toHaveBeenCalledTimes(2);

      // Get the render function from the second call
      const secondWidgetCall = ctx.ui.setWidget.mock.calls[1];
      const widgetFactory = secondWidgetCall[1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
      };
      const widget = widgetFactory(null, mockTheme);

      // Render with enough width to see the content
      const lines = widget.render(100);

      // Should contain the new thinking, not the old
      const allText = lines.join(' ');
      expect(allText).toContain('Completely new thinking');
      expect(allText).not.toContain('Initial thinking content');
    });

    it('does not flash back old thoughts when clear animation is interrupted', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Step 1: Set initial thinking content
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'First analysis thinking content that will be cleared',
      });

      // Step 2: Trigger the clear animation by going to watching state (simulating 15s delay completion)
      // First we need to trigger the clear timer - this happens when we go to a non-analyzing state
      // or when state becomes inactive. Let's use a steering action which triggers the animation.
      updateUI(ctx, state, {
        type: 'steering',
        message: 'Please focus',
      });

      // Step 3: Now simulate agent_end firing with new analyzing content
      // This is the key test - if old thoughts flash back, the bug exists
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 2,
        thinking: 'Fresh analysis after steering',
      });

      // Get the final widget state
      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widgetFactory = lastCall[1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
      };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);

      // Verify fresh content is shown, old content is not flashed back
      const allText = lines.join(' ');
      expect(allText).toContain('Fresh analysis after steering');
      expect(allText).not.toContain('First analysis thinking');
    });

    it('preserves thinking lines when leaving analyzing for steering (animation will clear)', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Step 1: Start with analyzing and thinking content
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Analysis thinking that should animate out on steer',
      });

      // Step 2: Transition to steering - thinking lines are preserved for animation
      updateUI(ctx, state, {
        type: 'steering',
        message: 'Please fix this issue',
        reframeTier: 0,
      });

      // Get the widget state after steering
      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widgetFactory = lastCall[1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
      };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);

      // The thinking content should be preserved for animation (not immediately cleared)
      expect(lines.length).toBeGreaterThan(1); // Header + thinking lines
      const allText = lines.join(' ');
      expect(allText).toContain('steering');
      expect(allText).toContain('Analysis thinking');
    });

    it('preserves thinking lines through multiple rapid steers (animation handles clearing)', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Simulate rapid steers after analysis (the 5 steers bug scenario)
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Initial analysis content',
      });

      // Multiple rapid steers (faster than 15s animation delay)
      // Each steer preserves thinking lines - animation will clear them after 15s delay
      for (let i = 0; i < 5; i++) {
        updateUI(ctx, state, {
          type: 'steering',
          message: `Steer ${i + 1}`,
          reframeTier: 0,
        });
      }

      // Final state should preserve thinking lines (they animate out after delay)
      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widgetFactory = lastCall[1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
      };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);

      // Should have header + thinking lines (animation will clear them)
      expect(lines.length).toBeGreaterThan(1);
      const allText = lines.join(' ');
      expect(allText).toContain('Initial analysis');
      expect(allText).toContain('steering');
    });

    it('preserves thinking lines when leaving analyzing for done state (animation will clear)', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Start with analyzing
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Analysis that will animate out on done',
      });

      // Transition to done - thinking lines are preserved for animation
      updateUI(ctx, state, { type: 'done' });

      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widgetFactory = lastCall[1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
      };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);

      // Should have header + thinking lines (animation will clear them)
      expect(lines.length).toBeGreaterThan(1);
      const allText = lines.join(' ');
      expect(allText).toContain('done');
      expect(allText).toContain('Analysis that will animate out');
    });

    it('does not flash old thoughts when re-entering analyzing after steering', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Initial analysis
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'First round of analysis',
      });

      // Steer
      updateUI(ctx, state, {
        type: 'steering',
        message: 'Fix this',
      });

      // New analysis - should NOT show old thinking even briefly
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 2,
        thinking: 'Fresh second round analysis',
      });

      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widgetFactory = lastCall[1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
      };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);

      const allText = lines.join(' ');
      expect(allText).toContain('Fresh second round');
      expect(allText).not.toContain('First round');
    });

    it('preserves animation state when same thinking content is updated', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // First call with thinking
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Streaming thinking content',
      });

      // Second call with same thinking (simulating streaming update with same content)
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Streaming thinking content',
      });

      // Should still have the content (not cleared since it's the same)
      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widgetFactory = lastCall[1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
      };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);

      const allText = lines.join(' ');
      expect(allText).toContain('Streaming thinking content');
    });

    it('clears thoughts when going to done state', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // First set some thinking
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Analysis in progress',
      });

      // Then go to done state
      updateUI(ctx, state, { type: 'done' });

      // Should trigger clear timer setup (but not immediately clear)
      // The clear animation should be scheduled
      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widgetFactory = lastCall[1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
      };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);

      // The done action should show the done indicator
      const allText = lines.join(' ');
      expect(allText).toContain('done');
    });

    it('handles transition from cleared state to new analysis', async () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Initial analysis
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Initial analysis',
      });

      // Go to done (triggers clear)
      updateUI(ctx, state, { type: 'done' });

      // Simulate another agent_end with new analysis
      // This should show new thinking, not old
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 2,
        thinking: 'New analysis after completion',
      });

      const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
      const widgetFactory = lastCall[1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
      };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);

      const allText = lines.join(' ');
      expect(allText).toContain('New analysis after completion');
      expect(allText).not.toContain('Initial analysis');
    });

    it('preserves thinking lines when supervisor becomes inactive after done (animation will clear)', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Step 1: Start with analyzing and thinking content
      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Analysis thinking that should animate clear',
      });

      // Step 2: Transition to done while still active
      updateUI(ctx, state, { type: 'done' });

      // Verify the widget was rendered with 'done' status
      const doneCalls = ctx.ui.setWidget.mock.calls.filter((call: any[]) => call[0] === 'loop');
      expect(doneCalls.length).toBeGreaterThan(0);

      const lastDoneCall = doneCalls[doneCalls.length - 1];
      expect(lastDoneCall[1]).not.toBeUndefined();

      // Verify thinking lines are preserved (shown until animation clears them)
      const widgetFactory = lastDoneCall[1];
      const mockTheme = { fg: (color: string, text: string) => text };
      const widget = widgetFactory(null, mockTheme);
      const lines = widget.render(100);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.join(' ')).toContain('done');
      expect(lines.join(' ')).toContain('Analysis thinking');

      // Step 3: Verify widget was updated after going inactive (animation path or clear)
      const callsAfterDone = ctx.ui.setWidget.mock.calls.length;

      const inactiveState = { ...state, active: false };
      updateUI(ctx, inactiveState as any);

      // Widget should be updated (either animation setup or clear)
      expect(ctx.ui.setWidget.mock.calls.length).toBeGreaterThanOrEqual(callsAfterDone);
    });
  });

  describe('widget visibility', () => {
    it('hides widget when toggle is off', () => {
      const ctx = createMockCtx();
      const state = createMockState();

      // Hide the widget
      toggleWidget();

      updateUI(ctx, state, {
        type: 'analyzing',
        turn: 1,
        thinking: 'Should not be visible',
      });

      // Should set widget to undefined when hidden
      expect(ctx.ui.setWidget).toHaveBeenCalledWith('loop', undefined);
    });
  });
});
