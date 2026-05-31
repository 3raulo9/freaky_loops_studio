<template>
  <div class="warp-panel">
    <div class="warp-label">WARP</div>

    <!-- Warp mode selector -->
    <div class="warp-mode-select">
      <select v-model="selectedMode" class="warp-select" @change="$emit('update:mode', $event.target.value)">
        <option value="none">None</option>
        <option value="sync">Sync</option>
        <option value="bend">Bend</option>
        <option value="pwm">PWM</option>
        <option value="asym">Asym</option>
        <option value="fm">FM from Osc B</option>
      </select>
    </div>

    <!-- Warp amount knob -->
    <div class="warp-knob-area">
      <Knob
        :model-value="warp"
        :min="0" :max="1"
        label="Warp Amt"
        :color="color"
        :size="48"
        :decimals="2"
        @update:model-value="$emit('update:warp', $event)"
      />
    </div>

    <!-- Visual waveform deformation preview -->
    <div class="warp-preview">
      <svg viewBox="0 0 120 80" class="warp-svg">
        <defs>
          <linearGradient id="warp-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" :stop-color="color" stop-opacity="0.6" />
            <stop offset="100%" :stop-color="color" stop-opacity="0.2" />
          </linearGradient>
        </defs>

        <!-- Background -->
        <rect width="120" height="80" fill="#0a0a0a" opacity="0.5" />

        <!-- Center line -->
        <line x1="0" y1="40" x2="120" y2="40" stroke="#333" stroke-width="0.5" />

        <!-- Warp preview waveform -->
        <path
          :d="warpPreviewPath"
          fill="url(#warp-grad)"
          :stroke="color"
          stroke-width="1"
          opacity="0.8"
        />
      </svg>
      <div class="warp-mode-label">{{ modeDescription }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import Knob from './Knob.vue'

const props = defineProps({
  mode: { type: String, default: 'none' },
  warp: { type: Number, default: 0.5 },
  color: { type: String, default: '#4ecdc4' },
})

const emit = defineEmits(['update:mode', 'update:warp'])

const selectedMode = ref(props.mode)

const modeDescription = computed(() => {
  const descriptions = {
    none: 'No warp',
    sync: 'Hard sync (rising overtones)',
    bend: 'Waveform bend',
    pwm: 'Pulse width modulation',
    asym: 'Asymmetric tilt',
    fm: 'Frequency modulation',
  }
  return descriptions[selectedMode.value] || 'No warp'
})

// Generate warp preview visualization
const warpPreviewPath = computed(() => {
  const points = []
  const centerY = 40
  const amplitude = 30
  const warpAmount = props.warp

  for (let i = 0; i < 120; i++) {
    const t = i / 120
    let y = 0

    switch (selectedMode.value) {
      case 'none':
        y = Math.sin(t * Math.PI * 2) * amplitude
        break

      case 'sync':
        // Simulate hard sync (rising overtones)
        y = Math.sin(t * Math.PI * 2) * amplitude
        y += Math.sin(t * Math.PI * 2 * (1 + warpAmount * 3)) * amplitude * 0.3
        break

      case 'bend':
        // Bend waveform toward center or edges
        const bend = warpAmount * 0.5
        y = Math.sin(t * Math.PI * 2 + Math.sin(t * Math.PI * 2) * bend) * amplitude
        break

      case 'pwm':
        // Pulse width modulation
        const pw = 0.5 + warpAmount * 0.4
        y = (t < pw ? 1 : -1) * amplitude
        break

      case 'asym':
        // Asymmetric tilt
        const tilt = warpAmount * 0.3
        y = Math.sin(t * Math.PI * 2 + tilt) * amplitude
        y += t * tilt * amplitude
        break

      case 'fm':
        // Frequency modulation
        const carrier = Math.sin(t * Math.PI * 2) * amplitude
        const modulator = Math.sin(t * Math.PI * 2 * 3) * warpAmount * 5
        y = Math.sin(t * Math.PI * 2 + modulator) * amplitude
        break

      default:
        y = 0
    }

    points.push(`${i},${centerY - y}`)
  }

  return `M ${points.join(' L ')}`
})
</script>

<style scoped>
.warp-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #0f0f0f;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid #333;
}

.warp-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
}

.warp-mode-select {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.warp-select {
  padding: 6px 8px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 3px;
  color: #ccc;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s;
}

.warp-select:hover {
  background: #252525;
  border-color: #444;
}

.warp-select:focus {
  outline: none;
  border-color: #4ecdc4;
  background: #252525;
}

.warp-knob-area {
  display: flex;
  justify-content: center;
}

.warp-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #1a1a1a;
  padding: 6px;
  border-radius: 3px;
  border: 1px solid #333;
}

.warp-svg {
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 2;
  border: 1px solid #333;
  border-radius: 2px;
}

.warp-mode-label {
  font-size: 8px;
  font-weight: 600;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
  text-align: center;
}
</style>
