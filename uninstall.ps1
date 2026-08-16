param(
  [string]$DshRoot = '',
  [string]$CodexConfig = (Join-Path $env:USERPROFILE '.codex\config.toml')
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($DshRoot)) {
  throw "DshRoot is required (the DeepSeek Harness installation root). Example: .\uninstall.ps1 -DshRoot 'C:\path\to\DeepSeek Harness'"
}
$patch = Join-Path $env:USERPROFILE '.dsh\profiles\web\cordis.patch.yml'
$target = Join-Path $DshRoot 'resources\harness\node_modules\dsh-mcp-bridge'
$profileLink = Join-Path $env:USERPROFILE '.dsh\profiles\web\node_modules\dsh-mcp-bridge'
if (Test-Path -LiteralPath $patch -PathType Leaf) {
  $content = Get-Content -LiteralPath $patch -Raw
  $content = [regex]::Replace($content, '(?ms)\r?\n?# dsh-mcp-bridge begin\r?\n.*?# dsh-mcp-bridge end\r?\n?', "`r`n")
  Set-Content -LiteralPath $patch -Value $content -Encoding utf8
}
if (Test-Path -LiteralPath $CodexConfig -PathType Leaf) {
  $codex = Get-Content -LiteralPath $CodexConfig -Raw
  $codex = [regex]::Replace($codex, '(?ms)\r?\n?# dsh-mcp-bridge begin\r?\n.*?# dsh-mcp-bridge end\r?\n?', "`r`n")
  $codex = [regex]::Replace($codex, '(?ms)^\[mcp_servers\.dsh_bridge\]\r?\n.*?(?=^\[|\z)', '')
  Set-Content -LiteralPath $CodexConfig -Value $codex -Encoding utf8
}
if (Test-Path -LiteralPath $profileLink) {
  $resolvedTarget = if (Test-Path -LiteralPath $target) { (Resolve-Path -LiteralPath $target).Path } else { $null }
  $linkItem = Get-Item -LiteralPath $profileLink -Force
  if ($linkItem.LinkType -ne 'Junction') { throw "Refusing to remove an unrelated profile package: $profileLink" }
  $resolvedLink = [System.IO.Path]::GetFullPath([string]$linkItem.Target)
  if ($resolvedTarget -ne $null -and $resolvedLink -ne $resolvedTarget) { throw "Refusing to remove an unrelated profile package: $profileLink" }
  Remove-Item -LiteralPath $profileLink -Force
}
if (Test-Path -LiteralPath $target -PathType Container) { Remove-Item -LiteralPath $target -Recurse -Force }
Write-Host 'Removed dsh-mcp-bridge. Restart DeepSeek Harness and Codex if they are running.'
