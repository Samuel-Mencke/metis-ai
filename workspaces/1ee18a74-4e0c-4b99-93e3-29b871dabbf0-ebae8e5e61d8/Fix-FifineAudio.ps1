# Permanent Fifine / Windows audio guard for DESKTOP-PD4H5G9
$ErrorActionPreference = "Continue"
$LogDir = "C:\ProgramData\MetisAI"
$Log = Join-Path $LogDir "fifine-audio-guard.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log($msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $Log -Value $line
  Write-Output $line
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
public class PolicyConfigClient {}

[Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr ppFormat);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr ppFormat);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pEndpointFormat, IntPtr mixFormat);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr pmftDefault, IntPtr pmftMin);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pmft);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bFxStore, IntPtr key, IntPtr pv);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bFxStore, IntPtr key, IntPtr pv);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bVisible);
}

[Guid("568b9108-7b07-4f1d-a232-6582c6f18ee7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPolicyConfigWin7 {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr ppFormat);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr ppFormat);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pEndpointFormat, IntPtr mixFormat);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr pmftDefault, IntPtr pmftMin);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pmft);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bFxStore, IntPtr key, IntPtr pv);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bFxStore, IntPtr key, IntPtr pv);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bVisible);
}

public static class AudioPolicy {
  public static int SetDefault(string id, int role) {
    object c = new PolicyConfigClient();
    try {
      var p = (IPolicyConfig)c;
      return p.SetDefaultEndpoint(id, role);
    } catch {
      var p7 = (IPolicyConfigWin7)c;
      return p7.SetDefaultEndpoint(id, role);
    }
  }
  public static int SetVisible(string id, bool visible) {
    object c = new PolicyConfigClient();
    int v = visible ? 1 : 0;
    try {
      var p = (IPolicyConfig)c;
      return p.SetEndpointVisibility(id, v);
    } catch {
      var p7 = (IPolicyConfigWin7)c;
      return p7.SetEndpointVisibility(id, v);
    }
  }
  public static int SetShared(string id) {
    object c = new PolicyConfigClient();
    IntPtr pMode = Marshal.AllocHGlobal(4);
    Marshal.WriteInt32(pMode, 0);
    try {
      try {
        var p = (IPolicyConfig)c;
        return p.SetShareMode(id, pMode);
      } catch {
        var p7 = (IPolicyConfigWin7)c;
        return p7.SetShareMode(id, pMode);
      }
    } finally {
      Marshal.FreeHGlobal(pMode);
    }
  }
}
"@

$RenderMonitor = "{0.0.0.00000000}.{b0d485a9-730d-4d69-9624-0b4770d87817}"
$RenderFifine  = "{0.0.0.00000000}.{2f403839-d80b-47b4-8100-22a435cf21b8}"
$CaptureFifine = "{0.0.1.00000000}.{f470c657-40fa-452c-97db-f12d80cfc0f5}"

Write-Log "=== apply start ==="

New-Item -Path "HKCU:\Software\Microsoft\Multimedia\Audio" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Multimedia\Audio" -Name "UserDuckingPreference" -Type DWord -Value 3
Write-Log "UserDuckingPreference=3"

foreach ($role in 0,1,2) {
  $hr = [AudioPolicy]::SetDefault($RenderMonitor, $role)
  Write-Log ("SetDefault RENDER monitor role={0} hr={1}" -f $role, $hr)
}
foreach ($role in 0,1,2) {
  $hr = [AudioPolicy]::SetDefault($CaptureFifine, $role)
  Write-Log ("SetDefault CAPTURE fifine role={0} hr={1}" -f $role, $hr)
}

$hrHide = [AudioPolicy]::SetVisible($RenderFifine, $false)
Write-Log "Hide Fifine Speakers hr=$hrHide"

foreach ($id in @($RenderMonitor, $CaptureFifine, $RenderFifine)) {
  try {
    $hr = [AudioPolicy]::SetShared($id)
    Write-Log "SetShared $id hr=$hr"
  } catch {
    Write-Log "SetShared $id ERR $($_.Exception.Message)"
  }
}

try {
  $scheme = (powercfg /GETACTIVESCHEME) | Select-String -Pattern '[0-9a-fA-F-]{36}' | ForEach-Object { $_.Matches[0].Value }
  if ($scheme) {
    powercfg /SETACVALUEINDEX $scheme 2a737441-1930-4402-8d77-b2beb39e50e0 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 | Out-Null
    powercfg /SETDCVALUEINDEX $scheme 2a737441-1930-4402-8d77-b2beb39e50e0 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 | Out-Null
    powercfg /SETACTIVE $scheme | Out-Null
    Write-Log "USB selective suspend disabled scheme=$scheme"
  }
} catch { Write-Log "powercfg ERR $($_.Exception.Message)" }

Get-CimInstance -ClassName MSPower_DeviceEnable -Namespace root\wmi -ErrorAction SilentlyContinue |
  Where-Object { $_.InstanceName -match "VID_3142" } |
  ForEach-Object {
    try {
      $_.Enable = $false
      Set-CimInstance -CimInstance $_
      Write-Log "USB power off $($_.InstanceName)"
    } catch { Write-Log "USB power ERR $($_.InstanceName) $($_.Exception.Message)" }
  }

Get-PnpDevice -ErrorAction SilentlyContinue |
  Where-Object { $_.InstanceId -match "VID_3142&PID_A010&MI_03" -and $_.Status -eq "OK" } |
  ForEach-Object {
    try {
      Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false
      Write-Log "Disabled Fifine HID $($_.InstanceId)"
    } catch { Write-Log "HID disable ERR $($_.Exception.Message)" }
  }

$discordSettings = Join-Path $env:APPDATA "discord\settings.json"
if (Test-Path $discordSettings) {
  try {
    $j = Get-Content $discordSettings -Raw | ConvertFrom-Json
    $j | Add-Member -NotePropertyName audioSubsystem -NotePropertyValue "legacy" -Force
    $j | Add-Member -NotePropertyName offloadAdmControls -NotePropertyValue $false -Force
    $j | ConvertTo-Json -Depth 20 | Set-Content $discordSettings -Encoding UTF8
    Write-Log "Patched Discord settings.json"
  } catch { Write-Log "Discord patch ERR $($_.Exception.Message)" }
}

$obsIni = Join-Path $env:APPDATA "obs-studio\user.ini"
if (Test-Path $obsIni) {
  try {
    $txt = Get-Content $obsIni -Raw
    $txt2 = $txt -replace "WASAPIExclusive=\d","WASAPIExclusive=0"
    if ($txt2 -ne $txt) {
      Set-Content $obsIni -Value $txt2 -Encoding UTF8
      Write-Log "OBS WASAPIExclusive=0"
    } else {
      Write-Log "OBS ini present, no WASAPIExclusive key"
    }
  } catch { Write-Log "OBS ERR $($_.Exception.Message)" }
}

Write-Log "=== apply done ==="
