using System.Text.Json;
using System.Windows.Forms;
using FreakyLoops.Shell;         // VstEditorWindow
using FreakyLoops.Shell.Audio;   // VstHost, Log

namespace FreakyLoops.VstBridge;

// x86 helper process that hosts ONE 32-bit VST2 plugin on behalf of the 64-bit
// main app (which can't load a 32-bit .dll in-process). Protocol: control comes
// in over stdin as one JSON object per line ({"t":"noteOn",...}); status goes
// out over stdout the same way ({"t":"loaded",...}). Audio is played by this
// process directly via the shared VstHost — parity with the in-process host.
internal static class Program
{
    private static readonly VstHost Vst = new();
    private static MarshalForm _pump = null!;
    private static VstEditorWindow? _editor;
    private static IntPtr _ownerHwnd;   // main-app window to own the editor to (cross-process)

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            WriteOut(new { t = "error", message = "No plugin path given to bridge." });
            return 2;
        }
        string path = args[0];
        if (args.Length >= 2 && long.TryParse(args[1], out long owner) && owner != 0)
            _ownerHwnd = new IntPtr(owner);

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // Route UI-thread exceptions to a handler instead of killing the process,
        // and log everything — a misbehaving plugin editor must not silently take
        // the bridge (and thus its audio) down.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) =>
        {
            Log.Write("[bridge] UI-thread exception: " + e.Exception);
            WriteOut(new { t = "error", message = "Plugin UI error: " + e.Exception.Message });
        };
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            Log.Write("[bridge] FATAL: " + (e.ExceptionObject as Exception));

        _pump = new MarshalForm();
        _ = _pump.Handle;   // force handle creation (the Form stays invisible) so
                            // BeginInvoke has a real window to post to

        try
        {
            string name = Vst.Load(path);
            WriteOut(new
            {
                t = "loaded",
                name,
                inputs = Vst.AudioInputCount,
                outputs = Vst.AudioOutputCount,
                canReplacing = Vst.CanReplacing,
                isSynth = Vst.IsSynth,
                hasEditor = Vst.HasEditor,
            });
        }
        catch (Exception ex)
        {
            Log.Write("[bridge] load FAILED: " + ex);
            WriteOut(new { t = "error", message = $"{ex.GetType().Name}: {ex.Message}" });
            return 1;
        }

        // Report the plugin's output peak ~3x/sec so the UI meter still lights up.
        var meter = new System.Windows.Forms.Timer { Interval = 300 };
        meter.Tick += (_, _) =>
        {
            float p = Vst.ReadPeakReset();
            if (p > 0.0001f) WriteOut(new { t = "peak", peak = Math.Round(p, 4) });
        };
        meter.Start();

        // Read control lines on a background thread; marshal UI ops to the pump.
        var reader = new Thread(ReadLoop) { IsBackground = true };
        reader.Start();

        Application.Run(new ApplicationContext());   // pump; ends on Application.Exit()

        try { Vst.Dispose(); } catch { /* best effort */ }
        return 0;
    }

    private static void ReadLoop()
    {
        try
        {
            string? line;
            while ((line = Console.In.ReadLine()) != null)
                if (line.Length > 0) Dispatch(line);
        }
        catch { /* stdin closed */ }
        Quit();   // parent closed our stdin → shut down
    }

    private static void Dispatch(string json)
    {
        JsonElement m;
        try { m = JsonSerializer.Deserialize<JsonElement>(json); }
        catch { return; }
        if (!m.TryGetProperty("t", out var tEl)) return;

        switch (tEl.GetString())
        {
            case "noteOn":
                Vst.NoteOn(GetInt(m, "pitch", 60), GetInt(m, "vel", 100));
                break;
            case "noteOff":
                Vst.NoteOff(GetInt(m, "pitch", 60));
                break;
            case "editor":
                bool open = m.TryGetProperty("open", out var oEl) && oEl.ValueKind == JsonValueKind.True;
                _pump.BeginInvoke(new Action(() => { if (open) ToggleEditor(); else CloseEditor(); }));
                break;
            case "unload":
            case "quit":
                Quit();
                break;
        }
    }

    private static void ToggleEditor()
    {
        try
        {
            if (_editor != null) { CloseEditor(); return; }   // re-clicking closes it
            if (!Vst.HasEditor)
            {
                WriteOut(new { t = "error", message = "Plugin has no custom UI." });
                return;
            }
            _editor = new VstEditorWindow(Vst);
            _editor.RequestClose += CloseEditor;
            // Own the editor to the main app window (cross-process) so it floats
            // above the maximized app, not behind it; fall back to the pump.
            IntPtr owner = _ownerHwnd != IntPtr.Zero ? _ownerHwnd : _pump.Handle;
            _editor.ShowOver(owner, 160, 120);
            Log.Write($"[bridge] editor opened (owner={owner})");
        }
        catch (Exception ex)
        {
            Log.Write("[bridge] editor open FAILED: " + ex);
            WriteOut(new { t = "error", message = "Editor failed: " + ex.Message });
            _editor = null;
        }
    }

    private static void CloseEditor()
    {
        if (_editor == null) return;
        VstEditorWindow ed = _editor;
        _editor = null;
        try { ed.Teardown(); } catch { /* ignore */ }
    }

    private static void Quit()
    {
        try { _pump.BeginInvoke(new Action(() => { CloseEditor(); Application.Exit(); })); }
        catch { try { Application.Exit(); } catch { /* ignore */ } }
    }

    private static int GetInt(JsonElement m, string name, int dflt) =>
        m.TryGetProperty(name, out var e) && e.ValueKind == JsonValueKind.Number ? e.GetInt32() : dflt;

    private static void WriteOut(object o)
    {
        try { Console.Out.WriteLine(JsonSerializer.Serialize(o)); Console.Out.Flush(); }
        catch { /* parent gone */ }
    }
}

// Invisible window that owns the UI-thread message pump and serves as a
// BeginInvoke marshal target for editor ops. Never becomes visible.
internal sealed class MarshalForm : Form
{
    protected override void SetVisibleCore(bool value) => base.SetVisibleCore(false);
}
