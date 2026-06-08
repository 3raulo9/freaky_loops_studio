<template>
  <div class="piano-roll"
    @mouseenter="prFocused = true"
    @mouseleave="prFocused = false"
    @wheel="onWheel"
    @click="rulerCtx = null">

    <!-- ── Channel selector title bar ─────────────────────────────────── -->
    <div class="pr-title-bar">
      <span class="pr-title-text">PIANO ROLL</span>

      <!-- Target channel dropdown -->
      <div class="pr-ch-sel" @click.stop="chDropOpen = !chDropOpen" @wheel.prevent="onChSelWheel">
        <span class="pr-ch-dot" :style="{ background: targetCh.color }" />
        <span class="pr-ch-name">{{ targetCh.name }}</span>
        <span class="pr-ch-caret">▾</span>
        <div v-if="chDropOpen" class="pr-ch-drop" @click.stop>
          <div v-for="ch in pianoChannels" :key="ch.id"
            class="pr-ch-item" :class="{ active: ch.id === targetChId }"
            @click="switchChannel(ch.id)">
            <span class="pr-ch-item-dot" :style="{ background: ch.color }" />
            <span>{{ ch.name }}</span>
            <span v-if="chHasNotes(ch.id)" class="pr-ch-tick">✓</span>
          </div>
        </div>
      </div>

      <!-- Ghost notes toggle -->
      <button class="pr-ghost-btn" :class="{ on: ghostsEnabled }"
        @click="ghostsEnabled = !ghostsEnabled" title="Show other channels as ghost notes (Alt+V)">
        GHOST
      </button>

      <span class="pr-title-info">{{ currentNotes.length }} notes{{ selectedNotes.size > 0 ? ' · ' + selectedNotes.size + ' sel' : '' }}</span>
    </div>

    <!-- ── Toolbar ─────────────────────────────────────────────────────── -->
    <div class="pr-bar">
      <!-- Tools: P=Draw, B=Paint, E=Select, T=Mute, D=Erase -->
      <div class="pr-tools">
        <button v-for="t in TOOLS" :key="t.key"
          class="pr-tool" :class="{ active: tool === t.key }"
          :title="t.label" @click="tool = t.key">{{ t.icon }}</button>
      </div>

      <div class="pr-sep" />

      <!-- Snap -->
      <span class="pr-lbl">SNAP</span>
      <select v-model.number="snapTicks" class="pr-sel">
        <option :value="30">1/64</option>
        <option :value="60">1/32</option>
        <option :value="120">1/16</option>
        <option :value="240">1/8</option>
        <option :value="480">1/4</option>
        <option :value="960">1/2</option>
        <option :value="1920">1 BAR</option>
      </select>

      <div class="pr-sep" />

      <!-- Zoom -->
      <button class="pr-zbtn" @click="adjustZoom(-10)">−</button>
      <span class="pr-lbl" style="min-width:30px; text-align:center">{{ pxPerStep }}</span>
      <button class="pr-zbtn" @click="adjustZoom(+10)">+</button>

      <div class="pr-sep" />

      <!-- Scale snap -->
      <label class="pr-scale-toggle" :class="{ on: snapScale.enabled }">
        <input type="checkbox" v-model="snapScale.enabled" />
        <span>SCALE</span>
      </label>
      <template v-if="snapScale.enabled">
        <select v-model.number="snapScale.tonic" class="pr-sel">
          <option v-for="(n, i) in NOTE_NAMES" :key="i" :value="i">{{ n }}</option>
        </select>
        <select v-model="snapScale.scale" class="pr-sel">
          <option v-for="(_, k) in SCALE_DEFS" :key="k" :value="k">{{ k }}</option>
        </select>
        <div class="pr-scale-chips">
          <span v-for="(s, i) in scaleIntervals" :key="i"
            class="pr-scale-chip" :class="{ root: i === 0 }">
            {{ NOTE_NAMES[(snapScale.tonic + s) % 12] }}
          </span>
        </div>
      </template>

      <div class="pr-bar-right">
        <button class="pr-clr-btn" @click="clearNotes">CLR</button>
      </div>
    </div>

    <!-- ── Main body: keys + scrollable grid ──────────────────────────── -->
    <div class="pr-body">

      <!-- Piano keyboard (vertically synced) -->
      <div class="pr-keys-col">
        <div class="pr-keys-ruler-spc" />
        <div class="pr-keys-inner" ref="keysInnerRef">
          <div v-for="pitch in PIANO_KEYS" :key="pitch"
            class="pr-key"
            :style="{ height: ROW_H + 'px' }"
            :class="{
              black:        isBlackKey(pitch),
              'c-note':     pitch % 12 === 0,
              'scale-root': snapScale.enabled && pitch % 12 === snapScale.tonic,
              'scale-in':   snapScale.enabled && scaleSet.has(pitch % 12),
              active:       activePitch === pitch,
            }"
            @mousedown.prevent="onKeyPress(pitch)"
            @mouseenter="onKeyHover(pitch)">
            <span v-if="pitch % 12 === 0 || (snapScale.enabled && pitch % 12 === snapScale.tonic)"
              class="pr-key-lbl">{{ midiToLabel(pitch) }}</span>
          </div>
        </div>
      </div>

      <!-- Scrollable roll area -->
      <div class="pr-scroll" ref="scrollRef" @scroll="onScroll">
        <div class="pr-content" :style="{ width: gridWidth + 'px' }">

          <!-- Ruler (sticky top) -->
          <div class="pr-ruler"
            @mousedown="onRulerMouseDown"
            @contextmenu.prevent="onRulerContextMenu">
            <div v-for="m in rulerMarks" :key="m.x"
              class="pr-ruler-mark" :class="{ bar: m.isBar, beat: m.isBeat }"
              :style="{ left: m.x + 'px' }">{{ m.label }}</div>
            <!-- Loop region red band (RMB / Ctrl+LMB drag selection) -->
            <div v-if="loopRegion" class="pr-loop-band"
              :style="{
                left:  (loopRegion.startTick * pxPerTick) + 'px',
                width: ((loopRegion.endTick - loopRegion.startTick) * pxPerTick) + 'px'
              }" />
            <!-- Void dim in ruler beyond pattern end -->
            <div class="pr-ruler-void"
              :style="{ left: (patLengthTicks * pxPerTick) + 'px' }" />
            <!-- Pattern length marker — drag to resize, right-click ruler to set/clear -->
            <div class="pr-pat-end"
              :style="{ left: (patLengthTicks * pxPerTick) + 'px' }"
              title="Pattern loop end — drag to resize"
              @mousedown.left.stop.prevent="onPatEndDragStart" />
            <div class="pr-ruler-head" :style="{ left: playheadX + 'px' }" />
          </div>

          <!-- Ruler right-click context menu -->
          <div v-if="rulerCtx" class="pr-ruler-ctx"
            :style="{ left: rulerCtx.x + 'px', top: rulerCtx.y + 'px' }"
            @click.stop>
            <div class="pr-ctx-item" @click="applyPatternLength">
              Set pattern length — {{ rulerCtx.tick / TICKS_PER_BAR }} bar{{ rulerCtx.tick / TICKS_PER_BAR !== 1 ? 's' : '' }}
            </div>
            <div class="pr-ctx-item" @click="clearPatternLength">
              Clear pattern length override
            </div>
            <div class="pr-ctx-item pr-ctx-cancel" @click="rulerCtx = null">Cancel</div>
          </div>

          <!-- Grid -->
          <div class="pr-grid" ref="gridRef"
            :style="{ height: gridHeight + 'px' }"
            @mousedown="onGridDown"
            @contextmenu.prevent>

            <!-- Pitch lane backgrounds -->
            <div v-for="(pitch, ri) in PIANO_KEYS" :key="'l' + pitch"
              class="pr-lane"
              :class="{
                black:        isBlackKey(pitch),
                'scale-in':   snapScale.enabled && scaleSet.has(pitch % 12),
                'scale-out':  snapScale.enabled && !scaleSet.has(pitch % 12),
                'scale-root': snapScale.enabled && pitch % 12 === snapScale.tonic,
                'c-border':   pitch % 12 === 0,
              }"
              :style="{ top: (ri * ROW_H) + 'px', height: ROW_H + 'px' }" />

            <!-- Vertical grid lines -->
            <div v-for="vl in gridLines" :key="'vl' + vl.t"
              class="pr-vline"
              :class="{ bar: vl.isBar, beat: vl.isBeat, snap: vl.isSnap }"
              :style="{ left: (vl.t * pxPerTick) + 'px', height: gridHeight + 'px' }" />

            <!-- Dark void beyond the active pattern zone — infinite horizon fades here.
                 Placed BEFORE the end-marker and notes so it dims the lanes/lines but
                 does not cover them (DOM order, no z-index needed). -->
            <div class="pr-void-zone"
              :style="{
                left: (patLengthTicks * pxPerTick) + 'px',
                width: ((canvasTicks - patLengthTicks) * pxPerTick) + 'px',
                height: gridHeight + 'px'
              }" />

            <!-- Pattern length end marker (vertical line at loop-end tick) -->
            <div class="pr-pat-end-line"
              :style="{ left: (patLengthTicks * pxPerTick) + 'px', height: gridHeight + 'px' }" />

            <!-- Ghost notes (other channels, behind active notes) -->
            <template v-if="ghostsEnabled">
              <div v-for="(gn, gi) in ghostNotes" :key="'g' + gi"
                class="pr-ghost" :style="ghostStyle(gn)" />
            </template>

            <!-- Active channel notes — only the viewport-visible subset is rendered -->
            <div v-for="{ note, idx } in visibleNotesWithIdx" :key="'n' + idx"
              class="pr-note"
              :class="{ selected: selectedNotes.has(idx), muted: note.muted }"
              :style="noteStyle(note)"
              @mousedown.prevent.stop="onNoteDown($event, idx)">
              <span v-if="(note.durationTicks ?? TICKS_PER_STEP) * pxPerTick > 32" class="pr-note-lbl">
                {{ midiToLabel(note.pitch) }}
              </span>
              <!-- Resize handle on right edge -->
              <div class="pr-note-rh" @mousedown.prevent.stop="onResizeDown($event, idx)" />
            </div>

            <!-- Rubber-band selection rectangle -->
            <div v-if="selBox" class="pr-selbox" :style="selBoxStyle" />

            <!-- Playhead -->
            <div class="pr-playhead" :style="{ left: playheadX + 'px', height: gridHeight + 'px' }" />
          </div>
        </div>
      </div>
    </div>

    <!-- ── Control pane (velocity / pan) ──────────────────────────────── -->
    <div class="pr-ctrl-outer">
      <!-- Left tabs column (synced height with piano keys ruler spacer) -->
      <div class="pr-ctrl-tabs-col">
        <button v-for="tab in CTRL_TABS" :key="tab.key"
          class="pr-ctrl-tab" :class="{ active: ctrlTarget === tab.key }"
          @click="ctrlTarget = tab.key">{{ tab.label }}</button>
      </div>
      <!-- Scrollable control bars -->
      <div class="pr-ctrl-view" ref="ctrlViewRef">
        <div class="pr-ctrl-inner" ref="ctrlInnerRef">
          <div class="pr-ctrl-bg" :style="{ width: gridWidth + 'px' }"
            @mousedown.prevent="onCtrlDown"
            @mousemove="onCtrlMove"
            @mouseup="ctrlDrag = false"
            @mouseleave="ctrlDrag = false">

            <!-- Center line for pan view -->
            <div v-if="ctrlTarget === 'pan'" class="pr-ctrl-cline" />

            <!-- Bars for each note -->
            <div v-for="(note, idx) in currentNotes" :key="'cb' + idx"
              class="pr-ctrl-bar"
              :class="{ selected: selectedNotes.has(idx) }"
              :style="ctrlBarStyle(note)" />

            <!-- Grid lines -->
            <div v-for="vl in gridLines" :key="'cvl' + vl.t"
              class="pr-ctrl-vline"
              :class="{ bar: vl.isBar, beat: vl.isBeat }"
              :style="{ left: (vl.t * pxPerTick) + 'px' }" />

            <!-- Playhead -->
            <div class="pr-ctrl-head" :style="{ left: playheadX + 'px' }" />
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  useStudio, PIANO_KEYS, isBlackKey, midiToLabel,
  SCALE_DEFS, NOTE_NAMES,
} from '../store/studio.js'

