/**
 * Session client - high-level interface for calling the observer model.
 */

import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { SteeringDecision } from '../types.js';
import { LoopSession } from './loop-session.js';
import { parseDecision, safeContinue } from './response-parser.js';

// Global session manager (one per loop goal)
let activeSession: LoopSession | null = null;

/** Get or create the global loop session. */
function getOrCreateSession(): LoopSession {
  if (!activeSession) {
    activeSession = new LoopSession();
  }
  return activeSession;
}

/** Dispose the global loop session. */
export function disposeSession(): void {
  activeSession?.dispose();
  activeSession = null;
}

/**
 * Run a one-shot observer analysis using reusable session.
 * Returns { action: "continue" } on any failure so the chat is never interrupted.
 */
export async function callObserverModel(
  ctx: ExtensionContext,
  provider: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void
): Promise<SteeringDecision> {
  const session = getOrCreateSession();
  const started = await session.ensureStarted(ctx, provider, modelId, systemPrompt);
  if (!started) return safeContinue('Failed to start loop session');

  const text = await session.prompt(userPrompt, signal, onDelta);
  if (text === null) return safeContinue('Model call failed');
  return parseDecision(text);
}
