<template>
  <div class="piano-roll">

    <!-- Column headers (step numbers) -->
    <div class="pr-header" :style="{ '--cols': totalSteps }">
      <div class="pr-key-spacer" />
      <div
        v-for="s in totalSteps"
        :key="s"
        class="pr-step-hdr"
        :class="{
          beat:    (s - 1) % 4 === 0,
          playing: isPlaying && displayStep === s - 1,
        }"
      >
        <span v-if="(s - 1) % 4 === 0">{{ s }}</span>
      </div>
    </div>

    <!-- Scrollable pitch × step grid -->
    <div class="pr-body" ref="bodyRef">
      <div
        v-for="pitch in PIANO_KEYS"
        :key="pitch"
        class="pr-row"
        :class="{
          black:  isBlackKey(pitch),
          'c-note': pitch % 12 === 0,
        }"
      >
        <!-- Piano key label -->
        <div
          class="pr-key"
          :class="{ black: isBlackKey(pitch) }"
          @mousedown.prevent="previewNote(pitch)"
        >
          <span v-if="pitch % 12 === 0" class="key-label">{{ midiToLabel(pitch) }}</span>
        </div>

        <!-- Note cells -->
        <div
          v-for="s in totalSteps"
          :key="s"
          class="pr-cell"
          :class="{
            lit:     hasNote(ch.id, s - 1, pitch),
            playing: isPlaying && displayStep === s - 1,
            beat:    (s - 1) % 4 === 0,
            black:   isBlackKey(pitch),
          }"
          @mousedown.prevent="onCellDown(s - 1, pitch)"
          @mouseenter="onCellEnter(s - 1, pitch)"
        />
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useStudio } from '../store/studio.js'
import { PIANO_KEYS, isBlackKey, midiToLabel } from '../store/studio.js'

const props = defineProps({
  ch: { type: Object, required: true },
})

const { totalSteps, isPlaying, displayStep, togglePianoNote, hasNote, playNote } = useStudio()

const bodyRef = ref(null)
let painting = false
let paintMode = null   // 'add' | 'remove'

function previewNote(pitch) {
  playNote(props.ch, pitch)
}

function onCellDown(step, pitch) {
  painting  = true
  paintMode = hasNote(props.ch.id, step, pitch) ? 'remove' : 'add'
  togglePianoNote(props.ch.id, step, pitch)
  playNote(props.ch, pitch)
}

function onCellEnter(step, pitch) {
  if (!painting) return
  const has = hasNote(props.ch.id, step, pitch)
  if (paintMode === 'add'    && !has) { togglePianoNote(props.ch.id, step, pitch); playNote(props.ch, pitch) }
  if (paintMode === 'remove' &&  has) { togglePianoNote(props.ch.id, step, pitch) }
}

onMounted(() => {
  window.addEventListener('mouseup', () => { painting = false })
  // Scroll to C4 (MIDI 60) on mount
  if (bodyRef.value) {
    const rowH = 16
    const c4idx = 84 - 60  // distance from top (C6) to C4
    bodyRef.value.scrollTop = c4idx * rowH - bodyRef.value.clientHeight / 2 + rowH * 2
  }
})
</script>

<style scoped>
.piano-roll {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  background: #0e0e1a;
}

/* Header row: step numbers */
.pr-header {
  display: grid;
  grid-template-columns: 44px repeat(var(--cols), 1fr);
  flex-shrink: 0;
  background: #0a0a12;
  border-bottom: 1px solid #1a1a28;
  height: 20px;
}
.pr-key-spacer { border-right: 1px solid #1a1a28; }
.pr-step-hdr {
  display: flex; align-items: center; justify-content: center;
  font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #44446a;
  border-right: 1px solid transparent; transition: background 0.06s;
}
.pr-step-hdr.beat    { border-left: 1px solid #252535; }
.pr-step-hdr.playing { background: rgba(255,255,255,0.12); color: #fff; }

/* Scrollable body */
.pr-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
}

/* One row per pitch */
.pr-row {
  display: grid;
  grid-template-columns: 44px repeat(v-bind('totalSteps'), minmax(24px, 1fr));
  height: 16px;
  border-bottom: 1px solid #111118;
}
.pr-row.black    { background: #0b0b14; }
.pr-row.c-note   { border-top: 1px solid #1e1e30; }

/* Piano key */
.pr-key {
  display: flex; align-items: center; justify-content: flex-end;
  padding-right: 4px; border-right: 1px solid #1a1a28;
  background: #f5f5f5; cursor: pointer; user-select: none;
  transition: background 0.08s;
}
.pr-key.black { background: #222; }
.pr-key:hover    { background: #ddd; }
.pr-key.black:hover { background: #444; }
.key-label {
  font-family: 'Share Tech Mono', monospace; font-size: 8px;
  color: #333; line-height: 1;
}
.pr-key.black .key-label { color: #aaa; }

/* Note cells */
.pr-cell {
  border-right: 1px solid #131320;
  background: transparent;
  cursor: crosshair;
  transition: background 0.04s;
  user-select: none;
}
.pr-cell.black  { background: rgba(0,0,0,0.15); }
.pr-cell.beat   { border-left: 1px solid #1e1e32; }
.pr-cell.playing { background: rgba(255,255,255,0.07) !important; }
.pr-cell.lit {
  background: v-bind('props.ch.color');
  border-color: color-mix(in srgb, v-bind('props.ch.color') 70%, #000);
  box-shadow: 0 0 4px color-mix(in srgb, v-bind('props.ch.color') 50%, transparent);
}
.pr-cell.lit.playing {
  filter: brightness(1.3);
  box-shadow: 0 0 8px v-bind('props.ch.color');
}
.pr-cell:hover:not(.lit) { background: color-mix(in srgb, v-bind('props.ch.color') 20%, transparent); }
</style>
