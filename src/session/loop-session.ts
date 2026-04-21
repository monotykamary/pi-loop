/**
 * LoopSession - reusable session for a single loop goal.
 * Maintains context window across multiple analyses for token efficiency.
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from '@mariozechner/pi-coding-agent';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';

export class LoopSession {
  private session: Awaited<ReturnType<typeof createAgentSession>>['session'] | null = null;
  private model: any = null;
  private systemPrompt: string = '';

  async ensureStarted(
    ctx: ExtensionContext,
    provider: string,
    modelId: string,
    systemPrompt: string
  ): Promise<boolean> {
    // If model or system prompt changed, need new session
    const newModel = ctx.modelRegistry.find(provider, modelId);
    if (!newModel) return false;

    if (this.session && this.model === newModel && this.systemPrompt === systemPrompt) {
      // Session reusable
      return true;
    }

    // Dispose old session if exists
    this.dispose();

    const loader = new DefaultResourceLoader({
      cwd: ctx.cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPromptOverride: () => systemPrompt,
    });
    await loader.reload();

    try {
      const result = await createAgentSession({
        sessionManager: SessionManager.inMemory(),
        modelRegistry: ctx.modelRegistry,
        model: newModel,
        tools: [],
        resourceLoader: loader,
      });
      this.session = result.session;
      this.model = newModel;
      this.systemPrompt = systemPrompt;
      return true;
    } catch {
      return false;
    }
  }

  async prompt(
    userPrompt: string,
    signal?: AbortSignal,
    onDelta?: (accumulated: string) => void
  ): Promise<string | null> {
    if (!this.session) return null;

    const onAbort = () => this.session?.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    let responseText = '';
    const unsubscribe = this.session.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        responseText += event.assistantMessageEvent.delta;
        onDelta?.(responseText);
      }
    });

    try {
      await this.session.prompt(userPrompt);
    } catch {
      return null;
    } finally {
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
    }

    return responseText;
  }

  dispose(): void {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    this.model = null;
  }
}
