param(
  [string]$InstallDir = "",
  [string]$RepoUrl = $env:METIS_AI_REPO_URL,
  [string]$DataDir = "",
  [string]$AgentCwd = "",
  [string]$Port = "3100",
  [Alias("Host")][string]$BindHost = "127.0.0.1",
  [string]$McpPort = "8787",
  [string]$Username = "admin",
  [string]$Password = "",
  [string]$PasswordFile = "",
  [string]$ServiceName = "MetisAI",
  [string]$PublicUrl = "",
  [switch]$NonInteractive,
  [switch]$SkipRuntimeInstall,
  [switch]$DryRun,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
if ($Help) {
  @"
Usage:
  windows.ps1                         Guided installation
  windows.ps1 -NonInteractive -Password P

This script must be invoked with powershell -File. Do not pipe it to iex;
use install.ps1 for the one-line installer.

Options: -InstallDir, -DataDir, -AgentCwd, -Port, -Host, -McpPort,
         -Username, -Password, -PasswordFile, -ServiceName, -PublicUrl
         -NonInteractive, -SkipRuntimeInstall, -DryRun
"@ | Write-Host
  exit 0
}
if (-not $RepoUrl) { $RepoUrl = "https://github.com/f1shyondrugs/metis-ai.git" }
if (-not $InstallDir) {
  $InstallDir = if ($env:METIS_AI_INSTALL_DIR) { $env:METIS_AI_INSTALL_DIR } else { Join-Path $HOME "metis-ai" }
}

function Ask([string]$Prompt, [string]$Default) {
  if ($NonInteractive) { return $Default }
  $value = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value
}
function Get-DefaultPublicHost {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($ip) { return $ip }
  return "127.0.0.1"
}
function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name is required." }
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [Environment]::GetEnvironmentVariable("Path", "User")
}
function Get-NodeMajor {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return 0 }
  try { return [int]((& $node.Source -p "process.versions.node.split('.')[0]")) } catch { return 0 }
}
function Confirm-Install([string]$Name) {
  if ($NonInteractive) { return $true }
  $answer = Read-Host "$Name is missing or too old. Install/update it automatically now? (Y/n)"
  return [string]::IsNullOrWhiteSpace($answer) -or $answer -match "^(y|yes)$"
}

if ($PasswordFile) {
  if (-not (Test-Path -LiteralPath $PasswordFile -PathType Leaf)) { throw "Password file is not readable: $PasswordFile" }
  $Password = (Get-Content -LiteralPath $PasswordFile -Raw).TrimEnd("`r", "`n")
}

$port = $Port
$mcpPort = $McpPort
$username = $Username
$serviceName = $ServiceName
$dataDir = if ($DataDir) { $DataDir } else { Join-Path $InstallDir "data" }
$agentCwd = if ($AgentCwd) { $AgentCwd } else { $HOME }

if (-not $NonInteractive) {
  $InstallDir = Ask "Installation directory" $InstallDir
  $dataDir = if ($DataDir) { $DataDir } else { Join-Path $InstallDir "data" }
  $dataDir = Ask "Data directory" $dataDir
  $agentCwd = Ask "Agent workspace directory" $agentCwd
  $port = Ask "Web application port" $port
  $hostMode = (Ask "Host web application on local network? (y/N)" "n").Trim().ToLowerInvariant()
  $aiChatHost = if (@("y", "yes", "1", "true") -contains $hostMode) { "0.0.0.0" } else { "127.0.0.1" }
  $mcpPort = Ask "MCP gateway port" $mcpPort
  $username = Ask "Initial username" $username
  $passwordSecure = Read-Host "Initial password" -AsSecureString
  $passwordAgain = Read-Host "Confirm password" -AsSecureString
  $passwordPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure))
  $passwordAgainPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordAgain))
  if ($passwordPlain.Length -lt 8 -or $passwordPlain -cne $passwordAgainPlain) { throw "Passwords must match and contain at least 8 characters." }
  $serviceName = Ask "Task prefix" $serviceName
} else {
  $aiChatHost = if ($BindHost) { $BindHost } else { "127.0.0.1" }
  $passwordPlain = $Password
  if ([string]::IsNullOrEmpty($passwordPlain) -or $passwordPlain.Length -lt 8) {
    throw "-Password is required and must contain at least 8 characters with -NonInteractive."
  }
}

