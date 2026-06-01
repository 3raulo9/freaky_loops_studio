<template>
  <!-- The sole renderer for hover hints across the whole toolbar.
       Right-click toggles the detachable Extended Hint Panel (HUD). -->
  <div
    class="tb-hintbar"
    :class="{ 'tb-hintbar--idle': !hintText, 'tb-hintbar--hud': extendedHudOpen }"
    title="Hint bar — right-click for the Extended Hint Panel"
    @contextmenu.prevent.stop="extendedHudOpen = !extendedHudOpen"
  >
    <span class="tb-hintbar-icon">{{ extendedHudOpen ? '◎' : '›' }}</span>
    <span class="tb-hintbar-text">{{ hintText || 'Hover a control for a hint' }}</span>
  </div>
</template>

<script setup>
import { hintText } from './hintBus.js'
import { useStudio } from '../../store/studio.js'

const { extendedHudOpen } = useStudio()
</script>

<style scoped>
.tb-hintbar {
  display: flex; align-items: center; gap: 6px;
  flex: 1; width: 100%; height: 22px;
  padding: 0 9px;
  border: 1px solid var(--border-subtle); border-radius: 4px;
  background: var(--bg-deeper);
  overflow: hidden;
}
.tb-hintbar-icon {
  font-family: 'Share Tech Mono', monospace; font-size: 13px;
  color: #2ecc71; line-height: 1; flex-shrink: 0;
  filter: drop-shadow(0 0 4px #2ecc7155);
}
.tb-hintbar--idle .tb-hintbar-icon { color: #2a2a40; filter: none; }
.tb-hintbar-text {
  font-family: 'Share Tech Mono', monospace; font-size: 10px;
  color: #8a8ab0; letter-spacing: 0.02em; line-height: 1.1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tb-hintbar--idle .tb-hintbar-text { color: #3a3a55; }
.tb-hintbar--hud { border-color: #2ecc7155; }
.tb-hintbar--hud .tb-hintbar-icon { color: #2ecc71; filter: drop-shadow(0 0 5px #2ecc7166); }
</style>
