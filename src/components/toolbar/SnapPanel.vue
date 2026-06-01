<template>
  <div class="tb-ctrl" v-hint="'snap'">
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
</template>

<script setup>
import { useStudio } from '../../store/studio.js'
const { gridSnap } = useStudio()
</script>
