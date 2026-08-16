import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { installModelSelection } from "@deepseek-ai/dsh-agent";

function insideRoot(candidate, root) {
  const relative = candidate.slice(root.length);
  return candidate === root || relative.startsWith("/") || relative.startsWith("\\");
}

export function resolveWorkspace(cwd, roots) {
  const resolved = resolve(cwd);
  const allowed = roots.map((root) => resolve(root));
  if (!allowed.some((root) => insideRoot(resolved.toLowerCase(), root.toLowerCase()))) {
    throw new Error(`cwd must be inside a configured workspace root: ${resolved}`);
  }
  return resolved;
}

export class HarnessAgentRuntime {
  #ctx;
  #config;
  #parents = new Map();

  constructor(ctx, config) {
    this.#ctx = ctx;
    this.#config = config;
  }

  ping() {
    return {
      mode: "in-process",
      providers: this.#ctx.subagents.list(),
      configuredWorkspaceRoots: this.#config.workspaceRoots,
      defaultProvider: this.#config.defaultProvider
    };
  }

  async start(request, signal) {
    const cwd = resolveWorkspace(request.cwd ?? this.#config.defaultCwd, this.#config.workspaceRoots);
    const parent = await this.#getParent(cwd);
    const provider = request.provider ?? this.#config.defaultProvider;
    const toolFilter = request.toolAllow?.length ? { allow: request.toolAllow } : undefined;
    const startRequest = {
      label: request.label,
      prompt: [{ type: "text", text: request.task }],
      parent: parent.agent,
      signal,
      agentOptions: { cwd },
      ...(this.#config.maxDepth !== undefined ? { maxDepth: this.#config.maxDepth } : {}),
      ...(toolFilter ? { toolFilter } : {})
    };
    return this.#ctx.agents.withInitiator(parent.agent, () => this.#ctx.subagents.start(provider, startRequest));
  }

  async dispose() {
    await Promise.allSettled([...this.#parents.values()].map(async (parent) => parent.dispose()));
    this.#parents.clear();
  }

  async #getParent(cwd) {
    let parent = this.#parents.get(cwd);
    if (!parent) {
      const defaultModel = this.#ctx.get("agentDefaultModel");
      const presets = this.#ctx.get("agentPresets");
      const selection = defaultModel?.currentSelection();
      if (!selection) throw new Error("No active DSH model is configured for delegated tasks");
      parent = await this.#ctx.agents.create({
        sessionId: randomUUID(),
        meta: { cwd, agentPreset: this.#config.defaultAgentPreset },
        agentOptions: { cwd, provider: selection.provider, model: selection.model },
        setup: async (agentCtx) => {
          installModelSelection(agentCtx, { current: selection, assembled: undefined });
          await presets?.mount(agentCtx, this.#config.defaultAgentPreset);
        }
      });
      this.#parents.set(cwd, parent);
    }
    return parent;
  }
}
