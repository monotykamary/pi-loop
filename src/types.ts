/**
 * Core types for the pi-loop extension.
 */

export type LoopAction = 'continue' | 'steer' | 'done';

/** A single intervention record */
export interface LoopIntervention {
  turnCount: number;
  message: string;
  reasoning: string;
  timestamp: number;
  /** Self-generated actionable side information */
  asi?: InterventionASI;
}

/** Reframe tier tracks escalation of intervention strategies */
export type ReframeTier = 0 | 1 | 2 | 3 | 4;

/** Actionable Side Information — free-form observations from interventions */
export interface InterventionASI {
  /** Any observations worth remembering for future decisions */
  [key: string]: unknown;
}

/** Full loop state — persisted to session */
export interface LoopState {
  active: boolean;
  outcome: string;
  provider: string; // e.g. "anthropic"
  modelId: string; // e.g. "claude-haiku-4-5-20251001"
  interventions: LoopIntervention[];
  startedAt: number;
  turnCount: number;
  // Incremental snapshot buffer (not persisted, rebuilt on load)
  snapshotBuffer?: ConversationMessage[];
  lastAnalyzedTurn?: number;
  justSteered?: boolean; // flag to check if steer worked
  // Reframe escalation tracking
  reframeTier?: ReframeTier;
  lastSteerTurn?: number; // track when we last steered to detect ineffectiveness
}

/** Decision returned by the observer LLM */
export interface SteeringDecision {
  action: LoopAction;
  message?: string;
  reasoning: string;
  confidence: number;
  /** Self-generated actionable side information when steering */
  asi?: InterventionASI;
}

/** Content block types for rich message capture */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: string; mimeType?: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      toolCallId: string;
      content: (ContentBlock | string)[];
      isError?: boolean;
    };

/** A simplified message for building the supervisor context - now with full tool support */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool_results';
  content: string;
  /** Rich content blocks for full fidelity capture (images, tool calls, tool results) */
  blocks?: ContentBlock[];
  /** Raw tool results associated with this turn (for assistant messages) */
  toolResults?: ToolResultEntry[];
}

/** Captured tool result entry */
export interface ToolResultEntry {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  content: ContentBlock[];
  isError: boolean;
}
