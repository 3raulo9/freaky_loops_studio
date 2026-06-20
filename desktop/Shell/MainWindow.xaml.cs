using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using FreakyLoops.Shell.Audio;
using FreakyLoops.Shell.Ipc;
using Microsoft.Web.WebView2.Core;

namespace FreakyLoops.Shell;

public partial class MainWindow : Window
{
    private IpcBridge? _ipc;
    private readonly AudioEngine _audio = new();

    // One entry per VST channel in the rack. 64-bit plugins are hosted in-process
    // (InProc); 32-bit ones run in their own x86 bridge process (Bridge). Keyed by
    // the Vue channel id so many plugins of mixed bitness coexist.
    private readonly Dictionary<string, VstInstance> _vsts = new();
    private int _editorCascade;   // offsets stacked editor windows so they don't overlap exactly

    private sealed class VstInstance
    {
        public string Id = "";
        public string Path = "";
        public VstHost? InProc;          // 64-bit, in-process
        public VstBridgeClient? Bridge;  // 32-bit, out-of-process helper
        public VstEditorWindow? Editor;  // in-process editor window
        public DispatcherTimer? Meter;   // in-process peak meter
        public bool IsBridge => Bridge != null;
    }

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    protected override void OnClosed(EventArgs e)
    {
        foreach (VstInstance inst in _vsts.Values.ToList()) TeardownInstance(inst);
        _vsts.Clear();
        _audio.Dispose();
        base.OnClosed(e);
    }

    // ── Per-instance plumbing ────────────────────────────────────────────────────

    // Load a plugin into the channel `id`, routing by its real architecture:
    // 64-bit → in-process; 32-bit → x86 bit-bridge. Any plugin already on this id
    // is torn down first (replace-in-place).
    private void LoadVstPath(string id, string path)
    {
        if (_vsts.Remove(id, out VstInstance? existing)) TeardownInstance(existing);

        string arch = VstHost.PeArch(path);
        Log.Write($"loadVst id={id} arch={arch} path={path}");
        var inst = new VstInstance { Id = id, Path = path };

        if (arch == "x86")
        {
            var bridge = new VstBridgeClient();
            bridge.Loaded += b => Dispatcher.Invoke(() =>
                SendLoaded(id, b.Name, path, b.Inputs, b.Outputs, b.CanReplacing, b.IsSynth));
            bridge.Error += m => Dispatcher.Invoke(() => SendVstError(id, m));
            bridge.Peak += p => Dispatcher.Invoke(() => SendPeak(id, p));
            inst.Bridge = bridge;
            _vsts[id] = inst;
            // Pass our window handle so the helper owns its editor to the app window.
            bridge.Load(path, new WindowInteropHelper(this).Handle);
            return;
        }

        try
        {
            var host = new VstHost();
            string name = host.Load(path);
            inst.InProc = host;
            _vsts[id] = inst;
            StartMeter(inst);
            SendLoaded(id, name, path,
                host.AudioInputCount, host.AudioOutputCount, host.CanReplacing, host.IsSynth);
        }
        catch (Exception ex)
        {
            Log.Write("VST load FAILED: " + ex);
            Exception? inner = ex.InnerException;
            string detail = inner != null
                ? $"{ex.Message} ({inner.GetType().Name}: {inner.Message})"
                : ex.Message;
            SendVstError(id, $"{ex.GetType().Name}: {detail}");
        }
    }

    // Poll an in-process plugin's output peak ~3x/sec and report it (with id) when
    // there's signal, so the UI meter for that channel lights up.
    private void StartMeter(VstInstance inst)
    {
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        timer.Tick += (_, _) =>
        {
            VstHost? host = inst.InProc;
            if (host == null) return;
            float peak = host.ReadPeakReset();
            if (peak > 0.0001f) SendPeak(inst.Id, peak);
        };
        inst.Meter = timer;
        timer.Start();
    }

    // Toggle a channel's plugin editor. Bridged plugins show their editor in the
    // helper process; in-process plugins get an owned overlay over this window.
    private void ToggleEditor(string id, VstInstance inst)
    {
        if (inst.IsBridge) { inst.Bridge!.OpenEditor(); return; }

        if (inst.Editor != null) { CloseEditorInstance(inst); return; }   // re-click closes
        VstHost? host = inst.InProc;
        Log.Write($"ToggleEditor id={id} plugin={host?.PluginName ?? "<none>"} hasEditor={host?.HasEditor}");
        if (host?.PluginName == null) { SendVstError(id, "No plugin loaded."); return; }
        if (!host.HasEditor) { SendVstError(id, $"{host.PluginName} has no custom UI."); return; }

        var ed = new VstEditorWindow(host);
        ed.RequestClose += () => CloseEditorInstance(inst);
        inst.Editor = ed;
        int n = _editorCascade++ % 6;
        System.Windows.Point origin = PointToScreen(new System.Windows.Point(120 + n * 28, 90 + n * 28));
        ed.ShowOver(new WindowInteropHelper(this).Handle, (int)origin.X, (int)origin.Y);
    }

    private static void CloseEditorInstance(VstInstance inst)
    {
        if (inst.Editor == null) return;
        VstEditorWindow ed = inst.Editor;
        inst.Editor = null;
        try { ed.Teardown(); } catch { /* ignore */ }
    }

