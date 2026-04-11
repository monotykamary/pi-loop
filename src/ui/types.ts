/**
 * UI types and state for the supervisor widget.
 */

import type { LoopIntervention } from '../types.js';

export type WidgetAction =
  | { type: 'watching'; reframeTier?: number }
  | { type: 'analyzing'; turn: number; reframeTier?: number; thinking?: string }
  | { type: 'steering'; message: string; reframeTier?: number }
  | { type: 'done'; reframeTier?: number }
  | { type: 'waiting'; message: string; turn: number; reframeTier?: number }
  | { type: 'inferring' };

/** Internal UI state for the widget */
export interface WidgetState {
  widgetVisible: boolean;
  lastActiveState: { outcome: string; interventions: LoopIntervention[] } | null;
  lastThinking: string;
  lastActionType: WidgetAction['type'];
  storedAction: WidgetAction | null;
  lastRenderedWidth: number;
  lastThinkingLines: string[];
  hiddenFromBottomCount: number;
  clearTimer: ReturnType<typeof setTimeout> | null;
  animationTimer: ReturnType<typeof setTimeout> | null;
}

/** Create initial widget state */
export function createInitialState(): WidgetState {
  return {
    widgetVisible: true,
    lastActiveState: null,
    lastThinking: '',
    lastActionType: 'watching',
    storedAction: null,
    lastRenderedWidth: 80,
    lastThinkingLines: [],
    hiddenFromBottomCount: 0,
    clearTimer: null,
    animationTimer: null,
  };
}

/** Constants for widget behavior */
export const WIDGET_ID = 'loop';
export const CLEAR_DELAY_MS = 15000;
export const ANIMATION_STEP_MS = 500;
