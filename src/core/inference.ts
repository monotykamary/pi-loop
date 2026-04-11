/**
 * Outcome inference from conversation history.
 */

import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { ConversationMessage } from '../types.js';
import { LoopSession } from '../session/loop-session.js';
import { extractAllBlocks, extractText, extractAssistantText } from './content-extractor.js';
import { SNAPSHOT_LIMIT } from './snapshot-builder.js';

/** System prompt for inferring an outcome from conversation history. */
const INFER_OUTCOME_SYSTEM_PROMPT = `You are a goal extraction assistant. Your task is to analyze a conversation between a user and a coding AI assistant, and extract the user's primary desired outcome or goal.

The outcome should be:
- Specific and measurable (not vague like "make it better")
- Action-oriented (what needs to be built, fixed, or achieved)
- Concise (1-2 sentences, ideally under 100 characters)
- Focused on the core intent, not implementation details

Examples of good outcomes:
- "Add JWT authentication with refresh tokens and test coverage"
- "Refactor the database layer to use connection pooling"
- "Fix the memory leak in the file upload handler"
- "Implement dark mode toggle with system preference detection"

Respond with ONLY the outcome statement. No quotes, no markdown, no explanations.`;

/**
 * Infer a supervision outcome from the conversation history.
 * Returns null if inference fails or there's no conversation to analyze.
 */
export async function inferOutcome(
  ctx: ExtensionContext,
  provider: string,
  modelId: string,
  signal?: AbortSignal
): Promise<string | null> {
  // Build a focused snapshot for the immediate goal (last 6 messages = ~3 turns)
  const entries = ctx.sessionManager.getBranch();
  const messages: ConversationMessage[] = [];

  for (const entry of entries) {
    // Capture regular messages
    if (entry.type === 'message') {
      const msg = (entry as any).message;
      if (!msg) continue;

      if (msg.role === 'user') {
        const textContent = extractText(msg.content);
        const allBlocks = extractAllBlocks(msg.content);
        if (textContent || allBlocks.length > 0) {
          messages.push({ role: 'user', content: textContent, blocks: allBlocks });
        }
      } else if (msg.role === 'assistant') {
        const textContent = extractAssistantText(msg.content);
        const allBlocks = extractAllBlocks(msg.content);
        if (textContent || allBlocks.length > 0) {
          messages.push({ role: 'assistant', content: textContent, blocks: allBlocks });
        }
      } else if (msg.role === 'tool') {
        // Include tool results for context
        const textContent = extractText(msg.content);
        const allBlocks = extractAllBlocks(msg.content);
        if (textContent || allBlocks.length > 0) {
          messages.push({ role: 'tool_results', content: textContent, blocks: allBlocks });
        }
      }
    }

    // Capture custom_message entries (often contain tool results)
    if (entry.type === 'custom_message') {
      const customMsg = entry as any;
      const content = customMsg.content;

      if (typeof content === 'string') {
        messages.push({
          role: 'tool_results',
          content: content,
          blocks: [{ type: 'text', text: content }],
        });
      } else if (Array.isArray(content)) {
        const allBlocks = extractAllBlocks(content);
        const textContent = content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');
        messages.push({
          role: 'tool_results',
          content: textContent || `[${customMsg.customType}]`,
          blocks: allBlocks,
        });
      }
    }
  }

  const snapshot = messages.slice(-SNAPSHOT_LIMIT);
  if (snapshot.length === 0) return null;

  const conversationText = snapshot
    .map(
      (m) =>
        `${m.role === 'user' ? 'USER' : m.role === 'assistant' ? 'ASSISTANT' : 'TOOL RESULTS'}: ${m.content}`
    )
    .join('\n\n---\n\n');

  const userPrompt = `Analyze this conversation and extract the user's primary goal or desired outcome:

${conversationText}

What is the specific outcome the user is trying to achieve?`;

  try {
    // Use fresh LoopSession (not callObserverModel) to avoid
    // interfering with the global loop session
    const session = new LoopSession();
    const started = await session.ensureStarted(
      ctx,
      provider,
      modelId,
      INFER_OUTCOME_SYSTEM_PROMPT
    );
    if (!started) return null;

    const result = await session.prompt(userPrompt, signal);
    session.dispose();

    if (!result) return null;
    // Clean up the result: remove quotes, trim whitespace, limit length
    return result
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .replace(/\n/g, ' ') // Replace newlines with spaces
      .trim()
      .slice(0, 200); // Hard limit at 200 chars
  } catch {
    return null;
  }
}
