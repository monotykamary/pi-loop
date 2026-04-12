/**
 * Widget renderer - handles the visual rendering of the supervisor status widget.
 */

import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { truncateToWidth } from '@mariozechner/pi-tui';
import type { LoopIntervention, LoopState } from '../types.js';
import type { WidgetAction, WidgetState } from './types.js';
import { WIDGET_ID, CLEAR_DELAY_MS } from './types.js';
import { startLineClearAnimation, type RenderFn } from './animations.js';

/** Toggle the widget on/off. Returns the new visibility state. */
export function toggleWidget(state: WidgetState): boolean {
  state.widgetVisible = !state.widgetVisible;
  return state.widgetVisible;
}

/** Update footer + widget. Call this every time state or action changes. */
export function updateUI(
  ctx: ExtensionContext,
  state: WidgetState,
  supervisorState: LoopState | null,
  action: WidgetAction = { type: 'watching' }
): void {
  // Check if we're receiving new thinking content
  const hasNewThinking =
    action.type === 'analyzing' && action.thinking && action.thinking !== state.lastThinking;

  if (state.clearTimer) {
    clearTimeout(state.clearTimer);
    state.clearTimer = null;
  }
  if (state.animationTimer) {
    clearTimeout(state.animationTimer);
    state.animationTimer = null;
  }

  // Reset animation state for new thinking (streaming replacement)
  if (hasNewThinking) {
    state.hiddenFromBottomCount = 0;
    state.lastThinkingLines = [];
  }

  // Always update last state first
  if (supervisorState?.active) {
    state.lastActiveState = {
      outcome: supervisorState.outcome,
      interventions: [...supervisorState.interventions],
    };
    state.lastActionType = action.type;
    if (action.type === 'analyzing' && action.thinking) {
      state.lastThinking = action.thinking;
    }
  }

  // Handle inferring specially
  if (action.type === 'inferring') {
    if (state.widgetVisible) {
      const inferState = { outcome: '', interventions: state.lastActiveState?.interventions ?? [] };
      renderWithState(ctx, state, inferState, action, '', 0);
    }
    return;
  }

  const shouldAnimate = !supervisorState || !supervisorState.active || action.type === 'steering';

  if (shouldAnimate && state.lastActiveState && state.lastThinkingLines.length > 0) {
    state.clearTimer = setTimeout(() => {
      const boundRender: RenderFn = (ctx, snap, action, thinking, hideFromBottom) => {
        renderWithState(ctx, state, snap, action, thinking, hideFromBottom);
      };
      startLineClearAnimation(ctx, state, boundRender);
    }, CLEAR_DELAY_MS);
    const fallbackAction: WidgetAction =
      action.type === 'steering'
        ? { type: 'steering', message: '', reframeTier: action.reframeTier }
        : { type: 'done', reframeTier: 0 };
    state.lastActionType = fallbackAction.type;
    state.storedAction = fallbackAction;
    renderWithState(
      ctx,
      state,
      state.lastActiveState,
      fallbackAction,
      state.lastThinking,
      state.hiddenFromBottomCount
    );
    return;
  }

  if (!supervisorState || !supervisorState.active) {
    state.lastThinkingLines = [];
    ctx.ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  if (!state.widgetVisible) {
    ctx.ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  renderWithState(
    ctx,
    state,
    state.lastActiveState!,
    action,
    state.lastThinking,
    state.hiddenFromBottomCount
  );
}

/** Main render function - creates the widget content */
function renderWithState(
  ctx: ExtensionContext,
  widgetState: WidgetState,
  snap: { outcome: string; interventions: LoopIntervention[] },
  action: WidgetAction,
  lastThinking: string,
  hideFromBottom: number = 0
): void {
  ctx.ui.setWidget(WIDGET_ID, (tui, theme) => {
    let actionStr: string;
    let thinking = lastThinking;

    switch (action.type) {
      case 'watching':
        actionStr = theme.fg('dim', 'watching');
        break;
      case 'analyzing':
        actionStr = theme.fg('warning', `⟳ turn ${action.turn}`);
        thinking = action.thinking ?? lastThinking;
        break;
      case 'steering':
        actionStr = theme.fg('warning', 'steering');
        break;
      case 'done':
        actionStr = theme.fg('accent', '✓ done');
        break;
      case 'waiting':
        actionStr = theme.fg('warning', `⏳ ${action.message}`);
        break;
      case 'inferring':
        actionStr = theme.fg('dim', 'scanning');
        break;
    }

    const sep = theme.fg('dim', ' · ');
    let headerText: string;
    if (action.type === 'done') headerText = 'Closed';
    else if (action.type === 'inferring') headerText = 'Inferring';
    else headerText = 'Loop';
    const header = `${theme.fg('accent', '◉')} ${theme.fg('accent', headerText)}`;
    const hasGoal = snap.outcome.length > 0;
    const goalLabel = hasGoal ? `${theme.fg('dim', 'Goal:')} ` : '';
    const goalQuoteOpen = hasGoal ? theme.fg('muted', '"') : '';
    const goalQuoteClose = hasGoal ? theme.fg('muted', '"') : '';

    const steerCount = snap.interventions.length;
    const steers = steerCount > 0 ? theme.fg('dim', `↗ ${steerCount}`) : '';
    const reframeTier = 'reframeTier' in action ? (action.reframeTier ?? 0) : 0;
    const reframeStr = reframeTier > 0 ? theme.fg('error', `↻${reframeTier}`) : '';
    const suffixParts = [steers, reframeStr, actionStr].filter(Boolean);

    const thinkingPrefix = theme.fg('dim', '  ');
    const rawThinking = thinking;

    return {
      render: (width: number) => {
        const paddedWidth = Math.max(0, width - 1);
        widgetState.lastRenderedWidth = paddedWidth;
        const suffix = suffixParts.length > 0 ? sep + suffixParts.join(sep) : '';

        const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

        let line: string;
        if (hasGoal) {
          const prefix = header + sep + goalLabel + goalQuoteOpen;
          const prefixWidth = stripAnsi(prefix).length;
          const suffixWidth = stripAnsi(suffix).length;
          const closeQuoteWidth = stripAnsi(goalQuoteClose).length;
          const availableForGoal = Math.max(
            0,
            paddedWidth - prefixWidth - suffixWidth - closeQuoteWidth
          );
          const rawGoal = snap.outcome;
          const truncatedGoal = truncateToWidth(rawGoal, availableForGoal);
          const goalText = theme.fg('muted', truncatedGoal);
          line = prefix + goalText + goalQuoteClose + suffix;
        } else {
          const parts = [header, ...suffixParts].filter(Boolean);
          line = parts.join(sep);
        }
        const l1 = truncateToWidth(line, paddedWidth);

        // During animation, hide lines from the bottom
        if (hideFromBottom > 0 && widgetState.lastThinkingLines.length > 0) {
          const visibleCount = Math.max(0, widgetState.lastThinkingLines.length - hideFromBottom);
          const visibleLines = widgetState.lastThinkingLines
            .slice(0, visibleCount)
            .map((ln) => theme.fg('dim', ln));
          return [l1, ...visibleLines];
        }

        // For non-analyzing states (steering/done/waiting), preserve existing line breaks.
        // This prevents animation jumps caused by width changes from different headers.
        const isAnalyzing = action.type === 'analyzing';
        if (!isAnalyzing && widgetState.lastThinkingLines.length > 0) {
          const visibleLines = widgetState.lastThinkingLines.map((ln) => theme.fg('dim', ln));
          return [l1, ...visibleLines];
        }

        // No thinking to display
        if (!rawThinking) {
          return [l1];
        }

        const thinkingIndent = stripAnsi(thinkingPrefix).length;
        const thinkingWords = rawThinking.split(' ');
        const thinkingLines: string[] = [];
        const plainLines: string[] = [];
        let currentThinkingLine = '';
        let currentPlainLine = '';

        for (const word of thinkingWords) {
          const testLine = currentPlainLine ? `${currentPlainLine} ${word}` : word;
          if (testLine.length <= paddedWidth - thinkingIndent) {
            currentPlainLine = testLine;
            currentThinkingLine = currentThinkingLine ? `${currentThinkingLine} ${word}` : word;
          } else {
            if (currentThinkingLine) {
              thinkingLines.push(thinkingPrefix + theme.fg('dim', currentThinkingLine));
              plainLines.push('  ' + currentPlainLine);
            }
            currentPlainLine = word;
            currentThinkingLine = word;
          }
        }
        if (currentThinkingLine) {
          thinkingLines.push(thinkingPrefix + theme.fg('dim', currentThinkingLine));
          plainLines.push('  ' + currentPlainLine);
        }

        widgetState.lastThinkingLines = plainLines;
        return [l1, ...thinkingLines];
      },
      invalidate: () => {},
    };
  });
}