const props = defineProps({ ch: { type: Object, required: true } })

const {
  totalSteps, displayStep, channels, selectedChannelId, currentPatternId,
  getPatData, playNote, stopNote, snapScale, pushUndo,
  getPatternLengthTicks, setPatternLengthOverride, clearPatternLengthOverride,
  loopRegion, setLoopRegion, clearLoopRegion,
} = useStudio()

// ── Constants ──────────────────────────────────────────────────────────────────
const ROW_H   = 16   // px per pitch row
const RULER_H = 20   // px for time ruler
const TICKS_PER_BEAT = 480
const TICKS_PER_STEP = 120   // 1/16 note
const TICKS_PER_BAR  = 1920  // 4 beats

const TOOLS = [
  { key: 'draw',   icon: '✏', label: 'Draw (P) — click to add, drag to move/resize' },
  { key: 'paint',  icon: '⬛', label: 'Paint (B) — drag to paint notes horizontally' },
  { key: 'select', icon: '⬚', label: 'Select (E) — rubber-band select, Ctrl+A all, Del to delete' },
  { key: 'mute',   icon: '○', label: 'Mute (T) — click to toggle note mute' },
  { key: 'erase',  icon: '✕', label: 'Erase (D) — click/drag to delete notes' },
]

const CTRL_TABS = [
  { key: 'velocity', label: 'VEL' },
  { key: 'pan',      label: 'PAN' },
]

// ── UI state ───────────────────────────────────────────────────────────────────
const tool        = ref('draw')
const pxPerStep   = ref(40)
const snapTicks   = ref(120)   // default 1/16 note
const ctrlTarget  = ref('velocity')
const ghostsEnabled = ref(false)
const prFocused   = ref(false)
const chDropOpen  = ref(false)

// Target channel (can differ from props.ch when user switches via selector)
const targetChId  = ref(props.ch.id)
watch(() => props.ch.id, id => { targetChId.value = id; chDropOpen.value = false })

const targetCh    = computed(() => channels.find(c => c.id === targetChId.value) ?? props.ch)
const pianoChannels = computed(() => channels.filter(c => c.mode === 'piano'))

function chHasNotes(chId) { return getPatData(chId).pianoNotes.length > 0 }

function switchChannel(id) {
  targetChId.value = id
  selectedChannelId.value = id  // sync global selection
  chDropOpen.value = false
}

function cyclePianoChannel(dir) {
  const list = pianoChannels.value
  if (list.length < 2) return
  const idx = list.findIndex(c => c.id === targetChId.value)
  switchChannel(list[(idx + dir + list.length) % list.length].id)
}

