import { describe, expect, it, vi } from 'vitest';
import { updateUI } from '../src/ui/status-widget.js';

vi.mock('@earendil-works/pi-tui', () => ({
  truncateToWidth: (text: string, width: number) => text.slice(0, Math.max(0, width)),
}));

const theme = { fg: (_color: string, text: string) => text };

describe('loop widget width', () => {
  it('bounds long words and cached lines after a terminal shrink', () => {
    const setWidget = vi.fn();
    const ctx = {
      ui: { setWidget, setStatus: vi.fn(), notify: vi.fn(), select: vi.fn() },
      sessionManager: { getBranch: vi.fn(() => []) },
      model: { provider: 'test', id: 'model' },
    } as any;
    const state = {
      active: true,
      outcome: 'goal',
      interventions: [],
      turnCount: 1,
      justSteered: false,
      lastAnalyzedTurn: 0,
      snapshotBuffer: [],
      reframeTier: 0,
      lastSteerTurn: -1,
    } as any;

    updateUI(ctx, state, { type: 'analyzing', turn: 1, thinking: 'x'.repeat(200) });
    let factory = setWidget.mock.calls.at(-1)[1];
    factory(null, theme).render(100);

    updateUI(ctx, state, { type: 'done' });
    factory = setWidget.mock.calls.at(-1)[1];
    const width = 20;
    const lines = factory(null, theme).render(width);

    expect(lines.every((line: string) => line.length <= width - 1)).toBe(true);
  });
});
