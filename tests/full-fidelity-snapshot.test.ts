import { describe, expect, it, vi } from 'vitest';
import { buildIncrementalSnapshot } from '../src/core/snapshot-builder.js';
import { buildUserPrompt } from '../src/core/prompt-builder.js';
import type { LoopState, ConversationMessage } from '../src/types.js';

// Mock fs/os for the module
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
  };
});

vi.mock('node:os', async () => {
  return {
    homedir: () => '/home/test',
  };
});

describe('Full Fidelity Snapshot Capture', () => {
  describe('extractAllBlocks (via buildIncrementalSnapshot)', () => {
    it('captures text blocks from user messages', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              message: {
                role: 'user',
                content: [{ type: 'text', text: 'Show me the terminal output' }],
              },
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Show me the terminal output');
      expect(result[0].blocks).toHaveLength(1);
      expect(result[0].blocks?.[0]).toEqual({ type: 'text', text: 'Show me the terminal output' });
    });

    it('captures image blocks with base64 data', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              message: {
                role: 'user',
                content: [
                  { type: 'text', text: 'Look at this screenshot' },
                  {
                    type: 'image',
                    source: 'data:image/png;base64,abc123...',
                    mimeType: 'image/png',
                  },
                ],
              },
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      expect(result).toHaveLength(1);
      expect(result[0].blocks).toHaveLength(2);
      expect(result[0].blocks?.[1]).toEqual({
        type: 'image',
        source: 'data:image/png;base64,abc123...',
        mimeType: 'image/png',
      });
    });

    it('captures tool_use blocks from assistant messages', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              message: {
                role: 'assistant',
                content: [
                  { type: 'text', text: 'Let me check the files.' },
                  {
                    type: 'tool_use',
                    id: 'tool_abc123',
                    name: 'bash',
                    input: { command: 'ls -la' },
                  },
                ],
              },
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].blocks).toHaveLength(2);
      expect(result[0].blocks?.[1]).toEqual({
        type: 'tool_call',
        id: 'tool_abc123',
        name: 'bash',
        input: { command: 'ls -la' },
      });
    });

    it('captures tool_result blocks with full output', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              message: {
                role: 'assistant',
                content: [
                  { type: 'text', text: 'Here is the output:' },
                  {
                    type: 'tool_result',
                    tool_use_id: 'tool_abc123',
                    content: [
                      { type: 'text', text: 'drwxr-xr-x  5 user  staff  160 Apr 1 12:00 .' },
                    ],
                    is_error: false,
                  },
                ],
              },
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      expect(result).toHaveLength(1);
      expect(result[0].blocks?.[1]).toEqual({
        type: 'tool_result',
        toolCallId: 'tool_abc123',
        content: [{ type: 'text', text: 'drwxr-xr-x  5 user  staff  160 Apr 1 12:00 .' }],
        isError: false,
      });
    });
  });

  describe('Tool Result Capture', () => {
    it('captures custom_message entries as tool results', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            {
              type: 'custom_message',
              id: 'bash_001',
              customType: 'bash',
              content: 'total 32\ndrwxr-xr-x  5 user staff 160 Apr 1 12:00 .',
              details: { command: 'ls -la' },
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('tool_results');
      expect(result[0].content).toContain('total 32');
      expect(result[0].blocks).toHaveLength(1);
    });

    it('captures rich content custom_messages with images', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            {
              type: 'custom_message',
              id: 'img_001',
              customType: 'image_display',
              content: [
                { type: 'text', text: 'Screenshot of terminal:' },
                { type: 'image', source: 'data:image/png;base64,abc...', mimeType: 'image/png' },
              ],
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      expect(result).toHaveLength(1);
      expect(result[0].blocks).toHaveLength(2);
      expect(result[0].blocks?.[1].type).toBe('image');
    });

    it('associates tool results with the next assistant message', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              message: {
                role: 'assistant',
                content: [
                  { type: 'text', text: 'Let me run the command.' },
                  {
                    type: 'tool_use',
                    id: 'tool_001',
                    name: 'bash',
                    input: { command: 'git diff' },
                  },
                ],
              },
            },
            {
              type: 'custom_message',
              id: 'tool_result_001',
              customType: 'bash',
              content: '11 files changed, 411 insertions(+), 38 deletions(-)',
            },
            {
              type: 'message',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Here is the git diff output.' }],
              },
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      // Tool result is its own message
      const toolResultMsg = result.find((m) => m.role === 'tool_results');
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg?.content).toContain('11 files changed');

      // The second assistant message gets the tool results attached
      const secondAssistant = result.filter((m) => m.role === 'assistant')[1];
      expect(secondAssistant).toBeDefined();
      expect(secondAssistant?.toolResults).toBeDefined();
      expect(secondAssistant?.toolResults).toHaveLength(1);
      expect(secondAssistant?.toolResults?.[0].toolName).toBe('bash');
    });

    it('captures tool role messages as tool results', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              message: {
                role: 'tool',
                tool_call_id: 'call_abc',
                name: 'read',
                content: [{ type: 'text', text: 'File contents here' }],
                is_error: false,
              },
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('tool_results');
    });
  });

  describe('Snapshot Limiting (6 messages)', () => {
    it('limits to 6 messages total', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            { type: 'message', message: { role: 'user', content: [{ type: 'text', text: '1' }] } },
            {
              type: 'message',
              message: { role: 'assistant', content: [{ type: 'text', text: '2' }] },
            },
            { type: 'message', message: { role: 'user', content: [{ type: 'text', text: '3' }] } },
            {
              type: 'message',
              message: { role: 'assistant', content: [{ type: 'text', text: '4' }] },
            },
            { type: 'message', message: { role: 'user', content: [{ type: 'text', text: '5' }] } },
            {
              type: 'message',
              message: { role: 'assistant', content: [{ type: 'text', text: '6' }] },
            },
            { type: 'message', message: { role: 'user', content: [{ type: 'text', text: '7' }] } },
            {
              type: 'message',
              message: { role: 'assistant', content: [{ type: 'text', text: '8' }] },
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      expect(result).toHaveLength(6);
      // Should keep the most recent 6 (messages 3-8)
      expect(result[0].content).toBe('3');
      expect(result[5].content).toBe('8');
    });

    it('preserves tool results within the 6-message window', () => {
      const mockCtx = {
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              message: { role: 'user', content: [{ type: 'text', text: 'Old 1' }] },
            },
            {
              type: 'message',
              message: { role: 'assistant', content: [{ type: 'text', text: 'Old 2' }] },
            },
            {
              type: 'message',
              message: { role: 'user', content: [{ type: 'text', text: 'Recent user' }] },
            },
            {
              type: 'message',
              message: {
                role: 'assistant',
                content: [
                  { type: 'text', text: 'Recent assistant' },
                  { type: 'tool_use', id: 't1', name: 'bash', input: { command: 'ls' } },
                ],
              },
            },
            {
              type: 'custom_message',
              id: 'r1',
              customType: 'bash',
              content: 'file1.txt\nfile2.txt',
            },
            {
              type: 'message',
              message: { role: 'user', content: [{ type: 'text', text: 'Latest user' }] },
            },
            {
              type: 'message',
              message: { role: 'assistant', content: [{ type: 'text', text: 'Latest assistant' }] },
            },
          ],
        },
      } as any;

      const state: LoopState = {
        active: true,
        outcome: 'Test',
        provider: 'anthropic',
        modelId: 'claude',
        interventions: [],
        startedAt: Date.now(),
        turnCount: 1,
        snapshotBuffer: [],
        lastAnalyzedTurn: -1,
      };

      const result = buildIncrementalSnapshot(mockCtx, state);

      expect(result.length).toBeLessThanOrEqual(6);
      // Should include the tool result message
      const toolResult = result.find((m) => m.role === 'tool_results');
      expect(toolResult).toBeDefined();
      expect(toolResult?.content).toContain('file1.txt');
    });
  });
});

