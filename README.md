# Freaky Loops Studio

A browser-based DAW built with Vue 3 and the Web Audio API. No samples, no audio files, no backend — every sound is synthesized from scratch and every feature runs client-side. 

---

## What's in it

### Channel Rack
The core of the studio. Channels come in two types: **drum** and **melodic**. Each channel has its own color, mute/solo controls, volume fader, and a mixer routing selector. Patterns are named and navigable — you can duplicate, rename, delete, or split a pattern by channel. Each channel's steps open into a bottom piano roll panel that you can resize by dragging.

**Drum channels** are synthesized from scratch. The Kick is a sine wave with a falling pitch envelope and optional waveshaper crunch. The Snare is white noise through a bandpass filter plus a triangle wave body. The Hi-Hat uses six square oscillators tuned to the TR-909's inharmonic cymbal ratios. The Clash is based on the TR-808 crash, with ring modulation and a noise shimmer layer. Each drum channel supports plug-in style **effect modules** — add Distortion, Delay, Reverb, Compressor, Chorus, or Phaser per channel from the properties panel.

**Melodic channels** use a wavetable oscillator with selectable waveshape (Sawtooth, Square, Sine, Triangle) and can be sequenced either in the step grid or in the piano roll. Notes are entered by mouse or played live from the keyboard (Z–M and Q–U rows, with `[`/`]` to shift octave).

### Piano Roll
A full piano roll editor for melodic channels. Tools: draw, paint, select (box or click), mute, and erase. Notes support velocity (shown as bottom fill), can be multi-selected and moved by drag or nudged with arrow keys. Snap grid goes from 1/64 down to 1 bar. Ghost notes overlay other channels in the background so you can compose in context. A channel picker dropdown lets you switch target channels without closing the panel.

### Playlist
An arrangement view for building full songs. Drag pattern clips and automation clips onto tracks across a scrollable timeline. Supports draw, select, and erase tools, a zoom slider, auto-scroll during playback, a minimap for navigation, markers, and multiple playlist tracks and automation tracks. A **PLAYLIST** toggle switches the transport between pattern-loop mode and song-arrangement mode.

### Mixer
Eight named insert tracks plus a master bus, all with per-track volume faders, mute, solo, and dB readout. Each channel in the rack routes to a mixer insert via a dropdown. Channel routing is visualized as colored dots on each mixer strip.

### Automation
Automation clips can be drawn in the Playlist and tied to any automatable parameter. The Playlist distinguishes between pattern clips and automation clips via a focus-mode toggle.

### Transport & Global Controls
- **BPM** — 40 to 220, slider-controlled
- **Swing** — nudges odd 16th notes late for groove
- **Steps** — 8, 16, or 32 steps per pattern
- **Timecode display** — click to toggle between Bars:Beats:Ticks and Min:Sec:Ms
- **PAT / SONG mode** — loop the current pattern or play the full playlist arrangement

### Themes
A theme picker modal lets you switch the entire UI color scheme without reloading.

### Export
Click **EXPORT WAV** to render your composition. Uses `OfflineAudioContext` to render faster than real time and encodes as 16-bit PCM WAV. The export matches exactly what you hear in the browser.

### Keyboard shortcuts
- **Z–M / Q–U** — play the selected melodic channel live
- **`[` / `]`** — shift the live-play octave down/up
- **Ctrl+Shift+7** — panic: instantly silence everything (stops the sequencer, releases held keys, sends all-notes-off to every synth)

---

## Running it

You need Node.js (v18 or later) and npm. Clone the repo, then:

```bash
npm install
npm run dev
```

That starts a Vite dev server at `http://localhost:5173`.

To build a static version for hosting:

```bash
npm run build
```

Output goes into `dist/`. Preview locally with `npm run preview`.

---

## Stack

- Vue 3 (Composition API)
- Vite
- Web Audio API — all synthesis, scheduling, effect processing, and rendering happens here

No backend. No external audio libraries. Opens straight from the file system if you build it.
