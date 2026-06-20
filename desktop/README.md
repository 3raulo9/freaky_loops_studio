# Freaky Loops Studio — Desktop shell

Native Windows desktop wrapper for the Vue DAW: a C#/.NET 10 WPF host that renders
the existing Vue UI in WebView2, exchanges control messages with it, and hosts
native audio + live VST2 plugins.

> For the full project overview (web + desktop, features, architecture, IPC
> reference), see the [root README](../README.md). This file covers the desktop
> build specifics only.

## Status
- WebView2 shell + IPC ping/pong handshake: working.
- Native test-tone via the audio engine: working.
- **VST2 (.dll) hosting confirmed with a real plugin** — load `.dll` → MIDI
  note on/off → audio out, heard. Plugin editors open as an owned overlay window.

The native engine and the DSP port of the in-app synths are still in progress.
See the project memory note `native-desktop-pivot` for the full roadmap.

## Prerequisites
- **.NET 10 SDK** — https://aka.ms/dotnet/download
- **WebView2 Runtime** — ships with Windows 11

## Run — dev (hot reload)
The DEBUG build points WebView2 at the Vite dev server.

1. Repo root:        `npm run dev`        # Vite on http://localhost:5173
2. Another terminal: `dotnet run --project desktop/Shell`

On a successful handshake the title bar changes to **"… host connected ✓"**, and
the WebView DevTools console (right-click → Inspect) logs `[ipc] host round-trip OK`.

## Run — prod (bundled)
The RELEASE build serves the built Vue app from a virtual host (`app.local`).
MSBuild copies repo-root `/dist` into the app's `wwwroot` automatically.

1. Repo root: `npm run build`              # emits /dist
2. `dotnet run --project desktop/Shell -c Release`

## Publish
A self-contained build lives under `publish/` (zipped as `FreakyLoopsStudio.zip`).
Rebuild it with `npm run build` then `dotnet publish desktop/Shell -c Release`.

## Bitness
Built **x86** to host 32-bit VST2 `.dll` plugins (e.g. Delay Lama) in-process. A
process can only load plugins of its own bitness; switch to x64 (or add a
bit-bridge helper process) for 64-bit plugins. VST.NET2-Host errors on AnyCPU.

## Layout
```
Shell/
  MainWindow.*        window + WebView2 + dev/prod navigation + IPC dispatch
  App.*               WPF application entry
  VstEditorWindow.cs  borderless owned overlay for plugin UIs
  Ipc/
    IpcMessage.cs     wire format (type + loose payload)
    IpcBridge.cs      JSON-over-postMessage channel (control only)
  Audio/
    AudioEngine.cs    NAudio output (test tone now; full engine later)
    VstHost.cs        VST2 .dll load + MIDI + audio pull
    HostStub.cs       VST.NET2 host command stub
    Log.cs            file logger → %TEMP%\freakyloops.log
```

On the Vue side the matching helper is `src/desktop/ipc.js`. In a plain browser
(no WebView2) every bridge call is a safe no-op, so the web build is unaffected.
