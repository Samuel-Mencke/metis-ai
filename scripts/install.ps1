[CmdletBinding()]
param(
  [switch]$NonInteractive,
  [switch]$Yes,
  [switch]$DryRun,
  [switch]$Json,
  [switch]$SkipBuild,
  [switch]$EnableService,
  [switch]$Start,
  [string]$InstallDir = "",
  [string]$DataDir = "",
  [string]$AgentCwd = "",
  [string]$Source = "",
  [string]$Version = "master",
  [string]$AppName = "Metis AI",
  [string]$ChatUsername = "admin",
  [string]$ChatPassword = "",
  [string]$McpToken = "",
  [string]$CursorApiKey = "",
  [string]$PublicUrl = "",
  [int]$Port = 3100,
  [int]$McpPort = 8787,
  [string]$ServiceName = "metis-ai-worker"
)

$ErrorActionPreference = "Stop"
$Repository = if ($env:METIS_AI_REPOSITORY) { $env:METIS_AI_REPOSITORY } else { "f1shyondrugs/metis-ai" }
$GitHubToken = $env:GITHUB_TOKEN
if (-not $InstallDir) {
  $InstallDir = if ($env:METIS_AI_INSTALL_DIR) { $env:METIS_AI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "MetisAI" }
}
if (-not $DataDir) { $DataDir = Join-Path $InstallDir "data" }
if (-not $AgentCwd) { $AgentCwd = Join-Path $InstallDir "workspace" }
if (-not $Source) { $Source = if ($env:METIS_AI_SOURCE) { $env:METIS_AI_SOURCE } else { "github" } }

function Fail([string]$Message) {
  throw "Error: $Message"
}

function Show-Help {
  @"
Metis AI native PowerShell installer

Usage:
  .\install.ps1 [options]

Options:
  -NonInteractive       Never prompt; provide all values as parameters or environment variables.
  -Yes                  Confirm overwrite and setup decisions.
  -DryRun               Validate and print planned actions without changing files.
  -Json                 Emit machine-readable result output.
  -InstallDir PATH      Absolute application directory.
  -DataDir PATH         Absolute data directory.
  -AgentCwd PATH        Absolute agent workspace.
  -Source github|URL|DIR  Source repository, archive URL, or local directory.
  -Version BRANCH       Git branch or release selector.
  -AppName NAME         Application name.
  -ChatUsername NAME    Initial chat username.
  -ChatPassword VALUE   Chat password; prefer METIS_AI_CHAT_PASSWORD.
  -McpToken VALUE       MCP bearer token; prefer METIS_AI_MCP_TOKEN.
  -CursorApiKey VALUE   Cursor API key; prefer CURSOR_API_KEY.
  -Port NUMBER          Web port.
  -McpPort NUMBER       MCP port.
  -PublicUrl URL        Public MCP URL.
  -ServiceName NAME     Scheduled task name.
  -EnableService        Register the worker as a scheduled task.
  -Start                Start the web app after installation.
  -SkipBuild            Do not run the production build.

Examples:
  .\install.ps1
  .\install.ps1 -NonInteractive -Yes -InstallDir C:\Apps\MetisAI -EnableService
  .\install.ps1 -DryRun -Json -InstallDir C:\Apps\MetisAI
"@ | Write-Host
}

