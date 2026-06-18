# Freaky Loops Studio — Desktop shell

Native Windows desktop wrapper for the Vue DAW: a C#/.NET WPF host that renders
the existing Vue UI in WebView2 and exchanges control messages with it.

**Phase 0a (current):** proves the shell + IPC bridge only. No audio, no VST
hosting yet. See the project memory note `native-desktop-pivot` for the full
roadmap (engine → DSP port → live VST hosting).

## Prerequisites
- **.NET 10 SDK** — https://aka.ms/dotnet/download
  (none was installed when this was scaffolded; the build needs it)
- **WebView2 Runtime** — already ships with Windows 11

## Run — dev (hot reload)
The DEBUG build points WebView2 at the Vite dev server.

1. Repo root:        `npm run dev`        # Vite on http://localhost:5173
2. Another terminal: `dotnet run --project desktop/Shell`

The DAW opens in a native window. On a successful handshake the title bar
changes to **"… host connected ✓"**, and the WebView DevTools console
(right-click → Inspect) logs `[ipc] host round-trip OK`.

## Run — prod (bundled)
The RELEASE build serves the built Vue app from a virtual host (`app.local`).

1. Repo root: `npm run build`              # emits /dist
2. `dotnet run --project desktop/Shell -c Release`

MSBuild copies `/dist` into the app's `wwwroot` automatically.

## Layout
```
Shell/
  MainWindow.*   window + WebView2 + dev/prod navigation
  App.*          WPF application entry
  Ipc/
    IpcMessage.cs  wire format (type + loose payload)
    IpcBridge.cs   JSON-over-postMessage channel (control only)
```

On the Vue side the matching helper is `src/desktop/ipc.js`, wired in from
`src/main.js` via `pingHost()`.
