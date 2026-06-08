<template>
  <div class="mpr-root">

    <!-- ── Header ───────────────────────────────────────────────────────── -->
    <div class="mpr-header">
      <span class="mpr-logo">MIDI PORT ROUTER</span>
      <span class="mpr-sub">16-CHANNEL GM RENDERER</span>
      <div class="mpr-header-actions">
        <button
          class="mpr-btn"
          :class="{ 'mpr-btn--connected': midiPortName }"
          @click="connectSystemSynth"
          :title="midiPortName ? 'Connected: ' + midiPortName : 'Bind to a system MIDI output port'"
        >
          {{ midiPortName ? 'SYNTH: ' + truncate(midiPortName, 16) : 'CONNECT SYNTH' }}
        </button>
        <button
          class="mpr-btn mpr-btn--panic"
          @click="onPanic"
          title="MIDI Panic — hard-cut all active voices"
        >PANIC</button>
        <button
          class="mpr-btn mpr-btn--close"
          @click="emit('close')"
          title="Close MIDI Port Router"
        >✕</button>
      </div>
    </div>

    <!-- ── Drop / Upload zone ───────────────────────────────────────────── -->
    <div
      class="mpr-dropzone"
      :class="{ 'mpr-dropzone--active': dropActive }"
      @dragover.prevent="dropActive = true"
      @dragleave="dropActive = false"
      @drop.prevent="onDrop"
    >
      <template v-if="!fileName">
        <span class="mpr-drop-icon">♩</span>
        <span class="mpr-drop-text">Drop a MIDI file here</span>
        <label class="mpr-browse-btn">
          BROWSE
          <input type="file" accept=".mid,.midi" @change="onFileInput" style="display:none" />
        </label>
      </template>
      <template v-else>
        <span class="mpr-file-name" :title="fileName">{{ fileName }}</span>
        <span class="mpr-file-dur">{{ fmtTime(duration) }}</span>
        <label class="mpr-browse-btn mpr-browse-btn--sm">
          CHANGE
          <input type="file" accept=".mid,.midi" @change="onFileInput" style="display:none" />
        </label>
      </template>
    </div>

    <!-- ── Transport bar ────────────────────────────────────────────────── -->
    <div class="mpr-transport" v-if="fileName">
      <button
        class="mpr-transport-btn"
        :class="{ 'mpr-transport-btn--active': playing }"
        @click="onPlayStop"
      >{{ playing ? '■ STOP' : '▶ PLAY' }}</button>

      <button
        class="mpr-transport-btn mpr-transport-btn--pause"
        @click="onPauseResume"
        :disabled="!fileName"
        :title="paused ? 'Resume' : 'Pause'"
      >{{ paused ? '▶▶ RESUME' : '⏸ PAUSE' }}</button>

      <!-- Seekable progress bar -->
      <div class="mpr-progress-wrap" @click="onSeek" title="Click to seek">
        <div class="mpr-progress-bar" :style="{ width: progressPct + '%' }"></div>
        <span class="mpr-timecode">{{ fmtTime(playbackPos) }} / {{ fmtTime(duration) }}</span>
      </div>

      <!-- Master volume knob bound directly to the engine's master gain node -->
      <div class="mpr-master-knob">
        <Knob
          :modelValue="masterVol"
          :min="0" :max="1.5"
          label="MASTER" color="#4ecdc4" :size="46"
          @update:modelValue="onMasterVol"
        />
      </div>
    </div>

    <!-- ── Channel slot table ────────────────────────────────────────────── -->
    <div class="mpr-table">

      <!-- Column headers -->
      <div class="mpr-col-headers">
        <span class="mpr-col mpr-col--ch">CH</span>
        <span class="mpr-col mpr-col--patch">INSTRUMENT PATCH</span>
        <span class="mpr-col mpr-col--bank">BANK</span>
        <span class="mpr-col mpr-col--vu">LEVEL</span>
        <span class="mpr-col mpr-col--ms">M S</span>
      </div>

      <!-- 16 slot rows (channels 1-16) -->
      <div
        v-for="slot in slotState"
        :key="slot.ch"
        class="mpr-row"
        :class="{
          'mpr-row--active':  slot.hasData,
          'mpr-row--drum':    slot.ch === 9,
          'mpr-row--muted':   slot.muted,
          'mpr-row--soloed':  slot.soloed,
          'mpr-row--custom':  slot.isNonStandardBank,
        }"
      >
        <!-- Channel number + activity LED -->
        <div class="mpr-ch-num">
          <span class="mpr-led" :class="{ 'mpr-led--lit': slot.hasData && !slot.muted }"></span>
          {{ slot.ch + 1 }}
        </div>

        <!-- Instrument patch selector -->
        <div class="mpr-patch-cell">
          <template v-if="slot.ch === 9">
            <span class="mpr-drum-label">GM Percussion (ch 10)</span>
          </template>
          <template v-else>
            <select
              class="mpr-select"
              :value="slot.program"
              @change="onPatchChange(slot.ch, +$event.target.value)"
              :title="GM_INSTRUMENTS[slot.program]"
            >
              <option v-for="(name, idx) in GM_INSTRUMENTS" :key="idx" :value="idx">
                {{ String(idx).padStart(3, '0') }}  {{ name }}
              </option>
            </select>
          </template>
        </div>

        <!-- Non-standard bank indicator (shows when bankMSB != 0 + fallback applied) -->
        <div class="mpr-bank-cell">
          <span
            v-if="slot.isNonStandardBank"
            class="mpr-bank-tag"
            :title="'Non-GM bank detected — patch mapped to closest GM equivalent'"
          >FALLBACK</span>
        </div>

        <!-- VU peak meter (CSS bar driven by AnalyserNode reads) -->
        <div class="mpr-vu-cell">
          <div class="mpr-vu-track">
            <div
              class="mpr-vu-bar"
              :style="{ width: Math.min(100, slot.vuLevel * 100) + '%' }"
              :class="{
                'mpr-vu-bar--low':  slot.vuLevel < 0.5,
                'mpr-vu-bar--mid':  slot.vuLevel >= 0.5 && slot.vuLevel < 0.85,
                'mpr-vu-bar--high': slot.vuLevel >= 0.85,
              }"
            ></div>
          </div>
        </div>

        <!-- Mute / Solo -->
        <div class="mpr-ms-cell">
          <button
            class="mpr-ms-btn mpr-mute-btn"
            :class="{ 'mpr-ms-btn--active': slot.muted }"
            @click="toggleMute(slot.ch)"
            title="Mute this channel"
          >M</button>
          <button
            class="mpr-ms-btn mpr-solo-btn"
            :class="{ 'mpr-ms-btn--active': slot.soloed }"
            @click="toggleSolo(slot.ch)"
            title="Solo this channel"
          >S</button>
        </div>
      </div>
    </div>

    <!-- ── Error banner ──────────────────────────────────────────────────── -->
    <div v-if="errorMsg" class="mpr-error" @click="errorMsg = ''">
      ⚠ {{ errorMsg }}
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
const emit = defineEmits(['close'])
import Knob from './Knob.vue'
import { GM_INSTRUMENTS } from '../midi/gmDictionary.js'
import { parseMidi } from '../midi/midiParser.js'
import {
  getSlots, setMasterVolume, setChannelPatch,
  engineProgramChange, engineControlChange, enginePanic,
  tryConnectSystemSynth,
} from '../audio/midiSynthEngine.js'
import {
  loadMidi, play, stop, pause, resume,
  isPlaying, getPlaybackTime, getDuration,
} from '../midi/midiScheduler.js'

