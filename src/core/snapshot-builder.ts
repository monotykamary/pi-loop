/**
 * Snapshot builder - constructs conversation snapshots from session history.
 *
 * Incrementally builds snapshots from new session entries since last analysis.
 * CAPTURES EVERYTHING: full tool outputs, images (base64), all content blocks.
 */

import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { ConversationMessage, LoopState, ToolResultEntry, ContentBlock } from '../types.js';
import { extractAllBlocks, extractText, extractAssistantText } from './content-extractor.js';

/** Fixed message limit for supervisor context window. */
export const SNAPSHOT_LIMIT = 6;

/**
 * Incrementally build snapshot from new session entries since last analysis.
 * CAPTURES EVERYTHING: full tool outputs, images (base64), all content blocks.
 * Only walks entries from lastAnalyzedTurn to current, appends to existing buffer.
 */
export function buildIncrementalSnapshot(
  ctx: ExtensionContext,
  state: LoopState
): ConversationMessage[] {
  const existingBuffer = state.snapshotBuffer ?? [];
  const lastAnalyzed = state.lastAnalyzedTurn ?? -1;
  const currentTurn = state.turnCount;

  // If already analyzed this turn, return existing
  if (lastAnalyzed >= currentTurn) {
    return existingBuffer.slice(-SNAPSHOT_LIMIT);
  }

  const newMessages: ConversationMessage[] = [...existingBuffer];
  const entries = ctx.sessionManager.getBranch();

  // Track pending tool results to associate with the next assistant message
  const pendingToolResults: ToolResultEntry[] = [];

  // Find entries since last analysis
  for (const entry of entries) {
    // Capture regular messages (user/assistant conversation)
    if (entry.type === 'message') {
      const msg = (entry as any).message;
      if (!msg) continue;

      if (msg.role === 'user') {
        const textContent = extractText(msg.content);
        const allBlocks = extractAllBlocks(msg.content);
        if (textContent || allBlocks.length > 0) {
          newMessages.push({
            role: 'user',
            content: textContent,
            blocks: allBlocks,
          });
        }
      } else if (msg.role === 'assistant') {
        const textContent = extractAssistantText(msg.content);
        const allBlocks = extractAllBlocks(msg.content);

        // Check for tool calls in the content blocks
        const toolCalls = allBlocks.filter(
          (b): b is ContentBlock & { type: 'tool_call' } => b.type === 'tool_call'
        );

        if (textContent || allBlocks.length > 0 || toolCalls.length > 0) {
          newMessages.push({
            role: 'assistant',
            content: textContent,
            blocks: allBlocks,
            toolResults: pendingToolResults.length > 0 ? [...pendingToolResults] : undefined,
          });
          // Clear pending tool results after associating with assistant
          pendingToolResults.length = 0;
        }
      } else if (msg.role === 'tool') {
        // Tool result messages - capture them fully
        const allBlocks = extractAllBlocks(msg.content);
        const textContent = extractText(msg.content);

        // Try to extract tool call ID and name from the message
        const toolCallId = (msg as any).tool_call_id || (msg as any).toolCallId || 'unknown';
        const toolName = (msg as any).name || 'unknown';
        const isError = (msg as any).is_error || (msg as any).isError || false;

        pendingToolResults.push({
          toolCallId,
          toolName,
          input: {},
          content: allBlocks,
          isError,
        });

        // Also add as a tool_results message for visibility
        newMessages.push({
          role: 'tool_results',
          content: textContent || `[Tool output: ${toolName}]`,
          blocks: allBlocks,
        });
      }
    }

    // Capture custom_message entries (often contain tool results in pi)
    if (entry.type === 'custom_message') {
      const customMsg = entry as any;
      const content = customMsg.content;

      if (typeof content === 'string') {
        // Plain text custom message - likely tool output
        pendingToolResults.push({
          toolCallId: customMsg.id || 'unknown',
          toolName: customMsg.customType || 'unknown',
          input: customMsg.details || {},
          content: [{ type: 'text', text: content }],
          isError: false,
        });

        newMessages.push({
          role: 'tool_results',
          content: content,
          blocks: [{ type: 'text', text: content }],
        });
      } else if (Array.isArray(content)) {
        // Rich content custom message - extract all blocks
        const allBlocks = extractAllBlocks(content);
        const textContent = content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');

        pendingToolResults.push({
          toolCallId: customMsg.id || 'unknown',
          toolName: customMsg.customType || 'unknown',
          input: customMsg.details || {},
          content: allBlocks,
          isError: false,
        });

        newMessages.push({
          role: 'tool_results',
          content: textContent || `[Tool output: ${customMsg.customType}]`,
          blocks: allBlocks,
        });
      }
    }

    // Bash execution messages (special type in pi)
    if ((entry as any).type === 'bash_execution' || (entry as any).type === 'bash_result') {
      const bashEntry = entry as any;
      const result = bashEntry.result || bashEntry;

      if (result) {
        const output = result.stdout || result.output || result.content || '';
        const stderr = result.stderr || '';
        const exitCode = result.exitCode ?? result.exit_code ?? 0;

        const fullOutput = [output, stderr].filter(Boolean).join('\n');

        pendingToolResults.push({
          toolCallId: bashEntry.id || 'bash',
          toolName: 'bash',
          input: { command: result.command || bashEntry.command },
          content: [{ type: 'text', text: fullOutput }],
          isError: exitCode !== 0,
        });

        newMessages.push({
          role: 'tool_results',
          content: fullOutput || '[bash output]',
          blocks: [{ type: 'text', text: fullOutput }],
        });
      }
    }
  }

  // Keep only last 6, compress older if needed
  if (newMessages.length > SNAPSHOT_LIMIT) {
    const overflow = newMessages.length - SNAPSHOT_LIMIT;
    // Drop oldest messages (simple approach)
    return newMessages.slice(overflow);
  }

  return newMessages;
}

/**
 * Update state with new snapshot and return it.
 */
export function updateSnapshot(ctx: ExtensionContext, state: LoopState): ConversationMessage[] {
  const snapshot = buildIncrementalSnapshot(ctx, state);
  state.snapshotBuffer = snapshot;
  state.lastAnalyzedTurn = state.turnCount;
  return snapshot;
}
