import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { LoopState } from '../src/types.js';

// Mock fs for loadSystemPrompt tests
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock('node:os', async () => {
  return {
    homedir: () => '/home/test',
  };
});

import { existsSync, readFileSync } from 'node:fs';
import { loadSystemPrompt } from '../src/core/prompt-loader.js';
import { SNAPSHOT_LIMIT, updateSnapshot } from '../src/core/snapshot-builder.js';
import { buildUserPrompt } from '../src/core/prompt-builder.js';
import { getReframeGuidance } from '../src/core/reframe.js';
import { extractMetrics } from '../src/core/content-extractor.js';
import { inferOutcome } from '../src/core/inference.js';
import { LoopSession } from '../src/session/loop-session.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadSystemPrompt', () => {
  it('returns built-in prompt when no files exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = loadSystemPrompt('/test/cwd');

    expect(result.source).toBe('built-in');
    expect(result.prompt).toContain('You ensure outcomes');
    expect(result.prompt).toContain('Response schema');
  });

  it('loads project LOOP.md when it exists', () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      return String(path).includes('/test/cwd/.pi/LOOP.md');
    });
    vi.mocked(readFileSync).mockReturnValue('Custom project prompt');

    const result = loadSystemPrompt('/test/cwd');

    expect(result.source).toBe('/test/cwd/.pi/LOOP.md');
    expect(result.prompt).toBe('Custom project prompt');
  });

  it("falls back to global when project doesn't exist", () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      return String(path).includes('/home/test/.pi/agent/LOOP.md');
    });
    vi.mocked(readFileSync).mockReturnValue('Global prompt');

    const result = loadSystemPrompt('/test/cwd');

    expect(result.source).toBe('/home/test/.pi/agent/LOOP.md');
    expect(result.prompt).toBe('Global prompt');
  });

  it('prefers project over global', () => {
    vi.mocked(existsSync).mockReturnValue(true); // Both exist
    vi.mocked(readFileSync).mockReturnValue('Project wins');

    const result = loadSystemPrompt('/test/cwd');

    expect(result.source).toBe('/test/cwd/.pi/LOOP.md');
  });

  it('built-in prompt includes honesty check section', () => {
    vi.mocked(existsSync).mockReturnValue(false); // Neither project nor global exists

    const result = loadSystemPrompt('/test/cwd');

    expect(result.source).toBe('built-in');
    expect(result.prompt).toContain('The Honesty Check');
    expect(result.prompt).toContain('Unverified claims');
    expect(result.prompt).toContain('Same-tool verification');
    expect(result.prompt).toContain('Test manipulation');
    expect(result.prompt).toContain('Short-circuiting');
  });

  it('built-in prompt includes ASI memory section', () => {
    vi.mocked(existsSync).mockReturnValue(false); // Neither project nor global exists

    const result = loadSystemPrompt('/test/cwd');

    expect(result.source).toBe('built-in');
    expect(result.prompt).toContain('═══ YOUR MEMORY (ASI) ═══');
    expect(result.prompt).toContain('ASI is your recall across turns');
    expect(result.prompt).toContain('Before deciding, READ your past ASI');
    expect(result.prompt).toContain('REQUIRED when steering');
  });
});

describe('SNAPSHOT_LIMIT', () => {
  it('is set to 6 messages', () => {
    expect(SNAPSHOT_LIMIT).toBe(6);
  });
});

describe('updateSnapshot', () => {
  it('returns existing buffer when turn already analyzed', () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [],
      },
    } as any;

    const state: LoopState = {
      active: true,
      outcome: 'Test',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 5,
      snapshotBuffer: [{ role: 'user', content: 'Old' }],
      lastAnalyzedTurn: 5, // Already analyzed this turn
    };

    const result = updateSnapshot(mockCtx, state);

    // Should return existing buffer limited to SNAPSHOT_LIMIT
    expect(result).toEqual([{ role: 'user', content: 'Old' }]);
  });

  it('updates lastAnalyzedTurn after building snapshot', () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [],
      },
    } as any;

    const state: LoopState = {
      active: true,
      outcome: 'Test',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 3,
      snapshotBuffer: [],
      lastAnalyzedTurn: -1,
    };

    updateSnapshot(mockCtx, state);

    expect(state.lastAnalyzedTurn).toBe(3);
  });
});

