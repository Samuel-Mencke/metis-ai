param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,
  [switch]$KeepData,
  [switch]$RemoveData,
  [switch]$DryRun,
  [switch]$Yes
)
$ErrorActionPreference = "Stop"
$manifestPath = Join-Path $InstallDir ".metis-ai-install.json"
if (-not (Test-Path $manifestPath)) { throw "Install manifest not found: $manifestPath" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($InstallDir).TrimEnd("\") -eq [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($InstallDir)).TrimEnd("\")) {
  throw "Refusing to remove a filesystem root."
}
if (-not $Yes) {
  $answer = Read-Host "Remove Metis AI installation at $InstallDir? Type 'yes'"
  if ($answer -cne "yes") { Write-Host "Aborted."; exit 0 }
}
function Invoke-Step([scriptblock]$Action, [string]$Description) {
  if ($DryRun) { Write-Host "+ $Description" } else { & $Action }
}
foreach ($suffix in @("app", "worker", "mcp")) {
  $task = "$($manifest.serviceName)-$suffix"
  Invoke-Step { schtasks /Delete /TN $task /F 2>$null | Out-Null } "Delete scheduled task $task"
}
$shouldKeepData = $KeepData -and -not $RemoveData
if (-not $shouldKeepData -and $manifest.dataDir -and ([IO.Path]::GetFullPath($manifest.dataDir) -ne [IO.Path]::GetFullPath($InstallDir))) {
  Invoke-Step { Remove-Item -LiteralPath $manifest.dataDir -Recurse -Force } "Remove data directory"
}
Invoke-Step { Remove-Item -LiteralPath $InstallDir -Recurse -Force } "Remove installation directory"
Write-Host "Metis AI uninstalled. Data kept: $shouldKeepData"
