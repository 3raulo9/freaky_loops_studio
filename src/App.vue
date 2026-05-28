<template>
  <main class="app-shell">
    <DrumMachine />
  </main>
</template>

<script setup>
import DrumMachine from './components/DrumMachine.vue'
</script>

<style scoped>
.app-shell {
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}
</style>
