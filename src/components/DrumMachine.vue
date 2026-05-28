<template>
  <div class="machine">

    <!-- ─── Header ─────────────────────────────────────────────── -->
    <header class="machine-header">
      <div class="logo">
        <span class="logo-hex">⬡</span>
        <span class="logo-text">FREAKY<em>LOOPS</em> STUDIO</span>
      </div>

      <div class="transport">
        <div class="ctrl-group">
          <span class="ctrl-label">BPM</span>
          <div class="bpm-display">{{ bpm }}</div>
          <input type="range" v-model.number="bpm" min="40" max="220" step="1" class="bpm-slider" />
        </div>

        <div class="ctrl-group">
          <span class="ctrl-label">STEPS</span>
          <select v-model.number="totalSteps" class="steps-select">
            <option :value="8">8</option>
            <option :value="16">16</option>
            <option :value="32">32</option>
          </select>
        </div>

        <div class="ctrl-group">
          <span class="ctrl-label">SWING</span>
          <div class="bpm-display" style="font-size:16px">{{ Math.round(swing * 100) }}%</div>
          <input type="range" v-model.number="swing" min="0" max="0.25" step="0.01" class="bpm-slider" />
        </div>

        <button class="btn btn-play" :class="{ active: isPlaying }" @click="togglePlay">
          <span v-if="isPlaying">⏹ STOP</span>
          <span v-else>▶ PLAY</span>
        </button>
        <button class="btn btn-clear" @click="clearAll">CLR</button>

        <div class="divider" />

        <div class="ctrl-group">
          <span class="ctrl-label">BARS</span>
          <select v-model.number="exportBars" class="steps-select">
            <option :value="1">1</option>
            <option :value="2">2</option>
            <option :value="4">4</option>
            <option :value="8">8</option>
          </select>
        </div>
        <button
          class="btn btn-export"
          :class="{ rendering: isRendering }"
          :disabled="isRendering"
          @click="exportWav"
        >
          <span v-if="isRendering">⏳ RENDERING…</span>
          <span v-else>⬇ EXPORT WAV</span>
        </button>
      </div>
    </header>

    <!-- ─── Tracks ────────────────────────────────────────────── -->
    <div class="tracks">
      <div
        v-for="(track, ti) in tracks"
        :key="track.id"
        class="track"
        :class="{ 'track-muted': track.muted }"
        :style="{ '--accent': track.color }"
      >
        <!-- Name plate + on/off button -->
        <div class="track-name" :class="{ muted: track.muted }" :style="{ background: track.color }">
          <span class="track-label">{{ track.label }}</span>
          <button
            class="track-toggle"
            :class="{ off: track.muted }"
            @click="track.muted = !track.muted"
            :title="track.muted ? 'Enable track' : 'Mute track'"
          >
            <span class="toggle-dot" />
          </button>
        </div>

        <!-- Knobs panel -->
        <div class="knobs-panel">
          <Knob
            v-for="knob in track.knobs"
            :key="knob.key"
            v-model="track.params[knob.key]"
            :min="knob.min"
            :max="knob.max"
            :label="knob.label"
            :color="track.color"
            :size="56"
            :decimals="knob.decimals ?? 2"
          />
        </div>

        <!-- Volume fader -->
        <div class="vol-panel">
          <span class="ctrl-label">VOL</span>
          <input
            type="range"
            v-model.number="track.volume"
            min="0" max="1" step="0.01"
            class="vol-fader"
          />
          <span class="vol-num" :style="{ color: track.color }">{{ Math.round(track.volume * 100) }}</span>
        </div>

        <!-- Step buttons -->
        <div class="steps-grid" :style="{ '--cols': totalSteps }">
          <button
            v-for="s in totalSteps"
            :key="s - 1"
            class="step-btn"
            :class="{
              lit:     track.pattern[s - 1],
              playing: isPlaying && displayStep === s - 1,
              beat:    (s - 1) % 4 === 0,
            }"
            @click="toggleStep(ti, s - 1)"
          />
        </div>
      </div>
    </div>

    <!-- ─── Playhead ruler ────────────────────────────────────── -->
    <div class="ruler">
      <div class="ruler-left-spacer" />
      <div class="ruler-steps" :style="{ '--cols': totalSteps }">
        <div
          v-for="s in totalSteps"
          :key="s"
          class="ruler-cell"
          :class="{
            active: isPlaying && displayStep === s - 1,
            beat:   (s - 1) % 4 === 0,
          }"
        >
          <span v-if="(s - 1) % 4 === 0" class="ruler-num">{{ s }}</span>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, onBeforeUnmount } from 'vue'
