<template>
  <div class="tb-ctrl" v-hint="'steps'">
    <div class="tb-ctrl-label">STEPS</div>
    <select v-model.number="totalSteps" class="tb-select">
      <option :value="8">8</option>
      <option :value="16">16</option>
      <option :value="32">32</option>
      <option :value="64">64</option>
    </select>
  </div>
</template>

<script setup>
import { useStudio } from '../../store/studio.js'
const { totalSteps } = useStudio()
</script>
