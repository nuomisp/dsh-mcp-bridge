import { randomUUID } from "node:crypto";

export const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "timed_out"]);

export function renderContent(blocks = []) {
  return blocks.map((block) => {
    if (block?.type === "text") return block.text ?? "";
    return `[${block?.type ?? "unknown"} content omitted]`;
  }).filter(Boolean).join("\n");
}

export class TaskStore {
  #tasks = new Map();
  #start;

  constructor(start) {
    this.#start = start;
  }

  submit(request) {
    const id = randomUUID();
    const controller = new AbortController();
    const task = {
      id,
      label: request.label ?? "DSH delegated task",
      state: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      stopReason: null,
      result: null,
      error: null,
      childSessionId: null,
      controller,
      run: null,
      timeout: null
    };
    this.#tasks.set(id, task);
    queueMicrotask(() => this.#execute(task, request));
    return this.publicTask(task);
  }

  get(id) {
    const task = this.#tasks.get(id);
    return task ? this.publicTask(task) : undefined;
  }

  list() {
    return [...this.#tasks.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((task) => this.publicTask(task));
  }

  cancel(id) {
    const task = this.#tasks.get(id);
    if (!task) return undefined;
    if (!TERMINAL_STATES.has(task.state)) {
      task.state = "cancelled";
      task.stopReason = "aborted";
      task.finishedAt = new Date().toISOString();
      task.controller.abort(new Error("Cancelled by MCP client"));
    }
    return this.publicTask(task);
  }

  async dispose() {
    for (const task of this.#tasks.values()) this.cancel(task.id);
    await Promise.allSettled([...this.#tasks.values()].map(async (task) => task.run?.dispose?.()));
  }

  publicTask(task) {
    return {
      id: task.id,
      label: task.label,
      state: task.state,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      childSessionId: task.childSessionId,
      stopReason: task.stopReason,
      result: task.result,
      error: task.error
    };
  }

  async #execute(task, request) {
    if (task.controller.signal.aborted) return;
    task.state = "running";
    task.startedAt = new Date().toISOString();
    if (request.timeoutMs > 0) {
      task.timeout = setTimeout(() => {
        if (TERMINAL_STATES.has(task.state)) return;
        task.state = "timed_out";
        task.stopReason = "timeout";
        task.finishedAt = new Date().toISOString();
        task.controller.abort(new Error("Task timed out"));
      }, request.timeoutMs);
      task.timeout.unref?.();
    }
    try {
      const run = await this.#start(request, task.controller.signal);
      task.run = run;
      task.childSessionId = String(run.id);
      const outcome = await run.result;
      if (!TERMINAL_STATES.has(task.state)) {
        task.stopReason = outcome.stopReason ?? "error";
        task.result = renderContent(outcome.output);
        task.state = task.stopReason === "completed" ? "completed" : "failed";
        task.finishedAt = new Date().toISOString();
      }
    } catch (error) {
      if (!TERMINAL_STATES.has(task.state)) {
        task.state = task.controller.signal.aborted ? "cancelled" : "failed";
        task.stopReason = task.controller.signal.aborted ? "aborted" : "error";
        task.error = error instanceof Error ? error.message : String(error);
        task.finishedAt = new Date().toISOString();
      }
    } finally {
      if (task.timeout) clearTimeout(task.timeout);
      await task.run?.dispose?.().catch(() => {});
    }
  }
}
