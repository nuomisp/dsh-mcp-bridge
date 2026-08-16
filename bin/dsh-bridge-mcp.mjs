#!/usr/bin/env node
import { startMcpServer } from "../lib/server.js";

const config = { host: "127.0.0.1", port: 8931, basePath: "/mcp", serverName: "dsh-bridge-stub", authToken: "", taskTimeoutMs: 0 };
const runtime = {
  ping: () => ({ mode: "offline-stub", providers: [], message: "Load this package in DeepSeek Harness for real agent execution." }),
  start: async () => { throw new Error("Offline stub cannot start DSH agents. Install this package as a DSH plugin."); }
};
await startMcpServer({ config, runtime });
console.error("dsh-mcp-bridge offline MCP stub listening at http://127.0.0.1:8931/mcp");
