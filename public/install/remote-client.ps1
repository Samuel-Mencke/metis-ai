param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$EnrollmentToken,
  [string]$InstallDir = "$env:LOCALAPPDATA\MetisAI\RemoteClient"
)
$ErrorActionPreference = "Stop"
function Get-NodeMajor {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return 0 }
  try { return [int]((& $node.Source -p "process.versions.node.split('.')[0]")) } catch { return 0 }
}
function Confirm-Install([string]$Name) {
  $answer = Read-Host "$Name is missing or too old. Install/update it automatically now? (Y/n)"
  return [string]::IsNullOrWhiteSpace($answer) -or $answer -match "^(y|yes)$"
}
if ((Get-NodeMajor) -lt 20) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Node.js 20 or newer is required. Install it from https://nodejs.org/ and run this command again (winget was not found)."
  }
  if (-not (Confirm-Install "Node.js 20 or newer")) { throw "Node.js 20 or newer is required" }
  winget install --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
if ((Get-NodeMajor) -lt 20) { throw "Node.js 20 or newer is required after installation" }
$npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCommand) { throw "npm is required. Reinstall Node.js 20 or newer from https://nodejs.org/." }
if (-not (Get-Command Invoke-WebRequest -ErrorAction SilentlyContinue)) { throw "PowerShell web requests are required" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$body = @{
  token = $EnrollmentToken
  name = $env:COMPUTERNAME
  hostname = $env:COMPUTERNAME
  os = "windows"
  architecture = $env:PROCESSOR_ARCHITECTURE
  version = "1.0.0"
  capabilities = @("get_info", "list_directory", "read_file", "execute_command", "pty_open", "pty_input", "pty_close")
} | ConvertTo-Json -Compress
$enrolled = Invoke-RestMethod -Method Post -Uri "$($Server.TrimEnd('/'))/api/remote-clients/enroll" -ContentType "application/json" -Body $body
@{ server = $Server.TrimEnd('/'); clientId = $enrolled.client.id; credential = $enrolled.credential } | ConvertTo-Json | Set-Content -Encoding UTF8 -Path "$InstallDir\config.json"
Invoke-WebRequest -Uri "$($Server.TrimEnd('/'))/install/remote-client.mjs" -OutFile "$InstallDir\client.mjs"
Invoke-WebRequest -Uri "$($Server.TrimEnd('/'))/install/remote-client-uninstall.ps1" -OutFile "$InstallDir\uninstall.ps1"
Invoke-WebRequest -Uri "$($Server.TrimEnd('/'))/install/remote-client-run.ps1" -OutFile "$InstallDir\run.ps1"
Push-Location $InstallDir
& $npmCommand init -y | Out-Null
& $npmCommand install --omit=dev --no-audit --no-fund ws | Out-Null
Pop-Location
$nodePath = (Get-Command node).Source
$powershellPath = (Get-Command powershell.exe).Source
$runCommand = "`"$powershellPath`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\run.ps1`" -InstallDir `"$InstallDir`""
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name "Metis AI Remote Client" -Value $runCommand
$stdoutLog = Join-Path $InstallDir "client.log"
$stderrLog = Join-Path $InstallDir "client-error.log"
$process = Start-Process -FilePath $powershellPath -WindowStyle Hidden -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$InstallDir\run.ps1`"", "-InstallDir", "`"$InstallDir`"") -WorkingDirectory $InstallDir -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
Start-Sleep -Milliseconds 750
if ($process.HasExited) {
  $details = if (Test-Path $stderrLog) { Get-Content $stderrLog -Raw } else { "The client process exited without an error log." }
  throw "Remote client stopped immediately: $details"
}
Write-Output "Remote client enrolled successfully: $InstallDir"
Write-Output "Client PID: $($process.Id)"
Write-Output "Remove with: powershell -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""

