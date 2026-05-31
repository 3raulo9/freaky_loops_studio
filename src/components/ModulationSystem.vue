<template>
  <div class="mod-system">
    <!-- LFO Section -->
    <div class="mod-section">
      <div class="mod-section-header">LFOs</div>

      <div class="lfo-list">
        <div v-for="(lfo, idx) in lfos" :key="`lfo-${idx}`" class="lfo-item">
          <div class="lfo-header">
            <span class="lfo-name">LFO {{ idx + 1 }}</span>
            <span class="lfo-rate">{{ (lfo.rate * 20).toFixed(1) }}Hz</span>
          </div>

          <!-- LFO waveform selector -->
          <div class="lfo-waveform">
            <select v-model="lfos[idx].waveform" class="lfo-select">
              <option value="sine">Sine</option>
              <option value="triangle">Triangle</option>
              <option value="square">Square</option>
              <option value="sawtooth">Sawtooth</option>
              <option value="random">Random</option>
            </select>
          </div>

          <!-- LFO knobs -->
          <div class="lfo-knobs">
            <Knob
              :model-value="lfo.rate"
              :min="0" :max="1"
              label="Rate"
              :color="color"
              :size="40"
              :decimals="2"
              @update:model-value="updateLFO(idx, 'rate', $event)"
            />
            <Knob
              :model-value="lfo.phase"
              :min="0" :max="1"
              label="Phase"
              :color="color"
              :size="40"
              :decimals="2"
              @update:model-value="updateLFO(idx, 'phase', $event)"
            />
          </div>

          <!-- LFO visualization -->
          <div class="lfo-viz">
            <svg viewBox="0 0 100 40" class="lfo-svg">
              <path :d="generateLFOPath(lfo)" :stroke="color" stroke-width="1" fill="none" opacity="0.7" />
            </svg>
          </div>

          <!-- Retrigger toggle -->
          <label class="retrig-label">
            <input
              type="checkbox"
              :checked="lfo.retrig"
              @change="updateLFO(idx, 'retrig', $event.target.checked)"
              class="retrig-checkbox"
            />
            <span>Retrig on Note</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Envelope Section -->
    <div class="mod-section">
      <div class="mod-section-header">ENVELOPES</div>

      <div class="env-list">
        <div v-for="(env, idx) in envelopes" :key="`env-${idx}`" class="env-item">
          <div class="env-header">
            <span class="env-name">{{ env.name }}</span>
            <span class="env-type">(ADSR)</span>
          </div>

          <!-- ADSR knobs -->
          <div class="env-knobs">
            <Knob
              :model-value="env.attack"
              :min="0.001" :max="1"
              label="Attack"
              :color="color"
              :size="40"
              :decimals="3"
              @update:model-value="updateEnvelope(idx, 'attack', $event)"
            />
            <Knob
              :model-value="env.decay"
              :min="0.001" :max="1"
              label="Decay"
              :color="color"
              :size="40"
              :decimals="3"
              @update:model-value="updateEnvelope(idx, 'decay', $event)"
            />
            <Knob
              :model-value="env.sustain"
              :min="0" :max="1"
              label="Sustain"
              :color="color"
              :size="40"
              :decimals="2"
              @update:model-value="updateEnvelope(idx, 'sustain', $event)"
            />
            <Knob
              :model-value="env.release"
              :min="0.001" :max="1"
              label="Release"
              :color="color"
              :size="40"
              :decimals="3"
              @update:model-value="updateEnvelope(idx, 'release', $event)"
            />
          </div>

          <!-- Envelope curve visualization -->
          <div class="env-curve">
            <svg viewBox="0 0 100 60" class="env-svg">
              <path :d="generateEnvelopePath(env)" :stroke="color" stroke-width="1" fill="none" opacity="0.7" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Modulation Matrix Info -->
    <div class="mod-info">
      <div class="mod-info-header">MODULATION MATRIX</div>
      <div class="mod-info-text">
        Drag LFO/Envelope crosshairs onto parameters to create modulation connections
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Knob from './Knob.vue'

const props = defineProps({
  lfos: {
    type: Array,
    default: () => [],
  },
  envelopes: {
    type: Array,
    default: () => [],
  },
  modMatrix: {
    type: Array,
    default: () => [],
  },
  color: {
    type: String,
    default: '#4ecdc4',
  },
})