$publicHost = if ($aiChatHost -eq "0.0.0.0") { Get-DefaultPublicHost } else { "127.0.0.1" }
$publicUrl = if ($PublicUrl) { $PublicUrl } else { "http://$publicHost`:$port" }

$portNumber = 0
$mcpPortNumber = 0
if (-not [int]::TryParse($port, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535) {
  throw "Web port must be a number between 1 and 65535."
}
if (-not [int]::TryParse($mcpPort, [ref]$mcpPortNumber) -or $mcpPortNumber -lt 1 -or $mcpPortNumber -gt 65535) {
  throw "MCP port must be a number between 1 and 65535."
}
if ($serviceName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') {
  throw "Service name may contain letters, numbers, underscores and hyphens."
}

if ($DryRun) {
  Write-Host "Dry run; no files or services will be changed."
  Write-Host "  os:            windows"
  Write-Host "  install dir:   $InstallDir"
  Write-Host "  data dir:      $dataDir"
  Write-Host "  agent cwd:     $agentCwd"
  Write-Host "  bind:          ${aiChatHost}:${port}"
  Write-Host "  mcp port:      $mcpPort"
  Write-Host "  service name:  $serviceName"
  Write-Host "  public url:    $publicUrl"
  Write-Host "  username:      $username"
  exit 0
}

if (-not $SkipRuntimeInstall) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is required to install Git and Node.js automatically."
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (-not (Confirm-Install "Git")) { throw "git is required." }
    winget install --id Git.Git --accept-source-agreements --accept-package-agreements
  }
  if ((Get-NodeMajor) -lt 22) {
    if (-not (Confirm-Install "Node.js 22 or newer")) { throw "Node.js 22 or newer is required." }
    winget install --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
  }
  Refresh-Path
}
Require-Command git
if ((Get-NodeMajor) -lt 22) { throw "Node.js 22 or newer is required." }
$pnpmCommand = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpmCommand) {
  $corepackCommand = (Get-Command corepack.cmd -ErrorAction SilentlyContinue).Source
  if (-not $corepackCommand) { throw "corepack is required to install pnpm." }
  & $corepackCommand enable
  & $corepackCommand prepare pnpm@9 --activate
  $pnpmCommand = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
}
if (-not $pnpmCommand) { throw "pnpm is required." }

if (Test-Path (Join-Path $InstallDir ".git")) {
  git -C $InstallDir pull --ff-only
} elseif ((Test-Path $InstallDir) -and (Get-ChildItem -Force $InstallDir | Select-Object -First 1)) {
  throw "Installation directory exists and is not a Metis AI checkout: $InstallDir"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
  git clone $RepoUrl $InstallDir
}

$randomHex = { -join (1..32 | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) }) }
$chatPassword = & $randomHex
$secretsKey = & $randomHex
$mcpToken = & $randomHex

New-Item -ItemType Directory -Force -Path $dataDir, $agentCwd | Out-Null
@"
APP_NAME=Metis AI
PORT=$port
AI_CHAT_HOST=$aiChatHost
CHAT_USERNAME=$username
CHAT_PASSWORD=$chatPassword
CHAT_DATA_DIR=$dataDir
AGENT_CWD=$agentCwd
AI_CHAT_ROOT=$InstallDir
AI_CHAT_INSTALL_DIR=$InstallDir
AI_CHAT_PUBLIC_URL=$publicUrl
AI_CHAT_SERVICE_NAME=$serviceName
AI_CHAT_MCP_STATE_DIR=$(Join-Path $dataDir "mcp-state")
AI_CHAT_SECRETS_KEY=$secretsKey
MCP_PORT=$mcpPort
MCP_PUBLIC_URL=http://127.0.0.1:$mcpPort
MCP_BEARER_TOKEN=$mcpToken
MCP_ALLOW_REMOTE_ADMIN=false
MCP_ENABLE_REMOTE_SERVERS=false
MCP_ENABLE_OPTIONAL_SERVERS=false
"@ | Set-Content -LiteralPath (Join-Path $InstallDir ".env") -Encoding utf8

