/**
 * Reframe tier management - escalation strategies for ineffective steering.
 */

import type { ReframeTier } from '../types.js';

/** Get reframe guidance based on current tier */
export function getReframeGuidance(
  tier: number,
  ineffectivePattern?: { detected: boolean; similarCount: number; turnsSinceLastSteer: number }
): string {
  if (!ineffectivePattern?.detected && tier === 0) return '';

  const tierGuidance: Record<number, string> = {
    0: '',
    1: `🔄 REFRAME TIER 1 — DIRECTIVE: The agent needs clearer direction. Be extremely specific about the next single action to take.`,
    2: `🔄 REFRAME TIER 2 — SUBGOAL: The agent is stuck on the full goal. Break this into a smaller, verifiable milestone. Tell it to complete just that one piece.`,
    3: `🔄 REFRAME TIER 3 — PIVOT: The current approach isn't working. Suggest a completely different strategy or implementation path. Challenge any assumptions.`,
    4: `🔄 REFRAME TIER 4 — MINIMAL SLICE: Strip to absolute essentials. Ask: "What's the smallest working version you can deliver right now?" Push for tangible output.`,
  };

  const patternNote = ineffectivePattern?.detected
    ? `\n⚠ INEFFECTIVE PATTERN DETECTED: Last ${ineffectivePattern.similarCount} steering messages were similar or no progress in ${ineffectivePattern.turnsSinceLastSteer} turns. Escalate your approach.`
    : '';

  return tierGuidance[tier] + patternNote;
}

/** Maximum reframe tier value */
const MAX_REFRAME_TIER: ReframeTier = 4;