describe('getReframeGuidance', () => {
  it('returns empty string for tier 0 without ineffective pattern', () => {
    const result = getReframeGuidance(0);
    expect(result).toBe('');
  });

  it('returns pattern warning even for tier 0 when ineffective pattern detected', () => {
    const result = getReframeGuidance(0, {
      detected: true,
      similarCount: 2,
      turnsSinceLastSteer: 3,
    });
    expect(result).toContain('INEFFECTIVE PATTERN DETECTED');
  });

  it('returns tier 1 guidance', () => {
    const result = getReframeGuidance(1);
    expect(result).toContain('REFRAME TIER 1');
    expect(result).toContain('DIRECTIVE');
    expect(result).toContain('extremely specific');
  });

  it('returns tier 2 guidance', () => {
    const result = getReframeGuidance(2);
    expect(result).toContain('REFRAME TIER 2');
    expect(result).toContain('SUBGOAL');
    expect(result).toContain('smaller, verifiable milestone');
  });

  it('returns tier 3 guidance', () => {
    const result = getReframeGuidance(3);
    expect(result).toContain('REFRAME TIER 3');
    expect(result).toContain('PIVOT');
    expect(result).toContain('completely different strategy');
  });

  it('returns tier 4 guidance', () => {
    const result = getReframeGuidance(4);
    expect(result).toContain('REFRAME TIER 4');
    expect(result).toContain('MINIMAL SLICE');
    expect(result).toContain('smallest working version');
  });

  it('includes ineffective pattern warning when detected', () => {
    const result = getReframeGuidance(2, {
      detected: true,
      similarCount: 2,
      turnsSinceLastSteer: 3,
    });
    expect(result).toContain('INEFFECTIVE PATTERN DETECTED');
    expect(result).toContain('Last 2 steering messages');
    expect(result).toContain('no progress in 3 turns');
  });

  it('does not include pattern warning when not detected', () => {
    const result = getReframeGuidance(2, {
      detected: false,
      similarCount: 1,
      turnsSinceLastSteer: 1,
    });
    expect(result).not.toContain('INEFFECTIVE PATTERN DETECTED');
  });
});

