$ErrorActionPreference = "Continue"
Write-Output "=== HOST ==="
hostname
whoami
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber | Format-List | Out-String

Write-Output "=== DUCKING REGISTRY ==="
$audioKey = "HKCU:\Software\Microsoft\Multimedia\Audio"
if (Test-Path $audioKey) {
  Get-ItemProperty $audioKey | Select-Object UserDuckingPreference, * | Format-List | Out-String
} else {
  Write-Output "Audio key missing"
}

Write-Output "=== SOUND DEVICES CIM ==="
Get-CimInstance Win32_SoundDevice | Select-Object Name, Status, Manufacturer, PNPDeviceID | Format-List | Out-String

Write-Output "=== DEFAULT AUDIO (Win32_Sound / MMDevices names) ==="
$mm = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio"
foreach ($kind in @("Render", "Capture")) {
  Write-Output "--- $kind ---"
  $base = Join-Path $mm $kind
  if (-not (Test-Path $base)) { continue }
  Get-ChildItem $base | ForEach-Object {
    $guid = $_.PSChildName
    $props = Join-Path $_.PSPath "Properties"
    $name = $null
    $desc = $null
    try {
      $p = Get-ItemProperty $props -ErrorAction SilentlyContinue
      # {a45c254e-df1c-4efd-8020-67d146a850e0},2 = DeviceDesc
      # {b3f8fa53-0004-438e-9003-51a46e139bfc},6 = FriendlyName sometimes
    } catch {}
    $devdesc = (Get-ItemProperty $props -Name "{a45c254e-df1c-4efd-8020-67d146a850e0},2" -ErrorAction SilentlyContinue)."{a45c254e-df1c-4efd-8020-67d146a850e0},2"
    $friendly = (Get-ItemProperty $props -Name "{b3f8fa53-0004-438e-9003-51a46e139bfc},6" -ErrorAction SilentlyContinue)."{b3f8fa53-0004-438e-9003-51a46e139bfc},6"
    $state = (Get-ItemProperty $_.PSPath -Name DeviceState -ErrorAction SilentlyContinue).DeviceState
    $role = ""
    Write-Output ("GUID={0} State={1} Desc={2} Friendly={3}" -f $guid, $state, $devdesc, $friendly)
    $exAllow = (Get-ItemProperty $props -Name "{b7edc6fe-40b8-4db8-a0f5-4e3e8c56c89e},7" -ErrorAction SilentlyContinue)."{b7edc6fe-40b8-4db8-a0f5-4e3e8c56c89e},7"
    $exPrio  = (Get-ItemProperty $props -Name "{b7edc6fe-40b8-4db8-a0f5-4e3e8c56c89e},8" -ErrorAction SilentlyContinue)."{b7edc6fe-40b8-4db8-a0f5-4e3e8c56c89e},8"
    if ($null -ne $exAllow -or $null -ne $exPrio) {
      Write-Output ("  ExclusiveAllow={0} ExclusivePriority={1}" -f $exAllow, $exPrio)
    }
  }
}

Write-Output "=== PNP AUDIO / FIFINE / HID ==="
Get-PnpDevice | Where-Object {
  $_.FriendlyName -match "FIFINE|Fifine|USB Audio|USB PnP|Microphone|HID|Audio"
} | Select-Object Status, Class, FriendlyName, InstanceId | Format-Table -AutoSize | Out-String -Width 220

Write-Output "=== USB POWER (audio/hid related) ==="
Get-PnpDevice -Class USB,HIDClass,MEDIA,AudioEndpoint,SoftwareDevice -ErrorAction SilentlyContinue |
  Where-Object { $_.FriendlyName -match "FIFINE|Fifine|USB Composite|USB Audio|Audio" } |
  ForEach-Object {
    Write-Output ("Device: {0} [{1}] {2}" -f $_.FriendlyName, $_.Status, $_.InstanceId)
    $power = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_PowerData -ErrorAction SilentlyContinue
  }

Write-Output "=== USB SELECTIVE SUSPEND / POWERCFG ==="
powercfg /query SCHEME_CURRENT SUB_USB 2>&1 | Out-String
Write-Output "--- USB devices power mgmt ---"
Get-CimInstance -ClassName MSPower_DeviceEnable -Namespace root\wmi -ErrorAction SilentlyContinue |
  Select-Object InstanceName, Enable | Format-Table -AutoSize | Out-String -Width 200

Write-Output "=== AUDIO-RELATED PROCESSES ==="
Get-Process | Where-Object {
  $_.Name -match "Discord|obs|Steam|Teams|Skype|voicemeeter|Nahimic|Sonic|Realtek|fifine|NVIDIA|GameBar|YourPhone|Chrome|firefox|spotify|vlc"
} | Select-Object Name, Id, CPU | Format-Table -AutoSize | Out-String

