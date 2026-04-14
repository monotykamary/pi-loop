/**
 * Prompt builder - constructs user prompts for the supervisor LLM.
 */

import type { LoopState, ConversationMessage, LoopIntervention } from '../types.js';
import { extractMetrics } from './content-extractor.js';
import { getReframeGuidance } from './reframe.js';

/** Build the user-facing prompt for the supervisor LLM. */
export function buildUserPrompt(
  state: LoopState,
  snapshot: ConversationMessage[],
  agentIsIdle: boolean,
  ineffectivePattern?: { detected: boolean; similarCount: number; turnsSinceLastSteer: number }
): string {
  // Build intervention history with full ASI display
  const interventionHistory =
    state.interventions.length === 0
      ? 'None yet.'
      : state.interventions
          .slice(-5)
          .map((iv, i) => {
            let entry = `[${i + 1}] Turn ${iv.turnCount}: "${iv.message}"`;

            // Display ASI prominently if present
            if (iv.asi && Object.keys(iv.asi).length > 0) {
              const asiEntries = Object.entries(iv.asi)
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(', ');
              entry += `\n    ASI {${asiEntries}}`;
            }
            return entry;
          })
          .join('\n');

  // Build ASI pattern summary for loop closing
  const asiSummary = buildASISummary(state.interventions);

  // Extract metrics from all conversation messages
  const allMetrics: Record<string, number> = {};
  for (const msg of snapshot) {
    const msgMetrics = extractMetrics(msg.content);
    Object.assign(allMetrics, msgMetrics);
  }
  const metricsText =
    Object.keys(allMetrics).length > 0
      ? `METRICS DETECTED IN CONVERSATION:\n${Object.entries(allMetrics)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n')}\n`
      : '';

  const conversationText =
    snapshot.length === 0
      ? '(No conversation yet)'
      : snapshot
          .map((m) => {
            const roleLabel =
              m.role === 'user' ? 'USER' : m.role === 'assistant' ? 'ASSISTANT' : 'TOOL RESULTS';
            let text = `${roleLabel}: ${m.content}`;

            // Include tool calls from assistant blocks
            if (m.role === 'assistant' && m.blocks) {
              const toolCalls = m.blocks.filter((b) => b.type === 'tool_call');
              if (toolCalls.length > 0) {
                text += '\n\n[Tool calls made]:';
                for (const tc of toolCalls) {
                  text += `\n  - ${(tc as any).name}(${JSON.stringify((tc as any).input)})`;
                }
              }
            }

            // Include full tool results attached to assistant messages
            if (m.role === 'assistant' && m.toolResults && m.toolResults.length > 0) {
              text += '\n\n[Tool outputs received]:';
              for (const tr of m.toolResults) {
                const resultText = tr.content
                  .map((c) =>
                    c.type === 'text' ? c.text : c.type === 'image' ? '[Image data]' : `[${c.type}]`
                  )
                  .join('');
                text += `\n--- ${tr.toolName} output ---\n${resultText}${tr.isError ? '\n[ERROR]' : ''}`;
              }
            }

            // For tool_results role, the content is already the full output
            if (m.role === 'tool_results' && m.blocks) {
              const hasImages = m.blocks.some((b) => b.type === 'image');
              if (hasImages) {
                text += '\n\n[Contains image data - see blocks for full content]';
              }
            }

            return text;
          })
          .join('\n\n---\n\n');

  const agentStatus = agentIsIdle
    ? `AGENT STATUS: IDLE — the agent has finished its turn and is now waiting for user input.
DECISION: You MUST return "done" or "steer". "continue" is NOT VALID when the agent is idle.`
    : `AGENT STATUS: WORKING — the agent is actively processing. Only intervene if clearly off track.
DECISION: Return "continue" (let them work) or "steer" (intervene now).`;

  // Context-aware JSON schema - only include valid actions for current state
  const responseSchema = agentIsIdle
    ? `{
  "action": "done" | "steer",  // ONLY these two when agent is idle
  "message": "...",              // Required when "steer" (what to tell the agent)
  "reasoning": "...",            // Why you chose this action
  "confidence": 0.85,            // 0-1 float
  "asi": { "...": "..." }        // REQUIRED when steering. Log patterns for future turns
}`
    : `{
  "action": "continue" | "steer", // "continue" lets them work; "steer" interrupts now
  "message": "...",                // Required when "steer"
  "reasoning": "...",
  "confidence": 0.85,
  "asi": { "...": "..." }          // REQUIRED when steering
}`;

  const reframeGuidance = getReframeGuidance(state.reframeTier ?? 0, ineffectivePattern);
  const reframeSection = reframeGuidance ? `\n${reframeGuidance}\n` : '';

  return `DESIRED OUTCOME:
${state.outcome}

${agentStatus}${reframeSection}

${metricsText}RECENT CONVERSATION (last ${snapshot.length} messages):
${conversationText}

YOUR INTERVENTION HISTORY (with ASI observations):
${interventionHistory}

${asiSummary}
REMINDER — DESIRED OUTCOME:
${state.outcome}

Respond ONLY with valid JSON matching this schema (no prose, no markdown fences):
${responseSchema}`;
}

/** Build summary of ASI patterns to close the loop */
function buildASISummary(interventions: LoopIntervention[]): string {
  if (interventions.length === 0) return '';

  // Extract key patterns from ASI
  const patterns: string[] = [];
  const recent = interventions.slice(-5);

  // Check for recurring ASI keys
  const keyFrequency: Record<string, number> = {};
  for (const iv of recent) {
    if (!iv.asi) continue;
    for (const key of Object.keys(iv.asi)) {
      keyFrequency[key] = (keyFrequency[key] || 0) + 1;
    }
  }

  // Surface recurring patterns
  for (const [key, count] of Object.entries(keyFrequency)) {
    if (count >= 2) {
      patterns.push(`Pattern seen ${count}x: "${key}"`);
    }
  }

  // Check for cheating-related indicators in ASI values
  const allValues = recent
    .filter((iv) => iv.asi)
    .flatMap((iv) => Object.values(iv.asi!))
    .map((v) => String(v).toLowerCase());

  const suspiciousIndicators = [
    'unverified',
    'contradict',
    'suspicious',
    'fake',
    'skip',
    'manipulat',
    'cheat',
    'gaming',
    'short-circuit',
  ];

  const hasSuspicious = suspiciousIndicators.some((indicator) =>
    allValues.some((v) => v.includes(indicator))
  );

  if (hasSuspicious) {
    patterns.push(
      '⚠️ Previous interventions flagged suspicious claims — require explicit proof before accepting "done"'
    );
  }

  // Check for verification failures across history
  const verificationFailures = interventions.filter(
    (iv) =>
      iv.asi &&
      Object.entries(iv.asi).some(
        ([k, v]) =>
          String(v).toLowerCase().includes('contradict') ||
          String(v).toLowerCase().includes('unverified')
      )
  ).length;

  if (verificationFailures >= 2) {
    patterns.push(
      `⚠️ ${verificationFailures} interventions involved unverified/contradicted claims — agent has pattern of unreliable reporting`
    );
  }

  if (patterns.length === 0) return '';

  return `ASI PATTERN SUMMARY (use this to inform your decision):
${patterns.map((p) => `- ${p}`).join('\n')}

`;
}
