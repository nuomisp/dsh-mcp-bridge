# DSH MCP Bridge

`dsh-mcp-bridge` is an in-process DeepSeek Harness plugin. It adds a **Codex Bridge** switch to **DSH Settings → General**. DSH starts with the switch off; only an enabled bridge exposes the local Streamable HTTP MCP server. An MCP client such as Codex then submits work while DeepSeek Harness creates a real in-process child agent to execute it.

The child agent uses the tools already available in DSH, including configured MCP tools such as `mcp__unreal__…` and `mcp__blender__…`. This bridge does not connect to Unreal or Blender itself.

## Safety model

- DSH starts with the bridge disabled. Switching it off stops the listener and cancels running bridge tasks.
- Default bind is `127.0.0.1:8931`; a non-loopback host requires `authToken`.
- Each supplied `cwd` must be inside `workspaceRoots` (or `defaultCwd` when no roots are set).
- Work is asynchronous: use `dsh_run_task`, then poll `dsh_task_status`, then `dsh_get_task_result`.
- A DSH child may run its configured terminal, network, and MCP tools. Its `toolAllow` option can restrict tools; it cannot grant tools DSH did not already expose.

## Install

From the unpacked repository, run PowerShell. `DshRoot` and `DefaultCwd` are required and must point at this machine's DeepSeek Harness installation and agent workspace:

```powershell
.\install.ps1 -DshRoot 'C:\path\to\DeepSeek Harness' -DefaultCwd 'C:\path\to\workspace'
```

The script copies the package next to DSH's bundled dependencies, creates a verified profile junction so DSH can load both host and UI code, adds an idempotent DSH config block, and adds a Codex Streamable HTTP MCP entry with `prompt` approval. It never enables the bridge at startup. Restart DSH and Codex after installation.

Use `.\uninstall.ps1 -DshRoot 'C:\path\to\DeepSeek Harness'` to remove only the bridge's marked config sections, the verified junction, and its installed package.

## DSH configuration entry

The installer uses the package name `dsh-mcp-bridge` and creates a junction in the DSH Web profile's `node_modules`. This lets DSH resolve the package from its profile while Node resolves the plugin's dependencies beside the DSH runtime.

The installed entry is equivalent to:

```yaml
- insert:
    - id: mcp-bridge
      name: dsh-mcp-bridge
      config:
        host: 127.0.0.1
        port: 8931
        basePath: /mcp
        serverName: dsh-bridge
        controlPath: /dsh-bridge/control
        authToken: ''
        defaultProvider: fork
        defaultAgentPreset: standard
        defaultCwd: 'C:\\path\\to\\workspace'
        workspaceRoots:
          - 'C:\\path\\to\\workspace'
        maxDepth: 2
        taskTimeoutMs: 0
```

Restart DSH after installing or changing the patch. Configure the MCP client with `http://127.0.0.1:8931/mcp` using Streamable HTTP.

## Development checks

Run `npm test` and `npm run check`. The package imports DSH-provided dependencies, so syntax checks work in the source checkout and full loading is validated after the installer copies it beside DSH's packages.

`node bin/dsh-bridge-mcp.mjs` is an offline MCP transport smoke-test only; it deliberately cannot execute a DSH agent.
