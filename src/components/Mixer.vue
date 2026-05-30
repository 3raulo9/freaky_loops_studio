<template>
  <div class="mixer-panel" @click="closeRename">

    <!-- ── Header ───────────────────────────────────────────────────────── -->
    <div class="mx-header">
      <span class="mx-title">MIXER</span>
      <span class="mx-hint">Route channels via the TRACK selector in the Channel Rack</span>
      <div class="mx-spacer" />
      <div class="mx-master-vol-wrap">
        <span class="mx-mlabel">MASTER VOL</span>
        <input type="range" class="mx-master-vol-slider"
          v-model.number="masterTrack.volume" min="0" max="1.25" step="0.005"
          @input="setMixerTrackVolume(0, masterTrack.volume)"
        />
        <span class="mx-master-db">{{ volToDb(masterTrack.volume) }}</span>
      </div>
    </div>

    <!-- ── Strips ────────────────────────────────────────────────────────── -->
    <div class="mx-strips-scroll">
      <div class="mx-strips">

        <!-- Insert tracks 1-8 -->
        <div
          v-for="(track, i) in insertTracks"
          :key="track.id"
          class="mx-strip"
          :class="{ 'mx-muted': track.muted, 'mx-soloed': track._soloed }"
          :style="{ '--accent': track.color }"
        >
          <!-- Color accent bar -->
          <div class="mx-accent" :style="{ background: track.color }" />

          <!-- Channel routing dots -->
          <div class="mx-routes" :title="routeTitle(i + 1)">
            <span
              v-for="ch in getRoutedChannels(i + 1)"
              :key="ch.id"
              class="mx-dot"
              :style="{ background: ch.color }"
              :title="ch.name"
            />
            <span v-if="!getRoutedChannels(i + 1).length" class="mx-dot-empty" />
          </div>

          <!-- Name -->
          <div class="mx-name-area">
            <input
              v-if="renamingIdx === i + 1"
              class="mx-name-input"
              v-model="track.name"
              @blur="renamingIdx = -1"
              @keydown.enter.stop="renamingIdx = -1"
              @keydown.esc.stop="renamingIdx = -1"
              @click.stop
              maxlength="12"
              autofocus
            />
            <div v-else class="mx-name" @dblclick.stop="renamingIdx = i + 1"
              :title="'Double-click to rename'">{{ track.name }}</div>
          </div>

          <!-- Peak meter -->
          <div class="mx-meter">
            <div class="mx-meter-bg">
              <div class="mx-meter-fill"
                :style="{ height: peakPct(i + 1) + '%', background: peakColor(peakLevels[i + 1]) }"
              />
              <div class="mx-meter-peak-hold"
                :style="{ bottom: peakHoldPct(i + 1) + '%' }"
              />
            </div>
            <span class="mx-meter-db">{{ peakDb(i + 1) }}</span>
          </div>

          <!-- 3-band EQ -->
          <div class="mx-eq">
            <span class="mx-eq-label">EQ</span>
            <div class="mx-eq-bands">
              <div v-for="band in EQ_BANDS" :key="band.key" class="mx-eq-band">
                <span class="mx-eq-bl">{{ band.label }}</span>
                <div class="mx-eq-track">
                  <input type="range" class="mx-eq-slider"
                    v-model.number="track.eq[band.key]"
                    min="-12" max="12" step="0.5"
                    @input="setMixerEq(i + 1, band.key, track.eq[band.key])"
                    :title="`${band.label}: ${track.eq[band.key] > 0 ? '+' : ''}${Number(track.eq[band.key]).toFixed(1)} dB`"
                  />
                  <div class="mx-eq-zero" />
                </div>
                <span class="mx-eq-val"
                  :style="{ color: track.eq[band.key] !== 0 ? track.color : undefined }">
                  {{ track.eq[band.key] > 0 ? '+' : '' }}{{ Number(track.eq[band.key]).toFixed(0) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Volume fader -->
          <div class="mx-fader-area">
            <div class="mx-fader-wrap">
              <div class="mx-fader-unity" />
              <input type="range" class="mx-fader"
                v-model.number="track.volume"
                min="0" max="1.25" step="0.005"
                @input="setMixerTrackVolume(i + 1, track.volume)"
                :title="`Volume: ${volToDb(track.volume)}`"
              />
            </div>
            <span class="mx-vol-db">{{ volToDb(track.volume) }}</span>
          </div>

          <!-- Pan -->
          <div class="mx-pan-area">
            <span class="mx-pan-lbl">PAN</span>
            <input type="range" class="mx-pan-slider"
              v-model.number="track.pan"
              min="-1" max="1" step="0.01"
              @input="setMixerTrackPan(i + 1, track.pan)"
              :title="`Pan: ${panLabel(track.pan)}`"
            />
            <span class="mx-pan-val"
              :style="{ color: track.pan !== 0 ? track.color : undefined }">
              {{ panLabel(track.pan) }}
            </span>
          </div>

          <!-- Mute / Solo -->
          <div class="mx-ms">
            <button class="mx-btn mx-mute-btn" :class="{ active: track.muted }"
              @click.stop="muteMixerTrack(i + 1)" title="Mute">M</button>
            <button class="mx-btn mx-solo-btn" :class="{ active: track._soloed }"
              @click.stop="soloMixerTrack(i + 1)" title="Solo">S</button>
          </div>

          <!-- Track number -->
          <div class="mx-track-num" :style="{ color: track.color }">
            {{ String(i + 1).padStart(2, '0') }}
          </div>
        </div>

        <!-- ── Master separator ─────────────────────────────────────────── -->
        <div class="mx-sep" />

        <!-- ── Master strip ────────────────────────────────────────────── -->
        <div class="mx-strip mx-master" :style="{ '--accent': '#e74c3c' }">
          <div class="mx-accent" style="background:#e74c3c" />

          <!-- Channels routed to master (mixerTrack===0) -->
          <div class="mx-routes" title="Channels routed to Master">
            <span
              v-for="ch in masterChannels"
              :key="ch.id"
              class="mx-dot"
              :style="{ background: ch.color }"
              :title="ch.name"
            />
            <span v-if="!masterChannels.length" class="mx-dot-empty" />
          </div>

          <!-- Name -->
          <div class="mx-name-area">
            <div class="mx-name mx-master-name">MASTER</div>
          </div>

          <!-- Master peak meter -->
          <div class="mx-meter">
            <div class="mx-meter-bg">
              <div class="mx-meter-fill"
                :style="{ height: peakPct(0) + '%', background: peakColor(peakLevels[0]) }"
              />
              <div class="mx-meter-peak-hold"
                :style="{ bottom: peakHoldPct(0) + '%' }"
              />
            </div>
            <span class="mx-meter-db">{{ peakDb(0) }}</span>
          </div>

          <!-- No EQ on master (spacer) -->
          <div class="mx-eq-spacer" />

          <!-- Master fader -->
          <div class="mx-fader-area">
            <div class="mx-fader-wrap">
              <div class="mx-fader-unity" />
              <input type="range" class="mx-fader"
                v-model.number="masterTrack.volume"
                min="0" max="1.25" step="0.005"
                @input="setMixerTrackVolume(0, masterTrack.volume)"
                :title="`Master Volume: ${volToDb(masterTrack.volume)}`"
              />
            </div>
            <span class="mx-vol-db">{{ volToDb(masterTrack.volume) }}</span>
          </div>

          <!-- Pan (master always center) -->
          <div class="mx-pan-area">
            <span class="mx-pan-lbl">PAN</span>
            <div class="mx-pan-center">C</div>
          </div>

          <!-- Master mute -->
          <div class="mx-ms">
            <button class="mx-btn mx-mute-btn" :class="{ active: masterTrack.muted }"
              @click.stop="muteMixerTrack(0)" title="Mute Master">M</button>
            <div class="mx-btn" style="opacity:0.2;cursor:default">S</div>
          </div>

          <div class="mx-track-num" style="color:#e74c3c">MST</div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'

const {
  channels, mixerTracks,
  setMixerTrackVolume, setMixerTrackPan, setMixerEq,
  muteMixerTrack, soloMixerTrack, getMixerAnalyser,
} = useStudio()

const EQ_BANDS = [
  { key: 'low',  label: 'L', freq: 80 },
  { key: 'mid',  label: 'M', freq: 1000 },
  { key: 'high', label: 'H', freq: 8000 },
]

const masterTrack  = computed(() => mixerTracks[0])
const insertTracks = computed(() => mixerTracks.slice(1))

const renamingIdx  = ref(-1)

function closeRename() { renamingIdx.value = -1 }

// ── Channel routing ────────────────────────────────────────────────────────
function getRoutedChannels(trackIdx) {
  return channels.filter(ch => ch.mixerTrack === trackIdx)
}
const masterChannels = computed(() => channels.filter(ch => !ch.mixerTrack))

function routeTitle(idx) {
  const chs = getRoutedChannels(idx)
  return chs.length ? chs.map(c => c.name).join(', ') : 'No channels routed here'
}

// ── Peak meters ────────────────────────────────────────────────────────────
const NUM_TRACKS = mixerTracks.length   // master + 8 inserts
const peakLevels = ref(Array(NUM_TRACKS).fill(0))
const peakHolds  = ref(Array(NUM_TRACKS).fill(0))
const holdTimers = Array(NUM_TRACKS).fill(0)

let meterBufs = null
let meterRaf  = null

function updateMeters() {
  if (!meterBufs) meterBufs = Array(NUM_TRACKS).fill(null)

  for (let i = 0; i < NUM_TRACKS; i++) {
    const analyser = getMixerAnalyser(i)
    if (!analyser) continue
    if (!meterBufs[i] || meterBufs[i].length !== analyser.fftSize) {
      meterBufs[i] = new Float32Array(analyser.fftSize)
    }
    analyser.getFloatTimeDomainData(meterBufs[i])
    const peak = meterBufs[i].reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    peakLevels.value[i] = peak

    // Hold peak for 1.5s
    if (peak > peakHolds.value[i]) {
      peakHolds.value[i] = peak
      holdTimers[i] = Date.now()
    } else if (Date.now() - holdTimers[i] > 1500) {
      peakHolds.value[i] = Math.max(0, peakHolds.value[i] - 0.005)
    }
  }

  meterRaf = requestAnimationFrame(updateMeters)
}

onMounted(() => { meterRaf = requestAnimationFrame(updateMeters) })
onBeforeUnmount(() => { cancelAnimationFrame(meterRaf) })

// ── Meter helpers ──────────────────────────────────────────────────────────
function peakPct(idx) {
  return Math.min(100, peakLevels.value[idx] * 100).toFixed(1)
}
function peakHoldPct(idx) {
  return Math.min(100, peakHolds.value[idx] * 100).toFixed(1)
}
function peakColor(level) {
  if (level > 0.85) return '#e74c3c'
  if (level > 0.55) return '#f39c12'
  return '#2ecc71'
}
function peakDb(idx) {
  const v = peakLevels.value[idx]
  if (v <= 0.001) return '-∞'
  return (20 * Math.log10(v)).toFixed(1)
}

// ── Volume / Pan helpers ───────────────────────────────────────────────────
function volToDb(v) {
  if (v <= 0.001) return '-∞'
  const db = 20 * Math.log10(v)
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB'
}
function panLabel(p) {
  if (Math.abs(p) < 0.01) return 'C'
  const pct = Math.round(Math.abs(p) * 100)
  return p < 0 ? `L${pct}` : `R${pct}`
}
</script>

<style scoped>
/* ── Panel ──────────────────────────────────────────────────────────────── */
.mixer-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #07070e;
  overflow: hidden;
  user-select: none;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.mx-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  background: #0a0a14;
  border-bottom: 1px solid #161626;
  flex-shrink: 0;
}
.mx-title {
  font-family: 'Rajdhani', sans-serif;
  font-size: 11px; font-weight: 700; letter-spacing: 0.2em;
  color: #303050; text-transform: uppercase;
}
.mx-hint {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: #1c1c30;
}
.mx-spacer { flex: 1; }

.mx-master-vol-wrap {
  display: flex; align-items: center; gap: 6px;
}
.mx-mlabel {
  font-family: 'Rajdhani', sans-serif;
  font-size: 8px; font-weight: 700; letter-spacing: 0.15em;
  color: #2a2a40; text-transform: uppercase;
}
.mx-master-vol-slider {
  width: 90px; accent-color: #e74c3c; cursor: pointer;
}
.mx-master-db {
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px; color: #e74c3c; min-width: 54px;
}

/* ── Strips scroll wrapper ──────────────────────────────────────────────── */
.mx-strips-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  min-height: 0;
}
.mx-strips {
  display: flex;
  height: 100%;
  align-items: stretch;
  padding: 0 8px;
  gap: 2px;
  min-width: max-content;
}

