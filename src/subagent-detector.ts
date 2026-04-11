/**
 * Subagent detection via process tree inspection.
 *
 * This is extension-agnostic: we don't care HOW subagents were created
 * (pi-messenger, manual spawn, or other extensions). We just check if
 * there are child 'pi' processes still running.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface SubagentStatus {
  hasActiveSubagents: boolean;
  count: number;
  pids: number[];
}

/**
 * Check for child pi processes spawned by the current process.
 * Works on macOS and Linux via ps. Windows returns false (not implemented).
 */
export async function checkChildPiProcesses(): Promise<SubagentStatus> {
  const platform = process.platform;

  if (platform === 'darwin' || platform === 'linux') {
    return checkUnixChildProcesses();
  }

  // Windows: not implemented, assume no subagents
  return { hasActiveSubagents: false, count: 0, pids: [] };
}

async function checkUnixChildProcesses(): Promise<SubagentStatus> {
  try {
    const ppid = process.pid;

    // Get all pi processes with their parent PID
    // Format: ppid pid command
    const { stdout } = await execAsync(`ps -eo ppid,pid,comm | grep -E "\\bpi\\b" || true`);

    const pids: number[] = [];

    for (const line of stdout.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;

      const childPpid = parseInt(parts[0], 10);
      const childPid = parseInt(parts[1], 10);
      const comm = parts[2];

      // Check if this pi process is our direct child
      // Also check for grandchildren (subagents spawning subagents)
      if (childPpid === ppid && comm === 'pi') {
        pids.push(childPid);
      }
    }

    return {
      hasActiveSubagents: pids.length > 0,
      count: pids.length,
      pids,
    };
  } catch {
    return { hasActiveSubagents: false, count: 0, pids: [] };
  }
}

/**
 * Poll until no child pi processes remain or timeout.
 * Returns true if all subagents completed, false if timeout.
 */
export async function waitForSubagents(
  checkIntervalMs: number = 2000,
  timeoutMs: number = 60000
): Promise<{ completed: boolean; finalStatus: SubagentStatus }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await checkChildPiProcesses();
    if (!status.hasActiveSubagents) {
      return { completed: true, finalStatus: status };
    }
    await sleep(checkIntervalMs);
  }

  const finalStatus = await checkChildPiProcesses();
  return { completed: !finalStatus.hasActiveSubagents, finalStatus };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
