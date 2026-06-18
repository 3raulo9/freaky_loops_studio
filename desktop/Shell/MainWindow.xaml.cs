using System.IO;
using System.Text.Json;
using System.Windows;
using FreakyLoops.Shell.Audio;
using FreakyLoops.Shell.Ipc;
using Microsoft.Web.WebView2.Core;

namespace FreakyLoops.Shell;

public partial class MainWindow : Window
{
    private IpcBridge? _ipc;
    private readonly AudioEngine _audio = new();

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    protected override void OnClosed(EventArgs e)
    {
        _audio.Dispose();
        base.OnClosed(e);
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
        }
    }
}