function adjustZoom(d) { pxPerStep.value = Math.max(8, Math.min(120, pxPerStep.value + d)) }

// ── Scale ──────────────────────────────────────────────────────────────────────
const scaleIntervals = computed(() => SCALE_DEFS[snapScale.scale] ?? SCALE_DEFS.major)
const scaleSet = computed(() => {
  if (!snapScale.enabled) return new Set()
  return new Set(scaleIntervals.value.map(i => (snapScale.tonic + i) % 12))
})

// ── Grid dimensions ────────────────────────────────────────────────────────────
const pxPerTick = computed(() => pxPerStep.value / TICKS_PER_STEP)

// Effective loop-point for the current pattern (auto or manually overridden).
const patLengthTicks = computed(() => getPatternLengthTicks(currentPatternId.value))

// How many bars to keep rendered beyond the rightmost visible or hovered point.
const HORIZON_BARS = 4

// Infinite canvas: always extends beyond whatever the user is currently looking at.
// The canvas grows from four sources — notes, scroll viewport, mouse hover, and the
// live playhead — and is always snapped to a bar boundary so ruler marks stay clean.
const canvasTicks = computed(() => {
  const ppt = pxPerTick.value
  const noteHorizon   = patLengthTicks.value + TICKS_PER_BAR * 2
  const viewHorizon   = (scrollLeftVal.value + scrollClientWidth.value) / ppt + TICKS_PER_BAR * HORIZON_BARS
  const mouseHorizon  = horiMouseX.value / ppt + TICKS_PER_BAR * HORIZON_BARS
  // During live recording the playhead advances; keep HORIZON_BARS of room ahead of it
  // so new bars materialise as the user plays, exactly as the spec describes.
  const playTick      = Math.max(0, displayStep.value) * TICKS_PER_STEP
  const playHorizon   = playTick + TICKS_PER_BAR * HORIZON_BARS
  const raw = Math.max(noteHorizon, viewHorizon, mouseHorizon, playHorizon, TICKS_PER_BAR * 4)
  return Math.ceil(raw / TICKS_PER_BAR) * TICKS_PER_BAR
})

const gridWidth  = computed(() => canvasTicks.value * pxPerTick.value)
const gridHeight = computed(() => PIANO_KEYS.length * ROW_H)
const playheadX  = computed(() => Math.max(0, displayStep.value) * pxPerStep.value)

// ── Notes ──────────────────────────────────────────────────────────────────────
const currentNotes   = computed(() => getPatData(targetChId.value).pianoNotes)
const selectedNotes  = ref(new Set())

const GHOST_NOTE_CAP = 800  // prevent O(N×channels) blow-up on large imports
const ghostNotes = computed(() => {
  if (!ghostsEnabled.value) return []
  const result = []
  for (const c of channels) {
    if (c.id === targetChId.value || c.mode !== 'piano') continue
    for (const n of getPatData(c.id).pianoNotes) {
      if (result.length >= GHOST_NOTE_CAP) return result
      result.push({ ...n, _color: c.color })
    }
  }
  return result
})

// Viewport-clipped note list — only the notes visible (or within 2 bars) of the
// current horizontal scroll window are returned. Original indices are preserved
// so selectedNotes.has(idx) and onNoteDown($event, idx) still target the right note.
const visibleNotesWithIdx = computed(() => {
  const all = currentNotes.value
  const ppt = pxPerTick.value
  if (ppt <= 0) return all.map((note, idx) => ({ note, idx }))
  const BUFFER = TICKS_PER_BAR * 2
  const visStart = Math.max(0, scrollLeftVal.value / ppt - BUFFER)
  const visEnd   = (scrollLeftVal.value + scrollClientWidth.value) / ppt + BUFFER
  const result = []
  for (let idx = 0; idx < all.length; idx++) {
    const note = all[idx]
    const noteEnd = note.startTick + (note.durationTicks ?? TICKS_PER_STEP)
    if (noteEnd >= visStart && note.startTick <= visEnd) result.push({ note, idx })
  }
  return result
})

function clearNotes() {
  pushUndo()
  currentNotes.value.length = 0
  selectedNotes.value = new Set()
}

// ── Ruler / grid line marks ────────────────────────────────────────────────────
// Only generate marks/lines inside the visible scroll viewport + a 1-bar buffer
// on each side. This keeps DOM count constant (~20-40 divs) regardless of song
// length, which is critical after importing long MIDI files.
const rulerMarks = computed(() => {
  const ppt = pxPerTick.value
  if (ppt <= 0) return []
  const left  = scrollLeftVal.value
  const right = left + scrollClientWidth.value
  const startT = Math.max(0,                Math.floor((left  / ppt) / TICKS_PER_BEAT) * TICKS_PER_BEAT)
  const endT   = Math.min(canvasTicks.value, Math.ceil ((right / ppt) / TICKS_PER_BEAT) * TICKS_PER_BEAT + TICKS_PER_BEAT)
  const marks = []
  for (let t = startT; t < endT; t += TICKS_PER_BEAT) {
    const isBar = t % TICKS_PER_BAR === 0
    marks.push({
      x: t * ppt, isBar, isBeat: !isBar,
      label: isBar
        ? String(t / TICKS_PER_BAR + 1)
        : (pxPerStep.value >= 12 ? String(Math.floor(t / TICKS_PER_BEAT) + 1) : ''),
    })
  }
  return marks
})

const gridLines = computed(() => {
  const ppt  = pxPerTick.value
  const snap = snapTicks.value
  if (ppt <= 0 || snap <= 0) return []
  const left  = scrollLeftVal.value
  const right = left + scrollClientWidth.value
  const startT = Math.max(0,                Math.floor((left  / ppt) / snap) * snap)
  const endT   = Math.min(canvasTicks.value, Math.ceil ((right / ppt) / snap) * snap + snap)
  const lines = []
  for (let t = startT; t <= endT; t += snap) {
    const isBar  = t % TICKS_PER_BAR === 0
    const isBeat = !isBar && t % TICKS_PER_BEAT === 0
    const isSnap = !isBar && !isBeat
    if (isBar || isBeat || (isSnap && pxPerStep.value >= 16))
      lines.push({ t, isBar, isBeat, isSnap })
  }
  return lines
})

// ── Coordinate helpers ─────────────────────────────────────────────────────────
function tickToX(t)   { return t * pxPerTick.value }
function xToTick(x)   { return x / pxPerTick.value }
function pitchToY(p)  { return PIANO_KEYS.indexOf(p) * ROW_H }
function yToPitch(y)  { return PIANO_KEYS[Math.max(0, Math.min(PIANO_KEYS.length - 1, Math.floor(y / ROW_H)))] }

function snapTick(t, alt = false) {
  if (alt) return Math.max(0, t)
  return Math.max(0, Math.round(t / snapTicks.value) * snapTicks.value)
}
function snapPitch(p) {
  if (!snapScale.enabled || scaleSet.value.has(p % 12)) return p
  const lo = PIANO_KEYS[PIANO_KEYS.length - 1], hi = PIANO_KEYS[0]
  for (let d = 1; d <= 12; d++) {
    if (p - d >= lo && scaleSet.value.has(((p - d) % 12 + 12) % 12)) return p - d
    if (p + d <= hi && scaleSet.value.has((p + d) % 12)) return p + d
  }
  return p
}

// Grid position from any mouse event (client coordinates → grid content coordinates)
function getGridPos(clientX, clientY) {
  const scroll = scrollRef.value
  if (!scroll) return { x: 0, y: 0 }
  const r = scroll.getBoundingClientRect()
  return {
    x: clientX - r.left + scroll.scrollLeft,
    y: clientY - r.top  + scroll.scrollTop - RULER_H,
  }
}

