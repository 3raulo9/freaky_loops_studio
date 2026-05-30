<template>
  <div class="piano-roll">

    <!-- ── Scale snap toolbar ──────────────────────────────────────────── -->
    <div class="pr-scale-bar">
      <label class="pr-scale-toggle" :class="{ on: snapScale.enabled }">
        <input type="checkbox" v-model="snapScale.enabled" />
        <span>SCALE</span>
      </label>

      <template v-if="snapScale.enabled">
        <!-- Root note selector -->
        <select v-model.number="snapScale.tonic" class="pr-scale-select">
          <option v-for="(n, i) in NOTE_NAMES" :key="i" :value="i">{{ n }}</option>
        </select>

        <!-- Scale type selector -->
        <select v-model="snapScale.scale" class="pr-scale-select">
          <option value="major">Major</option>
          <option value="minor">Minor</option>
          <option value="harmMinor">Harm. Minor</option>
          <option value="pentatonic">Pentatonic</option>
          <option value="minPent">Min. Pent.</option>
          <option value="blues">Blues</option>
          <option value="dorian">Dorian</option>
          <option value="phrygian">Phrygian</option>
          <option value="lydian">Lydian</option>
          <option value="mixolydian">Mixolydian</option>
          <option value="locrian">Locrian</option>
          <option value="chromatic">Chromatic</option>
        </select>

        <!-- Scale note chips -->
        <div class="pr-scale-notes">
          <span
            v-for="(semitone, i) in scaleIntervals"
            :key="i"
            class="pr-scale-chip"
            :class="{ root: i === 0 }"
          >{{ NOTE_NAMES[(snapScale.tonic + semitone) % 12] }}</span>
        </div>
      </template>
    </div>

    <!-- ── Column headers ─────────────────────────────────────────────── -->
    <div class="pr-header" :style="{ '--cols': totalSteps }">
      <div class="pr-key-spacer" />
      <div v-for="s in totalSteps" :key="s" class="pr-step-hdr"
        :class="{ beat: (s-1)%4===0, playing: isPlaying && displayStep === s-1 }">
        <span v-if="(s-1)%4===0">{{ s }}</span>
      </div>
    </div>

    <!-- ── Scrollable grid ────────────────────────────────────────────── -->
    <div class="pr-body" ref="bodyRef">
      <div
        v-for="pitch in PIANO_KEYS" :key="pitch"
        class="pr-row"
        :class="{
          black:       isBlackKey(pitch),
          'c-note':    pitch % 12 === 0,
          'scale-in':  snapScale.enabled && scaleSet.has(pitch % 12),
          'scale-out': snapScale.enabled && !scaleSet.has(pitch % 12),
          'scale-root': snapScale.enabled && pitch % 12 === snapScale.tonic,
        }"
      >
        <!-- Piano key -->
        <div class="pr-key"
          :class="{
            black:       isBlackKey(pitch),
            'scale-in':  snapScale.enabled && scaleSet.has(pitch % 12),
            'scale-root': snapScale.enabled && pitch % 12 === snapScale.tonic,
          }"
          @mousedown.prevent="previewNote(pitch)">
          <span v-if="pitch % 12 === 0" class="key-label">{{ midiToLabel(pitch) }}</span>
        </div>

        <!-- Step cells -->
        <div v-for="s in totalSteps" :key="s"
          class="pr-cell"
          :class="{
            lit:     noteSet.has(s-1 + ':' + pitch),
            playing: isPlaying && displayStep === s-1,
            beat:    (s-1)%4===0,
            black:   isBlackKey(pitch),
            'out-of-scale': snapScale.enabled && !scaleSet.has(pitch % 12),
          }"
          @mousedown.prevent="onCellDown(s-1, pitch)"
          @mouseenter="onCellEnter(s-1, pitch)"
        />
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useStudio, PIANO_KEYS, isBlackKey, midiToLabel, SCALE_DEFS, NOTE_NAMES } from '../store/studio.js'

const props = defineProps({ ch: { type: Object, required: true } })
const { totalSteps, isPlaying, displayStep, togglePianoNote, getPatData, playNote, snapScale } = useStudio()

// ── Scale helpers ──────────────────────────────────────────────────────────
const scaleIntervals = computed(() => SCALE_DEFS[snapScale.scale] ?? SCALE_DEFS.major)
const scaleSet = computed(() => {
  if (!snapScale.enabled) return new Set()
  const intervals = scaleIntervals.value
  return new Set(intervals.map(i => (snapScale.tonic + i) % 12))
})

// ── Note set for O(1) lookup ───────────────────────────────────────────────
const noteSet = computed(() => {
  const d = getPatData(props.ch.id)
  const s = new Set()
  d.pianoNotes.forEach(n => s.add(n.step + ':' + n.pitch))
  return s
})

function hasNote(step, pitch) { return noteSet.value.has(step + ':' + pitch) }
function previewNote(pitch)   { playNote(props.ch, pitch) }

const bodyRef = ref(null)
let painting = false; let paintMode = null

function onCellDown(step, pitch) {
  painting  = true
  paintMode = hasNote(step, pitch) ? 'remove' : 'add'
  togglePianoNote(props.ch.id, step, pitch)
  playNote(props.ch, pitch)
}
function onCellEnter(step, pitch) {
  if (!painting) return
  const has = hasNote(step, pitch)
  if (paintMode === 'add'    && !has) { togglePianoNote(props.ch.id, step, pitch); playNote(props.ch, pitch) }
  if (paintMode === 'remove' &&  has) { togglePianoNote(props.ch.id, step, pitch) }
}

