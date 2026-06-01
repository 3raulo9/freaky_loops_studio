<template>
  <!-- Title bar core: brand signature + live project filename (with isDirty
       asterisk) + the edition/identity readout. -->
  <div class="tb-logo" v-hint="'title'">
    <span class="tb-hex">⬡</span>
    <div class="tb-logo-text">
      <span class="tb-logo-main">FREAKY<em>LOOPS</em></span>
      <span class="tb-title-file">
        {{ projectName }}<span v-if="projectDirty" class="tb-title-dirty">*</span>
      </span>
    </div>
    <span class="tb-title-edition">{{ EDITION }}</span>
  </div>
</template>

<script setup>
import { useStudio } from '../../store/studio.js'

const { projectName, projectDirty } = useStudio()

// Identity readout (in a real build this is parsed from the license token).
const EDITION = 'PRODUCER'
</script>

<style scoped>
.tb-title-file {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: #6a6a90; letter-spacing: 0.04em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;
}
.tb-title-dirty { color: #e74c3c; font-weight: 700; }
.tb-title-edition {
  align-self: flex-start; margin-left: 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 6px; font-weight: 700;
  letter-spacing: 0.16em; color: #4a3a1a;
  border: 1px solid #4a3a1a; border-radius: 3px; padding: 1px 3px;
}
</style>