// Hit test: which note index is at grid (x,y)? -1 if none
function hitTest(x, y) {
  const notes = currentNotes.value
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]
    const nx = tickToX(n.startTick)
    const nw = Math.max(4, (n.durationTicks ?? TICKS_PER_STEP) * pxPerTick.value)
    const ny = pitchToY(n.pitch)
    if (x >= nx && x < nx + nw && y >= ny && y < ny + ROW_H) return i
  }
  return -1
}

// ── Note styling ───────────────────────────────────────────────────────────────
function noteStyle(note) {
  const durTicks = Math.max(snapTicks.value, note.durationTicks ?? TICKS_PER_STEP)
  const color = note.muted ? '#484860' : targetCh.value.color
  return {
    left: tickToX(note.startTick) + 'px',
    top:  pitchToY(note.pitch) + 'px',
    width: Math.max(4, durTicks * pxPerTick.value - 1) + 'px',
    height: (ROW_H - 1) + 'px',
    background: color,
    borderColor: note.muted ? '#333348' : `color-mix(in srgb, ${color} 55%, #000)`,
  }
}

function ghostStyle(note) {
  const durTicks = note.durationTicks ?? TICKS_PER_STEP
  return {
    left: tickToX(note.startTick) + 'px',
    top:  pitchToY(note.pitch) + 'px',
    width: Math.max(4, durTicks * pxPerTick.value - 1) + 'px',
    height: (ROW_H - 1) + 'px',
    background: note._color + '30',
    border: `1px solid ${note._color}55`,
  }
}

function ctrlBarStyle(note) {
  const nw = Math.max(3, snapTicks.value * pxPerTick.value - 2)
  const base = { position: 'absolute', left: tickToX(note.startTick) + 'px', width: nw + 'px' }
  const color = targetCh.value.color

  if (ctrlTarget.value === 'velocity') {
    const v = note.velocity ?? 0.8
    return { ...base, bottom: 0, height: (v * 100) + '%', background: color }
  }
  if (ctrlTarget.value === 'pan') {
    const p = note.pan ?? 0
    const h = Math.abs(p) * 50
    return {
      ...base,
      top: (p >= 0 ? (50 - h) : 50) + '%',
      height: Math.max(1, h) + '%',
      background: p >= 0 ? '#4ecdc4' : '#e74c3c',
    }
  }
  return base
}

// ── Refs ───────────────────────────────────────────────────────────────────────
const scrollRef    = ref(null)
const keysInnerRef = ref(null)
const ctrlInnerRef = ref(null)
const ctrlViewRef  = ref(null)
const gridRef      = ref(null)

// Reactive viewport state — updated by onScroll so canvasTicks can depend on them
const scrollLeftVal     = ref(0)    // scrollRef.scrollLeft
const scrollClientWidth  = ref(800) // scrollRef.clientWidth (initial guess, fixed on mount)
const scrollTopVal       = ref(0)   // scrollRef.scrollTop
const scrollClientHeight = ref(600) // scrollRef.clientHeight (initial guess)
const horiMouseX         = ref(0)   // rightmost grid-px the mouse has ever reached (high-water)

// ── Scroll sync ────────────────────────────────────────────────────────────────
function onScroll() {
  const el = scrollRef.value; if (!el) return
  scrollLeftVal.value      = el.scrollLeft
  scrollClientWidth.value  = el.clientWidth
  scrollTopVal.value       = el.scrollTop
  scrollClientHeight.value = el.clientHeight
  if (keysInnerRef.value) keysInnerRef.value.style.transform = `translateY(-${el.scrollTop}px)`
  if (ctrlInnerRef.value) ctrlInnerRef.value.style.transform  = `translateX(-${el.scrollLeft}px)`
}

// ── Piano key preview ──────────────────────────────────────────────────────────
const activePitch = ref(null)
let keyHeld = false

function onKeyPress(pitch) { keyHeld = true; activePitch.value = pitch; playNote(targetCh.value, pitch) }
function onKeyHover(pitch) {
  if (!keyHeld || activePitch.value === pitch) return
  activePitch.value = pitch; playNote(targetCh.value, pitch)
}

// ── Drag state ─────────────────────────────────────────────────────────────────
// types: 'create' | 'resize' | 'move' | 'select-move' | 'paint' | 'rclick'
let drag        = null
let paintStroke = null    // { pitch, painted: Set<step> }
let selDrag     = null    // { x1, y1 } rubber-band start
let rDrag       = false   // right-click drag delete
let rDragRefs   = new Set()

const selBox = ref(null)
const selBoxStyle = computed(() => {
  if (!selBox.value) return {}
  const { x1, y1, x2, y2 } = selBox.value
  return {
    left: Math.min(x1, x2) + 'px', top: Math.min(y1, y2) + 'px',
    width: Math.abs(x2 - x1) + 'px', height: Math.abs(y2 - y1) + 'px',
  }
})

function finalizeRubberBand() {
  if (!selBox.value) return
  const { x1, y1, x2, y2 } = selBox.value
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2)
  const newSel = new Set()
  currentNotes.value.forEach((n, i) => {
    const nx = tickToX(n.startTick), nw = (n.durationTicks ?? TICKS_PER_STEP) * pxPerTick.value
    const ny = pitchToY(n.pitch)
    if (nx < maxX && nx + nw > minX && ny < maxY && ny + ROW_H > minY) newSel.add(i)
  })
  selectedNotes.value = newSel
  selBox.value = null
  selDrag = null
}

function doRightDelete(x, y) {
  if (y < 0 || y > gridHeight.value) return
  const notes = getPatData(targetChId.value).pianoNotes
  const idx = hitTest(x, y)
  if (idx >= 0) {
    const note = notes[idx]
    if (!rDragRefs.has(note)) {
      if (!rDragRefs.size) pushUndo()
      rDragRefs.add(note)
      notes.splice(idx, 1)
    }
  }
}

function doPaint(x, y) {
  if (!paintStroke || y < 0 || y > gridHeight.value) return
  const startTick = snapTick(xToTick(x))
  const key = `${startTick}`
  if (paintStroke.painted.has(key)) return
  paintStroke.painted.add(key)
  const notes = getPatData(targetChId.value).pianoNotes
  if (!notes.some(n => Math.round(n.startTick) === startTick && n.pitch === paintStroke.pitch)) {
    notes.push({ startTick, pitch: paintStroke.pitch, velocity: 0.8, durationTicks: snapTicks.value })
    playNote(targetCh.value, paintStroke.pitch)
  }
}

