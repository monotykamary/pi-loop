/**
 * Pattern detection for ineffective steering interventions.
 */

import type { LoopIntervention, LoopState } from '../types.js';

export interface IneffectivePattern {
  detected: boolean;
  similarCount: number;
  turnsSinceLastSteer: number;
}

/**
 * Detect if recent interventions show a pattern of ineffectiveness.
 * Returns similarity info if the last 2+ steering messages are similar.
 */
export function detectIneffectivePattern(
  state: Pick<LoopState, 'interventions' | 'turnCount' | 'lastSteerTurn'>
): IneffectivePattern {
  const turnsSinceLastSteer = state.turnCount - (state.lastSteerTurn ?? 0);

  // Check stagnation: no progress after 3+ turns since last steer
  const stagnating =
    state.lastSteerTurn !== undefined && state.lastSteerTurn >= 0 && turnsSinceLastSteer >= 3;

  const recent = state.interventions.slice(-3);
  if (recent.length < 2) {
    // Still detect stagnation even with fewer than 2 interventions
    return { detected: stagnating, similarCount: recent.length, turnsSinceLastSteer };
  }

  // Simple similarity: check if messages share common keywords or have similar length
  const messages = recent.map((iv) => iv.message.toLowerCase());
  let similarCount = 1;

  for (let i = 1; i < messages.length; i++) {
    if (areMessagesSimilar(messages[i - 1], messages[i])) {
      similarCount++;
    }
  }

  // Detected if 2+ recent messages are similar OR stagnating (no progress after 3+ turns)
  const detected = similarCount >= 2 || stagnating;

  return { detected, similarCount, turnsSinceLastSteer };
}

function areMessagesSimilar(a: string, b: string): boolean {
  // Simple similarity heuristics
  const normalize = (s: string) => s.replace(/[^\w\s]/g, '').trim();
  const normA = normalize(a);
  const normB = normalize(b);

  // Exact match after normalization
  if (normA === normB) return true;

  // Check for common directive keywords
  const directiveWords = [
    'focus',
    'implement',
    'add',
    'fix',
    'create',
    'build',
    'need',
    'should',
    'must',
  ];
  const aDirectives = directiveWords.filter((w) => normA.includes(w));
  const bDirectives = directiveWords.filter((w) => normB.includes(w));

  // If they share 2+ directive words, likely similar
  const commonDirectives = aDirectives.filter((w) => bDirectives.includes(w));
  if (commonDirectives.length >= 2) return true;

  // Length similarity (within 30%)
  const lenRatio = Math.min(normA.length, normB.length) / Math.max(normA.length, normB.length);
  if (lenRatio > 0.7 && commonDirectives.length >= 1) return true;

  return false;
}