onMounted(() => {
  window.addEventListener('mouseup', () => { painting = false })
  if (bodyRef.value) {
    const c4idx = 84 - 60
    bodyRef.value.scrollTop = c4idx * 16 - bodyRef.value.clientHeight / 2
  }
})
</script>

<style scoped>
.piano-roll { display: flex; flex-direction: column; flex: 1; overflow: hidden; background: #0e0e1a; }

/* ── Scale bar ──────────────────────────────────────────────────────────── */
.pr-scale-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: #090912;
  border-bottom: 1px solid #141422;
  flex-shrink: 0;
  flex-wrap: wrap;
  min-height: 24px;
}
.pr-scale-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.pr-scale-toggle input { display: none; }
.pr-scale-toggle span {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.15em;
  color: #2a2a3e;
  padding: 2px 6px;
  border: 1px solid #1e1e2e;
  border-radius: 3px;
  transition: all 0.1s;
  user-select: none;
}
.pr-scale-toggle.on span {
  color: #1abc9c; border-color: #1abc9c; background: #001a14;
  box-shadow: 0 0 6px #1abc9c33;
}
.pr-scale-select {
  background: #0a0a18; border: 1px solid #1a1a2c; color: #6060a0;
  font-family: 'Share Tech Mono', monospace; font-size: 9px;
  padding: 2px 4px; border-radius: 3px; cursor: pointer; outline: none;
}
.pr-scale-select:focus { border-color: #1abc9c; }
.pr-scale-notes {
  display: flex; gap: 3px; flex-wrap: wrap;
}
.pr-scale-chip {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: #1abc9c;
  padding: 1px 4px;
  background: #001a14;
  border: 1px solid #0a3028;
  border-radius: 2px;
}
.pr-scale-chip.root {
  color: #fff; background: #1abc9c; border-color: #1abc9c; font-weight: 700;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.pr-header {
  display: grid; grid-template-columns: 44px repeat(var(--cols), 1fr);
  flex-shrink: 0; background: #0a0a12; border-bottom: 1px solid #1a1a28; height: 20px;
}
.pr-key-spacer { border-right: 1px solid #1a1a28; }
.pr-step-hdr {
  display: flex; align-items: center; justify-content: center;
  font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #44446a; transition: background 0.06s;
}
.pr-step-hdr.beat    { border-left: 1px solid #252535; }
.pr-step-hdr.playing { background: rgba(255,255,255,0.12); color: #fff; }

/* ── Body ───────────────────────────────────────────────────────────────── */
.pr-body   { flex: 1; overflow-y: auto; overflow-x: auto; }
.pr-row {
  display: grid; grid-template-columns: 44px repeat(v-bind('totalSteps'), minmax(22px, 1fr));
  height: 16px; border-bottom: 1px solid #111118;
}
.pr-row.black  { background: #0b0b14; }
.pr-row.c-note { border-top: 1px solid #1e1e30; }

/* Scale highlighting on rows */
.pr-row.scale-in  { background: rgba(26, 188, 156, 0.04); }
.pr-row.scale-out { background: rgba(0,0,0,0.18); }
.pr-row.scale-root { background: rgba(26, 188, 156, 0.09) !important; }
.pr-row.black.scale-in  { background: rgba(26, 188, 156, 0.06); }
.pr-row.black.scale-out { background: rgba(0,0,0,0.25); }

/* ── Keys ───────────────────────────────────────────────────────────────── */
.pr-key {
  display: flex; align-items: center; justify-content: flex-end; padding-right: 4px;
  border-right: 1px solid #1a1a28; background: #f5f5f5; cursor: pointer; transition: background 0.08s;
}
.pr-key.black       { background: #222; }
.pr-key:hover       { background: #ddd; }
.pr-key.black:hover { background: #444; }
.pr-key.scale-in  { background: #e8faf7; }
.pr-key.black.scale-in { background: #1a3830; }
.pr-key.scale-root { background: #1abc9c !important; }
.pr-key.scale-root:hover { background: #16a085 !important; }
.key-label { font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #333; line-height: 1; }
.pr-key.black .key-label { color: #aaa; }
.pr-key.scale-root .key-label { color: #fff; }

/* ── Cells ──────────────────────────────────────────────────────────────── */
.pr-cell {
  border-right: 1px solid #131320; background: transparent; cursor: crosshair; user-select: none;
}
.pr-cell.black   { background: rgba(0,0,0,0.15); }
.pr-cell.beat    { border-left: 1px solid #1e1e32; }
.pr-cell.playing { background: rgba(255,255,255,0.07) !important; }
.pr-cell.out-of-scale { background: rgba(0,0,0,0.3); }
.pr-cell.black.out-of-scale { background: rgba(0,0,0,0.45); }
.pr-cell.lit {
  background: v-bind('props.ch.color');
  border-color: color-mix(in srgb, v-bind('props.ch.color') 70%, #000);
  box-shadow: 0 0 4px color-mix(in srgb, v-bind('props.ch.color') 50%, transparent);
}
.pr-cell.lit.playing { filter: brightness(1.3); }
.pr-cell:hover:not(.lit) { background: color-mix(in srgb, v-bind('props.ch.color') 20%, transparent); }
</style>