// ── Grid mouse down ────────────────────────────────────────────────────────────
function onGridDown(e) {
  // Right-click → start delete drag
  if (e.button === 2) {
    e.preventDefault()
    rDrag = true; rDragRefs = new Set()
    const { x, y } = getGridPos(e.clientX, e.clientY)
    doRightDelete(x, y)
    return
  }
  if (e.button !== 0) return
  e.preventDefault()

  const { x, y } = getGridPos(e.clientX, e.clientY)
  if (y < 0 || y > gridHeight.value) return
  const hitIdx = hitTest(x, y)

  // ── Ctrl+click = toggle note selection (any tool) ────────────────────
  if (e.ctrlKey && tool.value !== 'erase') {
    if (hitIdx >= 0) {
      const s = new Set(selectedNotes.value)
      s.has(hitIdx) ? s.delete(hitIdx) : s.add(hitIdx)
      selectedNotes.value = s
    } else {
      // Ctrl+drag on empty = rubber band
      selDrag = { x1: x, y1: y }
      selBox.value = { x1: x, y1: y, x2: x, y2: y }
    }
    return
  }

  // ── Erase tool ────────────────────────────────────────────────────────
  if (tool.value === 'erase') {
    if (hitIdx >= 0) { pushUndo(); getPatData(targetChId.value).pianoNotes.splice(hitIdx, 1) }
    drag = { type: 'rclick' }  // reuse drag to erase on move
    return
  }

  // ── Mute tool ─────────────────────────────────────────────────────────
  if (tool.value === 'mute') {
    if (hitIdx >= 0) {
      pushUndo()
      const n = getPatData(targetChId.value).pianoNotes[hitIdx]
      n.muted = !(n.muted ?? false)
    }
    return
  }

  // ── Select tool ───────────────────────────────────────────────────────
  if (tool.value === 'select') {
    if (hitIdx >= 0 && selectedNotes.value.has(hitIdx)) {
      // Drag the selection
      pushUndo()
      const notes = getPatData(targetChId.value).pianoNotes
      drag = {
        type: 'select-move',
        startClientX: e.clientX, startClientY: e.clientY,
        origPositions: [...selectedNotes.value].map(i => ({
          i, startTick: notes[i].startTick, pitchIdx: PIANO_KEYS.indexOf(notes[i].pitch),
        })),
      }
    } else {
      // Start rubber-band
      if (!e.shiftKey) selectedNotes.value = new Set()
      selDrag = { x1: x, y1: y }
      selBox.value = { x1: x, y1: y, x2: x, y2: y }
    }
    return
  }

  // ── Paint tool ────────────────────────────────────────────────────────
  if (tool.value === 'paint') {
    const pitch = snapPitch(yToPitch(y))
    pushUndo()
    paintStroke = { pitch, painted: new Set() }
    doPaint(x, y)
    return
  }

  // ── Draw tool (default) ───────────────────────────────────────────────
  if (hitIdx >= 0) {
    // Click on existing note → move it (or selection if multi-selected)
    pushUndo()
    const notes = getPatData(targetChId.value).pianoNotes
    if (selectedNotes.value.size > 1 && selectedNotes.value.has(hitIdx)) {
      drag = {
        type: 'select-move',
        startClientX: e.clientX, startClientY: e.clientY,
        origPositions: [...selectedNotes.value].map(i => ({
          i, startTick: notes[i].startTick, pitchIdx: PIANO_KEYS.indexOf(notes[i].pitch),
        })),
      }
    } else {
      selectedNotes.value = new Set()
      drag = {
        type: 'move', noteIdx: hitIdx,
        startClientX: e.clientX, startClientY: e.clientY,
        origStartTick: notes[hitIdx].startTick, origPitch: notes[hitIdx].pitch,
        origDurationTicks: notes[hitIdx].durationTicks ?? TICKS_PER_STEP,
      }
    }
    return
  }

  // Click on empty space → create note
  const startTick = snapTick(xToTick(x), e.altKey)
  const pitch = snapPitch(yToPitch(y))
  pushUndo()
  selectedNotes.value = new Set()
  const notes = getPatData(targetChId.value).pianoNotes
  notes.push({ startTick, pitch, velocity: 0.8, durationTicks: snapTicks.value })
  playNote(targetCh.value, pitch)
  drag = {
    type: 'create', noteIdx: notes.length - 1,
    startClientX: e.clientX, origDurationTicks: snapTicks.value,
  }
}

// ── Note / resize mouse down ───────────────────────────────────────────────────
function onNoteDown(e, idx) {
  if (e.button !== 0) return
  const notes = getPatData(targetChId.value).pianoNotes
  const note = notes[idx]; if (!note) return

  if (tool.value === 'erase') { pushUndo(); notes.splice(idx, 1); return }
  if (tool.value === 'mute')  { pushUndo(); note.muted = !(note.muted ?? false); return }

  if (tool.value === 'select' || e.ctrlKey) {
    const s = new Set(selectedNotes.value)
    s.has(idx) ? s.delete(idx) : s.add(idx)
    selectedNotes.value = s
    return
  }

  pushUndo()
  if (selectedNotes.value.size > 1 && selectedNotes.value.has(idx)) {
    drag = {
      type: 'select-move',
      startClientX: e.clientX, startClientY: e.clientY,
      origPositions: [...selectedNotes.value].map(i => ({
        i, startTick: notes[i].startTick, pitchIdx: PIANO_KEYS.indexOf(notes[i].pitch),
      })),
    }
  } else {
    selectedNotes.value = new Set()
    drag = {
      type: 'move', noteIdx: idx,
      startClientX: e.clientX, startClientY: e.clientY,
      origStartTick: note.startTick, origPitch: note.pitch, origDurationTicks: note.durationTicks ?? TICKS_PER_STEP,
    }
  }
}

function onResizeDown(e, idx) {
  if (e.button !== 0) return
  const notes = getPatData(targetChId.value).pianoNotes
  if (!notes[idx]) return
  pushUndo()
  drag = { type: 'resize', noteIdx: idx, startClientX: e.clientX, origDurationTicks: notes[idx].durationTicks ?? TICKS_PER_STEP }
}

// ── Global mouse move / up ─────────────────────────────────────────────────────
function onWindowMouseMove(e) {
  // Advance the infinite-horizon high-water mark whenever the mouse is over the roll
  if (prFocused.value) {
    const { x } = getGridPos(e.clientX, e.clientY)
    if (x > horiMouseX.value) horiMouseX.value = x
  }

  // Ruler loop-region drag (RMB or Ctrl+LMB held)
  if (rulerLoopDrag && Math.abs(e.clientX - rulerLoopDrag.startClientX) > 3) {
    rulerLoopDrag.isLoop = true
    const { x } = getGridPos(e.clientX, 0)
    const curTick  = Math.max(0, snapTick(xToTick(x)))
    const startTick = Math.min(rulerLoopDrag.startTick, curTick)
    const endTick   = Math.max(rulerLoopDrag.startTick, curTick) || TICKS_PER_BAR
    setLoopRegion(startTick, endTick)
  }

  // Pattern-end marker drag
  if (patEndDrag) {
    const dx      = e.clientX - patEndDrag.startClientX
    const newTick = patEndDrag.startTick + dx / pxPerTick.value
    const barTick = Math.max(TICKS_PER_BAR, Math.round(newTick / TICKS_PER_BAR) * TICKS_PER_BAR)
    setPatternLengthOverride(currentPatternId.value, barTick)
  }

  // Right-click delete drag
  if (rDrag) {
    const { x, y } = getGridPos(e.clientX, e.clientY)
    doRightDelete(x, y)
  }

  // Paint stroke
  if (paintStroke) {
    const { x, y } = getGridPos(e.clientX, e.clientY)
    doPaint(x, y)
  }

  // Rubber-band selection
  if (selDrag) {
    const { x, y } = getGridPos(e.clientX, e.clientY)
    selBox.value = { x1: selDrag.x1, y1: selDrag.y1, x2: x, y2: y }
  }

  // Note drag
  if (!drag) return
  const notes = getPatData(targetChId.value).pianoNotes
  const alt = e.altKey

  if (drag.type === 'select-move') {
    const dxPx = e.clientX - drag.startClientX
    const dyPx = e.clientY - drag.startClientY
    const dRows = Math.round(dyPx / ROW_H)
    drag.origPositions.forEach(({ i, startTick: os, pitchIdx: opi }) => {
      const n = notes[i]; if (!n) return
      n.startTick = snapTick(os + dxPx / pxPerTick.value, alt)
      const np = Math.max(0, Math.min(PIANO_KEYS.length - 1, opi + dRows))
      n.pitch = PIANO_KEYS[np]
    })
    return
  }

  const note = notes[drag.noteIdx]; if (!note) { drag = null; return }
  const dxPx = e.clientX - drag.startClientX

  if (drag.type === 'create' || drag.type === 'resize') {
    const dTicks = dxPx / pxPerTick.value
    note.durationTicks = alt
      ? Math.max(1, drag.origDurationTicks + dTicks)
      : Math.max(snapTicks.value, snapTick(drag.origDurationTicks + dTicks))
    return
  }

  if (drag.type === 'move') {
    const dyPx  = e.clientY - drag.startClientY
    const dRows = Math.round(dyPx / ROW_H)
    note.startTick = snapTick(drag.origStartTick + dxPx / pxPerTick.value, alt)
    const opi  = PIANO_KEYS.indexOf(drag.origPitch)
    const npi  = Math.max(0, Math.min(PIANO_KEYS.length - 1, opi + dRows))
    note.pitch = snapPitch(PIANO_KEYS[npi])
  }
}

