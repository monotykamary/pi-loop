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
export const SNAPSHOT_LIMIT = 20;

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

    // Catch-all for any other tool result entries (write, edit, or any tool not explicitly handled above)
    // This ensures tool results aren't silently dropped if they come through with non-standard entry types
    if (
      entry.type !== 'message' &&
      entry.type !== 'custom_message' &&
      (entry as any).type !== 'bash_execution' &&
      (entry as any).type !== 'bash_result'
    ) {
      const otherEntry = entry as any;

      // Only process if it looks like a tool result (has output-like content)
      const content =
        otherEntry.content || otherEntry.result || otherEntry.output || otherEntry.text;
      const toolName = otherEntry.customType || otherEntry.name || otherEntry.tool || 'tool';

      // Skip entries that don't have meaningful content (like state entries)
      if (
        content &&
        typeof content === 'string' &&
        content.length > 0 &&
        !otherEntry.customType?.includes('state')
      ) {
        pendingToolResults.push({
          toolCallId: otherEntry.id || otherEntry.toolCallId || 'unknown',
          toolName,
          input: otherEntry.details || otherEntry.input || {},
          content: [{ type: 'text', text: content }],
          isError: otherEntry.isError || otherEntry.is_error || false,
        });

        newMessages.push({
          role: 'tool_results',
          content,
          blocks: [{ type: 'text', text: content }],
        });
      } else if (Array.isArray(content) && content.length > 0) {
        // Handle rich content arrays (e.g., tool results with image blocks)
        const allBlocks = extractAllBlocks(content);
        const textContent = content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');

        pendingToolResults.push({
          toolCallId: otherEntry.id || otherEntry.toolCallId || 'unknown',
          toolName,
          input: otherEntry.details || otherEntry.input || {},
          content: allBlocks,
          isError: otherEntry.isError || otherEntry.is_error || false,
        });

        newMessages.push({
          role: 'tool_results',
          content: textContent || `[${toolName} output]`,
          blocks: allBlocks,
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
