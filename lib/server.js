import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { TaskStore, TERMINAL_STATES } from "./tasks.js";

const text = (value, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });
const taskInput = {
  task: z.string().min(1).describe("Complete, concrete work instruction for the DSH agent."),
  label: z.string().min(1).optional(),
  cwd: z.string().optional().describe("Working directory, constrained to configured workspaceRoots."),
  provider: z.string().optional().describe("DSH subagent provider; defaults to fork."),
  toolAllow: z.array(z.string()).optional().describe("Optional exact allow-list for DSH tool names."),
  timeoutMs: z.number().int().min(0).optional()
};

function authorized(req, config) {
  if (!config.authToken) return true;
  return req.headers.authorization === `Bearer ${config.authToken}`;
}

function registerTools(mcp, tasks, config, runtime) {
  mcp.registerTool("dsh_ping", { description: "Check DSH bridge health and available subagent providers." }, async () => text({ ok: true, ...runtime.ping() }));
  mcp.registerTool("dsh_run_task", { description: "Start a DSH subagent asynchronously. Poll dsh_task_status and call dsh_get_task_result once terminal.", inputSchema: taskInput }, async (args) => {
    try {
      const task = tasks.submit({ ...args, timeoutMs: args.timeoutMs ?? config.taskTimeoutMs });
      return text(task);
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true);
    }
  });
  mcp.registerTool("dsh_task_status", { description: "Return a task's state without its final result.", inputSchema: { taskId: z.string().uuid() } }, async ({ taskId }) => {
    const task = tasks.get(taskId);
    if (!task) return text(`Unknown task: ${taskId}`, true);
    const { result, ...status } = task;
    return text(status, TERMINAL_STATES.has(task.state) && task.state !== "completed");
  });
  mcp.registerTool("dsh_get_task_result", { description: "Return the final output for a completed task. Non-completed terminal tasks return an MCP error.", inputSchema: { taskId: z.string().uuid() } }, async ({ taskId }) => {
    const task = tasks.get(taskId);
    if (!task) return text(`Unknown task: ${taskId}`, true);
    if (!TERMINAL_STATES.has(task.state)) return text({ taskId, state: task.state, message: "Task is still running; poll dsh_task_status." });
    return text(task, task.state !== "completed");
  });
  mcp.registerTool("dsh_cancel_task", { description: "Cancel a queued or running DSH task.", inputSchema: { taskId: z.string().uuid() } }, async ({ taskId }) => {
    const task = tasks.cancel(taskId);
    return task ? text(task) : text(`Unknown task: ${taskId}`, true);
  });
  mcp.registerTool("dsh_list_tasks", { description: "List bridge tasks created during this DSH process lifetime." }, async () => text(tasks.list()));
}

async function createRequestTransport(config, runtime, tasks) {
  const mcp = new McpServer({ name: config.serverName, version: "0.1.0" });
  registerTools(mcp, tasks, config, runtime);
  // The SDK requires a fresh stateless transport for every HTTP request.
  // That fits this bridge: task state lives in TaskStore, not in MCP sessions.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);
  return transport;
}

export async function startMcpServer({ config, runtime }) {
  const tasks = new TaskStore((request, signal) => runtime.start(request, signal));
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, serverName: config.serverName }));
      return;
    }
    if (!req.url?.startsWith(config.basePath)) {
      res.writeHead(404).end();
      return;
    }
    if (!authorized(req, config)) {
      res.writeHead(401, { "www-authenticate": "Bearer" }).end();
      return;
    }
    (async () => {
      let transport;
      try {
        transport = await createRequestTransport(config, runtime, tasks);
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("dsh-mcp-bridge: MCP request failed", error);
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        if (!res.writableEnded) res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } finally {
        await transport?.close().catch(() => {});
      }
    })();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    close: async () => {
      await tasks.dispose();
      await runtime.dispose?.();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

export class BridgeController {
  #config;
  #runtime;
  #bridge = null;
  #pending = null;
  #lastError = null;

  constructor(config, runtime) {
    this.#config = config;
    this.#runtime = runtime;
  }

  status() {
    return {
      enabled: this.#bridge !== null,
      endpoint: `http://${this.#config.host}:${this.#config.port}${this.#config.basePath}`,
      lastError: this.#lastError
    };
  }

  async setEnabled(enabled) {
    if (this.#pending) await this.#pending;
    if (enabled === (this.#bridge !== null)) return this.status();
    this.#pending = (async () => {
      if (enabled) {
        try {
          this.#bridge = await startMcpServer({ config: this.#config, runtime: this.#runtime });
          this.#lastError = null;
        } catch (error) {
          this.#bridge = null;
          this.#lastError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      } else {
        const bridge = this.#bridge;
        this.#bridge = null;
        await bridge?.close();
      }
    })();
    try {
      await this.#pending;
      return this.status();
    } finally {
      this.#pending = null;
    }
  }

  async dispose() {
    await this.setEnabled(false);
  }
}

function replyJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error("Control request is too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function registerControlRoute(ctx, controller, controlPath) {
  return ctx.webServer.register({
    kind: "exact",
    path: controlPath,
    handler: async (req, res) => {
      if (req.method === "OPTIONS") return replyJson(res, 204, {});
      if (req.method === "GET") return replyJson(res, 200, controller.status());
      if (req.method !== "POST") return replyJson(res, 405, { error: "Method not allowed" });
      try {
        const body = await readJson(req);
        if (typeof body.enabled !== "boolean") return replyJson(res, 400, { error: "enabled must be a boolean" });
        return replyJson(res, 200, await controller.setEnabled(body.enabled));
      } catch (error) {
        return replyJson(res, 500, { error: error instanceof Error ? error.message : String(error), ...controller.status() });
      }
    }
  });
}