Write-Output "=== STARTUP / SERVICES AUDIO ==="
Get-CimInstance Win32_Service | Where-Object {
  $_.Name -match "Nahimic|Audio|Realtek|RtkAudio|AMD External|NVIDIA Display|Voicemeeter"
} | Select-Object Name, State, StartMode | Format-Table -AutoSize | Out-String

Write-Output "=== EVENTLOG USB / AUDIO (last 48h) ==="
$since = (Get-Date).AddHours(-48)
try {
  Get-WinEvent -FilterHashtable @{ LogName = "System"; StartTime = $since; Id = 2100,2102,1001,1003,2003,219 } -MaxEvents 30 -ErrorAction SilentlyContinue |
    Select-Object TimeCreated, Id, ProviderName, Message |
    ForEach-Object { "{0} id={1} {2} {3}" -f $_.TimeCreated, $_.Id, $_.ProviderName, (($_.Message -replace '\s+', ' ').Substring(0, [Math]::Min(180, $_.Message.Length))) }
} catch { Write-Output $_.Exception.Message }
try {
  Get-WinEvent -FilterHashtable @{ LogName = "System"; StartTime = $since; ProviderName = "Kernel-PnP","USBHUB3","UsbHub","Microsoft-Windows-Audio" } -MaxEvents 40 -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match "USB|Audio|FIFINE|microphone" } |
    Select-Object TimeCreated, Id, ProviderName, Message |
    ForEach-Object { "{0} id={1} {2} {3}" -f $_.TimeCreated, $_.Id, $_.ProviderName, (($_.Message -replace '\s+', ' ').Substring(0, [Math]::Min(180, ($_.Message | Out-String).Length))) }
} catch { Write-Output $_.Exception.Message }

Write-Output "=== CORE AUDIO ENDPOINT VOLUME (COM) ==="
$code = @"
using System;
using System.Runtime.InteropServices;
public class AudioDump {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorCom {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    [PreserveSig] int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387CEC"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out uint pcDevices);
    [PreserveSig] int Item(uint nDevice, out IMMDevice ppDevice);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int NotImpl1();
    int NotImpl2();
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
  public static string Dump() {
    var sb = new System.Text.StringBuilder();
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    DumpFlow(enumerator, 0, "Render", sb);
    DumpFlow(enumerator, 1, "Capture", sb);
    int[] roles = new int[]{0,1,2};
    string[] roleNames = new string[]{"Console","Multimedia","Communications"};
    foreach (int flow in new int[]{0,1}) {
      string flowName = flow==0?"Render":"Capture";
      foreach (int role in roles) {
        IMMDevice dev;
        int hr = enumerator.GetDefaultAudioEndpoint(flow, role, out dev);
        if (hr != 0) { sb.AppendLine(flowName+" default "+roleNames[role]+" hr="+hr); continue; }
        string id; dev.GetId(out id);
        sb.AppendLine(flowName+" DEFAULT "+roleNames[role]+" = "+id+" "+Vol(dev));
      }
    }
    return sb.ToString();
  }
  static void DumpFlow(IMMDeviceEnumerator enumerator, int flow, string name, System.Text.StringBuilder sb) {
    IMMDeviceCollection col;
    enumerator.EnumAudioEndpoints(flow, 1, out col); // DEVICE_STATE_ACTIVE=1
    uint count; col.GetCount(out count);
    sb.AppendLine("== "+name+" active count="+count);
    for (uint i=0;i<count;i++) {
      IMMDevice dev; col.Item(i, out dev);
      string id; dev.GetId(out id);
      string fname = GetName(dev);
      sb.AppendLine("  "+fname+" | "+id+" | "+Vol(dev));
    }
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
try {
  Add-Type -TypeDefinition $code -Language CSharp
  [AudioDump]::Dump()
} catch {
  Write-Output "COM dump failed: $($_.Exception.Message)"
  Write-Output $_.Exception.ToString()
}

Write-Output "=== DISCORD SETTINGS FILES ==="
$discord = Join-Path $env:APPDATA "discord"
Get-ChildItem $discord -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime | Format-Table | Out-String
$settings = Join-Path $discord "settings.json"
if (Test-Path $settings) {
  Write-Output "--- discord settings.json (audio-related keys) ---"
  try {
    $j = Get-Content $settings -Raw | ConvertFrom-Json
    $j.PSObject.Properties | Where-Object { $_.Name -match "audio|voice|input|output|attenuation|gain|echo|noise|qos|sidetone" } |
      ForEach-Object { "$($_.Name)=$($_.Value)" }
  } catch { Write-Output $_.Exception.Message }
}

Write-Output "=== STEAM / OBS / FIFINE APPS ==="
@(
  "$env:APPDATA\obs-studio",
  "$env:PROGRAMFILES\obs-studio",
  "$env:LOCALAPPDATA\FIFINE",
  "${env:ProgramFiles(x86)}\Steam"
) | ForEach-Object { if (Test-Path $_) { "EXISTS $_" } else { "missing $_" } }

Write-Output "=== DONE ==="