// ── Reactive state ────────────────────────────────────────────────────────────

const fileName    = ref('')
const dropActive  = ref(false)
const errorMsg    = ref('')
const masterVol   = ref(0.85)
const midiPortName = ref(null)

const playing     = ref(false)
const paused      = ref(false)
const playbackPos = ref(0)
const duration    = ref(0)

const progressPct = computed(() =>
  duration.value > 0 ? Math.min(100, (playbackPos.value / duration.value) * 100) : 0
)

// One reactive descriptor per channel slot
const slotState = reactive(
  Array.from({ length: 16 }, (_, ch) => ({
    ch,
    program:            0,
    hasData:            false,
    isNonStandardBank:  false,
    muted:              false,
    soloed:             false,
    vuLevel:            0,
  }))
)

// ── VU meter + playback position animation loop ───────────────────────────────

const VU_DECAY = 0.82  // per-frame smoothing factor (rise instantly, fall slowly)
let _rafId = null

function _animLoop() {
  const slots = getSlots()

  for (let i = 0; i < 16; i++) {
    const peak = slots[i].getPeakLevel()
    slotState[i].vuLevel = peak > slotState[i].vuLevel
      ? peak
      : slotState[i].vuLevel * VU_DECAY
  }

  if (isPlaying()) {
    playbackPos.value = getPlaybackTime()
    playing.value     = true
    paused.value      = false
  }

  _rafId = requestAnimationFrame(_animLoop)
}