function onWindowMouseUp(e) {
  if (e.button === 2) {
    rDrag = false; rDragRefs = new Set()
    // rulerLoopDrag cleanup is handled by onRulerContextMenu (fires after mouseup)
    return
  }
  // Clean up pat-end drag and ruler Ctrl+LMB loop drag
  patEndDrag = null
  if (rulerLoopDrag?.button === 0) rulerLoopDrag = null
  if (selDrag) finalizeRubberBand()
  drag = null; paintStroke = null; selDrag = null
  if (activePitch.value !== null) stopNote(targetCh.value, activePitch.value)
  keyHeld = false; activePitch.value = null
}

// ── Alt + Mouse Wheel → change velocity ───────────────────────────────────────
function onWheel(e) {
  if (!e.altKey) return
  e.preventDefault(); e.stopPropagation()
  const notes = currentNotes.value
  const delta = e.deltaY < 0 ? 0.05 : -0.05
  const targets = selectedNotes.value.size > 0
    ? [...selectedNotes.value].map(i => notes[i]).filter(Boolean)
    : notes
  targets.forEach(n => { n.velocity = Math.max(0.01, Math.min(1, (n.velocity ?? 0.8) + delta)) })
}

// ── Mouse wheel on channel selector → cycle channels ──────────────────────────
function onChSelWheel(e) { e.preventDefault(); cyclePianoChannel(e.deltaY > 0 ? 1 : -1) }

// ── Control pane (VEL / PAN) ───────────────────────────────────────────────────
const ctrlDrag = ref(false)

function ctrlGetX(e) {
  const view = ctrlViewRef.value; const scroll = scrollRef.value
  if (!view || !scroll) return 0
  const r = view.getBoundingClientRect()
  return e.clientX - r.left + scroll.scrollLeft
}

function onCtrlDown(e) { ctrlDrag.value = true; applyCtrlEdit(e) }
function onCtrlMove(e) { if (ctrlDrag.value) applyCtrlEdit(e) }

function applyCtrlEdit(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const absX = ctrlGetX(e)
  const relY = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  const notes = getPatData(targetChId.value).pianoNotes

  // Find note whose bar center is closest
  let best = -1, bestDist = Infinity
  notes.forEach((n, i) => {
    const nx = tickToX(n.startTick), nw = Math.max(4, snapTicks.value * pxPerTick.value)
    const d = Math.abs(absX - nx)
    if (absX >= nx && absX <= nx + nw && d < bestDist) { bestDist = d; best = i }
  })
  if (best < 0) return

  if (ctrlTarget.value === 'velocity') {
    notes[best].velocity = Math.max(0.01, Math.min(1, relY))
  } else if (ctrlTarget.value === 'pan') {
    notes[best].pan = Math.max(-1, Math.min(1, (relY - 0.5) * 2))
  }
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (!prFocused.value) return
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return

  if      (e.key === 'p' || e.key === 'P') { tool.value = 'draw';   return }
  else if (e.key === 'b' || e.key === 'B') { tool.value = 'paint';  return }
  else if (e.key === 'e' || e.key === 'E') { tool.value = 'select'; return }
  else if (e.key === 't' || e.key === 'T') { tool.value = 'mute';   return }
  else if (e.key === 'd' || e.key === 'D' || e.key === 'n' || e.key === 'N') { tool.value = 'erase'; return }
  else if (e.key === 'Escape') {
    if (loopRegion.value) { clearLoopRegion(); return }
    selectedNotes.value = new Set(); return
  }
  else if (e.key === 'h' || e.key === 'H') { cyclePianoChannel(-1); return }
  else if (e.key === 'j' || e.key === 'J') { cyclePianoChannel(+1); return }
  else if (e.code === 'KeyA' && e.ctrlKey) {
    e.preventDefault()
    selectedNotes.value = new Set(currentNotes.value.map((_, i) => i))
    return
  }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNotes.value.size > 0) {
    e.preventDefault()
    pushUndo()
    const notes = getPatData(targetChId.value).pianoNotes
    const sorted = [...selectedNotes.value].sort((a, b) => b - a)
    sorted.forEach(i => notes.splice(i, 1))
    selectedNotes.value = new Set()
    return
  }
  else if (e.altKey && e.key === 'v') {
    ghostsEnabled.value = !ghostsEnabled.value
    return
  }
}

// ── Ruler context menu (pattern length marker) ─────────────────────────────────
const rulerCtx = ref(null)  // { x, y, tick } or null

// ── Ruler drag state (loop region + pat-end dragging) ──────────────────────────
// Non-reactive — only used transiently during mousedown/move/up
let rulerLoopDrag = null   // { startTick, isLoop: bool } — right-click / Ctrl+LMB drag
let patEndDrag    = null   // { startClientX, startTick }  — gold triangle drag

function onRulerMouseDown(e) {
  rulerLoopDrag = null   // always reset stale state from previous drag
  // Right-click drag OR Ctrl+Left drag → start loop-region selection
  if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
    e.preventDefault()
    const { x } = getGridPos(e.clientX, 0)
    const tick = Math.max(0, snapTick(xToTick(x)))
    rulerLoopDrag = { button: e.button, startClientX: e.clientX, startTick: tick, isLoop: false }
    return
  }
  // Plain left click on ruler → clear the loop region
  if (e.button === 0 && !e.ctrlKey) {
    clearLoopRegion()
  }
}

// Called by @contextmenu.prevent — decides whether to show menu or just confirm drag
function onRulerContextMenu(e) {
  e.preventDefault()
  if (rulerLoopDrag?.isLoop) {
    // Was a right-drag — loop region already set, skip context menu
    rulerLoopDrag = null
    return
  }
  rulerLoopDrag = null
  // Show pattern-length context menu at click position
  const { x } = getGridPos(e.clientX, 0)
  const barTick = Math.max(TICKS_PER_BAR, Math.round(xToTick(x) / TICKS_PER_BAR) * TICKS_PER_BAR)
  rulerCtx.value = { x: e.clientX, y: e.clientY, tick: barTick }
}

// Gold triangle (pat-end marker) drag start
function onPatEndDragStart(e) {
  if (e.button !== 0) return
  e.preventDefault(); e.stopPropagation()
  patEndDrag = { startClientX: e.clientX, startTick: patLengthTicks.value }
}

function applyPatternLength() {
  if (rulerCtx.value) setPatternLengthOverride(currentPatternId.value, rulerCtx.value.tick)
  rulerCtx.value = null
}

