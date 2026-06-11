<template>
  <div class="fx-rack">
    <div
      v-for="(effect, idx) in effects"
      :key="idx"
      class="fx-item"
      :class="{ disabled: !effect.enabled, 'drag-over': dragOverIdx === idx }"
      @dragover="dragOver(idx, $event)"
      @dragleave="dragLeave(idx)"
      @drop="drop(idx, $event)"
    >
      <!-- Header: enable toggle · name · drag grip · remove -->
      <div class="fx-head">
        <button
          class="fx-toggle"
          :style="{ color: effect.enabled ? color : '#555' }"
          @click="toggleEffect(idx)"
          :title="`${effect.enabled ? 'Disable' : 'Enable'} ${formatEffectName(effect.type)}`"
        >{{ effect.enabled ? '◉' : '○' }}</button>

        <span class="fx-name">{{ formatEffectName(effect.type) }}</span>

        <span
          class="fx-grip"
          draggable="true"
          title="Drag to reorder"
          @dragstart="startDrag(idx, $event)"
          @dragend="endDrag"
        >⋮⋮</span>

        <button class="fx-remove" title="Remove effect" @click="$emit('remove', idx)">✕</button>
      </div>

      <!-- Controls -->
      <div class="fx-controls">
        <template v-if="effect.type === 'distortion'">
          <Knob :model-value="effect.drive" :min="0" :max="1" label="Drive" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'drive', $event)" />
          <Knob :model-value="effect.tone" :min="0" :max="1" label="Tone" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'tone', $event)" />
        </template>

        <template v-else-if="effect.type === 'reverb'">
          <Knob :model-value="effect.size" :min="0" :max="1" label="Size" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'size', $event)" />
          <Knob :model-value="effect.decay" :min="0" :max="1" label="Decay" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'decay', $event)" />
          <Knob :model-value="effect.mix" :min="0" :max="1" label="Mix" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'mix', $event)" />
        </template>

        <template v-else-if="effect.type === 'compressor'">
          <Knob :model-value="effect.threshold" :min="0" :max="1" label="Thresh" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'threshold', $event)" />
          <Knob :model-value="effect.ratio" :min="1" :max="16" label="Ratio" :color="color" :size="32" :decimals="1"
            @update:model-value="updateEffect(idx, 'ratio', $event)" />
        </template>

        <template v-else-if="effect.type === 'delay'">
          <Knob :model-value="effect.time" :min="0" :max="1" label="Time" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'time', $event)" />
          <Knob :model-value="effect.feedback" :min="0" :max="1" label="Fdbk" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'feedback', $event)" />
          <Knob :model-value="effect.mix" :min="0" :max="1" label="Mix" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'mix', $event)" />
        </template>

        <template v-else-if="['chorus', 'phaser', 'flanger'].includes(effect.type)">
          <Knob :model-value="effect.rate" :min="0" :max="1" label="Rate" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'rate', $event)" />
          <Knob :model-value="effect.depth" :min="0" :max="1" label="Depth" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'depth', $event)" />
          <Knob v-if="effect.feedback !== undefined" :model-value="effect.feedback" :min="0" :max="1" label="Fdbk" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'feedback', $event)" />
          <Knob :model-value="effect.mix" :min="0" :max="1" label="Mix" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'mix', $event)" />
        </template>

        <template v-else-if="effect.type === 'dimension'">
          <Knob :model-value="effect.mix" :min="0" :max="1" label="Mix" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'mix', $event)" />
          <Knob :model-value="effect.width" :min="0" :max="1" label="Width" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'width', $event)" />
        </template>

        <template v-else-if="effect.type === 'volume'">
          <Knob :model-value="effect.value" :min="0" :max="1" label="Level" :color="color" :size="32" :decimals="2"
            @update:model-value="updateEffect(idx, 'value', $event)" />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Knob from './Knob.vue'

const props = defineProps({
  effects: { type: Array, default: () => [] },
  color:   { type: String, default: '#4ecdc4' },
})

const emit = defineEmits(['update', 'reorder', 'remove'])

let draggedIdx = null
const dragOverIdx = ref(null)

function formatEffectName(type) {
  const names = {
    distortion: 'Distortion', reverb: 'Reverb', compressor: 'Compressor',
    delay: 'Delay', chorus: 'Chorus', phaser: 'Phaser', flanger: 'Flanger',
    eq: 'EQ', volume: 'Volume', dimension: 'Dimension',
  }
  return names[type] || type
}

function toggleEffect(idx) { emit('update', idx, 'enabled', !props.effects[idx].enabled) }
function updateEffect(idx, key, value) { emit('update', idx, key, value) }

function startDrag(idx, event) {
  draggedIdx = idx
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(idx))
}
function dragOver(idx, event) {
  if (draggedIdx === null) return            // ignore non-reorder drags (e.g. instruments)
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dragOverIdx.value = idx
}
function dragLeave(idx) { if (dragOverIdx.value === idx) dragOverIdx.value = null }
function drop(toIdx, event) {
  if (draggedIdx === null) return
  event.preventDefault()
  if (draggedIdx !== toIdx) emit('reorder', draggedIdx, toIdx)
  dragOverIdx.value = null
}
function endDrag() { draggedIdx = null; dragOverIdx.value = null }
</script>

<style scoped>
.fx-rack { display: flex; flex-direction: column; gap: 6px; }

.fx-item {
  display: flex; flex-direction: column; gap: 4px;
  padding: 6px 7px;
  background: var(--bg-deeper);
  border: 1px solid var(--border);
  border-radius: 5px;
  transition: border-color 0.12s, opacity 0.12s, box-shadow 0.12s;
}
.fx-item.disabled { opacity: 0.5; }
.fx-item.drag-over { border-color: var(--accent, #4ecdc4); box-shadow: 0 0 0 1px var(--accent, #4ecdc4) inset; }

.fx-head { display: flex; align-items: center; gap: 6px; }
.fx-toggle {
  width: 16px; height: 16px; padding: 0; flex-shrink: 0;
  background: transparent; border: none; cursor: pointer;
  font-size: 13px; line-height: 1; display: flex; align-items: center; justify-content: center;
}
.fx-name {
  flex: 1; min-width: 0;
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fx-grip { color: #44445a; font-size: 11px; letter-spacing: -2px; cursor: grab; flex-shrink: 0; }
.fx-grip:active { cursor: grabbing; color: var(--accent, #4ecdc4); }
.fx-remove {
  width: 16px; height: 16px; padding: 0; flex-shrink: 0;
  background: transparent; border: none; color: #50506a; cursor: pointer;
  font-size: 11px; line-height: 1;
}
.fx-remove:hover { color: #e74c3c; }

.fx-controls {
  display: flex; flex-wrap: wrap; gap: 6px 10px;
  justify-content: center; padding: 2px 0 1px;
}
</style>
