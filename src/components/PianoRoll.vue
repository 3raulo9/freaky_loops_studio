<template>
  <div class="piano-roll">
    <!-- Column headers -->
    <div class="pr-header" :style="{ '--cols': totalSteps }">
      <div class="pr-key-spacer" />
      <div v-for="s in totalSteps" :key="s" class="pr-step-hdr"
        :class="{ beat: (s-1)%4===0, playing: isPlaying && displayStep === s-1 }">
        <span v-if="(s-1)%4===0">{{ s }}</span>
      </div>
    </div>
    <!-- Scrollable grid -->
    <div class="pr-body" ref="bodyRef">
      <div
        v-for="pitch in PIANO_KEYS" :key="pitch"
        class="pr-row"
        :class="{ black: isBlackKey(pitch), 'c-note': pitch % 12 === 0 }"
      >
        <div class="pr-key" :class="{ black: isBlackKey(pitch) }" @mousedown.prevent="previewNote(pitch)">
          <span v-if="pitch % 12 === 0" class="key-label">{{ midiToLabel(pitch) }}</span>
        </div>
        <div v-for="s in totalSteps" :key="s"
          class="pr-cell"
          :class="{
            lit:     noteSet.has(s-1 + ':' + pitch),
            playing: isPlaying && displayStep === s-1,
            beat:    (s-1)%4===0,
            black:   isBlackKey(pitch),
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
import { useStudio, PIANO_KEYS, isBlackKey, midiToLabel } from '../store/studio.js'

const props = defineProps({ ch: { type: Object, required: true } })
const { totalSteps, isPlaying, displayStep, togglePianoNote, getPatData, playNote } = useStudio()

// Build a Set of "step:pitch" keys for O(1) lookup in template
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
.pr-body   { flex: 1; overflow-y: auto; overflow-x: auto; }
.pr-row {
  display: grid; grid-template-columns: 44px repeat(v-bind('totalSteps'), minmax(22px, 1fr));
  height: 16px; border-bottom: 1px solid #111118;
}
.pr-row.black  { background: #0b0b14; }
.pr-row.c-note { border-top: 1px solid #1e1e30; }
.pr-key {
  display: flex; align-items: center; justify-content: flex-end; padding-right: 4px;
  border-right: 1px solid #1a1a28; background: #f5f5f5; cursor: pointer; transition: background 0.08s;
}
.pr-key.black       { background: #222; }
.pr-key:hover       { background: #ddd; }
.pr-key.black:hover { background: #444; }
.key-label { font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #333; line-height: 1; }
.pr-key.black .key-label { color: #aaa; }
.pr-cell {
  border-right: 1px solid #131320; background: transparent; cursor: crosshair; user-select: none;
}
.pr-cell.black   { background: rgba(0,0,0,0.15); }
.pr-cell.beat    { border-left: 1px solid #1e1e32; }
.pr-cell.playing { background: rgba(255,255,255,0.07) !important; }
.pr-cell.lit {
  background: v-bind('props.ch.color');
  border-color: color-mix(in srgb, v-bind('props.ch.color') 70%, #000);
  box-shadow: 0 0 4px color-mix(in srgb, v-bind('props.ch.color') 50%, transparent);
}
.pr-cell.lit.playing { filter: brightness(1.3); }
.pr-cell:hover:not(.lit) { background: color-mix(in srgb, v-bind('props.ch.color') 20%, transparent); }
</style>