function clearPatternLength() {
  clearPatternLengthOverride(currentPatternId.value)
  rulerCtx.value = null
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────
onMounted(() => {
  window.addEventListener('mousemove', onWindowMouseMove)
  window.addEventListener('mouseup',   onWindowMouseUp)
  window.addEventListener('keydown',   onKeyDown)
  // Scroll to C4 — wait for layout so clientHeight is available
  nextTick(() => {
    if (scrollRef.value) {
      const el = scrollRef.value
      scrollClientWidth.value  = el.clientWidth    // init viewport width for canvasTicks
      scrollClientHeight.value = el.clientHeight   // init viewport height for note virtualization
      const c4idx = PIANO_KEYS.indexOf(60)
      el.scrollTop = Math.max(0, c4idx * ROW_H - el.clientHeight / 2 + ROW_H * 2)
      scrollTopVal.value = el.scrollTop
    }
  })
})
onUnmounted(() => {
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup',   onWindowMouseUp)
  window.removeEventListener('keydown',   onKeyDown)
})
</script>

<style scoped>
/* ── Root ──────────────────────────────────────────────────────────────────── */
.piano-roll {
  display: flex; flex-direction: column; flex: 1;
  overflow: hidden; background: var(--bg-header);
  font-family: 'Share Tech Mono', monospace;
  user-select: none;
}

/* ── Title bar ─────────────────────────────────────────────────────────────── */
.pr-title-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 8px; background: var(--bg-deeper);
  border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; min-height: 24px;
}
.pr-title-text {
  font-size: 9px; font-weight: 700; letter-spacing: 0.18em; color: #252540;
  text-transform: uppercase; flex-shrink: 0;
}
.pr-title-info {
  margin-left: auto; font-size: 8px; color: #25254a; letter-spacing: 0;
}