import Knob from './Knob.vue'
import { playKick, playSnare, playHiHat, playClash } from '../audio/synths.js'
import { renderLoopToWav } from '../audio/export.js'

// ─── Tracks ──────────────────────────────────────────────────────────────────
function makePattern(n = 32) { return Array(n).fill(false) }

const tracks = reactive([
  {
    id: 'kick', label: 'KICK', color: '#e74c3c',
    volume: 0.9, muted: false,
    pattern: makePattern(),
    params: { pitch: 60, decay: 0.55, punch: 0.65 },
    knobs: [
      { key: 'pitch', label: 'PITCH', min: 30,   max: 140,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.15, max: 1.6,  decimals: 2 },
      { key: 'punch', label: 'PUNCH', min: 0,    max: 1,    decimals: 2 },
    ],
    fn: playKick,
  },
  {
    id: 'snare', label: 'SNARE', color: '#f39c12',
    volume: 0.8, muted: false,
    pattern: makePattern(),
    params: { snap: 0.7, tone: 210, decay: 0.28 },
    knobs: [
      { key: 'snap',  label: 'SNAP',  min: 0,    max: 1,    decimals: 2 },
      { key: 'tone',  label: 'TONE',  min: 80,   max: 700,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.04, max: 0.9,  decimals: 2 },
    ],
    fn: playSnare,
  },
  {
    id: 'hihat', label: 'HI-HAT', color: '#2ecc71',
    volume: 0.65, muted: false,
    pattern: makePattern(),
    params: { decay: 0.07, tone: 0.5, mix: 0.75 },
    knobs: [
      { key: 'decay', label: 'DECAY', min: 0.01, max: 0.45, decimals: 2 },
      { key: 'tone',  label: 'TONE',  min: 0,    max: 1,    decimals: 2 },
      { key: 'mix',   label: 'MIX',   min: 0,    max: 1,    decimals: 2 },
    ],
    fn: playHiHat,
  },
  {
    id: 'clash', label: 'CLASH', color: '#9b59b6',
    volume: 0.7, muted: false,
    pattern: makePattern(),
    params: { decay: 1.2, tone: 0.45, ring: 0.4 },
    knobs: [
      { key: 'decay', label: 'DECAY', min: 0.2,  max: 4.0,  decimals: 2 },
      { key: 'tone',  label: 'TONE',  min: 0,    max: 1,    decimals: 2 },
      { key: 'ring',  label: 'RING',  min: 0,    max: 1,    decimals: 2 },
    ],
    fn: playClash,
  },
])

// ─── State ────────────────────────────────────────────────────────────────────
const bpm         = ref(120)
const totalSteps  = ref(16)
const swing       = ref(0)
const isPlaying   = ref(false)
const displayStep = ref(-1)
const exportBars  = ref(2)
const isRendering = ref(false)

// ─── Audio context + per-track gain nodes ─────────────────────────────────────
let audioCtx   = null
let trackGains = []   // GainNode per track, recreated on each play

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (audioCtx.state === 'suspended') audioCtx.resume()

  // One gain node per track so volume slider works in real time
  trackGains = tracks.map(t => {
    const g = audioCtx.createGain()
    g.gain.value = t.volume
    g.connect(audioCtx.destination)
    return g
  })
}

// Keep gain values in sync with sliders while playing
function syncVolumes() {
  tracks.forEach((t, i) => {
    if (trackGains[i]) trackGains[i].gain.value = t.volume
  })
}

// ─── Lookahead scheduler ─────────────────────────────────────────────────────
const LOOK_AHEAD = 0.12  // seconds
const TICK_MS    = 25    // ms between scheduler ticks

let schedulerTimer = null
let nextNoteTime   = 0
let schedStep      = 0
const noteQueue    = []  // { step, time } for visual sync

function scheduleStep(step, when) {
  noteQueue.push({ step, time: when })
  syncVolumes()
  tracks.forEach((track, ti) => {
    if (track.pattern[step] && !track.muted) {
      track.fn(audioCtx, when, { ...track.params }, trackGains[ti])
    }
  })
}

function tick() {
  if (!audioCtx) return
  const secPerBeat = 60 / bpm.value
  const secPerStep = secPerBeat / 4   // 16th-note grid
  const steps = totalSteps.value

  while (nextNoteTime < audioCtx.currentTime + LOOK_AHEAD) {
    // Apply swing: odd 16th notes are pushed slightly later
    const swingOffset = (schedStep % 2 === 1) ? swing.value * secPerBeat * 0.5 : 0
    scheduleStep(schedStep % steps, nextNoteTime + swingOffset)
    nextNoteTime += secPerStep
    schedStep++
  }
}