function Read-Secret([string]$Prompt) {
  $secure = Read-Host "$Prompt" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Read-Default([string]$Prompt, [string]$Default) {
  $value = Read-Host "$Prompt [$Default]"
  if ($value) { return $value }
  return $Default
}

function Select-Option([string]$Prompt, [string[]]$Options) {
  $selected = 0
  do {
    Clear-Host
    Write-Host $Prompt
    Write-Host ""
    for ($index = 0; $index -lt $Options.Count; $index++) {
      $prefix = if ($index -eq $selected) { "> " } else { "  " }
      Write-Host "$prefix$($Options[$index])"
    }
    $key = [Console]::ReadKey($true)
    switch ($key.Key) {
      "UpArrow" { $selected = ($selected - 1 + $Options.Count) % $Options.Count }
      "DownArrow" { $selected = ($selected + 1) % $Options.Count }
    }
  } while ($key.Key -ne "Enter")
  return $Options[$selected]
}

function Interactive-Setup {
  if ($NonInteractive) { return }
  if ([Console]::IsInputRedirected) { Fail "stdin is redirected; use -NonInteractive with explicit parameters" }
  $script:InstallDir = Read-Default "Install directory" $InstallDir
  $script:DataDir = Read-Default "Data directory" $DataDir
  $script:AgentCwd = Read-Default "Agent workspace" $AgentCwd
  $script:Port = [int](Read-Default "Web port" "$Port")
  $script:McpPort = [int](Read-Default "MCP port" "$McpPort")
  $script:AppName = Read-Default "Application name" $AppName
  $script:ChatUsername = Read-Default "Chat username" $ChatUsername
  if (-not $ChatPassword) { $script:ChatPassword = Read-Secret "Chat password (empty generates one)" }
  if (-not $Source -or $Source -eq "github") { $script:Source = Read-Default "Source (github, archive URL, or local directory)" $Source }
  if ((Select-Option "Worker service setup" @("No service", "Register scheduled task")) -eq "Register scheduled task") {
    $script:EnableService = $true
  }
}

function Validate-Options {
  if (-not [IO.Path]::IsPathFullyQualified($InstallDir)) { Fail "-InstallDir must be an absolute path" }
  if (-not [IO.Path]::IsPathFullyQualified($DataDir)) { Fail "-DataDir must be an absolute path" }
  if (-not [IO.Path]::IsPathFullyQualified($AgentCwd)) { Fail "-AgentCwd must be an absolute path" }
  if ($Port -lt 1 -or $Port -gt 65535) { Fail "-Port must be between 1 and 65535" }
  if ($McpPort -lt 1 -or $McpPort -gt 65535) { Fail "-McpPort must be between 1 and 65535" }
  if ($ServiceName -notmatch "^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$") { Fail "invalid -ServiceName" }
}

function Ensure-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    Fail "Node.js 20+ and npm are required. Install OpenJS.NodeJS.LTS with winget, then rerun this installer."
  }
  $major = [int]((node -p "process.versions.node.split('.')[0]") -replace "\D", "")
  if ($major -lt 20) { Fail "Node.js 20 or newer is required (found $major)" }
}

function Confirm-Existing {
  if (-not (Test-Path $InstallDir)) { return }
  $items = Get-ChildItem -Force $InstallDir -ErrorAction SilentlyContinue
  if (-not $items) { return }
  if ($Yes) { return }
  if ($NonInteractive) { Fail "$InstallDir is not empty; pass -Yes to allow an update" }
  $answer = Read-Default "$InstallDir is not empty. Continue and overlay files? (y/N)" "N"
  if ($answer.ToLowerInvariant() -notin @("y", "yes")) { Fail "installation cancelled" }
}

