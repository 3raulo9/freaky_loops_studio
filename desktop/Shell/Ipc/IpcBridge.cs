using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace FreakyLoops.Shell.Ipc;

// Thin wrapper over WebView2's postMessage channel. CONTROL MESSAGES ONLY —
// audio never travels through here; that stays inside the native engine.
public sealed class IpcBridge
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly CoreWebView2 _core;

    public event Action<IpcMessage>? MessageReceived;

    public IpcBridge(CoreWebView2 core)
    {
        _core = core;
        _core.WebMessageReceived += OnWebMessageReceived;
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // The UI posts objects via window.chrome.webview.postMessage({type,payload});
        // WebView2 surfaces them here as a JSON string.
        string json = e.WebMessageAsJson;
        if (string.IsNullOrEmpty(json)) return;

        IpcMessage? msg;
        try { msg = JsonSerializer.Deserialize<IpcMessage>(json, JsonOpts); }
        catch (JsonException) { return; }   // ignore malformed frames

        if (msg is not null) MessageReceived?.Invoke(msg);
    }

    public void Send(IpcMessage msg)
    {
        string json = JsonSerializer.Serialize(msg, JsonOpts);
        _core.PostWebMessageAsJson(json);
    }
}
