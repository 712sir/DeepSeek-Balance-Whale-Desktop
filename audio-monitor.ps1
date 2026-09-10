Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public enum AudioDataFlow { Render = 0, Capture = 1, All = 2 }
public enum AudioRole { Console = 0, Multimedia = 1, Communications = 2 }

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumerator { }

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator
{
    int EnumAudioEndpoints(AudioDataFlow dataFlow, int stateMask, out object devices);
    int GetDefaultAudioEndpoint(AudioDataFlow dataFlow, AudioRole role, out IMMDevice device);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice
{
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.Interface)] out object instance);
}

[ComImport]
[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation
{
    int GetPeakValue(out float peak);
}

public static class AudioPeakReader
{
    public static float Read()
    {
        var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(
            Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
        IMMDevice device;
        var hr = enumerator.GetDefaultAudioEndpoint(AudioDataFlow.Render, AudioRole.Multimedia, out device);
        if (hr != 0 || device == null) return 0;
        var iid = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
        object instance;
        hr = device.Activate(ref iid, 23, IntPtr.Zero, out instance);
        if (hr != 0 || instance == null) return 0;
        float peak;
        ((IAudioMeterInformation)instance).GetPeakValue(out peak);
        return peak;
    }
}
"@

while ($true) {
    [float]$peak = [AudioPeakReader]::Read()
    [Console]::WriteLine((ConvertTo-Json @{ peak = [math]::Round([double]$peak, 4); ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } -Compress))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 250
}