describe('Prompt Building with Tool Outputs', () => {
  it('includes tool calls in assistant message rendering', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Show terminal output',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const snapshot: ConversationMessage[] = [
      {
        role: 'assistant',
        content: 'I will run the command.',
        blocks: [
          { type: 'text', text: 'I will run the command.' },
          { type: 'tool_call', id: 't1', name: 'bash', input: { command: 'ls -la' } },
        ],
      },
    ];

    const result = buildUserPrompt(state, snapshot, true);

    expect(result).toContain('[Tool calls made]:');
    expect(result).toContain('bash({"command":"ls -la"})');
  });

  it('includes full tool outputs attached to assistant messages', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Show terminal output',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const snapshot: ConversationMessage[] = [
      {
        role: 'assistant',
        content: 'The terminal outputs are being shown.',
        blocks: [{ type: 'text', text: 'The terminal outputs are being shown.' }],
        toolResults: [
          {
            toolCallId: 't1',
            toolName: 'bash',
            input: { command: 'ls -la' },
            content: [{ type: 'text', text: 'drwxr-xr-x  5 user staff 160 Apr 1 12:00 .' }],
            isError: false,
          },
          {
            toolCallId: 't2',
            toolName: 'read',
            input: { path: '/tmp/output.txt' },
            content: [{ type: 'text', text: 'File contents: 11 files changed' }],
            isError: false,
          },
        ],
      },
    ];

    const result = buildUserPrompt(state, snapshot, true);

    expect(result).toContain('[Tool outputs received]:');
    expect(result).toContain('--- bash output ---');
    expect(result).toContain('drwxr-xr-x');
    expect(result).toContain('--- read output ---');
    expect(result).toContain('11 files changed');
  });

  it('marks error outputs with [ERROR] tag', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Run command',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const snapshot: ConversationMessage[] = [
      {
        role: 'assistant',
        content: 'Command failed.',
        blocks: [{ type: 'text', text: 'Command failed.' }],
        toolResults: [
          {
            toolCallId: 't1',
            toolName: 'bash',
            input: { command: 'badcommand' },
            content: [{ type: 'text', text: 'bash: badcommand: command not found' }],
            isError: true,
          },
        ],
      },
    ];

    const result = buildUserPrompt(state, snapshot, true);

    expect(result).toContain('[ERROR]');
  });

  it('renders tool_results role messages correctly', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Show output',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const snapshot: ConversationMessage[] = [
      { role: 'user', content: 'Run ls' },
      {
        role: 'tool_results',
        content: 'file1.txt\nfile2.txt',
        blocks: [
          { type: 'text', text: 'file1.txt\nfile2.txt' },
          { type: 'image', source: 'data:png;base64,abc...', mimeType: 'image/png' },
        ],
      },
    ];

    const result = buildUserPrompt(state, snapshot, true);

    expect(result).toContain('TOOL RESULTS:');
    expect(result).toContain('file1.txt');
    expect(result).toContain('[Contains image data');
  });

  it('shows full conversation flow with tools in prompt', () => {
    const state: LoopState = {
      active: true,
      outcome: 'Show raw terminal output',
      provider: 'anthropic',
      modelId: 'claude',
      interventions: [],
      startedAt: Date.now(),
      turnCount: 1,
    };

    const snapshot: ConversationMessage[] = [
      { role: 'user', content: 'Show me the raw terminal output from ls -la' },
      {
        role: 'assistant',
        content: 'Here are the outputs:',
        blocks: [
          { type: 'text', text: 'Here are the outputs:' },
          { type: 'tool_call', id: 't1', name: 'bash', input: { command: 'ls -la' } },
        ],
        toolResults: [
          {
            toolCallId: 't1',
            toolName: 'bash',
            input: { command: 'ls -la' },
            content: [
              { type: 'text', text: 'total 32\ndrwxr-xr-x  5 user staff 160 Apr 1 12:00 .' },
            ],
            isError: false,
          },
        ],
      },
      { role: 'user', content: 'That was just a summary. Show the RAW text.' },
      {
        role: 'assistant',
        content: 'I will show the raw output.',
        blocks: [
          { type: 'text', text: 'I will show the raw output.' },
          { type: 'tool_call', id: 't2', name: 'bash', input: { command: 'ls -la /tmp' } },
        ],
        toolResults: [
          {
            toolCallId: 't2',
            toolName: 'bash',
            input: { command: 'ls -la /tmp' },
            content: [{ type: 'text', text: 'drwxrwxrwt  10 root  wheel  320 Apr 1 12:00 /tmp' }],
            isError: false,
          },
        ],
      },
    ];

    const result = buildUserPrompt(state, snapshot, true);

    // Verify supervisor can see the user's demand AND the actual tool output
    expect(result).toContain('USER: Show me the raw terminal output from ls -la');
    expect(result).toContain('USER: That was just a summary. Show the RAW text.');
    expect(result).toContain('[Tool outputs received]:');
    expect(result).toContain('total 32');
    expect(result).toContain('drwxr-xr-x');

    // This is the key: supervisor can now compare what user demanded vs what was shown
    // If agent claims "outputs are displayed" but tool result shows they weren't,
    // supervisor will detect this and steer
  });
});
