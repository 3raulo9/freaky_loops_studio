<template>
  <div class="fx-rack">
    <div class="fx-header">EFFECT RACK</div>

    <div class="fx-effects-list">
      <div
        v-for="(effect, idx) in effects"
        :key="idx"
        class="fx-item"
        :class="{ disabled: !effect.enabled }"
        draggable="true"
        @dragstart="startDrag(idx, $event)"
        @dragover="dragOver($event)"
        @drop="drop(idx, $event)"
        @dragend="endDrag"
      >
        <!-- Enable toggle -->
        <button
          class="fx-toggle"
          :style="{ color: effect.enabled ? color : '#666' }"
          @click="toggleEffect(idx)"
          :title="`${effect.enabled ? 'Disable' : 'Enable'} ${effect.type}`"
        >
          ⊙
        </button>

        <!-- Effect name -->
        <div class="fx-name">
          {{ formatEffectName(effect.type) }}
        </div>

        <!-- Effect controls -->
        <div class="fx-controls">
          <template v-if="effect.type === 'distortion'">
            <Knob
              :model-value="effect.drive"
              :min="0" :max="1"
              label="Drive"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'drive', $event)"
            />
            <Knob
              :model-value="effect.tone"
              :min="0" :max="1"
              label="Tone"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'tone', $event)"
            />
          </template>

          <template v-else-if="effect.type === 'reverb'">
            <Knob
              :model-value="effect.size"
              :min="0" :max="1"
              label="Size"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'size', $event)"
            />
            <Knob
              :model-value="effect.decay"
              :min="0" :max="1"
              label="Decay"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'decay', $event)"
            />
            <Knob
              :model-value="effect.mix"
              :min="0" :max="1"
              label="Mix"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'mix', $event)"
            />
          </template>

          <template v-else-if="effect.type === 'compressor'">
            <Knob
              :model-value="effect.threshold"
              :min="0" :max="1"
              label="Thresh"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'threshold', $event)"
            />
            <Knob
              :model-value="effect.ratio"
              :min="1" :max="16"
              label="Ratio"
              :color="color"
              :size="36"
              :decimals="1"
              @update:model-value="updateEffect(idx, 'ratio', $event)"
            />
          </template>

          <template v-else-if="effect.type === 'delay'">
            <Knob
              :model-value="effect.time"
              :min="0" :max="1"
              label="Time"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'time', $event)"
            />
            <Knob
              :model-value="effect.feedback"
              :min="0" :max="1"
              label="Feedback"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'feedback', $event)"
            />
            <Knob
              :model-value="effect.mix"
              :min="0" :max="1"
              label="Mix"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'mix', $event)"
            />
          </template>

          <template v-else-if="['chorus', 'phaser', 'flanger'].includes(effect.type)">
            <Knob
              :model-value="effect.rate"
              :min="0" :max="1"
              label="Rate"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'rate', $event)"
            />
            <Knob
              :model-value="effect.depth"
              :min="0" :max="1"
              label="Depth"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'depth', $event)"
            />
            <Knob
              v-if="effect.feedback !== undefined"
              :model-value="effect.feedback"
              :min="0" :max="1"
              label="Feedback"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'feedback', $event)"
            />
            <Knob
              :model-value="effect.mix"
              :min="0" :max="1"
              label="Mix"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'mix', $event)"
            />
          </template>

          <template v-else-if="effect.type === 'dimension'">
            <Knob
              :model-value="effect.mix"
              :min="0" :max="1"
              label="Mix"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'mix', $event)"
            />
            <Knob
              :model-value="effect.width"
              :min="0" :max="1"
              label="Width"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'width', $event)"
            />
          </template>

          <template v-else-if="effect.type === 'volume'">
            <Knob
              :model-value="effect.value"
              :min="0" :max="1"
              label="Level"
              :color="color"
              :size="36"
              :decimals="2"
              @update:model-value="updateEffect(idx, 'value', $event)"
            />
          </template>
        </div>

        <!-- Drag handle indicator -->
        <div class="fx-drag-hint">⋮⋮</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import Knob from './Knob.vue'

const props = defineProps({
  effects: {
    type: Array,
    default: () => [],
  },
  color: {
    type: String,
    default: '#4ecdc4',
  },
})

const emit = defineEmits(['update', 'reorder'])

let draggedIdx = null

function formatEffectName(type) {
  const names = {
    distortion: 'Distortion',
    reverb: 'Reverb',
    compressor: 'Compressor',
    delay: 'Delay',
    chorus: 'Chorus',
    phaser: 'Phaser',
    flanger: 'Flanger',
    eq: 'EQ',
    volume: 'Volume',
    dimension: 'Dimension',
  }
  return names[type] || type
}

function toggleEffect(idx) {
  emit('update', idx, 'enabled', !props.effects[idx].enabled)
}

function updateEffect(idx, key, value) {
  emit('update', idx, key, value)
}

function startDrag(idx, event) {
  draggedIdx = idx
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', idx)
}

function dragOver(event) {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}

function drop(toIdx, event) {
  event.preventDefault()
  if (draggedIdx !== null && draggedIdx !== toIdx) {
    emit('reorder', draggedIdx, toIdx)
  }
}

function endDrag() {
  draggedIdx = null
}
</script>

<style scoped>
.fx-rack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #151515;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #333;
}

.fx-header {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
  padding-bottom: 6px;
  border-bottom: 1px solid #333;
}

.fx-effects-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fx-item {
  display: grid;
  grid-template-columns: 24px 1fr auto 24px;
  gap: 8px;
  align-items: center;
  padding: 8px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 3px;
  transition: all 0.15s;
  cursor: grab;
}

.fx-item:hover {
  background: #202020;
  border-color: #444;
}

.fx-item.disabled {
  opacity: 0.5;
}

.fx-item:active {
  cursor: grabbing;
}

.fx-toggle {
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 50%;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.fx-toggle:hover {
  background: rgba(78, 205, 196, 0.1);
}

.fx-name {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: #ccc;
  letter-spacing: 0.05em;
}

.fx-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 8px;
}

.fx-drag-hint {
  font-size: 12px;
  color: #555;
  font-weight: 700;
  letter-spacing: -2px;
  cursor: grab;
}

.fx-item:active .fx-drag-hint {
  cursor: grabbing;
  color: #4ecdc4;
}
</style>