    private static void TeardownInstance(VstInstance inst)
    {
        inst.Meter?.Stop();
        inst.Meter = null;
        CloseEditorInstance(inst);
        try { inst.InProc?.Dispose(); } catch { /* ignore */ }
        inst.InProc = null;
        try { inst.Bridge?.Dispose(); } catch { /* ignore */ }
        inst.Bridge = null;
    }

    private void SendLoaded(string id, string name, string path,
        int inputs, int outputs, bool canReplacing, bool isSynth)
        => _ipc?.Send(new IpcMessage("vstLoaded",
            new { id, name, path, inputs, outputs, canReplacing, isSynth }));

    private void SendVstError(string? id, string message)
        => _ipc?.Send(new IpcMessage("vstError", new { id, message }));

    private void SendPeak(string id, double peak)
        => _ipc?.Send(new IpcMessage("vstPeak", new { id, peak = Math.Round(peak, 4) }));

    private static string NewVstId() => "vst-" + Guid.NewGuid().ToString("N")[..8];

    private static string? GetStr(JsonElement el, string name)
        => el.TryGetProperty(name, out JsonElement p) && p.ValueKind == JsonValueKind.String
            ? p.GetString() : null;

    private static int GetInt(JsonElement el, string name, int dflt)
        => el.TryGetProperty(name, out JsonElement p) && p.ValueKind == JsonValueKind.Number
            ? p.GetInt32() : dflt;

    // ── Navigation + IPC ─────────────────────────────────────────────────────────

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await WebView.EnsureCoreWebView2Async();
        CoreWebView2 core = WebView.CoreWebView2;

        _ipc = new IpcBridge(core);
        _ipc.MessageReceived += OnIpcMessage;

#if DEBUG
        // Dev: load the Vite dev server (run `npm run dev` first) for hot reload.
        core.Navigate("http://localhost:5173/");
#else
        // Prod: serve the built Vue app (copied to wwwroot) from a virtual host.
        string dist = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        core.SetVirtualHostNameToFolderMapping(
            "app.local", dist, CoreWebView2HostResourceAccessKind.Allow);
        core.Navigate("https://app.local/index.html");
#endif
    }

    private void OnIpcMessage(IpcMessage msg)
    {
        switch (msg.Type)
        {
            case "ping":
                _ipc!.Send(new IpcMessage("pong", new
                {
                    version = "0.0.2-phase0b",
                    time = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
                }));
                Dispatcher.Invoke(() => Title = "Freaky Loops Studio — host connected ✓");
                break;

            case "testTone":
                bool on = true;
                double freq = 440;
                if (msg.Payload is JsonElement el)
                {
                    if (el.TryGetProperty("on", out var pOn) &&
                        pOn.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        on = pOn.GetBoolean();
                    if (el.TryGetProperty("freq", out var pFreq) &&
                        pFreq.ValueKind == JsonValueKind.Number)
                        freq = pFreq.GetDouble();
                }
                if (on) _audio.StartTone(freq); else _audio.StopTone();
                break;

            case "loadVst":
            {
                if (msg.Payload is not JsonElement le) break;
                string? path = GetStr(le, "path");
                if (string.IsNullOrWhiteSpace(path))
                {
                    SendVstError(GetStr(le, "id"), "No plugin path provided.");
                    break;
                }
                LoadVstPath(GetStr(le, "id") ?? NewVstId(), path);
                break;
            }

            case "pickVst":
            {
                string id = (msg.Payload is JsonElement pe ? GetStr(pe, "id") : null) ?? NewVstId();
                var dlg = new Microsoft.Win32.OpenFileDialog
                {
                    Title = "Select a VST2 plugin (.dll)",
                    Filter = "VST2 plugin (*.dll)|*.dll",
                    CheckFileExists = true,
                };
                if (dlg.ShowDialog(this) == true)
                    LoadVstPath(id, dlg.FileName);
                else
                    _ipc!.Send(new IpcMessage("vstCancelled", new { id }));   // free the placeholder channel
                break;
            }

            case "vstNoteOn":
            {
                if (msg.Payload is not JsonElement ne) break;
                string? id = GetStr(ne, "id");
                if (id == null || !_vsts.TryGetValue(id, out VstInstance? inst)) break;
                int pitch = GetInt(ne, "pitch", 60), velocity = GetInt(ne, "velocity", 100);
                if (inst.IsBridge) inst.Bridge!.NoteOn(pitch, velocity);
                else inst.InProc?.NoteOn(pitch, velocity);
                break;
            }

            case "vstNoteOff":
            {
                if (msg.Payload is not JsonElement fe) break;
                string? id = GetStr(fe, "id");
                if (id == null || !_vsts.TryGetValue(id, out VstInstance? inst)) break;
                int pitch = GetInt(fe, "pitch", 60);
                if (inst.IsBridge) inst.Bridge!.NoteOff(pitch);
                else inst.InProc?.NoteOff(pitch);
                break;
            }

            case "vstUnload":
            {
                string? id = msg.Payload is JsonElement ue ? GetStr(ue, "id") : null;
                if (id != null && _vsts.Remove(id, out VstInstance? inst)) TeardownInstance(inst);
                break;
            }

            case "openVstEditor":
            {
                string? id = msg.Payload is JsonElement oe ? GetStr(oe, "id") : null;
                if (id != null && _vsts.TryGetValue(id, out VstInstance? inst)) ToggleEditor(id, inst);
                break;
            }
        }
    }
}
