/**
 * Response parser for supervisor model decisions.
 */

import type { SteeringDecision, InterventionASI } from '../types.js';

/**
 * Parse a supervisor decision from text response.
 * Handles JSON extraction from markdown code blocks or raw JSON.
 */
export function parseDecision(text: string): SteeringDecision {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? text.trim();

  try {
    const parsed = JSON.parse(jsonStr) as Partial<SteeringDecision>;
    const action = parsed.action;
    if (action !== 'continue' && action !== 'steer' && action !== 'done') {
      return safeContinue('Invalid action in supervisor response');
    }
    return {
      action,
      message: typeof parsed.message === 'string' ? parsed.message.trim() : undefined,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      asi:
        parsed.asi && typeof parsed.asi === 'object' ? (parsed.asi as InterventionASI) : undefined,
    };
  } catch {
    return safeContinue('Failed to parse supervisor JSON decision');
  }
}

/** Create a safe "continue" decision with a reason. */
export function safeContinue(reason: string): SteeringDecision {
  return { action: 'continue', reasoning: reason, confidence: 0 };
}
