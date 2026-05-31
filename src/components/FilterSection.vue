<template>
  <div class="filter-section">
    <div class="filter-header">FILTER</div>

    <div class="filter-knobs">
      <!-- Filter type selector -->
      <div class="filter-type">
        <label class="filter-type-label">Type</label>
        <select v-model="selectedType" class="filter-type-select" @change="$emit('update', 'type', $event.target.value)">
          <option value="lowpass">Low Pass</option>
          <option value="highpass">High Pass</option>
          <option value="bandpass">Band Pass</option>
          <option value="notch">Notch</option>
          <option value="allpass">All Pass</option>
          <option value="vowel">Vowel</option>
          <option value="flange">Flange</option>
          <option value="phaser">Phaser</option>
        </select>
      </div>

      <!-- Cutoff frequency -->
      <Knob
        :model-value="params.cutoff"
        :min="0" :max="1"
        label="Cutoff"
        :color="color"
        :size="48"
        :decimals="2"
        @update:model-value="$emit('update', 'cutoff', $event)"
      />

      <!-- Resonance -->
      <Knob
        :model-value="params.resonance"
        :min="0" :max="1"
        label="Resonance"
        :color="color"
        :size="48"
        :decimals="2"
        @update:model-value="$emit('update', 'resonance', $event)"
      />

      <!-- Drive -->
      <Knob
        :model-value="params.drive"
        :min="0" :max="1"
        label="Drive"
        :color="color"
        :size="48"
        :decimals="2"
        @update:model-value="$emit('update', 'drive', $event)"
      />

      <!-- Fat -->
      <Knob
        :model-value="params.fat"
        :min="0" :max="1"
        label="Fat"
        :color="color"
        :size="48"
        :decimals="2"
        @update:model-value="$emit('update', 'fat', $event)"
      />
    </div>

    <!-- Keytracking toggle -->
    <div class="keytrack-row">
      <label class="keytrack-label">
        <input
          type="checkbox"
          :checked="params.keyTracking"
          @change="$emit('update', 'keyTracking', $event.target.checked)"
          class="keytrack-checkbox"
        />
        <span class="keytrack-text">Key Tracking</span>
      </label>
    </div>

    <!-- Filter curve visualization -->
    <div class="filter-curve">
      <svg viewBox="0 0 150 100" class="filter-svg">
        <defs>
          <linearGradient id="filter-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" :stop-color="color" stop-opacity="0.6" />
            <stop offset="100%" :stop-color="color" stop-opacity="0.1" />
          </linearGradient>
        </defs>

        <!-- Axes -->
        <line x1="10" y1="90" x2="140" y2="90" stroke="#333" stroke-width="0.5" />
        <line x1="10" y1="10" x2="10" y2="90" stroke="#333" stroke-width="0.5" />

        <!-- Filter curve -->
        <path
          :d="filterCurvePath"
          fill="url(#filter-grad)"
          :stroke="color"
          stroke-width="1"
          opacity="0.8"
        />

        <!-- Cutoff indicator -->
        <circle
          :cx="10 + params.cutoff * 130"
          cy="50"
          r="2"
          :fill="color"
          opacity="0.9"
        />
      </svg>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import Knob from './Knob.vue'

const props = defineProps({
  params: {
    type: Object,
    default: () => ({
      type: 'lowpass',
      cutoff: 0.8,
      resonance: 0.3,
      drive: 0,
      fat: 0,
      keyTracking: false,
    }),
  },
  color: { type: String, default: '#4ecdc4' },
})

const emit = defineEmits(['update'])

const selectedType = ref(props.params.type)

// Generate filter response curve
const filterCurvePath = computed(() => {
  const points = []
  const cutoffFreq = props.params.cutoff
  const resonance = props.params.resonance

  for (let i = 0; i <= 130; i++) {
    const freqNorm = i / 130
    let response = 1

    switch (selectedType.value) {
      case 'lowpass':
        // Lowpass: attenuate frequencies above cutoff
        if (freqNorm > cutoffFreq) {
          const roll = (freqNorm - cutoffFreq) / (1 - cutoffFreq)
          response = Math.pow(1 - roll, 2) + resonance * 0.3
        }
        break

      case 'highpass':
        // Highpass: attenuate frequencies below cutoff
        if (freqNorm < cutoffFreq) {
          const roll = (cutoffFreq - freqNorm) / cutoffFreq
          response = Math.pow(1 - roll, 2) + resonance * 0.3
        }
        break

      case 'bandpass':
        // Bandpass: peak at cutoff
        const bandwidth = 0.2 + resonance * 0.3
        const distance = Math.abs(freqNorm - cutoffFreq)
        response = Math.exp(-(distance / bandwidth) ** 2) + resonance * 0.2
        break

      case 'notch':
        // Notch: dip at cutoff
        const notchWidth = 0.15 + resonance * 0.1
        const notchDist = Math.abs(freqNorm - cutoffFreq)
        response = 1 - Math.exp(-(notchDist / notchWidth) ** 2) * 0.8
        break

      case 'vowel':
        // Vowel: multiple peaks
        response = Math.sin(freqNorm * Math.PI * 2) * 0.3 + 0.7 + resonance * 0.3
        break

      default:
        response = 1
    }

    response = Math.max(0.1, Math.min(1, response))
    const y = 90 - response * 80
    points.push(`${10 + i},${y}`)
  }

  return `M ${points.join(' L ')}`
})
</script>

<style scoped>
.filter-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #151515;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #333;
}

.filter-header {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
  padding-bottom: 6px;
  border-bottom: 1px solid #333;
}

.filter-knobs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.filter-type {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-type-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.08em;
}

.filter-type-select {
  padding: 6px 8px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 3px;
  color: #ccc;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.filter-type-select:hover {
  background: #252525;
  border-color: #444;
}

.filter-type-select:focus {
  outline: none;
  border-color: #4ecdc4;
  background: #252525;
}

.keytrack-row {
  display: flex;
  align-items: center;
  padding: 6px 0;
  border-top: 1px solid #333;
}

.keytrack-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.08em;
  user-select: none;
}

.keytrack-checkbox {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: #4ecdc4;
}

.keytrack-text {
  transition: color 0.15s;
}

.keytrack-label:hover .keytrack-text {
  color: #888;
}

.filter-curve {
  background: #0f0f0f;
  padding: 6px;
  border-radius: 3px;
  border: 1px solid #333;
}

.filter-svg {
  width: 100%;
  height: auto;
}
</style>