// ── File loading ──────────────────────────────────────────────────────────────

async function loadFile(file) {
  if (!file) return
  if (!/\.(mid|midi)$/i.test(file.name)) {
    errorMsg.value = 'Not a MIDI file — please upload a .mid or .midi file.'
    return
  }
  errorMsg.value = ''
  try {
    const buf    = await file.arrayBuffer()
    const parsed = parseMidi(buf)
    loadMidi(parsed)

    fileName.value    = file.name
    duration.value    = getDuration()
    playbackPos.value = 0
    playing.value     = false
    paused.value      = false

    // Reflect parsed channel metadata in slot state
    for (let ch = 0; ch < 16; ch++) {
      const info = parsed.channels[ch]
      slotState[ch].hasData           = parsed.activeChannels.has(ch)
      slotState[ch].isNonStandardBank = info.isNonStandardBank ?? false
      // Channel 9 is always percussion; others get the auto-mapped patch
      slotState[ch].program = ch === 9 ? 0 : (info.program ?? 0)
    }
  } catch (e) {
    errorMsg.value = 'Failed to parse MIDI file: ' + e.message
    console.error('[MidiPortRouter]', e)
  }
}

function onDrop(e) {
  dropActive.value = false
  loadFile(e.dataTransfer?.files?.[0])
}

function onFileInput(e) {
  loadFile(e.target.files?.[0])
  e.target.value = ''  // reset so the same file can be re-selected
}

// ── Transport controls ────────────────────────────────────────────────────────

function onPlayStop() {
  if (!fileName.value) return
  if (isPlaying()) {
    stop()
    playing.value = false
    paused.value  = false
  } else {
    // If paused, resume from saved position; otherwise play from current scrub position
    play(playbackPos.value, () => {
      playing.value = false
      paused.value  = false
    })
    playing.value = true
    paused.value  = false
  }
}

function onPauseResume() {
  if (!fileName.value) return
  if (paused.value) {
    resume()
    playing.value = true
    paused.value  = false
  } else if (isPlaying()) {
    pause()
    playing.value = false
    paused.value  = true
  }
}

function onSeek(e) {
  if (!duration.value) return
  const rect = e.currentTarget.getBoundingClientRect()
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const pos  = pct * duration.value
  playbackPos.value = pos
  paused.value      = false
  if (isPlaying()) {
    play(pos, () => { playing.value = false })
  }
}

// ── Slot controls ─────────────────────────────────────────────────────────────

/**
 * User-facing patch override — calls setChannelPatch() which bypasses bank
 * fallback logic and applies the chosen GM program number directly.
 */
function onPatchChange(ch, program) {
  slotState[ch].program = program
  setChannelPatch(ch, program)
}

function toggleMute(ch) {
  const s = slotState[ch]
  s.muted = !s.muted
  getSlots()[ch].setMuted(s.muted)
  // Un-solo this channel if it was soloed
  if (s.muted && s.soloed) { s.soloed = false; _restoreAllFromSolo() }
}

function toggleSolo(ch) {
  const slots  = getSlots()
  const s      = slotState[ch]
  const soloOn = !s.soloed

  if (soloOn) {
    // Mute every channel except the soloed one
    slotState.forEach((st, i) => {
      if (i !== ch) {
        st.muted  = true
        st.soloed = false
        slots[i].setMuted(true)
      } else {
        st.muted  = false
        st.soloed = true
        slots[i].setMuted(false)
      }
    })
  } else {
    _restoreAllFromSolo()
  }
}

function _restoreAllFromSolo() {
  const slots = getSlots()
  slotState.forEach((st, i) => {
    st.soloed = false
    st.muted  = false
    slots[i].setMuted(false)
  })
}

function onMasterVol(v) {
  masterVol.value = v
  setMasterVolume(v)
}

function onPanic() {
  enginePanic()
  playing.value = false
  paused.value  = false
  stop()
}

// ── System synth connection ───────────────────────────────────────────────────

async function connectSystemSynth() {
  midiPortName.value = null
  const name = await tryConnectSystemSynth()
  midiPortName.value = name
  if (!name) errorMsg.value = 'No MIDI output found — using oscillator fallback.'
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  _rafId = requestAnimationFrame(_animLoop)
})

