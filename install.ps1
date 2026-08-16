param(
  [string]$DshRoot = '',
  [string]$DefaultCwd = '',
  [string]$CodexConfig = (Join-Path $env:USERPROFILE '.codex\config.toml'),
  [switch]$SkipCodexConfig
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($DshRoot)) {
  throw "DshRoot is required (the DeepSeek Harness installation root). Example: .\install.ps1 -DshRoot 'C:\path\to\DeepSeek Harness' -DefaultCwd 'C:\path\to\workspace'"
}
if ([string]::IsNullOrWhiteSpace($DefaultCwd)) {
  throw "DefaultCwd is required (the agent workspace root). Example: .\install.ps1 -DshRoot 'C:\path\to\DeepSeek Harness' -DefaultCwd 'C:\path\to\workspace'"
}
$harness = Join-Path $DshRoot 'resources\harness'
$target = Join-Path $harness 'node_modules\dsh-mcp-bridge'
$patch = Join-Path $env:USERPROFILE '.dsh\profiles\web\cordis.patch.yml'
$profileModules = Join-Path (Split-Path $patch -Parent) 'node_modules'
$profileLink = Join-Path $profileModules 'dsh-mcp-bridge'
if (-not (Test-Path -LiteralPath $harness -PathType Container)) { throw "DSH harness not found: $harness" }
if (-not (Test-Path -LiteralPath $patch -PathType Leaf)) { throw "DSH profile patch not found: $patch" }
if (-not (Test-Path -LiteralPath $target -PathType Container)) { New-Item -ItemType Directory -Path $target | Out-Null }
Get-ChildItem -LiteralPath $PSScriptRoot -Force | Where-Object { $_.Name -notin @('.git', 'node_modules') } | Copy-Item -Destination $target -Recurse -Force
$resolvedTarget = (Resolve-Path -LiteralPath $target).Path
if (Test-Path -LiteralPath $profileLink) {
  $linkItem = Get-Item -LiteralPath $profileLink -Force
  if ($linkItem.LinkType -ne 'Junction') { throw "Refusing to replace an unrelated profile package: $profileLink" }
  $resolvedLink = [System.IO.Path]::GetFullPath([string]$linkItem.Target)
  if ($resolvedLink -ne $resolvedTarget) { throw "Refusing to replace an unrelated profile package: $profileLink" }
} else {
  if (-not (Test-Path -LiteralPath $profileModules -PathType Container)) { New-Item -ItemType Directory -Path $profileModules | Out-Null }
  New-Item -ItemType Junction -Path $profileLink -Target $target | Out-Null
}
$existing = Get-Content -LiteralPath $patch -Raw
$block = @"

# dsh-mcp-bridge begin
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
        defaultCwd: '$DefaultCwd'
        workspaceRoots:
          - '$DefaultCwd'
        maxDepth: 2
        taskTimeoutMs: 0
# dsh-mcp-bridge end
"@
if ($existing -match '(?m)^# dsh-mcp-bridge begin$') {
  $updated = [regex]::Replace($existing, '(?ms)\r?\n?# dsh-mcp-bridge begin\r?\n.*?# dsh-mcp-bridge end\r?\n?', $block)
  Set-Content -LiteralPath $patch -Value $updated -Encoding utf8
} else {
  Add-Content -LiteralPath $patch -Value $block -Encoding utf8
}
if (-not $SkipCodexConfig) {
  $codexDir = Split-Path $CodexConfig -Parent
  if (-not (Test-Path -LiteralPath $codexDir -PathType Container)) { New-Item -ItemType Directory -Path $codexDir | Out-Null }
  if (-not (Test-Path -LiteralPath $CodexConfig -PathType Leaf)) { New-Item -ItemType File -Path $CodexConfig | Out-Null }
  $codex = Get-Content -LiteralPath $CodexConfig -Raw
  $codex = [regex]::Replace($codex, '(?ms)\r?\n?# dsh-mcp-bridge begin\r?\n.*?# dsh-mcp-bridge end\r?\n?', "`r`n")
  $codex = [regex]::Replace($codex, '(?ms)^\[mcp_servers\.dsh_bridge\]\r?\n.*?(?=^\[|\z)', '')
  $codexBlock = @"

# dsh-mcp-bridge begin
[mcp_servers.dsh_bridge]
url = "http://127.0.0.1:8931/mcp"
startup_timeout_sec = 10
tool_timeout_sec = 60
default_tools_approval_mode = "prompt"
# dsh-mcp-bridge end
"@
  Set-Content -LiteralPath $CodexConfig -Value ($codex.TrimEnd() + $codexBlock + "`r`n") -Encoding utf8
}
Write-Host "Installed dsh-mcp-bridge. Restart DeepSeek Harness and Codex to load the bridge switch and MCP connection."
