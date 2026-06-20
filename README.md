# Freaky Loops Studio

A DAW that synthesizes every sound from scratch — no samples, no audio files. It
runs two ways from one codebase:

- **Web app** — Vue 3 + the Web Audio API. Everything runs client-side in the
  browser; there's no backend.
- **Native desktop app** *(Windows, in progress)* — a C#/.NET 10 WPF shell that
  renders the same Vue UI inside WebView2 and adds a native audio engine with
  **live VST2 plugin hosting**, which a browser sandbox can't do.

The Vue UI is shared between both. In the browser the desktop bridge is a safe
no-op, so the web build keeps working unchanged.

---

## Repository layout

```
.
├── src/                 Vue 3 frontend (shared by web + desktop)
│   ├── audio/           Web Audio synthesis, effects, export
│   ├── components/      Channel Rack, Piano Roll, Playlist, Mixer, synth UIs
│   ├── midi/            MIDI import/parse + look-ahead scheduler
│   ├── store/           studio.js — the project model / single source of truth
│   ├── desktop/         ipc.js — bridge to the native host (no-op in browser)
│   └── themes.js        UI color schemes
├── desktop/             .NET 10 WPF desktop shell
│   └── Shell/           WebView2 host, IPC bridge, native audio + VST host
├── public/              static assets
├── dist/                Vue build output (also bundled into the desktop app)
└── index.html           Vite entry
```

---

## The Vue frontend

Built with Vue 3 (Composition API) and Vite. All synthesis, scheduling, effect
processing, and offline rendering happen in the Web Audio API — no external
audio libraries, no backend.

### Channel Rack
The core of the studio. Channels come in two types: **drum** and **melodic**.
Each channel has its own color, mute/solo controls, volume fader, and a mixer
routing selector. Patterns are named and navigable — you can duplicate, rename,
delete, or split a pattern by channel. Each channel's steps open into a bottom
piano roll panel that you can resize by dragging.

**Drum channels** are synthesized from scratch. The Kick is a sine wave with a
falling pitch envelope and optional waveshaper crunch. The Snare is white noise
through a bandpass filter plus a triangle wave body. The Hi-Hat uses six square
oscillators tuned to the TR-909's inharmonic cymbal ratios. The Clash is based on
the TR-808 crash, with ring modulation and a noise shimmer layer. Each drum
channel supports plug-in style **effect modules** — Distortion, Delay, Reverb,
Compressor, Chorus, or Phaser per channel.

**Melodic channels** use a wavetable oscillator with selectable waveshape
(Sawtooth, Square, Sine, Triangle) and can be sequenced in the step grid or the
piano roll. Notes are entered by mouse or played live from the keyboard (Z–M and
Q–U rows, with `[` / `]` to shift octave). A custom Serum-style synth, an FM
engine, the Subterra bass plugin, a GM/soundfont synth, and a sampler/chop
channel are also available.

### Piano Roll
A full piano roll editor for melodic channels. Tools: draw, paint, select (box or
click), mute, and erase. Notes support velocity (shown as bottom fill), can be
multi-selected and moved by drag or nudged with arrow keys. Snap grid goes from
1/64 down to 1 bar. Ghost notes overlay other channels in the background so you
can compose in context. A channel picker dropdown switches target channels
without closing the panel.

### Playlist
An arrangement view for building full songs. Drag pattern clips and automation
clips onto tracks across a scrollable timeline. Supports draw, select, and erase
tools, a zoom slider, auto-scroll during playback, a minimap, markers, and
multiple playlist and automation tracks. A **PLAYLIST** toggle switches the
transport between pattern-loop mode and song-arrangement mode.

### Mixer
Eight named insert tracks plus a master bus, all with per-track volume faders,
mute, solo, and dB readout. Each rack channel routes to a mixer insert via a
dropdown; routing is visualized as colored dots on each strip.

### Automation
Automation clips can be drawn in the Playlist and tied to any automatable
parameter. The Playlist distinguishes pattern clips from automation clips via a
focus-mode toggle.

### Transport & global controls
- **BPM** — 40 to 220, slider-controlled
- **Swing** — nudges odd 16th notes late for groove
- **Steps** — 8, 16, or 32 steps per pattern
- **Timecode** — click to toggle Bars:Beats:Ticks ↔ Min:Sec:Ms
- **PAT / SONG mode** — loop the current pattern or play the full arrangement

### Themes & export
A theme picker modal switches the whole UI color scheme without reloading.
**EXPORT WAV** renders the composition with `OfflineAudioContext` (faster than
real time) and encodes 16-bit PCM WAV that matches exactly what you hear.

### Keyboard shortcuts
- **Z–M / Q–U** — play the selected melodic channel live
- **`[` / `]`** — shift the live-play octave down/up
- **Ctrl+Shift+7** — panic: instantly silence everything (stops the sequencer,
  releases held keys, sends all-notes-off to every synth)

