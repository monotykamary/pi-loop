/**
 * Animation utilities for the supervisor widget.
 */

import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { WidgetState, WidgetAction } from './types.js';
import type { LoopIntervention } from '../types.js';
import { WIDGET_ID, ANIMATION_STEP_MS } from './types.js';

/** Type for the render function callback */
export type RenderFn = (
  ctx: ExtensionContext,
  snap: { outcome: string; interventions: LoopIntervention[] },
  action: WidgetAction,
  lastThinking: string,
  hideFromBottom: number
) => void;

/** Start the line-by-line clear animation - hides lines from bottom to top */
export function startLineClearAnimation(
  ctx: ExtensionContext,
  state: WidgetState,
  renderFn: RenderFn
): void {
  if (!state.lastActiveState || state.lastThinkingLines.length === 0) return;

  const isSteering = state.lastActionType === 'steering';
  const targetVisibleCount = 0;

  const animateStep = () => {
    const currentVisible = state.lastThinkingLines.length - state.hiddenFromBottomCount;

    if (currentVisible <= targetVisibleCount) {
      if (isSteering) {
        state.lastThinkingLines = [];
        state.hiddenFromBottomCount = 0;
        const reframeTier =
          state.storedAction?.type === 'steering' ? (state.storedAction.reframeTier ?? 0) : 0;
        renderFn(
          ctx,
          state.lastActiveState!,
          { type: 'steering', message: '', reframeTier },
          '',
          0
        );
        return;
      } else {
        state.lastActiveState = null;
        state.lastThinking = '';
        state.lastThinkingLines = [];
        state.hiddenFromBottomCount = 0;
        state.storedAction = null;
        ctx.ui.setWidget(WIDGET_ID, undefined);
        return;
      }
    }

    state.hiddenFromBottomCount++;
    const reframeTier =
      state.storedAction?.type === 'steering' ? (state.storedAction.reframeTier ?? 0) : 0;
    const fallbackAction: WidgetAction = isSteering
      ? { type: 'steering', message: '', reframeTier }
      : { type: 'done', reframeTier: 0 };
    renderFn(ctx, state.lastActiveState!, fallbackAction, '', state.hiddenFromBottomCount);

    state.animationTimer = setTimeout(animateStep, ANIMATION_STEP_MS);
  };

  animateStep();
}
