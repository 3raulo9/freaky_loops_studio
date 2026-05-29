<template>
  <header class="topbar">

    <!-- ── Logo ───────────────────────────────────────────────────────────────── -->
    <div class="tb-logo">
      <span class="tb-hex">⬡</span>
      <div class="tb-logo-text">
        <span class="tb-logo-main">FREAKY<em>LOOPS</em></span>
        <span class="tb-logo-sub">STUDIO</span>
      </div>
    </div>

    <div class="tb-sep" />

    <!-- ── Transport ──────────────────────────────────────────────────────────── -->
    <div class="tb-group">
      <div class="tb-group-label">TRANSPORT</div>
      <div class="tb-row">
        <button
          class="tb-btn tb-stop"
          @click="stopPlay"
          title="Stop & reset to start (destructive)"
        >■</button>
        <button
          class="tb-btn tb-play"
          :class="{ active: isPlaying }"
          @click="togglePlay"
          :title="isPlaying ? 'Pause — hold position' : 'Play'"
        >{{ isPlaying ? '⏸' : '▶' }}</button>
        <button
          class="tb-btn tb-rec"
          title="Record (coming soon)"
          disabled
        >⏺</button>
      </div>
    </div>

    <div class="tb-sep" />

    <!-- ── Timecode Display ────────────────────────────────────────────────────── -->
    <div
      class="tb-timecode"
      @click="timecodeAsMins = !timecodeAsMins"
      :title="timecodeAsMins ? 'Click → Bars:Beats:Ticks' : 'Click → Min:Sec:Ms'"
    >
      <div class="tb-timecode-val">{{ timecodeDisplay }}</div>
      <div class="tb-timecode-mode">{{ timecodeAsMins ? 'MIN · SEC · MS' : 'BAR · BEAT · TICK' }}</div>
    </div>

    <div class="tb-sep" />

    <!-- ── BPM ────────────────────────────────────────────────────────────────── -->
    <div class="tb-ctrl">
      <div class="tb-ctrl-label">BPM</div>
      <div class="tb-ctrl-val tb-red">{{ bpm }}</div>
      <input type="range" v-model.number="bpm" min="40" max="220" step="1" class="tb-slider" />
    </div>

    <!-- ── Swing ─────────────────────────────────────────────────────────────── -->
    <div class="tb-ctrl">
      <div class="tb-ctrl-label">SWING</div>
      <div class="tb-ctrl-val" style="font-size:12px">{{ Math.round(swing * 100) }}%</div>
      <input type="range" v-model.number="swing" min="0" max="0.25" step="0.01" class="tb-slider" />
    </div>

    <!-- ── Steps ─────────────────────────────────────────────────────────────── -->
    <div class="tb-ctrl">
      <div class="tb-ctrl-label">STEPS</div>
      <select v-model.number="totalSteps" class="tb-select">
        <option :value="8">8</option>
        <option :value="16">16</option>
        <option :value="32">32</option>
      </select>
    </div>

    <div class="tb-sep" />

    <!-- ── PAT / SONG ─────────────────────────────────────────────────────────── -->
    <div class="tb-group">
      <div class="tb-group-label">MODE</div>
      <div class="tb-row">
        <button
          class="tb-mode-btn"
          :class="{ active: !usePlaylist }"
          @click="setPAT"
          title="Pattern mode — loop a single pattern"
        >PAT</button>
        <button
          class="tb-mode-btn"
          :class="{ active: usePlaylist }"
          @click="setSONG"
          title="Song mode — arrange patterns on the playlist"
        >SONG</button>
      </div>
    </div>

    <div class="tb-sep" />

    <!-- ── Global Snap ────────────────────────────────────────────────────────── -->
    <div class="tb-ctrl">
      <div class="tb-ctrl-label">🧲 SNAP</div>
      <select v-model="gridSnap" class="tb-select">
        <option value="bar">Bar</option>
        <option value="1/2">1/2</option>
        <option value="1/4">1/4</option>
        <option value="1/8">1/8</option>
        <option value="1/16">1/16</option>
        <option value="none">None</option>
      </select>
    </div>

    <!-- ── Push everything right ─────────────────────────────────────────────── -->
    <div class="tb-spacer" />

    <!-- ── Oscilloscope + CPU Meter ───────────────────────────────────────────── -->
    <div class="tb-meter">
      <canvas ref="scopeCanvas" class="tb-scope" :width="SCOPE_W" :height="SCOPE_H" />
      <div class="tb-cpu-row">
        <span class="tb-cpu-lbl">CPU</span>
        <div class="tb-cpu-bar">
          <div class="tb-cpu-fill" :style="{ width: audioLoad + '%', background: cpuColor }" />
        </div>
        <span class="tb-cpu-val">{{ audioLoad }}%</span>
      </div>
    </div>

    <div class="tb-sep" />

    <!-- ── Keyboard toggle + Undo/Redo ────────────────────────────────────────── -->
    <div class="tb-tools">
      <button
        class="tb-tool"
        :class="{ active: keyboardInputMode }"
        @click="keyboardInputMode = !keyboardInputMode"
        title="QWERTY keyboard → MIDI (intercepts browser shortcuts when on)"
      >⌨</button>
      <div class="tb-tools-sep" />
      <button
        class="tb-tool"
        @click="undoAction"
        :disabled="!canUndo"
        title="Undo"
      >↶</button>
      <button
        class="tb-tool"
        @click="redoAction"
        :disabled="!canRedo"
        title="Redo"
      >↷</button>
    </div>

    <div class="tb-sep" />

    <!-- ── Window Manager ─────────────────────────────────────────────────────── -->
    <div class="tb-windows">
      <button
        class="tb-win"
        :class="{ active: mainView === 'sequencer' }"
        @click="mainView = 'sequencer'"
        title="Channel Rack"
      >
        <span class="tb-win-icon">▦</span>
        <span class="tb-win-lbl">RACK</span>
      </button>
      <button
        class="tb-win"
        :class="{ active: pianoRollOpen && mainView === 'sequencer' }"
        @click="togglePianoRoll"
        title="Piano Roll"
      >
        <span class="tb-win-icon">𝅘𝅥𝅮</span>
        <span class="tb-win-lbl">PIANO</span>
      </button>
      <button
        class="tb-win"
        :class="{ active: mainView === 'playlist' }"
        @click="setSONG"
        title="Playlist / Song editor"
      >
        <span class="tb-win-icon">▤</span>
        <span class="tb-win-lbl">PLAYLIST</span>
      </button>
      <button
        class="tb-win tb-win-render"
        @click="renderModalOpen = true"
        title="Render / Export audio"
      >
        <span class="tb-win-icon">⬡</span>
        <span class="tb-win-lbl">RENDER</span>
      </button>
    </div>

  </header>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'

