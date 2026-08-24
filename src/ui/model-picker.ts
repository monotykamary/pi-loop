/**
 * model-picker — wraps pi's internal ModelSelectorComponent for use in
 * the /loop model command. Shows the same model selector the user
 * sees when pressing Ctrl+P in pi, with search and API-key availability.
 */

import { ModelRuntime, ModelSelectorComponent, getAgentDir } from '@earendil-works/pi-coding-agent';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';

/**
 * Open the interactive model picker.
 * Returns the selected Model, or null if the user cancelled.
 */
export async function pickModel(
  ctx: ExtensionContext,
  currentProvider?: string,
  currentModelId?: string
): Promise<Model<any> | null> {
  if (ctx.mode !== 'tui') {
    if (!ctx.hasUI) return null;
    const all = ctx.modelRegistry.getAll();
    if (all.length === 0) {
      ctx.ui.notify('No models available.', 'info');
      return null;
    }
    const items = all.map((m) => `${m.name ?? m.id} (${m.provider}/${m.id})`);
    const pick = await ctx.ui.select('Pick a model', items);
    if (pick === undefined) return null;
    const idx = items.indexOf(pick);
    if (idx < 0) return null;
    return all[idx] ?? null;
  }
  // Resolve the currently-selected supervisor model (to pre-highlight it)
  const currentModel =
    currentProvider && currentModelId
      ? ctx.modelRegistry.find(currentProvider, currentModelId)
      : undefined;

  // pi 0.80.8: ModelSelectorComponent takes the canonical ModelRuntime
  // (previously the sync ModelRegistry facade). ExtensionContext only exposes
  // modelRegistry, so build a runtime from the agent dir for the picker.
  const modelRuntime = await ModelRuntime.create({
    authPath: `${getAgentDir()}/auth.json`,
    modelsPath: `${getAgentDir()}/models.json`,
  });

  return ctx.ui.custom<Model<any> | null>((tui, _theme, _kb, done) => {
    const component = new ModelSelectorComponent(
      tui,
      currentModel,
      modelRuntime,
      [], // no scoped-model cycling — we want the full model list
      (model) => done(model),
      () => done(null)
    );

    // Give focus so the search input is active immediately
    component.focused = true;

    return {
      render: (width) => component.render(width),
      invalidate: () => component.invalidate(),
      handleInput: (data) => {
        component.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
