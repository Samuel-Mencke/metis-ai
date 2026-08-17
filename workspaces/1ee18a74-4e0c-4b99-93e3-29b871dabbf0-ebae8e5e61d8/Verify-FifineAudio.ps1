$ErrorActionPreference = "Continue"
Write-Output "=== TASK ==="
schtasks /Create /TN MetisAI-FifineAudioGuard /SC ONLOGON /RL HIGHEST /F /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\ProgramData\MetisAI\Fix-FifineAudio.ps1"
schtasks /Query /TN MetisAI-FifineAudioGuard /FO LIST

Write-Output "=== DUCKING ==="
Write-Output ((Get-ItemProperty "HKCU:\Software\Microsoft\Multimedia\Audio").UserDuckingPreference)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class AudioSafe {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
  }
  public static string Dump() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    string[] rn = new string[]{"Console","Multimedia","Communications"};
    var sb = new System.Text.StringBuilder();
    for (int flow=0; flow<2; flow++) {
      for (int role=0; role<3; role++) {
        IMMDevice d;
        int hr = e.GetDefaultAudioEndpoint(flow, role, out d);
        string id = "hr="+hr;
        if (hr==0) d.GetId(out id);
        sb.AppendLine((flow==0?"R":"C")+" "+rn[role]+" "+id);
      }
    }
    return sb.ToString();
  }
}
"@
Write-Output "=== DEFAULTS ==="
[AudioSafe]::Dump()

Write-Output "=== HID FIFINE ==="
Get-PnpDevice | Where-Object { $_.InstanceId -match "VID_3142" } |
  Select-Object Status, Class, FriendlyName, InstanceId |
  Format-Table -AutoSize | Out-String -Width 220

Write-Output "=== USB POWER FIFINE ==="
Get-CimInstance -ClassName MSPower_DeviceEnable -Namespace root\wmi |
  Where-Object { $_.InstanceName -match "VID_3142" } |
  Format-Table InstanceName, Enable -AutoSize | Out-String

Write-Output "=== DISCORD KEYS ==="
$p = Join-Path $env:APPDATA "discord\settings.json"
if (Test-Path $p) {
  $j = Get-Content $p -Raw | ConvertFrom-Json
  "audioSubsystem=$($j.audioSubsystem) offloadAdmControls=$($j.offloadAdmControls)"
}

Write-Output "=== SCRIPT EXISTS ==="
Test-Path "C:\ProgramData\MetisAI\Fix-FifineAudio.ps1"
Get-Content "C:\ProgramData\MetisAI\fifine-audio-guard.log" -Tail 20