const emit = defineEmits(['update:lfo', 'update:envelope'])

function updateLFO(idx, key, value) {
  emit('update:lfo', idx, key, value)
}

function updateEnvelope(idx, key, value) {
  emit('update:envelope', idx, key, value)
}

// Generate LFO waveform visualization
function generateLFOPath(lfo) {
  const points = []
  const centerY = 20

  for (let x = 0; x < 100; x++) {
    const t = (x / 100 + lfo.phase) % 1
    let y = 0

    switch (lfo.waveform) {
      case 'sine':
        y = Math.sin(t * Math.PI * 2) * 18
        break
      case 'triangle':
        y = (t < 0.5 ? t * 4 - 1 : 3 - t * 4) * 18
        break
      case 'square':
        y = (t < 0.5 ? 1 : -1) * 18
        break
      case 'sawtooth':
        y = (t * 2 - 1) * 18
        break
      case 'random':
        y = (Math.random() * 2 - 1) * 18
        break
      default:
        y = 0
    }

    points.push(`${x},${centerY - y}`)
  }

  return `M ${points.join(' L ')}`
}

// Generate ADSR envelope visualization
function generateEnvelopePath(env) {
  const points = []
  const totalTime = 1
  const attack = (env.attack / totalTime) * 100
  const decay = (env.decay / totalTime) * 100
  const release = (env.release / totalTime) * 100

  // Attack phase
  for (let x = 0; x <= attack; x++) {
    const t = x / attack
    points.push(`${x},${60 - t * 50}`)
  }

  // Decay phase
  const decayStart = attack
  const decayEnd = attack + decay
  for (let x = decayStart; x <= decayEnd; x += 0.5) {
    const t = (x - decayStart) / decay
    const y = 50 - t * (50 - env.sustain * 50)
    points.push(`${x},${60 - y}`)
  }

  // Sustain phase
  const sustainEnd = Math.min(decayEnd + 20, 70)
  points.push(`${sustainEnd},${60 - env.sustain * 50}`)

  // Release phase
  const releaseStart = sustainEnd
  const releaseEnd = Math.min(releaseStart + release * 20, 100)
  for (let x = releaseStart; x <= releaseEnd; x += 0.5) {
    const t = (x - releaseStart) / (releaseEnd - releaseStart)
    const y = env.sustain * 50 * (1 - t)
    points.push(`${x},${60 - y}`)
  }

  return `M ${points.join(' L ')}`
}
</script>

<style scoped>
.mod-system {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mod-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #151515;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #333;
}

.mod-section-header {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
  padding-bottom: 6px;
  border-bottom: 1px solid #333;
}

.lfo-list,
.env-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lfo-item,
.env-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #0f0f0f;
  padding: 8px;
  border-radius: 3px;
  border: 1px solid #333;
}

.lfo-header,
.env-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  color: #999;
  letter-spacing: 0.05em;
}

.lfo-name,
.env-name {
  color: #ccc;
}

.lfo-rate,
.env-type {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px;
  color: #4ecdc4;
}

.lfo-waveform {
  display: flex;
}

.lfo-select {
  flex: 1;
  padding: 4px 6px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 2px;
  color: #ccc;
  font-size: 9px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.lfo-select:hover {
  background: #252525;
  border-color: #444;
}

.lfo-select:focus {
  outline: none;
  border-color: #4ecdc4;
  background: #252525;
}

.lfo-knobs,
.env-knobs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(40px, 1fr));
  gap: 4px;
}

.lfo-viz,
.env-curve {
  background: #1a1a1a;
  padding: 4px;
  border-radius: 2px;
  border: 1px solid #333;
}

.lfo-svg,
.env-svg {
  width: 100%;
  height: auto;
}

.retrig-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 8px;
  font-weight: 600;
  text-transform: uppercase;
  color: #666;
  cursor: pointer;
  user-select: none;
}

.retrig-checkbox {
  width: 12px;
  height: 12px;
  cursor: pointer;
  accent-color: #4ecdc4;
}

.mod-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #0f0f0f;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #333;
}

.mod-info-header {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
  padding-bottom: 6px;
  border-bottom: 1px solid #333;
}

.mod-info-text {
  font-size: 9px;
  color: #888;
  line-height: 1.4;
}
</style>