Push-Location $InstallDir
try {
  $previousNodeEnv = $env:NODE_ENV
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  & $pnpmCommand install --frozen-lockfile
  $env:METIS_AI_BOOTSTRAP_USERNAME = $username
  $env:METIS_AI_BOOTSTRAP_PASSWORD = $passwordPlain
  $env:METIS_AI_BOOTSTRAP_OPTIONAL = "1"
  & $pnpmCommand exec tsx scripts/bootstrap-user.ts
  & $pnpmCommand build
} finally {
  if ($null -ne $previousNodeEnv) { $env:NODE_ENV = $previousNodeEnv }
  Pop-Location
  Remove-Item Env:METIS_AI_BOOTSTRAP_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:METIS_AI_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:METIS_AI_BOOTSTRAP_OPTIONAL -ErrorAction SilentlyContinue
}

$runner = Join-Path $InstallDir "run-service.ps1"
@"
`$ErrorActionPreference = "Stop"
Get-Content (Join-Path `$PSScriptRoot ".env") | Where-Object { `$_ -and -not `$_.StartsWith("#") } | ForEach-Object {
  `$pair = `$_ -split "=", 2
  if (`$pair.Count -eq 2) { [Environment]::SetEnvironmentVariable(`$pair[0], `$pair[1], "Process") }
}
Set-Location `$PSScriptRoot
& (Get-Command node).Source @args
"@ | Set-Content -LiteralPath $runner -Encoding utf8

foreach ($suffix in @("app", "worker", "mcp")) {
  $taskName = "$serviceName-$suffix"
  try {
    schtasks.exe /Query /TN $taskName 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      schtasks.exe /Delete /TN $taskName /F 2>&1 | Out-Null
    }
  } catch {
    # The task does not exist on a first installation.
  }
  $targetArgs = switch ($suffix) {
    "app" { @("node_modules/tsx/dist/cli.mjs", "server.mjs") }
    "worker" { @("node_modules/tsx/dist/cli.mjs", "worker.ts") }
    default { @("lib/mcp-core/gateway-core.mjs") }
  }
  $quotedTargetArgs = ($targetArgs | ForEach-Object { "`"$_`"" }) -join " "
  $action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runner`" $quotedTargetArgs"
  schtasks /Create /TN $taskName /SC ONLOGON /TR $action /F | Out-Null
  schtasks /Run /TN $taskName | Out-Null
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/status" -TimeoutSec 2 | Out-Null
    break
  } catch {
    if ($attempt -eq 19) { throw "The application did not become healthy." }
    Start-Sleep -Seconds 1
  }
}

$manifest = @{
  installDir = $InstallDir
  dataDir = $dataDir
  agentCwd = $agentCwd
  serviceName = $serviceName
  host = $aiChatHost
  os = "windows"
  createdAt = [DateTime]::UtcNow.ToString("o")
} | ConvertTo-Json -Compress
Set-Content -LiteralPath (Join-Path $InstallDir ".metis-ai-install.json") -Value $manifest -Encoding utf8
Copy-Item -LiteralPath (Join-Path $InstallDir "install/uninstall.ps1") -Destination (Join-Path $InstallDir "uninstall.ps1") -Force
if ($aiChatHost -eq "0.0.0.0") {
  Write-Host "Warning: the web application is reachable on the local network. Use strong credentials and a firewall or trusted TLS reverse proxy."
}
Write-Host "`nMetis AI installed successfully."
Write-Host "Open: $publicUrl"
Write-Host "Uninstall: $(Join-Path $InstallDir 'uninstall.ps1') -InstallDir `"$InstallDir`" -KeepData"
