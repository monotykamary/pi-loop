import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'node:child_process';
import { checkChildPiProcesses, waitForSubagents } from '../src/subagent-detector.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

describe('subagent-detector', () => {
  const mockExec = vi.mocked(exec);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkChildPiProcesses', () => {
    it('returns no subagents when ps output is empty', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '', stderr: '' }, null as any);
        return {} as any;
      });

      const result = await checkChildPiProcesses();

      expect(result.hasActiveSubagents).toBe(false);
      expect(result.count).toBe(0);
      expect(result.pids).toEqual([]);
    });

    it('detects child pi processes', async () => {
      const parentPid = process.pid;
      mockExec.mockImplementation((cmd, callback) => {
        callback(
          null,
          {
            stdout: `${parentPid} 12345 pi\n${parentPid} 12346 pi\n99999 12347 other`,
            stderr: '',
          },
          null as any
        );
        return {} as any;
      });

      const result = await checkChildPiProcesses();

      expect(result.hasActiveSubagents).toBe(true);
      expect(result.count).toBe(2);
      expect(result.pids).toContain(12345);
      expect(result.pids).toContain(12346);
      expect(result.pids).not.toContain(12347);
    });

    it('ignores non-pi processes', async () => {
      const parentPid = process.pid;
      mockExec.mockImplementation((cmd, callback) => {
        callback(
          null,
          {
            stdout: `${parentPid} 12345 node\n${parentPid} 12346 bash`,
            stderr: '',
          },
          null as any
        );
        return {} as any;
      });

      const result = await checkChildPiProcesses();

      expect(result.hasActiveSubagents).toBe(false);
      expect(result.count).toBe(0);
    });

    it('ignores pi processes from other parents', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        callback(
          null,
          {
            stdout: '99999 12345 pi\n99999 12346 pi',
            stderr: '',
          },
          null as any
        );
        return {} as any;
      });

      const result = await checkChildPiProcesses();

      expect(result.hasActiveSubagents).toBe(false);
      expect(result.count).toBe(0);
    });

    it('handles exec errors gracefully', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        callback(new Error('ps command failed'), { stdout: '', stderr: '' }, null as any);
        return {} as any;
      });

      const result = await checkChildPiProcesses();

      expect(result.hasActiveSubagents).toBe(false);
      expect(result.count).toBe(0);
      expect(result.pids).toEqual([]);
    });

    it('handles malformed ps output', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        callback(
          null,
          {
            stdout: 'garbage line\n  \n123 abc def extra',
            stderr: '',
          },
          null as any
        );
        return {} as any;
      });

      const result = await checkChildPiProcesses();

      expect(result.hasActiveSubagents).toBe(false);
      expect(result.count).toBe(0);
    });
  });

  describe('waitForSubagents', () => {
    it('returns immediately when no subagents', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '', stderr: '' }, null as any);
        return {} as any;
      });

      const result = await waitForSubagents(100, 1000);

      expect(result.completed).toBe(true);
      expect(result.finalStatus.hasActiveSubagents).toBe(false);
    });

    it('waits for subagents to complete', async () => {
      const parentPid = process.pid;
      let calls = 0;
      mockExec.mockImplementation((cmd, callback) => {
        calls++;
        if (calls < 3) {
          callback(
            null,
            {
              stdout: `${parentPid} 12345 pi`,
              stderr: '',
            },
            null as any
          );
        } else {
          callback(null, { stdout: '', stderr: '' }, null as any);
        }
        return {} as any;
      });

      const result = await waitForSubagents(50, 1000);

      expect(result.completed).toBe(true);
      expect(result.finalStatus.hasActiveSubagents).toBe(false);
      expect(calls).toBe(3);
    });

    it("times out if subagents don't complete", async () => {
      const parentPid = process.pid;
      mockExec.mockImplementation((cmd, callback) => {
        callback(
          null,
          {
            stdout: `${parentPid} 12345 pi`,
            stderr: '',
          },
          null as any
        );
        return {} as any;
      });

      const result = await waitForSubagents(50, 100);

      expect(result.completed).toBe(false);
      expect(result.finalStatus.hasActiveSubagents).toBe(true);
      expect(result.finalStatus.count).toBe(1);
    });
  });
});