function drawLoop() {
  if (!isPlaying.value) return
  const now = audioCtx ? audioCtx.currentTime : 0
  while (noteQueue.length && noteQueue[0].time <= now + 0.01) {
    displayStep.value = noteQueue[0].step
    noteQueue.shift()
  }
  requestAnimationFrame(drawLoop)
}

function startPlay() {
  initAudio()
  isPlaying.value = true
  schedStep       = 0
  nextNoteTime    = audioCtx.currentTime + 0.05
  noteQueue.length = 0
  displayStep.value = -1
  schedulerTimer  = setInterval(tick, TICK_MS)
  requestAnimationFrame(drawLoop)
}

function stopPlay() {
  isPlaying.value = false
  clearInterval(schedulerTimer)
  schedulerTimer = null
  noteQueue.length = 0
  displayStep.value = -1
}

function togglePlay() {
  isPlaying.value ? stopPlay() : startPlay()
}

// ─── Pattern helpers ──────────────────────────────────────────────────────────
function toggleStep(ti, si) {
  tracks[ti].pattern[si] = !tracks[ti].pattern[si]
}

function clearAll() {
  tracks.forEach(t => t.pattern.fill(false))
}

async function exportWav() {
  if (isRendering.value) return
  isRendering.value = true
  try {
    const blob = await renderLoopToWav(
      tracks, bpm.value, totalSteps.value, swing.value, exportBars.value
    )
    const url = URL.createObjectURL(blob)
    const a   = document.createElement('a')
    a.href     = url
    a.download = `freaky-loop-${bpm.value}bpm-${exportBars.value}bar.wav`
    a.click()
    URL.revokeObjectURL(url)
  } finally {
    isRendering.value = false
  }
}

onBeforeUnmount(() => {
  stopPlay()
  audioCtx?.close()
})
</script>

<style scoped>
/* ── Shell ─────────────────────────────────────────────────────── */
.machine {
  width: min(1280px, 100%);
  background: #12121c;
  border: 1px solid #252535;
  border-radius: 14px;
  box-shadow:
    0 12px 60px rgba(0,0,0,0.75),
    inset 0 1px 0 rgba(255,255,255,0.04);
  overflow: hidden;
}

/* ── Header ────────────────────────────────────────────────────── */
.machine-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 14px 22px 12px;
  background: #0c0c14;
  border-bottom: 1px solid #1c1c2c;
}

