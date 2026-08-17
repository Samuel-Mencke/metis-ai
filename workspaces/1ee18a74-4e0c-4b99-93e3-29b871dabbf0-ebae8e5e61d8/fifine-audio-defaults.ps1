$ErrorActionPreference = "Continue"
Write-Output "admin=$(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"

$code = @"
using System;
using System.Runtime.InteropServices;
public class AudioSafe {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorCom {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    [PreserveSig] int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int a(); int b();
    [PreserveSig] int GetChannelCount(out uint pnChannelCount);
    [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    [PreserveSig] int GetMute(out bool pbMute);
  }
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)]
  struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointerValue;
  }
  [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out uint cProps);
    [PreserveSig] int GetAt(uint iProp, out PROPERTYKEY pkey);
    [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
  }
  public static string DumpDefaults() {
    var sb = new System.Text.StringBuilder();
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    string[] roleNames = new string[]{"Console","Multimedia","Communications"};
    foreach (int flow in new int[]{0,1}) {
      string flowName = flow==0?"Render":"Capture";
      for (int role=0; role<3; role++) {
        IMMDevice dev;
        int hr = enumerator.GetDefaultAudioEndpoint(flow, role, out dev);
        if (hr != 0) { sb.AppendLine(flowName+" DEFAULT "+roleNames[role]+" hr="+hr); continue; }
        string id; dev.GetId(out id);
        sb.AppendLine(flowName+" DEFAULT "+roleNames[role]+" name="+GetName(dev)+" id="+id+" "+Vol(dev));
      }
    }
    return sb.ToString();
  }
  static string GetName(IMMDevice dev) {
    try {
      IPropertyStore store;
      dev.OpenPropertyStore(0, out store);
      var key = new PROPERTYKEY();
      key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
      key.pid = 2;
      PROPVARIANT pv;
      store.GetValue(ref key, out pv);
      if (pv.vt == 31 || pv.vt == 8) return Marshal.PtrToStringUni(pv.pointerValue);
    } catch {}
    return "?";
  }
  static string Vol(IMMDevice dev) {
    try {
      Guid iid = typeof(IAudioEndpointVolume).GUID;
      object o;
      int hr = dev.Activate(ref iid, 1, IntPtr.Zero, out o);
      if (hr != 0) return "activate_hr="+hr;
      var vol = (IAudioEndpointVolume)o;
      bool mute; vol.GetMute(out mute);
      float scalar; vol.GetMasterVolumeLevelScalar(out scalar);
      return "mute="+mute+" vol="+(scalar*100).ToString("0.0")+"%";
    } catch (Exception ex) { return "vol_err="+ex.Message; }
  }
}
"@
Add-Type -TypeDefinition $code -Language CSharp
[AudioSafe]::DumpDefaults()

Write-Output "=== DISCORD ==="
$settings = Join-Path $env:APPDATA "discord\settings.json"
if (Test-Path $settings) {
  Get-Content $settings -Raw
} else { "no settings.json" }

Write-Output "=== STEAM VOICE ==="
$steam = "C:\Program Files (x86)\Steam\config"
Get-ChildItem $steam -ErrorAction SilentlyContinue | Select-Object Name | Out-String
Get-ChildItem "$env:PROGRAMFILES\obs-studio","$env:APPDATA\obs-studio" -ErrorAction SilentlyContinue | Select-Object FullName | Out-String

Write-Output "=== FIFINE SOFTWARE ==="
Get-ChildItem "C:\Program Files","C:\Program Files (x86)","$env:LOCALAPPDATA","$env:APPDATA" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match "fifine|ampligame" } | Select-Object FullName

Write-Output "=== EXCLUSIVE REG VALUES (active devices) ==="
$ids = @(
  "{2f403839-d80b-47b4-8100-22a435cf21b8}",
  "{b0d485a9-730d-4d69-9624-0b4770d87817}",
  "{f470c657-40fa-452c-97db-f12d80cfc0f5}",
  "{5c57750d-cf71-441d-8dca-d2562e09137e}"
)
foreach ($id in $ids) {
  foreach ($kind in @("Render","Capture")) {
    $path = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\$kind\$id\Properties"
    if (Test-Path $path) {
      Write-Output "--- $kind $id ---"
      Get-ItemProperty $path | Select-Object * | Out-String -Width 200
    }
  }
}
