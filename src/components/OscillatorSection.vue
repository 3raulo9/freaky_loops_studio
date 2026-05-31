<template>
  <div class="osc-knobs">
    <!-- WT Pos (Wavetable Position) -->
    <Knob
      :model-value="osc.wtPos"
      :min="0" :max="1"
      label="WT Pos"
      :color="color"
      :size="48"
      :decimals="2"
      @update:model-value="$emit('update', 'wtPos', $event)"
    />

    <!-- Warp Amount -->
    <Knob
      :model-value="osc.warp"
      :min="0" :max="1"
      label="Warp"
      :color="color"
      :size="48"
      :decimals="2"
      @update:model-value="$emit('update', 'warp', $event)"
    />

    <!-- Unison Voices -->
    <Knob
      :model-value="osc.unisonVoices"
      :min="1" :max="16"
      label="Voices"
      :color="color"
      :size="48"
      :decimals="0"
      @update:model-value="$emit('update', 'unisonVoices', $event)"
    />

    <!-- Unison Detune -->
    <Knob
      :model-value="osc.unisonDetune"
      :min="0" :max="1"
      label="Detune"
      :color="color"
      :size="48"
      :decimals="2"
      @update:model-value="$emit('update', 'unisonDetune', $event)"
    />

    <!-- Unison Blend -->
    <Knob
      :model-value="osc.unisonBlend"
      :min="0" :max="1"
      label="Blend"
      :color="color"
      :size="48"
      :decimals="2"
      @update:model-value="$emit('update', 'unisonBlend', $event)"
    />

    <!-- Sub Osc Amount -->
    <Knob
      :model-value="osc.subAmount"
      :min="0" :max="1"
      label="Sub"
      :color="color"
      :size="48"
      :decimals="2"
      @update:model-value="$emit('update', 'subAmount', $event)"
    />
  </div>
</template>

<script setup>
import Knob from './Knob.vue'

defineProps({
  osc: {
    type: Object,
    default: () => ({}),
  },
  color: {
    type: String,
    default: '#4ecdc4',
  },
})

defineEmits(['update'])
</script>

<style scoped>
.osc-knobs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

@media (max-width: 1024px) {
  .osc-knobs {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .osc-knobs {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
