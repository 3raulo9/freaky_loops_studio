<template>
  <div class="tb-ctrl" v-hint="'swing'">
    <div class="tb-ctrl-label">SWING</div>
    <div class="tb-ctrl-val" style="font-size:12px">{{ Math.round(swing * 100) }}%</div>
    <input type="range" v-model.number="swing" min="0" max="1" step="0.01" class="tb-slider" />
  </div>
</template>

<script setup>
import { useStudio } from '../../store/studio.js'
const { swing } = useStudio()
</script>
