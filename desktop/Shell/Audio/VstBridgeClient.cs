using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace FreakyLoops.Shell.Audio;

// Main-app side of the bit-bridge: launches the x86 helper process to host a
// 32-bit VST2 plugin this 64-bit app can't load in-process, relays control
// (notes/editor) over its stdin, and reads status from its stdout. One plugin
// per client; Load() replaces any running helper.
public sealed class VstBridgeClient : IDisposable
{
    private readonly object _gate = new();
    private Process? _proc;

    public event Action<BridgeLoaded>? Loaded;
    public event Action<string>? Error;
    public event Action<double>? Peak;

    public bool IsRunning { get { lock (_gate) return _proc is { HasExited: false }; } }

    public void Load(string pluginPath, IntPtr ownerHwnd = default)
    {
        Stop();

        string? exe = LocateBridgeExe();
        if (exe is null)
        {
            Error?.Invoke("32-bit bridge helper not found — build the VstBridge project.");
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = exe,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
        };
        psi.ArgumentList.Add(pluginPath);
        // Main-window handle so the helper can own its editor window to it (across
        // processes) — otherwise the editor opens behind the maximized app.
        psi.ArgumentList.Add(ownerHwnd.ToInt64().ToString());

        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => { if (e.Data is not null) OnLine(e.Data); };

        lock (_gate)
        {
            proc.Start();
            proc.BeginOutputReadLine();
            _proc = proc;
        }
        Log.Write($"[bridge] spawned {Path.GetFileName(exe)} for {pluginPath}");
    }

    public void NoteOn(int pitch, int velocity) => Send(new { t = "noteOn", pitch, vel = velocity });
    public void NoteOff(int pitch) => Send(new { t = "noteOff", pitch });
    public void OpenEditor() => Send(new { t = "editor", open = true });
    public void CloseEditor() => Send(new { t = "editor", open = false });

    public void Stop()
    {
        lock (_gate)
        {
            if (_proc is null) return;
            Process proc = _proc;
            _proc = null;
            try { if (!proc.HasExited) SendUnlocked(proc, new { t = "quit" }); } catch { /* ignore */ }
            try { if (!proc.WaitForExit(600)) proc.Kill(entireProcessTree: true); } catch { /* ignore */ }
            try { proc.Dispose(); } catch { /* ignore */ }
        }
    }

    public void Dispose() => Stop();

    private void Send(object o)
    {
        lock (_gate)
        {
            if (_proc is { HasExited: false } p) SendUnlocked(p, o);
        }
    }

    private static void SendUnlocked(Process proc, object o)
    {
        try
        {
            proc.StandardInput.WriteLine(JsonSerializer.Serialize(o));
            proc.StandardInput.Flush();
        }
        catch (Exception ex) { Log.Write("[bridge] send failed: " + ex.Message); }
    }

    private void OnLine(string line)
    {
        JsonElement m;
        try { m = JsonSerializer.Deserialize<JsonElement>(line); }
        catch { return; }
        if (!m.TryGetProperty("t", out var tEl)) return;

        switch (tEl.GetString())
        {
            case "loaded":
                Loaded?.Invoke(new BridgeLoaded(
                    Str(m, "name", "VST"),
                    Int(m, "inputs"), Int(m, "outputs"),
                    Bool(m, "canReplacing"), Bool(m, "isSynth")));
                break;
            case "error":
                Error?.Invoke(Str(m, "message", "Bridge error."));
                break;
            case "peak":
                if (m.TryGetProperty("peak", out var pe) && pe.ValueKind == JsonValueKind.Number)
                    Peak?.Invoke(pe.GetDouble());
                break;
        }
    }

    private static string Str(JsonElement m, string n, string d) =>
        m.TryGetProperty(n, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString()! : d;
    private static int Int(JsonElement m, string n) =>
        m.TryGetProperty(n, out var e) && e.ValueKind == JsonValueKind.Number ? e.GetInt32() : 0;
    private static bool Bool(JsonElement m, string n) =>
        m.TryGetProperty(n, out var e) && e.ValueKind == JsonValueKind.True;

    // The helper is staged next to the app under bridge\; fall back to the
    // sibling project output when running straight from the build tree.
    private static string? LocateBridgeExe()
    {
        string baseDir = AppContext.BaseDirectory;
#if DEBUG
        const string cfg = "Debug";
#else
        const string cfg = "Release";
#endif
        string[] candidates =
        {
            Path.Combine(baseDir, "bridge", "FreakyLoopsVstBridge.exe"),
            Path.Combine(baseDir, "..", "..", "..", "..", "VstBridge",
                "bin", "x86", cfg, "net10.0-windows", "FreakyLoopsVstBridge.exe"),
        };
        foreach (string c in candidates)
        {
            string full = Path.GetFullPath(c);
            if (File.Exists(full)) return full;
        }
        return null;
    }
}

public sealed record BridgeLoaded(string Name, int Inputs, int Outputs, bool CanReplacing, bool IsSynth);