### Running the web app
Requires Node.js 18+ and npm.

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # static build into dist/
npm run preview    # preview the production build
```

The build in `dist/` opens straight from the file system — no server needed.

---

## The .NET desktop app

A native Windows shell that wraps the Vue UI and moves audio out of the browser
into native code so it can host real VST plugins.

### Architecture
- **Shell** — C#/.NET 10 WPF host (`desktop/Shell`) embedding **WebView2**, which
  renders the existing Vue UI as a *control surface only*. The UI is reused, not
  rewritten.
- **IPC** — Vue and the host exchange JSON control messages over WebView2
  `postMessage` (`IpcBridge.cs` ↔ `src/desktop/ipc.js`). **Audio never crosses
  this bridge** — only control events (notes, load/unload, transport).
- **Audio** — a native C# audio engine (NAudio, WaveOut/WASAPI today; ASIO with
  the full engine) so there's one audio clock and one master bus.
- **VST hosting** — VST2 `.dll` plugins via the pure-C# **VST.NET2-Host** package.
  Load a `.dll`, route sequencer/keyboard notes to it as MIDI, and hear its audio
  out. Plugins with a custom UI open in a borderless owned overlay window
  (`VstEditorWindow.cs`) positioned over the app.

> **Bitness:** the app is built **x86** so it can host 32-bit VST2 plugins (e.g.
> Delay Lama) in-process. A process can only load plugins of its own bitness;
> switch to x64 (or add a bit-bridge helper process) for 64-bit plugins.

### Current status
- WPF + WebView2 shell builds and runs; IPC ping/pong handshake confirmed.
- Native test-tone (sine) over the audio engine works.
- VST2 hosting **confirmed with a real plugin**: load `.dll` → MIDI note on/off →
  audio out, heard. Channel Rack has a desktop-only **"Add VST… (.dll)"** picker
  that creates a `type:'vst'` channel; sequencer and keyboard notes forward to
  the plugin over IPC.
- The plugin editor opens as an owned overlay (WebView2 composites above embedded
  child HWNDs, so reparenting into the app window won't paint).

The native engine and the DSP port of the in-app synths are still in progress;
today the web synths still run on Web Audio while VST audio runs natively.

### Prerequisites
- **.NET 10 SDK** — https://aka.ms/dotnet/download
- **WebView2 Runtime** — ships with Windows 11

### Run — dev (hot reload)
The DEBUG build points WebView2 at the Vite dev server.

```bash
npm run dev                            # terminal 1: Vite at http://localhost:5173
dotnet run --project desktop/Shell     # terminal 2: native shell
```

On a successful handshake the title bar shows **"… host connected ✓"** and the
WebView DevTools console (right-click → Inspect) logs `[ipc] host round-trip OK`.

### Run — prod (bundled)
The RELEASE build serves the built Vue app from a virtual host (`app.local`).
MSBuild copies repo-root `/dist` into the app's `wwwroot` automatically, so build
the Vue app first.

```bash
npm run build                                    # emit /dist
dotnet run --project desktop/Shell -c Release
```

### Publish
A self-contained build is bundled under `desktop/publish/` (and zipped as
`FreakyLoopsStudio.zip`). Rebuild with:

```bash
npm run build
dotnet publish desktop/Shell -c Release
```

### IPC message reference
Control messages sent from Vue (`src/desktop/ipc.js`) and handled in
`MainWindow.xaml.cs`:

| Type            | Direction   | Purpose                                  |
|-----------------|-------------|------------------------------------------|
| `ping` / `pong` | UI ↔ host   | startup handshake                        |
| `testTone`      | UI → host   | start/stop a native sine tone            |
| `pickVst`       | UI → host   | open native `.dll` file picker           |
| `loadVst`       | UI → host   | load a VST2 `.dll` by absolute path      |
| `vstNoteOn` / `vstNoteOff` | UI → host | play/release a note on the plugin |
| `vstUnload`     | UI → host   | unload the current plugin                |
| `openVstEditor` | UI → host   | toggle the plugin's editor window        |
| `vstLoaded` / `vstError` / `vstPeak` | host → UI | load info, errors, output level |

Inside the shell, `window.__desktop` exposes these for poking from the WebView
DevTools console — e.g. `__desktop.testTone(true)` or
`__desktop.loadVst('C:\\path\\to\\synth.dll')` then `__desktop.vstNoteOn(60)`.
A file log is written to `%TEMP%\freakyloops.log`.

---

## Stack

- **Vue 3** (Composition API) + **Vite**
- **Web Audio API** — all synthesis, scheduling, effects, and WAV rendering
- **.NET 10 / WPF** + **WebView2** — native desktop shell
- **NAudio** — native audio device I/O
- **VST.NET2-Host** — pure-C# VST2 plugin hosting

No backend. No external audio libraries on the web side.
