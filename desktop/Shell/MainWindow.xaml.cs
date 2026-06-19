using System.IO;
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
    private readonly VstHost _vst = new();
    private DispatcherTimer? _vstMeter;
    private VstEditorWindow? _editor;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    protected override void OnClosed(EventArgs e)
    {
        CloseEditor();
        _vstMeter?.Stop();
        _audio.Dispose();
        _vst.Dispose();
        base.OnClosed(e);
    }

    // Tell the UI a plugin loaded, with the diagnostics we need to debug silence.
    private void ReportVstLoaded(string name, string path)
    {
        EnsureMeter();
        _ipc!.Send(new IpcMessage("vstLoaded", new
        {
            name,
            path,
            inputs = _vst.AudioInputCount,
            outputs = _vst.AudioOutputCount,
            canReplacing = _vst.CanReplacing,
            isSynth = _vst.IsSynth,
        }));
    }

    // Poll the plugin's output peak ~3x/sec and report it when there's signal,
    // so we can see whether the plugin is actually producing audio.
    private void EnsureMeter()
    {
        if (_vstMeter != null) return;
        _vstMeter = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _vstMeter.Tick += (_, _) =>
        {
            float peak = _vst.ReadPeakReset();
            if (peak > 0.0001f)
            {
                Log.Write($"peak {peak:F4}");
                _ipc?.Send(new IpcMessage("vstPeak", new { peak = Math.Round(peak, 4) }));
            }
        };
        _vstMeter.Start();
    }

    // Toggle the loaded plugin's editor, embedded as a child of this window.
    private void OpenVstEditor()
    {
        if (_editor != null) { CloseEditor(); return; }   // clicking the name again closes it
        Log.Write($"OpenVstEditor: plugin={_vst.PluginName ?? "<none>"} hasEditor={_vst.HasEditor}");
        if (_vst.PluginName == null)
        {
            _ipc?.Send(new IpcMessage("vstError", new { message = "No plugin loaded." }));
            return;
        }
        if (!_vst.HasEditor)
        {
            _ipc?.Send(new IpcMessage("vstError", new { message = $"{_vst.PluginName} has no custom UI." }));
            return;
        }
        _editor = new VstEditorWindow(_vst);
        _editor.RequestClose += CloseEditor;
        System.Windows.Point origin = PointToScreen(new System.Windows.Point(120, 90));
        _editor.ShowOver(new WindowInteropHelper(this).Handle, (int)origin.X, (int)origin.Y);
    }

    private void CloseEditor()
    {
        if (_editor == null) return;
        VstEditorWindow ed = _editor;
        _editor = null;
        try { ed.Teardown(); } catch { /* ignore */ }
    }

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

    // Phase 0a proof-of-life: the Vue side sends {type:"ping"} on load; we reply
    // with {type:"pong"} and flag success in the title bar so it's visible.
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
                string? path = msg.Payload is JsonElement le &&
                               le.TryGetProperty("path", out var pPath) &&
                               pPath.ValueKind == JsonValueKind.String
                    ? pPath.GetString()
                    : null;
                if (string.IsNullOrWhiteSpace(path))
                {
                    _ipc!.Send(new IpcMessage("vstError", new { message = "No plugin path provided." }));
                    break;
                }
                try
                {
                    CloseEditor();
                    string name = _vst.Load(path);
                    ReportVstLoaded(name, path);
                }
                catch (Exception ex)
                {
                    _ipc!.Send(new IpcMessage("vstError", new { message = ex.Message }));
                }
                break;
            }

            case "pickVst":
            {
                var dlg = new Microsoft.Win32.OpenFileDialog
                {
                    Title = "Select a VST2 plugin (.dll)",
                    Filter = "VST2 plugin (*.dll)|*.dll",
                    CheckFileExists = true,
                };
                if (dlg.ShowDialog(this) == true)
                {
                    try
                    {
                        CloseEditor();
                        string name = _vst.Load(dlg.FileName);
                        ReportVstLoaded(name, dlg.FileName);
                    }
                    catch (Exception ex)
                    {
                        _ipc!.Send(new IpcMessage("vstError", new { message = ex.Message }));
                    }
                }
                break;
            }

            case "vstNoteOn":
            {
                int pitch = 60, velocity = 100;
                if (msg.Payload is JsonElement ne)
                {
                    if (ne.TryGetProperty("pitch", out var pn) && pn.ValueKind == JsonValueKind.Number)
                        pitch = pn.GetInt32();
                    if (ne.TryGetProperty("velocity", out var vn) && vn.ValueKind == JsonValueKind.Number)
                        velocity = vn.GetInt32();
                }
                _vst.NoteOn(pitch, velocity);
                break;
            }

            case "vstNoteOff":
            {
                int pitch = 60;
                if (msg.Payload is JsonElement fe &&
                    fe.TryGetProperty("pitch", out var fp) && fp.ValueKind == JsonValueKind.Number)
                    pitch = fp.GetInt32();
                _vst.NoteOff(pitch);
                break;
            }

            case "vstUnload":
                _vst.Unload();
                break;

            case "openVstEditor":
                OpenVstEditor();
                break;
        }
    }
}
