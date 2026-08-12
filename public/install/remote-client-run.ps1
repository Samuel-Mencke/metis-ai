param(
  [Parameter(Mandatory = $true)][string]$InstallDir
)
$ErrorActionPreference = "Continue"
$nodePath = (Get-Command node).Source
$clientPath = Join-Path $InstallDir "client.mjs"
$configPath = Join-Path $InstallDir "config.json"
while ($true) {
  & $nodePath $clientPath --config $configPath
  Start-Sleep -Seconds 5
}