const {
  bpm, swing, totalSteps, isPlaying,
  mainView, pianoRollOpen, renderModalOpen,
  usePlaylist, gridSnap, keyboardInputMode, audioLoad,
  togglePlay, stopPlay, getPlayheadTimeSeconds,
  canUndo, canRedo, undoAction, redoAction, getAnalyser,
} = useStudio()

// ── PAT / SONG ────────────────────────────────────────────────────────────────
function setPAT() {
  usePlaylist.value = false
  mainView.value = 'sequencer'
}
function setSONG() {
  usePlaylist.value = true
  mainView.value = 'playlist'
}
function togglePianoRoll() {
  if (mainView.value !== 'sequencer') mainView.value = 'sequencer'
  pianoRollOpen.value = !pianoRollOpen.value
}

// ── Timecode ──────────────────────────────────────────────────────────────────
const timecodeAsMins = ref(false)
const currentTimeSec = ref(0)
let timecodeRaf = null

function tickTimecode() {
  currentTimeSec.value = getPlayheadTimeSeconds()
  timecodeRaf = requestAnimationFrame(tickTimecode)
}

const timecodeDisplay = computed(() => {
  const t = currentTimeSec.value
  if (timecodeAsMins.value) {
    const min = Math.floor(t / 60)
    const sec = Math.floor(t % 60)
    const ms  = Math.floor((t % 1) * 100)
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(ms).padStart(2, '0')}`
  }
  const spb  = 60 / bpm.value
  const spbar = 4 * spb
  const bar  = Math.floor(t / spbar) + 1
  const beat = Math.floor((t % spbar) / spb) + 1
  const tick = Math.floor(((t % spb) / spb) * totalSteps.value) + 1
  return `${String(bar).padStart(3, '0')}:${beat}:${String(tick).padStart(2, '0')}`
})

// ── Oscilloscope ──────────────────────────────────────────────────────────────
const SCOPE_W = 112
const SCOPE_H = 28
const scopeCanvas = ref(null)
let scopeRaf = null
let scopeBuf = null

function drawScope() {
  const canvas = scopeCanvas.value
  if (!canvas) { scopeRaf = requestAnimationFrame(drawScope); return }
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height

  ctx.fillStyle = '#07070f'
  ctx.fillRect(0, 0, w, h)

  const analyser = getAnalyser()
  if (!analyser) {
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2)
    ctx.strokeStyle = '#181828'; ctx.lineWidth = 1; ctx.stroke()
    scopeRaf = requestAnimationFrame(drawScope)
    return
  }

  if (!scopeBuf || scopeBuf.length !== analyser.fftSize) {
    scopeBuf = new Float32Array(analyser.fftSize)
  }
  analyser.getFloatTimeDomainData(scopeBuf)

  const peak = scopeBuf.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const waveColor = peak > 0.8 ? '#e74c3c' : peak > 0.5 ? '#f39c12' : '#2ecc71'

  // Subtle peak glow
  if (peak > 0.05) {
    ctx.fillStyle = `rgba(46,204,113,${Math.min(0.07, peak * 0.06)})`
    ctx.fillRect(0, 0, w, h)
  }

  ctx.beginPath()
  ctx.strokeStyle = waveColor
  ctx.lineWidth = 1.5
  const sl = w / scopeBuf.length
  for (let i = 0; i < scopeBuf.length; i++) {
    const x = i * sl
    const y = (1 - (scopeBuf[i] + 1) / 2) * h
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()

  scopeRaf = requestAnimationFrame(drawScope)
}

// ── CPU color ─────────────────────────────────────────────────────────────────
const cpuColor = computed(() => {
  const l = audioLoad.value
  return l > 75 ? '#e74c3c' : l > 45 ? '#f39c12' : '#2ecc71'
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => { tickTimecode(); drawScope() })
onBeforeUnmount(() => {
  cancelAnimationFrame(timecodeRaf)
  cancelAnimationFrame(scopeRaf)
})
</script>

<style scoped>
/* ── Root ──────────────────────────────────────────────────────────────────── */
.topbar {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 10px;
  background: linear-gradient(180deg, #0f0f1b 0%, #090912 100%);
  border-bottom: 1px solid #181828;
  flex-shrink: 0;
  overflow: hidden;
  gap: 0;
  user-select: none;
}

.tb-sep {
  width: 1px;
  height: 32px;
  background: #1c1c2c;
  flex-shrink: 0;
  margin: 0 7px;
}
.tb-spacer { flex: 1; min-width: 8px; }

/* ── Logo ──────────────────────────────────────────────────────────────────── */
.tb-logo {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  margin-right: 2px;
}
.tb-hex {
  font-size: 22px;
  color: #e74c3c;
  filter: drop-shadow(0 0 6px #e74c3c77);
  line-height: 1;
}
.tb-logo-text { display: flex; flex-direction: column; line-height: 1.15; }
.tb-logo-main {
  font-family: 'Rajdhani', sans-serif;
  font-size: 13px; font-weight: 700; letter-spacing: 0.11em; color: #c8c8e0;
}
.tb-logo-main em { font-style: normal; color: #e74c3c; }
.tb-logo-sub {
  font-family: 'Share Tech Mono', monospace;
  font-size: 7px; color: #28283c; letter-spacing: 0.28em;
}

/* ── Groups ────────────────────────────────────────────────────────────────── */
.tb-group { display: flex; flex-direction: column; align-items: center; gap: 2px; flex-shrink: 0; }
.tb-group-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 7px; font-weight: 700; letter-spacing: 0.2em;
  color: #28283c; text-transform: uppercase;
}
.tb-row { display: flex; gap: 3px; align-items: center; }

/* ── Transport buttons ─────────────────────────────────────────────────────── */
.tb-btn {
  width: 32px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 700;
  border: 1px solid; border-radius: 5px; cursor: pointer;
  transition: all 0.1s; outline: none; flex-shrink: 0;
}
.tb-stop {
  background: #150808; border-color: #3c1212; color: #602020; font-size: 11px;
}
.tb-stop:hover {
  border-color: #e74c3c; color: #e74c3c; background: #200a0a;
  box-shadow: 0 0 9px #e74c3c44;
}
.tb-play {
  background: #071408; border-color: #1a3a1e; color: #2a7035; font-size: 12px;
}
.tb-play:hover  { border-color: #2ecc71; color: #2ecc71; }
.tb-play.active {
  background: #081a09; border-color: #2ecc71; color: #2ecc71;
  box-shadow: 0 0 10px #2ecc7166;
}
.tb-rec {
  background: #150808; border-color: #2a1010; color: #441818;
  font-size: 11px; opacity: 0.35; cursor: not-allowed;
}

/* ── Timecode ──────────────────────────────────────────────────────────────── */
.tb-timecode {
  display: flex; flex-direction: column; align-items: center;
  cursor: pointer; padding: 3px 10px;
  border: 1px solid #141422; border-radius: 4px; background: #05050d;
  transition: border-color 0.15s; flex-shrink: 0;
}
.tb-timecode:hover { border-color: #252540; }
.tb-timecode-val {
  font-family: 'Share Tech Mono', monospace;
  font-size: 21px; color: #e74c3c; letter-spacing: 0.04em; line-height: 1;
  filter: drop-shadow(0 0 5px #e74c3c44);
}
.tb-timecode-mode {
  font-family: 'Rajdhani', sans-serif;
  font-size: 7px; font-weight: 600; letter-spacing: 0.2em; color: #22223a; margin-top: 1px;
}

/* ── Control groups (BPM, Swing, Steps, Snap) ──────────────────────────────── */
.tb-ctrl {
  display: flex; flex-direction: column; align-items: center;
  gap: 2px; flex-shrink: 0; padding: 0 5px;
}
.tb-ctrl-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 8px; font-weight: 700; letter-spacing: 0.18em;
  color: #28283c; text-transform: uppercase; line-height: 1;
}
.tb-ctrl-val {
  font-family: 'Share Tech Mono', monospace;
  font-size: 16px; color: #6060a0; min-width: 34px; text-align: center; line-height: 1;
}
.tb-red { color: #e74c3c; filter: drop-shadow(0 0 3px #e74c3c44); }
.tb-slider { width: 68px; accent-color: #e74c3c; height: 3px; cursor: pointer; }
.tb-select {
  background: #0c0c18; border: 1px solid #222232; color: #7070a0;
  padding: 3px 5px; border-radius: 4px;
  font-family: 'Share Tech Mono', monospace; font-size: 11px;
  cursor: pointer; outline: none; height: 22px;
}
.tb-select:focus { border-color: #e74c3c; }

/* ── PAT / SONG ────────────────────────────────────────────────────────────── */
.tb-mode-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.12em; padding: 4px 9px; height: 24px;
  border: 1px solid #1e1e2e; border-radius: 4px; cursor: pointer;
  background: transparent; color: #30304a;
  transition: all 0.12s; display: flex; align-items: center;
}
.tb-mode-btn:hover { border-color: #404068; color: #6060a0; }
.tb-mode-btn.active {
  border-color: #f39c12; color: #f39c12; background: #140e00;
  box-shadow: 0 0 8px #f39c1233;
}

/* ── Oscilloscope + CPU ────────────────────────────────────────────────────── */
.tb-meter { display: flex; flex-direction: column; gap: 3px; align-items: center; flex-shrink: 0; }
.tb-scope {
  display: block; border: 1px solid #111120; border-radius: 3px; background: #06060e;
}
.tb-cpu-row {
  display: flex; align-items: center; gap: 4px; width: 100%;
}
.tb-cpu-lbl {
  font-family: 'Rajdhani', sans-serif;
  font-size: 7px; font-weight: 700; letter-spacing: 0.12em; color: #202030;
  flex-shrink: 0;
}
.tb-cpu-bar {
  flex: 1; height: 4px; background: #0c0c18;
  border-radius: 2px; overflow: hidden; border: 1px solid #181828;
}
.tb-cpu-fill {
  height: 100%; border-radius: 2px;
  transition: width 0.12s ease, background 0.3s;
}
.tb-cpu-val {
  font-family: 'Share Tech Mono', monospace;
  font-size: 7px; color: #252535; min-width: 22px; text-align: right;
}

/* ── Tool buttons (keyboard, undo/redo) ────────────────────────────────────── */
.tb-tools { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
.tb-tools-sep { width: 1px; height: 16px; background: #181828; margin: 0 2px; }
.tb-tool {
  width: 27px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Share Tech Mono', monospace; font-size: 14px;
  background: transparent; border: 1px solid #1a1a2a; border-radius: 4px;
  color: #35354a; cursor: pointer; transition: all 0.1s; outline: none;
}
.tb-tool:hover:not(:disabled) { border-color: #404068; color: #8080b0; }
.tb-tool.active {
  border-color: #1abc9c; color: #1abc9c; background: #001a14;
  box-shadow: 0 0 7px #1abc9c33;
}
.tb-tool:disabled { opacity: 0.22; cursor: not-allowed; }

/* ── Window Manager ────────────────────────────────────────────────────────── */
.tb-windows { display: flex; gap: 3px; flex-shrink: 0; }
.tb-win {
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 4px 8px; min-width: 42px;
  border: 1px solid #1a1a2a; border-radius: 5px; cursor: pointer;
  background: transparent; color: #30304a;
  transition: all 0.12s; outline: none;
}
.tb-win:hover { border-color: #404068; color: #7070a0; }
.tb-win.active { border-color: #9b59b6; background: #120820; box-shadow: 0 0 8px #9b59b633; }
.tb-win-icon { font-size: 12px; line-height: 1; }
.tb-win-lbl {
  font-family: 'Rajdhani', sans-serif;
  font-size: 8px; font-weight: 700; letter-spacing: 0.1em; color: inherit;
}
.tb-win.active .tb-win-lbl { color: #9b59b6; }
.tb-win-render:hover { border-color: #e74c3c; color: #e74c3c; }
.tb-win-render.active { border-color: #e74c3c; background: #1a0808; box-shadow: 0 0 8px #e74c3c33; }
.tb-win-render.active .tb-win-lbl { color: #e74c3c; }
</style>