function Get-Source {
  $temp = Join-Path ([IO.Path]::GetTempPath()) ("metis-ai-" + [Guid]::NewGuid().ToString("N"))
  $sourceDir = Join-Path $temp "source"
  New-Item -ItemType Directory -Force -Path $sourceDir | Out-Null
  if ($Source -eq "github") {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($gh) {
      & gh auth status 2>$null
      if ($LASTEXITCODE -eq 0) {
        & gh repo clone $Repository $sourceDir -- --branch $Version --depth 1
      }
    }
    if (-not (Test-Path (Join-Path $sourceDir "package.json"))) {
      if (-not $GitHubToken) {
        if ($NonInteractive) { Fail "private GitHub source requires GITHUB_TOKEN or authenticated gh" }
        $script:GitHubToken = Read-Secret "GitHub token for $Repository (read-only)"
      }
      if (-not $GitHubToken) { Fail "GitHub token is required" }
      $archive = Join-Path $temp "source.zip"
      Invoke-WebRequest -Headers @{ Authorization = "Bearer $GitHubToken" } `
        -Uri "https://github.com/$Repository/archive/refs/heads/$Version.zip" -OutFile $archive
      $extract = Join-Path $temp "extract"
      Expand-Archive -Path $archive -DestinationPath $extract
      $root = Get-ChildItem -Directory $extract | Select-Object -First 1
      Copy-Item -Path (Join-Path $root.FullName "*") -Destination $sourceDir -Recurse -Force
    }
  } elseif ($Source -match "^https?://") {
    $archive = Join-Path $temp "source.zip"
    Invoke-WebRequest -Uri $Source -OutFile $archive
    $extract = Join-Path $temp "extract"
    New-Item -ItemType Directory -Force -Path $extract | Out-Null
    if ($Source.ToLowerInvariant().EndsWith(".zip")) {
      Expand-Archive -Path $archive -DestinationPath $extract
    } else {
      tar -xzf $archive -C $extract
    }
    $root = Get-ChildItem -Directory $extract | Select-Object -First 1
    Copy-Item -Path (Join-Path $root.FullName "*") -Destination $sourceDir -Recurse -Force
  } else {
    if (-not (Test-Path (Join-Path $Source "package.json"))) { Fail "-Source must be github, an archive URL, or a directory containing package.json" }
    Copy-Item -Path (Join-Path $Source "*") -Destination $sourceDir -Recurse -Force
  }
  if (-not (Test-Path (Join-Path $sourceDir "package.json"))) { Fail "source does not contain package.json" }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -Path (Join-Path $sourceDir "*") -Destination $InstallDir -Recurse -Force
  Remove-Item -Path $temp -Recurse -Force
}

function New-Secret {
  return -join ((1..64) | ForEach-Object { "0123456789abcdef"[(Get-Random -Maximum 16)] })
}

function Invoke-Step([string]$FilePath, [string[]]$Arguments) {
  if ($Json) {
    & $FilePath @Arguments *> $null
  } else {
    & $FilePath @Arguments
  }
  if ($LASTEXITCODE -ne 0) { Fail "$FilePath failed with exit code $LASTEXITCODE" }
}

function Write-Environment {
  if ((Test-Path (Join-Path $InstallDir ".env")) -and -not $Yes) {
    if ($NonInteractive) { return }
    Write-Host "Keeping existing $InstallDir\.env"
    return
  }
  if (-not $ChatPassword) { $script:ChatPassword = New-Secret }
  if (-not $McpToken) { $script:McpToken = New-Secret }
  $content = @"
APP_NAME=$AppName
APP_DESCRIPTION=A private, configurable AI agent workspace.
PORT=$Port
CHAT_USERNAME=$ChatUsername
CHAT_PASSWORD=$ChatPassword
CHAT_DATA_DIR=$DataDir
AGENT_CWD=$AgentCwd
AI_CHAT_ROOT=$InstallDir
AI_CHAT_MCP_STATE_DIR=$DataDir\mcp-state
AI_CHAT_INTERNAL_URL=http://127.0.0.1:$Port/api/internal/mcp-question
MCP_PORT=$McpPort
MCP_PUBLIC_URL=$(if ($PublicUrl) { $PublicUrl } else { "http://127.0.0.1:$McpPort" })
MCP_BEARER_TOKEN=$McpToken
MCP_ALLOW_REMOTE_ADMIN=false
MCP_ENABLE_REMOTE_SERVERS=false
MCP_ENABLE_OPTIONAL_SERVERS=false
$(if ($CursorApiKey) { "CURSOR_API_KEY=$CursorApiKey" })
"@
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Set-Content -Path (Join-Path $InstallDir ".env") -Value $content -Encoding UTF8
}

function Install-Dependencies {
  Push-Location $InstallDir
  try {
    if ((Test-Path "pnpm-lock.yaml") -and (Get-Command corepack -ErrorAction SilentlyContinue)) {
      Invoke-Step "corepack" @("pnpm", "install", "--frozen-lockfile")
      if (-not $SkipBuild) { Invoke-Step "corepack" @("pnpm", "run", "build") }
    } else {
      Invoke-Step "npm" @("install")
      if (-not $SkipBuild) { Invoke-Step "npm" @("run", "build") }
    }
  } finally { Pop-Location }
}

function Install-Service {
  if (-not $EnableService) { return }
  if ($InstallDir -match "\s") { Fail "-InstallDir cannot contain spaces when -EnableService is used" }
  if ($DryRun) { Write-Host "Would register scheduled task $ServiceName"; return }
  $envFile = Join-Path $InstallDir ".env"
  $tsx = Join-Path $InstallDir "node_modules\tsx\dist\cli.mjs"
  $worker = Join-Path $InstallDir "worker.ts"
  $arguments = "--env-file=`"$envFile`" `"$tsx`" `"$worker`""
  $action = New-ScheduledTaskAction -Execute "node.exe" -Argument $arguments -WorkingDirectory $InstallDir
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
  Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $ServiceName
}

function Emit-Result([string]$Status) {
  $result = [ordered]@{
    status = $Status
    installDir = $InstallDir
    dataDir = $DataDir
    port = $Port
    mcpPort = $McpPort
    service = $ServiceName
  }
  if ($Json) { $result | ConvertTo-Json -Compress | Write-Output }
  else {
    Write-Host "status: $Status"
    Write-Host "install_dir: $InstallDir"
    Write-Host "data_dir: $DataDir"
    Write-Host "web_url: http://127.0.0.1:$Port"
    Write-Host "mcp_url: $(if ($PublicUrl) { $PublicUrl } else { "http://127.0.0.1:$McpPort" })"
    Write-Host "service: $ServiceName"
    Write-Host "Start the web app with: Set-Location '$InstallDir'; npm run start"
  }
}

if ($args -contains "-h" -or $args -contains "--help") { Show-Help; exit 0 }
Interactive-Setup
Validate-Options
Ensure-Node
Confirm-Existing
if ($DryRun) { Emit-Result "dry-run"; exit 0 }
Get-Source
Write-Environment
Install-Dependencies
Install-Service
Emit-Result "installed"
if ($Start) {
  Set-Location $InstallDir
  npm run start
}