/* ── Individual strip ───────────────────────────────────────────────────── */
.mx-strip {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 72px;
  min-width: 72px;
  background: #0c0c18;
  border: 1px solid #151525;
  border-top: none;
  padding: 0 4px 6px;
  gap: 4px;
  transition: background 0.1s;
  position: relative;
}
.mx-strip:hover { background: #0e0e1e; }
.mx-strip.mx-muted { opacity: 0.45; }
.mx-strip.mx-soloed { background: #0e0e20; }

.mx-master {
  width: 82px; min-width: 82px;
  background: #0f090a;
  border-color: #2a1010;
}
.mx-master:hover { background: #120b0b; }

/* ── Color accent bar ───────────────────────────────────────────────────── */
.mx-accent {
  width: 100%; height: 3px;
  flex-shrink: 0;
  border-radius: 0 0 2px 2px;
}

/* ── Routing dots ───────────────────────────────────────────────────────── */
.mx-routes {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2px;
  min-height: 10px;
  padding: 2px 0;
}
.mx-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.mx-dot-empty {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #1c1c2a;
}

/* ── Name ───────────────────────────────────────────────────────────────── */
.mx-name-area {
  width: 100%;
  display: flex;
  justify-content: center;
}
.mx-name {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.12em;
  color: var(--accent, #5050a0);
  text-transform: uppercase;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}
.mx-master-name { color: #e74c3c; cursor: default; }
.mx-name-input {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
  background: #0a0a18; border: 1px solid #303055;
  color: var(--accent, #7070c0);
  width: 100%; text-align: center;
  padding: 1px 2px; border-radius: 2px; outline: none;
}

/* ── Peak meter ─────────────────────────────────────────────────────────── */
.mx-meter {
  display: flex; flex-direction: column; align-items: center;
  gap: 2px; width: 100%;
}
.mx-meter-bg {
  width: 18px; height: 80px;
  background: #070710;
  border: 1px solid #111120;
  border-radius: 2px;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.mx-meter-fill {
  width: 100%;
  transition: height 0.06s ease-out;
  border-radius: 1px 1px 0 0;
}
.mx-meter-peak-hold {
  position: absolute;
  left: 0; right: 0;
  height: 2px;
  background: rgba(255,255,255,0.4);
}
.mx-meter-db {
  font-family: 'Share Tech Mono', monospace;
  font-size: 7px; color: #252535; text-align: center;
}

/* ── EQ section ─────────────────────────────────────────────────────────── */
.mx-eq {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.mx-eq-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 7px; font-weight: 700; letter-spacing: 0.15em;
  color: #1e1e30; text-transform: uppercase;
}
.mx-eq-bands {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
}
.mx-eq-band {
  display: flex;
  align-items: center;
  gap: 3px;
}
.mx-eq-bl {
  font-family: 'Rajdhani', sans-serif;
  font-size: 8px; font-weight: 700;
  color: #2a2a40; width: 9px; text-align: center;
  flex-shrink: 0;
}
.mx-eq-track {
  flex: 1; position: relative;
}
.mx-eq-zero {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 1px; height: 8px;
  background: #1a1a28;
  pointer-events: none;
}
.mx-eq-slider {
  width: 100%; height: 3px;
  accent-color: var(--accent, #6060a0);
  cursor: pointer;
}
.mx-eq-val {
  font-family: 'Share Tech Mono', monospace;
  font-size: 7px; color: #252535;
  min-width: 14px; text-align: right;
  flex-shrink: 0;
}

.mx-eq-spacer { height: 68px; }

/* ── Volume fader ───────────────────────────────────────────────────────── */
.mx-fader-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 100%;
  flex: 1;
}
.mx-fader-wrap {
  position: relative;
  width: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}
.mx-fader-unity {
  position: absolute;
  width: 30px; height: 1px;
  background: #1e1e32;
  top: calc(100% - (80% * 1));
  pointer-events: none;
}
.mx-fader {
  width: 100%;
  writing-mode: vertical-lr;
  direction: rtl;
  height: 100%;
  min-height: 70px;
  accent-color: var(--accent, #6060a0);
  cursor: pointer;
}
.mx-vol-db {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: #353555;
  text-align: center; min-width: 54px;
}

/* ── Pan ────────────────────────────────────────────────────────────────── */
.mx-pan-area {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
}
.mx-pan-lbl {
  font-family: 'Rajdhani', sans-serif;
  font-size: 7px; font-weight: 700; letter-spacing: 0.12em;
  color: #1e1e30;
  flex-shrink: 0;
}
.mx-pan-slider {
  flex: 1; height: 3px;
  accent-color: var(--accent, #6060a0);
  cursor: pointer;
}
.mx-pan-val {
  font-family: 'Share Tech Mono', monospace;
  font-size: 7px; color: #252535;
  min-width: 22px; text-align: right;
  flex-shrink: 0;
}
.mx-pan-center {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: #252535; flex: 1; text-align: center;
}

/* ── Mute / Solo ────────────────────────────────────────────────────────── */
.mx-ms {
  display: flex;
  gap: 3px;
}
.mx-btn {
  width: 24px; height: 18px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  border-radius: 3px; border: 1px solid #1c1c2c;
  background: transparent; color: #2a2a3e; cursor: pointer;
  transition: all 0.1s; outline: none;
  display: flex; align-items: center; justify-content: center;
}
.mx-mute-btn:hover { border-color: #e74c3c; color: #e74c3c; }
.mx-mute-btn.active {
  border-color: #e74c3c; color: #e74c3c; background: #1a0505;
  box-shadow: 0 0 6px #e74c3c44;
}
.mx-solo-btn:hover { border-color: #f39c12; color: #f39c12; }
.mx-solo-btn.active {
  border-color: #f39c12; color: #f39c12; background: #1a0e00;
  box-shadow: 0 0 6px #f39c1244;
}

/* ── Track number ───────────────────────────────────────────────────────── */
.mx-track-num {
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px; letter-spacing: 0.05em;
  opacity: 0.7;
}

/* ── Master separator ───────────────────────────────────────────────────── */
.mx-sep {
  width: 1px;
  align-self: stretch;
  background: #1a1a2c;
  margin: 8px 4px;
  flex-shrink: 0;
}
</style>
