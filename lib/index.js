import z from "@deepseek-ai/schemastery";
import { HarnessAgentRuntime } from "./agent.js";
import { BridgeController, registerControlRoute } from "./server.js";

export const name = "dsh-mcp-bridge";
export const inject = ["agentDefaultModel", "agentPresets", "agents", "subagents", "webServer"];
export const Config = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().step(1).min(1).max(65535).default(8931),
  basePath: z.string().default("/mcp"),
  serverName: z.string().default("dsh-bridge"),
  controlPath: z.string().default("/dsh-bridge/control"),
  authToken: z.string().default(""),
  defaultProvider: z.string().default("fork"),
  defaultAgentPreset: z.string().default("standard"),
  defaultCwd: z.string().required(),
  workspaceRoots: z.array(String).default([]),
  maxDepth: z.number().step(1).min(0).default(2),
  taskTimeoutMs: z.number().step(1).min(0).default(0)
});

export async function apply(ctx, config) {
  if (config.host !== "127.0.0.1" && config.host !== "::1" && !config.authToken) {
    throw new Error("dsh-mcp-bridge: authToken is required when binding beyond loopback");
  }
  const resolved = {
    ...config,
    basePath: config.basePath.startsWith("/") ? config.basePath : `/${config.basePath}`,
    workspaceRoots: config.workspaceRoots.length ? config.workspaceRoots : [config.defaultCwd]
  };
  const runtime = new HarnessAgentRuntime(ctx, resolved);
  const controller = new BridgeController(resolved, runtime);
  ctx.effect(() => registerControlRoute(ctx, controller, resolved.controlPath), "dsh-mcp-bridge.control");
  ctx.effect(() => () => controller.dispose(), "dsh-mcp-bridge.server");
  ctx.logger.info(`dsh-mcp-bridge is disabled by default; use the DSH Settings switch to expose http://${resolved.host}:${resolved.port}${resolved.basePath}`);
}
