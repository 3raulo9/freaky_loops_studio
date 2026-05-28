# Freaky Loops Studio

A browser-based drum machine built with Vue 3 and the Web Audio API. No samples, no audio files — every sound is synthesized from scratch using oscillators, noise buffers, filters, and envelope generators. Think early FL Studio but running in a tab.

---

## What's in it

Four drum tracks: **Kick**, **Snare**, **Hi-Hat**, and **Clash** (crash cymbal). Each one has three knobs that actually change how the sound is constructed at the synthesis level, not just the volume or pan. Turning the Kick's Punch knob, for example, pushes more signal through a waveshaper distortion curve. The Hi-Hat's Tone knob shifts the cutoff of the highpass and bandpass filters shaping the inharmonic oscillator mix.

The sequencer runs on the Web Audio clock (not `setInterval` for timing), so the groove stays tight even at high BPMs. There's a swing control in the header that nudges every odd 16th note slightly late.

You can also export whatever you've made as a WAV file. It uses `OfflineAudioContext` to render the audio faster than real time and encodes it as 16-bit PCM — so the export sounds identical to what you're hearing in the browser.

---

## Running it

You need Node.js (v18 or later should be fine) and npm. Clone the repo, then:

```bash
npm install
npm run dev
```

That'll start a Vite dev server. Open `http://localhost:5173` in your browser and you're good to go.

If you want to build a static version for hosting somewhere:

```bash
npm run build
```

The output goes into `dist/`. You can preview it locally with `npm run preview` before deploying.

---

## How to use it

Hit **▶ PLAY** to start the sequencer. Click any of the small squares on a track to toggle that step on or off. The white cell that moves across the grid shows you where the playhead currently is.

The circular knobs respond to click-and-drag — drag upward to increase the value, downward to decrease. Each track also has a vertical volume fader on the left side and a small round on/off button inside the name plate. Muting a track dims everything and silences it without clearing the pattern, so you can bring it back later exactly as it was.

To export, pick how many bars you want in the BARS dropdown, then click **⬇ EXPORT WAV**. The button will pulse amber while it renders (usually just a second or two), then your browser will download a `.wav` file named with the BPM and bar count.

---

## Stack

- Vue 3 (Composition API)
- Vite
- Web Audio API — all synthesis, scheduling, and rendering happens here, no external audio libraries

No backend, no dependencies beyond Vue and Vite. Opens straight from the file system if you build it.

---

## A note on the sounds

The kick is a sine wave with a falling pitch envelope and an optional waveshaper for crunch. The snare is white noise through a bandpass filter combined with a triangle wave body and a short sub thump. The hi-hat uses six square wave oscillators tuned to the inharmonic frequency ratios of the TR-909's cymbal circuit. The clash is similar but based on the TR-808 crash ratios, with an added ring modulation layer and a noise shimmer on top.

All of this runs in `src/audio/synths.js` if you want to dig in or tweak things.
