/**
 * LoopStateManager — manages in-memory loop state and session persistence.
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { LoopState, LoopIntervention, ConversationMessage, ReframeTier } from '../types.js';
import { detectIneffectivePattern, type IneffectivePattern } from './patterns.js';
import {
  getReframeTier,
  escalateReframeTier as escalateReframeTierInState,
  resetReframeTier as resetReframeTierInState,
} from './reframe.js';

const ENTRY_TYPE = 'loop-state';

const DEFAULT_PROVIDER: string | null = null;
const DEFAULT_MODEL_ID: string | null = null;

export class LoopStateManager {
  private state: LoopState | null = null;
  private pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  start(outcome: string, provider: string, modelId: string): void {
    this.state = {
      active: true,
      outcome,
      provider,
      modelId,
      interventions: [],
      startedAt: Date.now(),
      turnCount: 0,
      snapshotBuffer: [],
      lastAnalyzedTurn: -1,
      justSteered: false,
      reframeTier: 0,
      lastSteerTurn: -1,
    };
    this.persist();
  }

  stop(): void {
    if (!this.state) return;
    this.state.active = false;
    this.state.outcome = ''; // Clear the goal so /supervise starts fresh, not in append mode
    this.persist();
  }

  isActive(): boolean {
    return this.state?.active === true;
  }

  getState(): LoopState | null {
    return this.state;
  }

  addIntervention(intervention: LoopIntervention): void {
    if (!this.state) return;
    this.state.interventions.push(intervention);
    this.state.justSteered = true;
    this.state.lastSteerTurn = intervention.turnCount;
    this.persist();
  }

  clearJustSteered(): void {
    if (!this.state) return;
    this.state.justSteered = false;
  }

  incrementTurnCount(): void {
    if (!this.state) return;
    this.state.turnCount++;
  }

  setModel(provider: string, modelId: string): void {
    if (!this.state) return;
    this.state.provider = provider;
    this.state.modelId = modelId;
    this.persist();
  }

  updateOutcome(outcome: string): void {
    if (!this.state) return;
    this.state.outcome = outcome;
    this.persist();
  }

  updateSnapshotBuffer(messages: ConversationMessage[]): void {
    if (!this.state) return;
    this.state.snapshotBuffer = messages;
    this.state.lastAnalyzedTurn = this.state.turnCount;
  }

  getSnapshotBuffer(): ConversationMessage[] {
    return this.state?.snapshotBuffer ?? [];
  }

  shouldAnalyzeMidRun(turnIndex: number): boolean {
    if (!this.state) return false;
    // Check if we just steered (verify it worked), or safety valve every 8th turn
    if (this.state.justSteered) return true;
    if (turnIndex > 0 && turnIndex % 8 === 0) return true;
    return false;
  }

  // ---- Reframe tier management ----

  getReframeTier(): ReframeTier {
    return getReframeTier(this.state);
  }

  escalateReframeTier(): void {
    if (!this.state) return;
    if (escalateReframeTierInState(this.state)) {
      this.persist();
    }
  }

  resetReframeTier(): void {
    if (!this.state) return;
    resetReframeTierInState(this.state);
    this.persist();
  }

  // ---- Pattern detection ----

  detectIneffectivePattern(): IneffectivePattern {
    if (!this.state) return { detected: false, similarCount: 0, turnsSinceLastSteer: 0 };
    return detectIneffectivePattern(this.state);
  }

  // ---- Persistence ----

  /** Restore state from session entries (finds the most recent loop-state entry). */
  loadFromSession(ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getBranch();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type === 'custom' && (entry as any).customType === ENTRY_TYPE) {
        const loaded = (entry as any).data as LoopState;
        // Restore ephemeral fields
        this.state = {
          ...loaded,
          snapshotBuffer: [],
          lastAnalyzedTurn: -1,
          justSteered: false,
        };
        return;
      }
    }
    this.state = null;
  }

  /** Persist current state to session (public for compaction handler). */
  persist(): void {
    if (!this.state) return;
    // Don't persist ephemeral fields that are runtime-only
    const { snapshotBuffer, lastAnalyzedTurn, justSteered, ...toPersist } = this.state;
    this.pi.appendEntry(ENTRY_TYPE, toPersist);
  }
}
