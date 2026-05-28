<template>
  <div class="step-grid-wrap">
    <div class="steps-grid" :style="{ '--cols': totalSteps }">
      <button
        v-for="s in totalSteps"
        :key="s - 1"
        class="step-btn"
        :class="{
          lit:     ch.pattern[s - 1],
          playing: isPlaying && displayStep === s - 1,
          beat:    (s - 1) % 4 === 0,
        }"
        @click="toggleStep(ch.id, s - 1)"
      />
    </div>

    <!-- Ruler -->
    <div class="ruler" :style="{ '--cols': totalSteps }">
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
</template>

<script setup>
import { useStudio } from '../store/studio.js'

const props = defineProps({
  ch: { type: Object, required: true },
})

const { totalSteps, isPlaying, displayStep, toggleStep } = useStudio()
</script>

<style scoped>
.step-grid-wrap { display: flex; flex-direction: column; gap: 0; }

.steps-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 3px;
  padding: 10px 12px;
}

.step-btn {
  aspect-ratio: 1;
  max-height: 38px;
  border: 1px solid #222238;
  border-radius: 4px;
  background: #0e0e20;
  cursor: pointer;
  transition: background 0.07s, box-shadow 0.07s, border-color 0.07s;
}
.step-btn.beat  { background: #131325; border-color: #252540; }
.step-btn.lit   {
  background: v-bind('props.ch.color');
  border-color: v-bind('props.ch.color');
  box-shadow: 0 0 6px color-mix(in srgb, v-bind('props.ch.color') 55%, transparent);
}
.step-btn.playing {
  border-color: #ffffff !important;
  box-shadow: 0 0 10px #ffffffaa, inset 0 0 5px rgba(255,255,255,0.2) !important;
}
.step-btn:hover:not(.lit) {
  background: color-mix(in srgb, v-bind('props.ch.color') 18%, #1a1a30);
  border-color: color-mix(in srgb, v-bind('props.ch.color') 35%, #333);
}

.ruler {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 3px;
  padding: 2px 12px 6px;
}
.ruler-cell {
  height: 14px; display: flex; align-items: center; justify-content: center;
  border-radius: 2px; transition: background 0.06s;
}
.ruler-cell.active { background: rgba(255,255,255,0.7); box-shadow: 0 0 4px rgba(255,255,255,0.5); }
.ruler-cell.beat   { border-left: 1px solid #252535; }
.ruler-num { font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #44446a; pointer-events: none; }
.ruler-cell.active .ruler-num { color: #0a0a12; }
</style>