onBeforeUnmount(() => {
  if (_rafId) cancelAnimationFrame(_rafId)
  stop()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(s) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}
</script>

<style scoped>
/* ── Root ───────────────────────────────────────────────────────────────────── */
.mpr-root {
  display: flex;
  flex-direction: column;
  background: var(--bg-deeper, #080810);
  border: 1px solid #2a2a40;
  border-radius: 4px;
  font-family: var(--font-mono, 'Share Tech Mono', monospace);
  color: var(--text-primary, #e0e0ee);
  min-width: 580px;
  user-select: none;
}

/* ── Header ─────────────────────────────────────────────────────────────────── */
.mpr-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: #0c0c18;
  border-bottom: 1px solid #1e1e30;
}
.mpr-logo {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: #4ecdc4;
  text-shadow: 0 0 8px #4ecdc455;
}
.mpr-sub {
  font-size: 9px;
  color: #383852;
  letter-spacing: 0.1em;
}
.mpr-header-actions { margin-left: auto; display: flex; gap: 6px; }

/* ── Shared button ──────────────────────────────────────────────────────────── */
.mpr-btn {
  padding: 3px 9px;
  font-family: inherit;
  font-size: 9px;
  letter-spacing: 0.08em;
  border: 1px solid #282840;
  background: #12121c;
  color: #77779a;
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.mpr-btn:hover           { background: #1c1c2e; color: #aaaacc; }
.mpr-btn--connected      { color: #4ecdc4; border-color: #1e4a47; }
.mpr-btn--panic:hover    { color: #e74c3c; border-color: #4a1010; }
.mpr-btn--close          { margin-left: 4px; }
.mpr-btn--close:hover    { color: #e74c3c; border-color: #4a1010; }

/* ── Dropzone ───────────────────────────────────────────────────────────────── */
.mpr-dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid #14141e;
  background: #0a0a13;
  min-height: 44px;
  transition: background 0.15s, border-color 0.15s;
}
.mpr-dropzone--active { background: #0c0c20; border-color: #4ecdc460; }
.mpr-drop-icon  { font-size: 18px; color: #2a2a3a; }
.mpr-drop-text  { font-size: 11px; color: #383852; letter-spacing: 0.06em; }
.mpr-file-name  { font-size: 11px; color: #c0c0d8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpr-file-dur   { font-size: 10px; color: #4ecdc4; white-space: nowrap; }
.mpr-browse-btn {
  padding: 3px 10px;
  font-size: 9px;
  font-family: inherit;
  letter-spacing: 0.1em;
  border: 1px solid #242436;
  background: #12121c;
  color: #55558a;
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.mpr-browse-btn:hover  { background: #1c1c2e; color: #8888bb; }
.mpr-browse-btn--sm    { font-size: 8px; padding: 2px 7px; }

/* ── Transport ──────────────────────────────────────────────────────────────── */
.mpr-transport {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: #0c0c18;
  border-bottom: 1px solid #14141e;
}
.mpr-transport-btn {
  padding: 3px 10px;
  font-family: inherit;
  font-size: 9px;
  letter-spacing: 0.1em;
  border: 1px solid #1e1e30;
  background: #12121c;
  color: #77779a;
  border-radius: 2px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.mpr-transport-btn:disabled        { opacity: 0.35; cursor: default; }
.mpr-transport-btn:not(:disabled):hover { background: #1c1c2e; color: #aaaacc; }
.mpr-transport-btn--active         { background: #0c1e1c; color: #4ecdc4; border-color: #1e4a47; }
.mpr-transport-btn--pause:not(:disabled):hover { color: #f39c12; border-color: #3a2800; }

.mpr-progress-wrap {
  flex: 1;
  position: relative;
  height: 18px;
  background: #09090f;
  border: 1px solid #16162a;
  border-radius: 2px;
  cursor: pointer;
  overflow: hidden;
}
.mpr-progress-bar {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: linear-gradient(90deg, #1e4a47, #4ecdc4);
  pointer-events: none;
  transition: width 0.08s linear;
}
.mpr-timecode {
  position: absolute;
  right: 6px; top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: #666680;
  pointer-events: none;
}
.mpr-master-knob { flex-shrink: 0; }

/* ── Column headers ─────────────────────────────────────────────────────────── */
.mpr-col-headers {
  display: flex;
  align-items: center;
  padding: 3px 10px;
  background: #0c0c16;
  border-bottom: 1px solid #14141e;
}
.mpr-col {
  font-size: 8px;
  letter-spacing: 0.12em;
  color: #333348;
  text-transform: uppercase;
}
.mpr-col--ch    { width: 36px;  flex-shrink: 0; }
.mpr-col--patch { flex: 1; }
.mpr-col--bank  { width: 64px;  flex-shrink: 0; text-align: center; }
.mpr-col--vu    { width: 78px;  flex-shrink: 0; text-align: center; }
.mpr-col--ms    { width: 46px;  flex-shrink: 0; text-align: center; }

/* ── Slot rows ──────────────────────────────────────────────────────────────── */
.mpr-table { overflow-y: auto; max-height: 420px; }

.mpr-row {
  display: flex;
  align-items: center;
  height: 27px;
  padding: 0 10px;
  border-bottom: 1px solid #0c0c14;
  background: #0c0c12;
  transition: background 0.1s;
}
.mpr-row:hover            { background: #12121e; }
.mpr-row--active          { background: #0e0e16; }
.mpr-row--active:hover    { background: #14142050; }
.mpr-row--drum            { border-left: 2px solid #9b59b6; }
.mpr-row--muted           { opacity: 0.38; }
.mpr-row--soloed          { background: #0c1c1a; }
.mpr-row--soloed:hover    { background: #10221e; }
.mpr-row--custom          { border-right: 2px solid #f39c1244; }

/* Channel number cell */
.mpr-ch-num {
  width: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #555570;
}
.mpr-led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #18182a;
  border: 1px solid #242436;
  flex-shrink: 0;
  transition: background 0.05s, box-shadow 0.05s;
}
.mpr-led--lit { background: #4ecdc4; box-shadow: 0 0 5px #4ecdc488; }

/* Patch cell */
.mpr-patch-cell {
  flex: 1;
  display: flex;
  align-items: center;
  padding-right: 6px;
  overflow: hidden;
}
.mpr-select {
  width: 100%;
  font-family: var(--font-mono, 'Share Tech Mono', monospace);
  font-size: 10px;
  background: #09090f;
  color: #b0b0cc;
  border: 1px solid #1a1a2a;
  border-radius: 2px;
  padding: 1px 4px;
  cursor: pointer;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
}
.mpr-select:focus { border-color: #4ecdc455; }
.mpr-drum-label   { font-size: 10px; color: #9b59b6; letter-spacing: 0.04em; padding-left: 2px; }

/* Bank fallback indicator */
.mpr-bank-cell {
  width: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mpr-bank-tag {
  font-size: 7px;
  letter-spacing: 0.06em;
  color: #f39c12;
  border: 1px solid #f39c1244;
  border-radius: 2px;
  padding: 1px 3px;
  cursor: help;
}

/* VU meter cell */
.mpr-vu-cell {
  width: 78px;
  flex-shrink: 0;
  padding: 0 8px;
}
.mpr-vu-track {
  width: 100%;
  height: 8px;
  background: #09090f;
  border: 1px solid #16162a;
  border-radius: 1px;
  overflow: hidden;
}
.mpr-vu-bar {
  height: 100%;
  border-radius: 1px;
  transition: width 0.04s linear;
  min-width: 0;
}
.mpr-vu-bar--low  { background: linear-gradient(90deg, #1a6e40, #2ecc71); }
.mpr-vu-bar--mid  { background: linear-gradient(90deg, #1a6e40, #f39c12); }
.mpr-vu-bar--high { background: linear-gradient(90deg, #f39c12, #e74c3c); }

/* Mute / Solo */
.mpr-ms-cell {
  width: 46px;
  flex-shrink: 0;
  display: flex;
  gap: 4px;
  justify-content: center;
}
.mpr-ms-btn {
  width: 18px;
  height: 16px;
  font-family: inherit;
  font-size: 8px;
  border-radius: 2px;
  cursor: pointer;
  border: 1px solid #1e1e30;
  background: #0c0c16;
  color: #383852;
  padding: 0;
  line-height: 1;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.mpr-ms-btn:hover                     { background: #181828; color: #7777aa; }
.mpr-mute-btn.mpr-ms-btn--active      { background: #220e00; color: #e67e22; border-color: #4a2800; }
.mpr-solo-btn.mpr-ms-btn--active      { background: #081600; color: #2ecc71; border-color: #163800; }

/* ── Error banner ───────────────────────────────────────────────────────────── */
.mpr-error {
  padding: 6px 12px;
  background: #160606;
  color: #e74c3c;
  font-size: 10px;
  border-top: 1px solid #320808;
  cursor: pointer;
  letter-spacing: 0.04em;
}
.mpr-error:hover { background: #1e0808; }
</style>