/* Channel selector */
.pr-ch-sel {
  position: relative; display: flex; align-items: center; gap: 5px;
  padding: 2px 8px; border: 1px solid var(--border); border-radius: 3px;
  cursor: pointer; transition: border-color 0.1s;
}
.pr-ch-sel:hover { border-color: #4a4a6a; }
.pr-ch-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.pr-ch-name { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: #b0b0d0; }
.pr-ch-caret { font-size: 8px; color: #50506a; }
.pr-ch-drop {
  position: absolute; top: calc(100% + 3px); left: 0; z-index: 200;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 5px;
  padding: 3px 0; min-width: 160px; box-shadow: 0 8px 28px rgba(0,0,0,0.75);
}
.pr-ch-item {
  display: flex; align-items: center; gap: 7px; padding: 5px 12px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.07em; color: #7070a0;
  cursor: pointer; transition: background 0.07s;
}
.pr-ch-item:hover   { background: var(--bg-hover); color: var(--text-primary); }
.pr-ch-item.active  { color: #4ecdc4; }
.pr-ch-item-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.pr-ch-tick { margin-left: auto; font-size: 9px; color: #4ecdc4; }

/* Ghost button */
.pr-ghost-btn {
  font-size: 8px; font-weight: 700; letter-spacing: 0.12em;
  padding: 2px 7px; border: 1px solid var(--border-subtle); border-radius: 3px;
  background: transparent; color: #28283a; cursor: pointer; transition: all 0.1s;
}
.pr-ghost-btn.on { border-color: #4ecdc444; color: #4ecdc488; background: #041614; }
.pr-ghost-btn:hover { border-color: #3a3a5a; color: #6060a0; }

/* ── Toolbar ───────────────────────────────────────────────────────────────── */
.pr-bar {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  padding: 3px 8px; background: var(--bg-deeper);
  border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; min-height: 28px;
}
.pr-tools { display: flex; gap: 2px; }
.pr-tool {
  width: 26px; height: 22px; border-radius: 3px;
  border: 1px solid var(--border); background: transparent; color: var(--text-muted);
  font-size: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.1s; padding: 0;
}
.pr-tool:hover  { border-color: #4a4a6a; color: #b0b0d0; }
.pr-tool.active { border-color: #4ecdc4; color: #4ecdc4; background: #041614; }
.pr-sep { width: 1px; height: 18px; background: var(--border-subtle); margin: 0 2px; flex-shrink: 0; }
.pr-lbl { font-size: 9px; font-weight: 700; letter-spacing: 0.14em; color: #333348; white-space: nowrap; }
.pr-sel {
  background: var(--bg-control); border: 1px solid var(--border-subtle); color: var(--text-muted);
  font-family: 'Share Tech Mono', monospace; font-size: 9px;
  padding: 2px 4px; border-radius: 3px; cursor: pointer; outline: none;
}
.pr-sel:focus { border-color: #4ecdc4; }
.pr-zbtn {
  width: 18px; height: 18px; border-radius: 3px; border: 1px solid var(--border);
  background: transparent; color: #50506a; font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1;
  transition: all 0.1s;
}
.pr-zbtn:hover { border-color: #4a4a6a; color: #c0c0e0; }

/* Scale snap */
.pr-scale-toggle { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.pr-scale-toggle input { display: none; }
.pr-scale-toggle span {
  font-size: 9px; font-weight: 700; letter-spacing: 0.15em;
  color: #222234; padding: 2px 5px; border: 1px solid #1a1a2c; border-radius: 3px; transition: all 0.1s;
}
.pr-scale-toggle.on span { color: #1abc9c; border-color: #1abc9c; background: #001a14; }
.pr-scale-chips { display: flex; gap: 2px; }
.pr-scale-chip { font-size: 8px; color: #1abc9c; padding: 1px 4px; background: #001a14; border: 1px solid #0a3028; border-radius: 2px; }
.pr-scale-chip.root { color: #fff; background: #1abc9c; border-color: #1abc9c; font-weight: 700; }
.pr-bar-right { margin-left: auto; }
.pr-clr-btn {
  font-size: 9px; font-weight: 700; letter-spacing: 0.1em; padding: 2px 7px;
  border: 1px solid var(--border); border-radius: 3px; background: transparent; color: var(--text-muted);
  cursor: pointer; transition: all 0.1s;
}
.pr-clr-btn:hover { border-color: #e74c3c55; color: #e74c3c88; }

/* ── Main body ─────────────────────────────────────────────────────────────── */
.pr-body { flex: 1; display: flex; overflow: hidden; }

/* ── Piano keys ────────────────────────────────────────────────────────────── */
.pr-keys-col {
  width: 44px; flex-shrink: 0; display: flex; flex-direction: column;
  overflow: hidden; border-right: 1px solid var(--border-subtle);
}
.pr-keys-ruler-spc { height: 20px; flex-shrink: 0; background: var(--bg-deeper); border-bottom: 1px solid var(--border-subtle); }
.pr-keys-inner { flex-shrink: 0; will-change: transform; }
.pr-key {
  display: flex; align-items: center; justify-content: flex-end; padding: 0 4px;
  cursor: pointer; background: #f5f5f5; border-bottom: 1px solid #ddd;
  transition: background 0.05s; box-sizing: border-box;
}
.pr-key.black   { background: #1e1e1e; border-color: #111; }
.pr-key.c-note  { border-top: 1px solid #bbb; }
.pr-key.black.c-note { border-top: 1px solid #000; }
.pr-key:hover        { background: #d8d8d8; }
.pr-key.black:hover  { background: #3a3a3a; }
.pr-key.scale-in     { background: #e8faf7; }
.pr-key.black.scale-in { background: #1a3830; }
.pr-key.scale-root   { background: #1abc9c !important; }
.pr-key.active       { background: #b0cfe8 !important; }
.pr-key.black.active { background: #3a6080 !important; }
.pr-key-lbl { font-size: 7px; color: #555; line-height: 1; }
.pr-key.black .pr-key-lbl { color: #aaa; }
.pr-key.scale-root .pr-key-lbl { color: #fff; }

/* ── Scroll area ───────────────────────────────────────────────────────────── */
.pr-scroll { flex: 1; overflow: auto; position: relative; }
.pr-content { min-width: 100%; }

/* ── Ruler ─────────────────────────────────────────────────────────────────── */
.pr-ruler {
  height: 20px; position: sticky; top: 0; z-index: 20;
  background: var(--bg-deeper); border-bottom: 1px solid var(--border-subtle); overflow: hidden;
}
.pr-ruler-mark {
  position: absolute; top: 0; bottom: 0;
  display: flex; align-items: center; padding-left: 3px;
  font-size: 8px; color: var(--text-muted);
}
.pr-ruler-mark.bar  { border-left: 1px solid var(--border); color: var(--text-muted); font-weight: 700; }
.pr-ruler-mark.beat { border-left: 1px solid var(--border-subtle); }
.pr-ruler-head { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.6); pointer-events: none; }

/* ── Grid ──────────────────────────────────────────────────────────────────── */
.pr-grid { position: relative; cursor: crosshair; overflow: hidden; }

/* Pitch lanes */
.pr-lane { position: absolute; left: 0; right: 0; pointer-events: none; box-sizing: border-box; }
.pr-lane.black     { background: rgba(0,0,0,0.18); }
.pr-lane.scale-in  { background: rgba(26,188,156,0.04); }
.pr-lane.scale-out { background: rgba(0,0,0,0.22); }
.pr-lane.scale-root { background: rgba(26,188,156,0.09) !important; }
.pr-lane.c-border  { border-top: 1px solid var(--border-subtle); }
.pr-lane.black.scale-in  { background: rgba(26,188,156,0.07); }
.pr-lane.black.scale-out { background: rgba(0,0,0,0.32); }

/* Grid lines */
.pr-vline { position: absolute; top: 0; width: 1px; pointer-events: none; }
.pr-vline.bar  { background: var(--border); }
.pr-vline.beat { background: var(--border-subtle); }
.pr-vline.snap { background: var(--bg-hover); }

/* Ghost notes */
.pr-ghost {
  position: absolute; border-radius: 2px; pointer-events: none;
  box-sizing: border-box;
}

/* Active notes */
.pr-note {
  position: absolute; border-radius: 2px; border: 1px solid transparent;
  display: flex; align-items: center; cursor: grab; overflow: hidden;
  box-sizing: border-box; transition: filter 0.05s;
}
.pr-note:hover  { filter: brightness(1.15); }
.pr-note.muted  { opacity: 0.4; }
.pr-note.selected { outline: 2px solid rgba(255,255,255,0.6); outline-offset: 0; }
.pr-note-lbl {
  font-size: 7px; color: rgba(0,0,0,0.65); padding: 0 3px;
  pointer-events: none; white-space: nowrap; overflow: hidden;
  font-weight: 700; letter-spacing: 0;
}
.pr-note-rh {
  position: absolute; right: 0; top: 0; bottom: 0; width: 7px;
  cursor: ew-resize; background: rgba(0,0,0,0.22);
  border-left: 1px solid rgba(0,0,0,0.28); flex-shrink: 0;
}

/* Rubber-band selection box */
.pr-selbox {
  position: absolute; border: 1px solid rgba(78,205,196,0.7);
  background: rgba(78,205,196,0.08); pointer-events: none; z-index: 30;
}

/* Playhead */
.pr-playhead {
  position: absolute; top: 0; width: 2px;
  background: rgba(255,255,255,0.7); pointer-events: none; z-index: 25;
}

/* Dark void zone — the "infinite horizon" beyond the active pattern area.
   No z-index: DOM order places it below the end-marker and notes. */
.pr-void-zone {
  position: absolute; top: 0;
  background: rgba(0, 0, 0, 0.14);
  pointer-events: none;
}

/* Red loop-region band (RMB / Ctrl+LMB drag on ruler) */
.pr-loop-band {
  position: absolute; top: 0; bottom: 0;
  background: rgba(231, 76, 60, 0.28);
  border-left:  2px solid rgba(231, 76, 60, 0.75);
  border-right: 2px solid rgba(231, 76, 60, 0.75);
  pointer-events: none; z-index: 10;
}

/* Ruler dim beyond pattern end */
.pr-ruler-void {
  position: absolute; top: 0; bottom: 0; right: 0;
  background: rgba(0, 0, 0, 0.22);
  pointer-events: none;
}

/* Pattern length end marker — ruler triangle + grid line */
.pr-pat-end {
  position: absolute; top: 0; width: 0; height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 9px solid #e8c84a;
  transform: translateX(-5px);
  cursor: ew-resize; z-index: 22;
  cursor: ew-resize;
}
.pr-pat-end-line {
  position: absolute; top: 0; width: 2px;
  background: rgba(232,200,74,0.45); pointer-events: none; z-index: 5;
}

/* Ruler right-click context menu */
.pr-ruler-ctx {
  position: fixed; z-index: 9999;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 5px;
  padding: 3px 0; min-width: 220px; box-shadow: 0 8px 28px rgba(0,0,0,0.8);
  font-family: 'Share Tech Mono', monospace;
}
.pr-ctx-item {
  padding: 6px 14px; font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
  color: #9090c0; cursor: pointer; transition: background 0.07s;
}
.pr-ctx-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.pr-ctx-cancel { color: #50506a; border-top: 1px solid var(--border-subtle); margin-top: 3px; }

/* ── Control pane ──────────────────────────────────────────────────────────── */
.pr-ctrl-outer {
  display: flex; height: 72px; flex-shrink: 0;
  border-top: 1px solid var(--border-subtle); background: var(--bg-deeper);
}
.pr-ctrl-tabs-col {
  width: 44px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 3px; border-right: 1px solid var(--border-subtle); padding: 3px 0;
}
.pr-ctrl-tab {
  font-size: 7px; font-weight: 700; letter-spacing: 0.12em; padding: 2px 5px;
  border: 1px solid var(--border-subtle); border-radius: 2px; background: transparent;
  color: var(--text-muted); cursor: pointer; transition: all 0.1s;
}
.pr-ctrl-tab:hover  { border-color: #3a3a5a; color: #7070a0; }
.pr-ctrl-tab.active { border-color: #4ecdc4; color: #4ecdc4; background: #041614; }
.pr-ctrl-view  { flex: 1; overflow: hidden; position: relative; }
.pr-ctrl-inner { position: absolute; top: 0; left: 0; height: 100%; will-change: transform; }
.pr-ctrl-bg    { height: 100%; position: relative; cursor: ns-resize; background: var(--bg-deeper); }
.pr-ctrl-bar   { position: absolute; border-radius: 2px 2px 0 0; opacity: 0.75; min-height: 2px; }
.pr-ctrl-bar.selected { opacity: 1; }
.pr-ctrl-cline {
  position: absolute; left: 0; right: 0; top: 50%; height: 1px;
  background: var(--border-subtle); pointer-events: none;
}
.pr-ctrl-vline { position: absolute; top: 0; bottom: 0; width: 1px; pointer-events: none; }
.pr-ctrl-vline.bar  { background: var(--border); }
.pr-ctrl-vline.beat { background: var(--border-subtle); }
.pr-ctrl-head { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.35); pointer-events: none; z-index: 5; }
</style>
