# Metis AI Windows one-line installer bootstrap.
# This file is designed to be invoked with:
#   irm https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master/install.ps1 | iex
# It MUST NOT start with param() — that statement is illegal under Invoke-Expression.
# The real installer is downloaded to a temp file and invoked with -File so named
# parameters and prompts work like a normal script.

$ErrorActionPreference = "Stop"
$base = if ($env:METIS_AI_INSTALL_BASE) { $env:METIS_AI_INSTALL_BASE.TrimEnd("/") } else { "https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master" }
$dest = Join-Path ([System.IO.Path]::GetTempPath()) ("metis-ai-windows-" + [guid]::NewGuid().ToString() + ".ps1")
Invoke-WebRequest -UseBasicParsing -Uri ($base + "/install/windows.ps1") -OutFile $dest
$forward = @()
if ($args -and $args.Count -gt 0) { $forward = @($args) }
elseif ($MyInvocation.UnboundArguments -and $MyInvocation.UnboundArguments.Count -gt 0) {
  $forward = @($MyInvocation.UnboundArguments)
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dest @forward
exit $LASTEXITCODE
