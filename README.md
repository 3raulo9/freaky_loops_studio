# Freaky Loops Studio

A DAW that synthesizes every sound from scratch — no samples, no audio files. It
runs two ways from one codebase:

- **Web app** — Vue 3 + the Web Audio API. Everything runs client-side in the
  browser; there's no backend.
- **Native desktop app** *(Windows)* — a Rust host that renders the same Vue UI
  in a webview and adds a native audio engine with **live VST2 plugin hosting**
  (64-bit in-process, 32-bit through a bridge process), which a browser sandbox
  can't do.

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
│   ├── import/          .flp project mapping + ZIP package reader
│   ├── store/           studio.js — the project model / single source of truth
│   ├── desktop/         ipc.js — bridge to the native host (no-op in browser)
│   └── themes.js        UI color schemes
├── crates/              Rust desktop app (Cargo workspace)
│   ├── native/          VST2 hosting, plugin editor windows, audio engine
│   ├── host/            the app: window + webview, IPC, plugin management
│   ├── bridge/          32-bit helper process for 32-bit VST2 plugins
│   ├── dsp/             time-stretch, tempo detection, WavPack → WebAssembly (src/wasm)
│   └── projfile/        .flp pattern-project reader (compiled into the dsp module)
├── scripts/             packaging for the desktop app
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

### Opening .flp pattern projects
**FILE → Open…** (or drag a file onto the window) accepts `.flp` projects
from every version of the pattern-project format (tested from 11.x to 25.x),
`.zip` packages that bundle a project with its samples, and whole folders.

- The project is read by a Rust parser (`crates/projfile`) running as
  WebAssembly — a large song parses in a few milliseconds — and mapped onto
  this app's model: channels and their samples, hosted VSTs **with their saved
  state**, patterns, the arrangement (pattern, audio and automation clips),
  time markers, tempo, and the mixer inserts that are in use with their
  routing. Effects are replaced by the closest built-in ones; generators that
  only exist inside the original app get a stand-in instrument, or — on
  desktop — a VST build of the same plugin when one is installed.
- **Finding assets.** Projects often come from another machine. On desktop the
  host looks for every sample and plugin in this order: the stored path, the
  project's own folder, then a cached index of your home folders, program
  folders and other drives, ranking candidates by how much of the stored path
  they share (this also resolves paths written relative to an app's data
  folder). The index is built in the background and kept in
  `%APPDATA%\FreakyLoopsStudio\file-index.txt`, so lookups take milliseconds.
  Anything still missing can be found later with **Look in a folder…** in the
  import report; that folder is remembered. On the web, samples are matched
  from the files dropped or zipped with the project.
- Sample formats browsers can't play are decoded too: **WavPack** (`.wv`, a
  Rust decoder, bit-exact) and **Ogg Vorbis wrapped in WAV**.
- An import report lists what was loaded, replaced or missing, and how long
  each step took.

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

## The native desktop app (Rust)

A Windows app that wraps the Vue UI and moves plugin audio out of the browser
into native code so it can host real VST plugins.

### Architecture
- **Host** (`crates/host`) — a native window (`tao`) with a webview (`wry`,
  WebView2 on Windows) that renders the existing Vue UI as the control surface.
  The UI is reused, not rewritten.
- **IPC** — Vue and the host exchange JSON control messages (`{type, payload}`)
  through `window.__flsHost`, which the host injects before the page loads
  (`src/desktop/ipc.js` is the JS end). **Audio never crosses this bridge.**
- **Audio** (`crates/native/src/engine.rs`) — one `cpal` output stream (WASAPI)
  mixing every loaded plugin at the device's sample rate.
- **VST2 hosting** (`crates/native`) — a from-scratch VST2 host over the plugin
  ABI: load a `.dll`, route notes to it as MIDI, pull its audio, answer its host
  callbacks (tempo/transport for synced effects, editor resize), bounce it
  offline for exports, and save/restore its state chunk with the project.
- **Plugin editors** — each opens in a small tool window owned by the app
  window. It takes mouse input without stealing keyboard focus, so QWERTY note
  entry and shortcuts keep working while you tweak a plugin.