describe('buildUserPrompt', () => {
  it('includes reframe guidance when tier > 0', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Implement auth',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
      reframeTier: 2,
    };

    const result = buildUserPrompt(state, [], true);
    expect(result).toContain('REFRAME TIER 2');
    expect(result).toContain('SUBGOAL');
  });

  it('does not include reframe guidance when tier is 0', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Implement auth',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
      reframeTier: 0,
    };

    const result = buildUserPrompt(state, [], true);
    expect(result).not.toContain('REFRAME TIER');
  });

  it('includes ineffective pattern warning in prompt', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Implement auth',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [
        { turnCount: 1, message: 'Focus on auth', reasoning: 'Test', timestamp: Date.now() },
      ],
      startedAt: Date.now(),
      turnCount: 4,
      reframeTier: 1,
    };

    const ineffectivePattern = { detected: true, similarCount: 1, turnsSinceLastSteer: 3 };
    const result = buildUserPrompt(state, [], true, ineffectivePattern);

    expect(result).toContain('INEFFECTIVE PATTERN DETECTED');
    expect(result).toContain('no progress in 3 turns');
  });

  it('includes outcome and agent status', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const result = buildUserPrompt(state, [], true);
    expect(result).toContain('DESIRED OUTCOME:');
    expect(result).toContain('Build API');
    expect(result).toContain('AGENT STATUS: IDLE');
  });

  it('shows WORKING status when agent is not idle', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const result = buildUserPrompt(state, [], false);
    expect(result).toContain('AGENT STATUS: WORKING');
  });

  it('includes conversation messages in prompt', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const snapshot = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there' },
    ];

    const result = buildUserPrompt(state, snapshot, true);
    expect(result).toContain('USER: Hello');
    expect(result).toContain('ASSISTANT: Hi there');
  });

  it('includes intervention history', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [
        { turnCount: 1, message: 'Focus on X', reasoning: 'Drift', timestamp: 123456 },
      ],
      startedAt: Date.now(),
      turnCount: 2,
    };

    const result = buildUserPrompt(state, [], true);
    expect(result).toContain('YOUR INTERVENTION HISTORY (with ASI observations):');
    expect(result).toContain('[1] Turn 1:');
    expect(result).toContain('Focus on X');
  });

  it('includes ASI from previous interventions', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [
        {
          turnCount: 1,
          message: 'Focus on tests',
          reasoning: 'Drift',
          timestamp: 123456,
          asi: {
            why_stuck: 'agent refactoring without tests',
            strategy_used: 'directive',
          },
        },
      ],
      startedAt: Date.now(),
      turnCount: 2,
    };

    const result = buildUserPrompt(state, [], true);
    expect(result).toContain('ASI {');
    expect(result).toContain('why_stuck: "agent refactoring without tests"');
    expect(result).toContain('strategy_used: "directive"');
  });

  it('surfaces recurring ASI patterns in summary', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [
        {
          turnCount: 1,
          message: 'Focus on tests',
          reasoning: 'Drift',
          timestamp: 123456,
          asi: { suspicious_claim: true, pattern: 'unverified' },
        },
        {
          turnCount: 2,
          message: 'Verify the output',
          reasoning: 'Contradiction',
          timestamp: 123457,
          asi: { suspicious_claim: true, pattern: 'contradicted' },
        },
        {
          turnCount: 3,
          message: 'Show proof',
          reasoning: 'Unverified',
          timestamp: 123458,
          asi: { requires_proof: true },
        },
      ],
      startedAt: Date.now(),
      turnCount: 4,
    };

    const result = buildUserPrompt(state, [], true);
    expect(result).toContain('ASI PATTERN SUMMARY');
    expect(result).toContain('Pattern seen 2x: "suspicious_claim"');
    expect(result).toContain('⚠️ Previous interventions flagged suspicious claims');
  });

  it('warns about verification failures in ASI summary', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [
        {
          turnCount: 1,
          message: 'Focus on tests',
          reasoning: 'Drift',
          timestamp: 123456,
          asi: { claim_status: 'contradicted_by_tool_output' },
        },
        {
          turnCount: 2,
          message: 'Verify the output',
          reasoning: 'Contradiction',
          timestamp: 123457,
          asi: { claim_status: 'unverified' },
        },
        {
          turnCount: 3,
          message: 'Show proof',
          reasoning: 'Unverified',
          timestamp: 123458,
          asi: { claim_status: 'contradicted_by_tool_output' },
        },
      ],
      startedAt: Date.now(),
      turnCount: 4,
    };

    const result = buildUserPrompt(state, [], true);
    expect(result).toContain('ASI PATTERN SUMMARY');
    expect(result).toContain('⚠️ 3 interventions involved unverified/contradicted claims');
    expect(result).toContain('agent has pattern of unreliable reporting');
  });

  it('detects suspicious keywords in ASI values', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [
        {
          turnCount: 1,
          message: 'Check for cheating',
          reasoning: 'Suspicious',
          timestamp: 123456,
          asi: { observation: 'agent_attempted_to_fake_test_results' },
        },
      ],
      startedAt: Date.now(),
      turnCount: 2,
    };

    const result = buildUserPrompt(state, [], true);
    expect(result).toContain('ASI PATTERN SUMMARY');
    expect(result).toContain('⚠️ Previous interventions flagged suspicious claims');
  });

  it('handles empty ASI gracefully', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [
        {
          turnCount: 1,
          message: 'Focus on X',
          reasoning: 'Drift',
          timestamp: 123456,
          // No ASI
        },
      ],
      startedAt: Date.now(),
      turnCount: 2,
    };

    const result = buildUserPrompt(state, [], true);
    // Should not show ASI section for empty ASI
    expect(result).toContain('[1] Turn 1: "Focus on X"');
    expect(result).not.toContain('ASI {}');
    // No ASI summary when no patterns
    expect(result).not.toContain('ASI PATTERN SUMMARY');
  });

  it('does not include metrics section when only natural language text', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const snapshot = [
      { role: 'assistant' as const, content: 'Coverage is now 87% and tests passing' },
    ];

    const result = buildUserPrompt(state, snapshot, true);
    // The LLM reads raw text; no metrics section inserted for natural language
    expect(result).not.toContain('METRICS DETECTED IN CONVERSATION:');
  });

  it('includes METRIC section when explicit markers present', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Build API',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const snapshot = [
      { role: 'assistant' as const, content: 'METRIC coverage=87\nAll tests passing' },
    ];

    const result = buildUserPrompt(state, snapshot, true);
    expect(result).toContain('METRICS DETECTED IN CONVERSATION:');
    expect(result).toContain('coverage: 87');
  });
});

describe('extractMetrics', () => {
  it('extracts autoresearch-style METRIC lines', () => {
    const text = 'METRIC coverage=87.5\nMETRIC tests=42';
    const result = extractMetrics(text);
    expect(result).toEqual({ coverage: 87.5, tests: 42 });
  });

  it('returns empty object when no metrics found', () => {
    const text = 'Coverage is now 87% and tests passing';
    const result = extractMetrics(text);
    expect(result).toEqual({});
  });

  it('returns empty object for regular conversation', () => {
    const text = 'Just some regular conversation without METRIC markers';
    const result = extractMetrics(text);
    expect(result).toEqual({});
  });

  it('handles decimal values in METRIC lines', () => {
    const text = 'METRIC accuracy=94.73';
    const result = extractMetrics(text);
    expect(result.accuracy).toBe(94.73);
  });

  it('ignores percentage patterns without METRIC marker', () => {
    // The LLM supervisor reads the raw text - no need for us to parse
    const text = 'Test coverage: 87% and everything looks good';
    const result = extractMetrics(text);
    expect(result).toEqual({});
  });
});

