/**
 * Reframe tier state management.
 */

import type { ReframeTier, LoopState } from '../types.js';

/** Maximum reframe tier value */
const MAX_REFRAME_TIER: ReframeTier = 4;

/** Get the current reframe tier from state */
export function getReframeTier(state: LoopState | null): ReframeTier {
  return state?.reframeTier ?? 0;
}

/** Get next tier value */
function getNextTier(tier: ReframeTier): ReframeTier {
  return Math.min(tier + 1, MAX_REFRAME_TIER) as ReframeTier;
}

/** Escalate reframe tier in state */
export function escalateReframeTier(state: LoopState): boolean {
  const current = state.reframeTier ?? 0;
  if (current < MAX_REFRAME_TIER) {
    state.reframeTier = getNextTier(current);
    return true;
  }
  return false;
}

/** Reset reframe tier to 0 */
export function resetReframeTier(state: LoopState): void {
  state.reframeTier = 0;
}
