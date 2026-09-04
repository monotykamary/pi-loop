import crypto from 'node:crypto';

export interface FailsafeConfig {
  /** Maximum consecutive steers allowed. 0 or unset means disabled (no artificial limit). */
  maxConsecutiveSteers?: number;
  /** Maximum period length to check for cyclic patterns (default: 3). */
  maxCycleLength?: number;
  /** Number of cycle recurrences required to trigger oscillation veto (default: 2). */
  cycleThreshold?: number;
  /** Maximum number of recent fingerprints kept in rolling history (default: 12). */
  historyWindowSize?: number;
}

export interface FailsafeCheckResult {
  veto: boolean;
  reason?: 'MAX_ITERATION_CEILING' | 'CYCLIC_OSCILLATION';
  period?: number;
  message?: string;
  fingerprint?: string;
}

/**
 * Failsafe guard that detects cyclic steering oscillations and optional iteration caps.
 */
export class LoopFailsafeGuard {
  private readonly maxConsecutiveSteers: number;
  private readonly maxCycleLength: number;
  private readonly cycleThreshold: number;
  private readonly maxHistoryWindow: number;
  private consecutiveSteers: number;
  private history: string[];

  constructor(config: FailsafeConfig = {}, initialSteers = 0, initialHistory: string[] = []) {
    const envLimit = process.env.PI_LOOP_MAX_STEERS
      ? parseInt(process.env.PI_LOOP_MAX_STEERS, 10)
      : undefined;

    this.maxConsecutiveSteers =
      config.maxConsecutiveSteers ??
      (envLimit !== undefined && !Number.isNaN(envLimit) ? envLimit : 0);
    this.maxCycleLength = config.maxCycleLength ?? 3;
    this.cycleThreshold = config.cycleThreshold ?? 2;
    this.maxHistoryWindow =
      config.historyWindowSize ?? this.maxCycleLength * this.cycleThreshold * 2;
    this.consecutiveSteers = initialSteers;
    this.history = [...initialHistory];
  }

  /**
   * Canonicalize directive message by stripping ANSI escape sequences,
   * lowercasing, and normalizing punctuation while strictly preserving Unicode letters and digits.
   */
  static normalize(message: string): string {
    if (!message || typeof message !== 'string') return '';
    // 1. Strip ANSI escape sequences
    const stripped = message.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
    // 2. Lowercase
    const lower = stripped.toLowerCase();
    // 3. Strip non-alphanumeric punctuation while preserving Unicode letters and numbers
    const cleaned = lower
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // 4. Fallback if stripping symbols leaves empty string to avoid false hash collisions
    return cleaned.length > 0 ? cleaned : lower.replace(/\s+/g, ' ').trim();
  }

  /**
   * Generate a 16-character SHA-256 hash fingerprint of the canonicalized directive.
   */
  static computeFingerprint(message: string): string {
    const canonical = LoopFailsafeGuard.normalize(message);
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
  }

  /**
   * Evaluate whether appending candidateHash completes a cyclic sequence of period p in 1..maxCycleLength.
   */
  private detectCycle(candidateHash: string): { detected: boolean; period: number } {
    const seq = [...this.history, candidateHash];
    for (let p = 1; p <= this.maxCycleLength; p++) {
      const requiredLength = p * this.cycleThreshold;
      if (seq.length < requiredLength) continue;

      let isCycle = true;
      for (let r = 1; r < this.cycleThreshold; r++) {
        for (let i = 0; i < p; i++) {
          const current = seq[seq.length - 1 - i];
          const previous = seq[seq.length - 1 - i - r * p];
          if (current !== previous) {
            isCycle = false;
            break;
          }
        }
        if (!isCycle) break;
      }

      if (isCycle) {
        return { detected: true, period: p };
      }
    }
    return { detected: false, period: 0 };
  }

  /**
   * Check if an outbound directive message violates failsafe rules.
   */
  check(directiveMessage: string): FailsafeCheckResult {
    // Check iteration ceiling if configured
    if (this.maxConsecutiveSteers > 0 && this.consecutiveSteers >= this.maxConsecutiveSteers) {
      return {
        veto: true,
        reason: 'MAX_ITERATION_CEILING',
        message:
          'Verification loop aborted: Maximum iteration ceiling reached without convergence.',
      };
    }

    // Check for cyclic oscillation (periods 1 to maxCycleLength)
    const fp = LoopFailsafeGuard.computeFingerprint(directiveMessage);
    const cycle = this.detectCycle(fp);
    if (cycle.detected) {
      return {
        veto: true,
        reason: 'CYCLIC_OSCILLATION',
        period: cycle.period,
        message: 'Verification loop aborted: Cyclic error oscillation detected.',
        fingerprint: fp,
      };
    }

    return { veto: false, fingerprint: fp };
  }

  /**
   * Record that a steering directive was dispatched to the agent.
   */
  recordDispatched(fingerprint: string): void {
    this.consecutiveSteers++;
    this.history.push(fingerprint);
    if (this.history.length > this.maxHistoryWindow) {
      this.history.shift();
    }
  }

  /**
   * Reset failsafe counters and history (called on user prompt, done, or stop).
   */
  reset(): void {
    this.consecutiveSteers = 0;
    this.history = [];
  }

  getConsecutiveSteers(): number {
    return this.consecutiveSteers;
  }

  getHistory(): string[] {
    return [...this.history];
  }
}
