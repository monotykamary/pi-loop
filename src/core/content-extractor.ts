/**
 * Content block extraction and manipulation utilities.
 */

import type { ContentBlock } from '../types.js';

/** Extract ALL content blocks from message content - full fidelity including images and tool calls. */
export function extractAllBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content
    .map((b: any): ContentBlock | null => {
      if (b.type === 'text' && b.text) {
        return { type: 'text', text: b.text };
      }
      if (b.type === 'image' && b.source) {
        return { type: 'image', source: b.source, mimeType: b.mimeType };
      }
      if (b.type === 'tool_use' || b.type === 'tool_call') {
        return {
          type: 'tool_call',
          id: b.id || b.tool_use_id || 'unknown',
          name: b.name || b.tool_name || 'unknown',
          input: b.input || b.arguments || {},
        };
      }
      if (b.type === 'tool_result') {
        return {
          type: 'tool_result',
          toolCallId: b.tool_use_id || b.toolCallId || 'unknown',
          content: b.content || [],
          isError: b.is_error || b.isError || false,
        };
      }
      return null;
    })
    .filter((b): b is ContentBlock => b !== null);
}

/** Extract text content from message - for backward compatibility. */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text as string)
      .join('\n')
      .trim();
  }
  return '';
}

/** Extract text from assistant message content - for backward compatibility. */
export function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const textParts = content.filter((b: any) => b.type === 'text').map((b: any) => b.text as string);
  return textParts.join('\n').trim();
}

/**
 * Extract metrics from conversation text.
 * Simple pass-through: the LLM supervisor can read the raw text.
 * Only explicitly marked METRIC lines are extracted for convenience.
 */
export function extractMetrics(text: string): Record<string, number> {
  const metrics: Record<string, number> = {};

  // Pattern: "METRIC name=value" (autoresearch-style - explicit marker)
  const metricLines = text.match(/METRIC\s+(\w+)\s*=\s*([\d.]+)/g);
  if (metricLines) {
    for (const line of metricLines) {
      const match = line.match(/METRIC\s+(\w+)\s*=\s*([\d.]+)/);
      if (match) {
        metrics[match[1]] = parseFloat(match[2]);
      }
    }
  }

  return metrics;
}
