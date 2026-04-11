/**
 * Loop UI - status widget.
 *
 * Widget line 1: ◉ Loop · Goal: "..." · steers · action
 * Widget line 2: dim thinking text while analyzing (temporary)
 *
 * Toggle visibility with toggleWidget().
 */

import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { LoopState } from '../types.js';
import { createInitialState, type WidgetAction, WIDGET_ID } from './types.js';
import { toggleWidget as toggleWidgetImpl, updateUI as updateUIImpl } from './renderer.js';

// Module-level state instance
const state = createInitialState();

/** Toggle the widget on/off. Returns the new visibility state. */
export function toggleWidget(): boolean {
  return toggleWidgetImpl(state);
}

/** Update footer + widget. Call this every time state or action changes. */
export function updateUI(
  ctx: ExtensionContext,
  supervisorState: LoopState | null,
  action: WidgetAction = { type: 'watching' }
): void {
  return updateUIImpl(ctx, state, supervisorState, action);
}