> **Bitness:** the app is 64-bit and hosts 64-bit plugins in-process. A
> process can only load DLLs of its own bitness, so the host reads each
> plugin's PE header and runs 32-bit plugins in the **32-bit bridge**
> (`crates/bridge`), spawned on demand and driven over stdin/stdout JSON lines.
> A crashing 32-bit plugin takes down only its bridge, not the app.

### Rust DSP in the web app
`crates/dsp` holds the heavy offline DSP — WSOLA / granular time-stretch and
tempo detection — compiled to WebAssembly (`src/wasm/fls_dsp.wasm`, ~40 KB) and
loaded by `src/audio/dsp.js`. Its output is bit-identical to the JavaScript
reference in `src/audio/warp.js` (kept as the fallback) and 2–10× faster.
The same module carries the `.flp` reader (`crates/projfile`) and a WavPack
decoder (`crates/dsp/src/wavpack.rs`).
Rebuild it with `npm run build:dsp` (needs `rustup target add wasm32-unknown-unknown`).

### Prerequisites
- **Rust** (stable, MSVC toolchain) — https://rustup.rs, plus the 32-bit
  target: `rustup target add i686-pc-windows-msvc`
- **Visual Studio Build Tools** (C++ workload) for the MSVC linker
- **WebView2 Runtime** — ships with Windows 11

### Run — dev (hot reload)
Debug builds load the Vite dev server when it's running, otherwise the built
`dist/`.

```bash
npm run dev               # terminal 1: Vite at http://localhost:5173
npm run desktop:bridge    # once: build the 32-bit bridge
npm run desktop           # terminal 2: cargo run -p fls-host
```

Right-click → Inspect opens devtools; `__desktop` in the console exposes the
bridge (e.g. `__desktop.testTone(true)`). A log is written to
`%TEMP%reakyloops.log`.

### Package
```bash
npm run desktop:build     # vite build + release builds of host and bridge
```
Produces `release/FreakyLoopsStudio/` — `FreakyLoopsStudio.exe`,
`bridge/FreakyLoopsVstBridge.exe` and `wwwroot/` (the UI). Copy the folder
anywhere; no installer or runtime needed beyond WebView2.

### IPC message reference
UI → host (`src/desktop/ipc.js`):

| Type | Payload | Purpose |
|------|---------|---------|
| `ping` | — | startup handshake (replies `pong` with engine info) |
| `testTone` | `on, freq` | start/stop a native sine tone |
| `pickVst` | `id` | native `.dll` picker, then load into channel `id` |
| `loadVst` | `id, path, state?` | load a plugin (optionally restoring saved state) |
| `vstNoteOn` / `vstNoteOff` | `id, pitch, velocity` | play/release a note |
| `vstAllNotesOff` | `id?` | release everything (one plugin or all) |
| `vstUnload` | `id` | unload a plugin |
| `openVstEditor` | `id` | toggle the plugin's editor window |
| `transport` | `bpm, playing, num, den` | tempo/play state for synced plugins |
| `renderVst` | `reqId, channelId, sampleRate, totalFrames, notes` | offline bounce for export |
| `vstGetState` / `vstSetState` | `id, reqId` / `id, data` | snapshot / restore plugin state |
| `fileOpen` / `fileSave` | `reqId, path?, filter, …` | native Open / Save dialogs (`.flp`/`.zip` are served from `/__file/`) |
| `resolveAssets` | `reqId, project?, folders?, samples, plugins` | locate an imported project's samples and plugins |
| `pickFolder` | `reqId, title?` | native folder picker |

Host → UI: `pong`, `vstLoaded`, `vstError`, `vstCancelled`, `vstPeak`,
`vstEditorClosed`, `vstState`, `vstRenderResult` (`url` of a one-shot PCM file
served by the host), `vstRenderError`, `assetsResolved` and `folderPicked`.

---

## Stack

- **Vue 3** (Composition API) + **Vite**
- **Web Audio API** — all synthesis, scheduling, effects, and WAV rendering
- **Rust** — native desktop app: `tao` + `wry` (window + WebView2), `cpal`
  (audio I/O), and a from-scratch VST2 host

No backend. No external audio libraries on the web side.