describe('inferOutcome', () => {
  // Spy on LoopSession prototype methods
  let ensureStartedSpy: ReturnType<typeof vi.spyOn>;
  let promptSpy: ReturnType<typeof vi.spyOn>;
  let disposeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create spies on the prototype methods
    ensureStartedSpy = vi.spyOn(LoopSession.prototype, 'ensureStarted');
    promptSpy = vi.spyOn(LoopSession.prototype, 'prompt');
    disposeSpy = vi.spyOn(LoopSession.prototype, 'dispose');

    // Set default success behavior
    ensureStartedSpy.mockResolvedValue(true);
    promptSpy.mockResolvedValue('Build auth system');
  });

  afterEach(() => {
    // Restore original implementations
    ensureStartedSpy.mockRestore();
    promptSpy.mockRestore();
    disposeSpy.mockRestore();
  });

  it('returns null when sessionManager has no branch entries', async () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [],
      },
      modelRegistry: {
        find: () => ({ name: 'test-model' }),
      },
    } as any;

    const result = await inferOutcome(mockCtx, 'anthropic', 'claude');
    expect(result).toBeNull();
  });

  it('returns null when model not found in registry', async () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [{ type: 'message', message: { role: 'user', content: 'Hello' } }],
      },
      modelRegistry: {
        find: () => null, // Model not found
      },
    } as any;

    ensureStartedSpy.mockResolvedValue(false);

    const result = await inferOutcome(mockCtx, 'anthropic', 'claude');
    expect(result).toBeNull();
  });

  it('returns null when session fails to start', async () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          {
            type: 'message',
            message: { role: 'user', content: [{ type: 'text', text: 'Build auth' }] },
          },
        ],
      },
      modelRegistry: {
        find: () => ({ name: 'test-model' }),
      },
    } as any;

    ensureStartedSpy.mockResolvedValue(false);

    const result = await inferOutcome(mockCtx, 'anthropic', 'claude');
    expect(result).toBeNull();
  });

  it('extracts outcome successfully', async () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          {
            type: 'message',
            message: { role: 'user', content: [{ type: 'text', text: 'Build auth' }] },
          },
        ],
      },
      modelRegistry: {
        find: () => ({ name: 'test-model' }),
      },
    } as any;

    promptSpy.mockResolvedValue('Add JWT authentication with refresh tokens');

    const result = await inferOutcome(mockCtx, 'anthropic', 'claude');

    expect(result).toBe('Add JWT authentication with refresh tokens');
  });

  it('cleans up result: removes quotes, newlines, and limits length', async () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          {
            type: 'message',
            message: { role: 'user', content: [{ type: 'text', text: 'Build auth' }] },
          },
        ],
      },
      modelRegistry: {
        find: () => ({ name: 'test-model' }),
      },
    } as any;

    promptSpy.mockResolvedValue('"Fix the\nbug in the handler"');

    const result = await inferOutcome(mockCtx, 'anthropic', 'claude');

    expect(result).toBe('Fix the bug in the handler'); // No quotes, newlines replaced with spaces
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('returns null when prompt returns null', async () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          {
            type: 'message',
            message: { role: 'user', content: [{ type: 'text', text: 'Build auth' }] },
          },
        ],
      },
      modelRegistry: {
        find: () => ({ name: 'test-model' }),
      },
    } as any;

    promptSpy.mockResolvedValue(null);

    const result = await inferOutcome(mockCtx, 'anthropic', 'claude');

    expect(result).toBeNull();
  });

  it('returns null when exception thrown', async () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          {
            type: 'message',
            message: { role: 'user', content: [{ type: 'text', text: 'Build auth' }] },
          },
        ],
      },
      modelRegistry: {
        find: () => ({ name: 'test-model' }),
      },
    } as any;

    ensureStartedSpy.mockRejectedValue(new Error('Network error'));

    const result = await inferOutcome(mockCtx, 'anthropic', 'claude');

    expect(result).toBeNull();
  });

  it('uses goal extraction system prompt', async () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          {
            type: 'message',
            message: { role: 'user', content: [{ type: 'text', text: 'Build auth' }] },
          },
        ],
      },
      modelRegistry: {
        find: () => ({ name: 'test-model' }),
      },
    } as any;

    await inferOutcome(mockCtx, 'anthropic', 'claude');

    // Verify the system prompt passed to ensureStarted contains goal extraction content
    expect(ensureStartedSpy).toHaveBeenCalledWith(
      mockCtx,
      'anthropic',
      'claude',
      expect.stringContaining('goal extraction')
    );
  });
});
