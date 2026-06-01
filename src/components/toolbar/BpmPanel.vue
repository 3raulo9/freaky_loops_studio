<template>
  <div class="tb-ctrl" v-hint="'bpm'">
    <div class="tb-ctrl-label">BPM</div>
    <div class="tb-ctrl-val tb-red">{{ bpm }}</div>
    <input type="range" v-model.number="bpm" min="40" max="220" step="1" class="tb-slider" />
  </div>
</template>

<script setup>
import { useStudio } from '../../store/studio.js'
const { bpm } = useStudio()
</script>