.logo {
  display: flex;
  align-items: center;
  gap: 9px;
}
.logo-hex {
  font-size: 24px;
  color: #e74c3c;
  line-height: 1;
  filter: drop-shadow(0 0 6px #e74c3c88);
}
.logo-text {
  font-family: 'Rajdhani', sans-serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: #d0d0e8;
}
.logo-text em {
  font-style: normal;
  color: #e74c3c;
}

.transport {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.ctrl-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.ctrl-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #50506a;
}
.bpm-display {
  font-family: 'Share Tech Mono', monospace;
  font-size: 20px;
  color: #e74c3c;
  min-width: 52px;
  text-align: center;
  line-height: 1;
  filter: drop-shadow(0 0 4px #e74c3c55);
}
.bpm-slider {
  width: 90px;
  accent-color: #e74c3c;
  height: 3px;
  cursor: pointer;
}
.steps-select {
  background: #181828;
  border: 1px solid #303048;
  color: #b0b0c8;
  padding: 5px 10px;
  border-radius: 5px;
  font-family: 'Share Tech Mono', monospace;
  font-size: 14px;
  cursor: pointer;
  outline: none;
}
.steps-select:focus { border-color: #e74c3c; }

.btn {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.1em;
  padding: 9px 20px;
  border: 1px solid;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
  text-transform: uppercase;
  outline: none;
}
.btn-play {
  background: #0e2a1a;
  border-color: #2ecc71;
  color: #2ecc71;
}
.btn-play.active {
  background: #2ecc71;
  color: #061206;
  box-shadow: 0 0 14px #2ecc7170;
}
.btn-play:hover { filter: brightness(1.15); }
.btn-clear {
  background: #1a0e28;
  border-color: #4a3060;
  color: #8060a0;
  padding: 9px 14px;
}
.btn-clear:hover { border-color: #9b59b6; color: #c084e0; }

.divider {
  width: 1px;
  height: 34px;
  background: #252535;
  align-self: center;
}

.btn-export {
  background: #0e1e2e;
  border-color: #3a8abd;
  color: #5aacdf;
  white-space: nowrap;
}
.btn-export:hover:not(:disabled) { border-color: #5aacdf; color: #88ccff; filter: brightness(1.1); }
.btn-export:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-export.rendering {
  border-color: #f39c12;
  color: #f39c12;
  animation: pulse-border 0.8s ease-in-out infinite alternate;
}
@keyframes pulse-border {
  from { box-shadow: 0 0 0px #f39c1200; }
  to   { box-shadow: 0 0 8px #f39c1266; }
}

/* ── Tracks ────────────────────────────────────────────────────── */
.tracks {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.track {
  display: grid;
  grid-template-columns: 72px 206px 48px 1fr;
  align-items: center;
  min-height: 88px;
  border-bottom: 1px solid #0e0e1a;
  background: #16162a;
  transition: background 0.1s;
}
.track:last-child { border-bottom: none; }
.track:nth-child(even) { background: #14142a; }
.track-muted .knobs-panel,
.track-muted .vol-panel {
  opacity: 0.35;
  pointer-events: none;
}
.track-muted .steps-grid {
  opacity: 0.35;
}

/* Name plate */
.track-name {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  align-self: stretch;
  border-right: 2px solid var(--accent);
  transition: opacity 0.2s, filter 0.2s;
}
.track-name.muted {
  opacity: 0.45;
  filter: saturate(0.2);
}
.track-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
}
.track-toggle {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.7);
  background: rgba(255,255,255,0.15);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, box-shadow 0.15s, border-color 0.15s;
  box-shadow: 0 0 6px rgba(255,255,255,0.5), inset 0 0 4px rgba(255,255,255,0.2);
  padding: 0;
}
.track-toggle:hover {
  filter: brightness(1.2);
}
.track-toggle.off {
  background: rgba(0,0,0,0.35);
  border-color: rgba(255,255,255,0.2);
  box-shadow: none;
}
.toggle-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  opacity: 0.9;
  transition: opacity 0.15s, background 0.15s;
}
.track-toggle.off .toggle-dot {
  background: #555;
  opacity: 0.5;
}

/* Knobs panel */
.knobs-panel {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  align-items: flex-start;
  border-right: 1px solid #1a1a2c;
}

/* Volume fader */
.vol-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 6px;
  border-right: 1px solid #1a1a2c;
  height: 100%;
  justify-content: center;
}
.vol-fader {
  writing-mode: vertical-lr;
  direction: rtl;
  width: 4px;
  height: 52px;
  accent-color: var(--accent);
  cursor: pointer;
}
.vol-num {
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px;
}

/* Step grid */
.steps-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 3px;
  padding: 10px 12px;
  align-self: stretch;
  align-items: center;
}

.step-btn {
  aspect-ratio: 1;
  max-height: 34px;
  border: 1px solid #222238;
  border-radius: 4px;
  background: #0e0e20;
  cursor: pointer;
  transition: background 0.07s, box-shadow 0.07s, border-color 0.07s;
  position: relative;
}

/* Every beat (every 4th step) has a slightly different off-state */
.step-btn.beat {
  background: #131325;
  border-color: #252540;
}

/* Active (lit) step */
.step-btn.lit {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 55%, transparent);
}

/* Currently playing step */
.step-btn.playing {
  border-color: #ffffff !important;
  box-shadow:
    0 0 10px #ffffffaa,
    inset 0 0 5px rgba(255,255,255,0.2) !important;
}

.step-btn:hover:not(.lit) {
  background: color-mix(in srgb, var(--accent) 18%, #1a1a30);
  border-color: color-mix(in srgb, var(--accent) 35%, #333);
}

/* ── Ruler ─────────────────────────────────────────────────────── */
.ruler {
  display: grid;
  grid-template-columns: 326px 1fr;  /* match track-left width + vol */
  background: #0a0a12;
  border-top: 1px solid #1a1a28;
  height: 20px;
}
.ruler-left-spacer {
  border-right: 1px solid #1a1a28;
}
.ruler-steps {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 3px;
  padding: 2px 12px;
  align-items: center;
}
.ruler-cell {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  transition: background 0.06s;
  background: transparent;
}
.ruler-cell.active {
  background: rgba(255,255,255,0.75);
  box-shadow: 0 0 5px rgba(255,255,255,0.5);
}
.ruler-cell.beat {
  border-left: 1px solid #252535;
}
.ruler-num {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px;
  color: #44446a;
  line-height: 1;
  pointer-events: none;
}
.ruler-cell.active .ruler-num { color: #0a0a12; }
</style>
