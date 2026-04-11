/**
 * Main analyzer - orchestrates supervisor analysis.
 */

import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { SteeringDecision, LoopState } from '../types.js';
import { callObserverModel } from '../session/client.js';
import { loadSystemPrompt } from './prompt-loader.js';
import { updateSnapshot } from './snapshot-builder.js';
import { buildUserPrompt } from './prompt-builder.js';

/**
 * Analyze the current conversation and return a steering decision.
 * Falls back to { action: "steer" } when the agent is idle to prevent it from staying stuck.
 */
export async function analyze(
  ctx: ExtensionContext,
  state: LoopState,
  agentIsIdle: boolean,
  ineffectivePattern?: { detected: boolean; similarCount: number; turnsSinceLastSteer: number },
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void
): Promise<SteeringDecision> {
  const { prompt: systemPrompt } = loadSystemPrompt(ctx.cwd);

  // Update snapshot incrementally
  const snapshot = updateSnapshot(ctx, state);
  const userPrompt = buildUserPrompt(state, snapshot, agentIsIdle, ineffectivePattern);

  try {
    return await callObserverModel(
      ctx,
      state.provider,
      state.modelId,
      systemPrompt,
      userPrompt,
      signal,
      onDelta
    );
  } catch {
    // When idle and analysis fails, nudge rather than silently do nothing
    return agentIsIdle
      ? {
          action: 'steer',
          message: 'Please continue working toward the goal.',
          reasoning: 'Analysis error',
          confidence: 0,
        }
      : { action: 'continue', reasoning: 'Analysis error', confidence: 0 };
  }
}
