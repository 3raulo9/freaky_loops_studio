<template>
  <div class="macro-section">
    <div class="macro-header">MACROS</div>

    <div class="macro-knobs">
      <div v-for="(macro, idx) in macros" :key="idx" class="macro-item">
        <Knob
          :model-value="macro.value"
          :min="0" :max="1"
          :label="`M${idx + 1}`"
          :color="color"
          :size="48"
          :decimals="2"
          @update:model-value="$emit('update', idx, 'value', $event)"
        />
        <input
          type="text"
          :value="macro.name"
          class="macro-name"
          maxlength="16"
          @blur="$emit('update', idx, 'name', $event.target.value)"
          @keydown.enter="$event.target.blur()"
        />
      </div>
    </div>

    <div class="macro-info">
      <span class="macro-info-text">Map macros to parameters</span>
    </div>
  </div>
</template>

<script setup>
import Knob from './Knob.vue'

defineProps({
  macros: {
    type: Array,
    default: () => [],
  },
  color: {
    type: String,
    default: '#4ecdc4',
  },
})

defineEmits(['update'])
</script>

<style scoped>
.macro-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #151515;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #333;
}

.macro-header {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
  padding-bottom: 6px;
  border-bottom: 1px solid #333;
}

.macro-knobs {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.macro-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.macro-name {
  width: 100%;
  padding: 4px 6px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 2px;
  color: #ccc;
  font-size: 9px;
  font-weight: 600;
  text-align: center;
  text-transform: uppercase;
  cursor: text;
  transition: all 0.15s;
}

.macro-name:hover {
  border-color: #444;
  background: #1f1f1f;
}

.macro-name:focus {
  outline: none;
  border-color: #4ecdc4;
  background: #252525;
  color: #fff;
}

.macro-info {
  display: flex;
  justify-content: center;
  padding-top: 6px;
  border-top: 1px solid #333;
}

.macro-info-text {
  font-size: 8px;
  font-weight: 600;
  text-transform: uppercase;
  color: #555;
  letter-spacing: 0.1em;
}
</style>
