<template>
  <div class="wt-display">
    <svg
      :viewBox="`0 0 ${width} ${height}`"
      class="wt-canvas"
      :class="{ view3d: mode === '3d' }"
    >
      <!-- Background grid -->
      <defs>
        <pattern id="grid" :width="gridSize" :height="gridSize" patternUnits="userSpaceOnUse">
          <path :d="`M ${gridSize} 0 L 0 0 0 ${gridSize}`" fill="none" stroke="#222" stroke-width="0.5" />
        </pattern>
      </defs>

      <rect width="100%" height="100%" fill="url(#grid)" opacity="0.5" />

      <!-- Center line -->
      <line :x1="0" :y1="height / 2" :x2="width" :y2="height / 2" stroke="#333" stroke-width="1" />

      <!-- 2D Waveform view -->
      <g v-if="mode === '2d'" class="wf-2d">
        <path
          :d="waveformPath2D"
          fill="none"
          :stroke="waveformColor"
          stroke-width="1.5"
          opacity="0.8"
        />
        <circle
          :cx="wtPosX"
          :cy="height / 2"
          r="3"
          :fill="waveformColor"
          opacity="0.9"
        />
      </g>

      <!-- 3D Wavetable view (mountain range) -->
      <g v-else class="wf-3d">
        <g v-for="(frame, i) in frameCount" :key="`frame-${i}`">
          <path
            :d="generateFramePath(i)"
            :fill="`url(#frame-gradient-${i})`"
            :opacity="frame3dOpacity(i)"
            :stroke="waveformColor"
            stroke-width="0.5"
          />
        </g>
      </g>

      <!-- WT Pos indicator (cursor line) -->
      <line
        :x1="wtPosX"
        :y1="0"
        :y2="height"
        :stroke="waveformColor"
        stroke-width="1"
        opacity="0.3"
        stroke-dasharray="2,2"
      />

      <!-- Modulation ring (placeholder for future modulation) -->
      <circle
        v-if="showModRing"
        cx="50%"
        cy="50%"
        :r="height * 0.35"
        fill="none"
        stroke="#4ecdc4"
        stroke-width="0.5"
        opacity="0.2"
      />
    </svg>

    <!-- Label -->
    <div class="wt-label">
      <span class="wt-name">{{ waveformName }}</span>
      <span class="wt-pos">Pos: {{ (wtPos * 100).toFixed(0) }}%</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  wtPos: { type: Number, default: 0.5 },
  waveform: { type: String, default: 'sine' },
  mode: { type: String, default: '2d', validator: v => ['2d', '3d'].includes(v) },
})

const width = 280
const height = 160
const gridSize = 20
const frameCount = 256 // Serum uses up to 256 frames per wavetable
const showModRing = false

const wtPosX = computed(() => {
  return 20 + props.wtPos * (width - 40)
})

const waveformName = computed(() => {
  const names = {
    sine: 'Sine',
    sawtooth: 'Sawtooth',
    square: 'Square',
    triangle: 'Triangle',
  }
  return names[props.waveform] || 'Custom'
})

const waveformColor = computed(() => {
  const colors = {
    sine: '#4ecdc4',
    sawtooth: '#ff6b6b',
    square: '#ffd93d',
    triangle: '#95e1d3',
  }
  return colors[props.waveform] || '#4ecdc4'
})

// Generate 2D waveform path
const waveformPath2D = computed(() => {
  const points = []
  const centerY = height / 2
  const amplitude = height / 2 - 10

  for (let i = 0; i < width - 40; i++) {
    const t = i / (width - 40)
    let y

    switch (props.waveform) {
      case 'sine':
        y = Math.sin(t * Math.PI * 2) * amplitude
        break
      case 'sawtooth':
        y = (t * 2 - 1) * amplitude
        break
      case 'square':
        y = (t < 0.5 ? 1 : -1) * amplitude
        break
      case 'triangle':
        y = (t < 0.5 ? t * 4 - 1 : 3 - t * 4) * amplitude
        break
      default:
        y = 0
    }

    points.push(`${20 + i},${centerY - y}`)
  }

  return `M ${points.join(' L ')}`
})

// Generate 3D frame paths (mountain range effect)
function generateFramePath(frameIndex) {
  const points = []
  const centerY = height / 2
  const amplitude = height / 2 - 10
  const frameProgress = frameIndex / frameCount

  // Vary the waveform slightly per frame for visual interest
  const phaseShift = frameProgress * Math.PI * 2

  for (let i = 0; i < width - 40; i++) {
    const t = i / (width - 40)
    let y

    switch (props.waveform) {
      case 'sine':
        y = Math.sin(t * Math.PI * 2 + phaseShift) * amplitude * (1 - Math.abs(frameProgress - props.wtPos))
        break
      case 'sawtooth':
        y = ((t + frameProgress) * 2 - 1) * amplitude * (1 - Math.abs(frameProgress - props.wtPos))
        break
      case 'square':
        y = (((t + frameProgress) % 1) < 0.5 ? 1 : -1) * amplitude * (1 - Math.abs(frameProgress - props.wtPos))
        break
      default:
        y = 0
    }

    const depth = Math.abs(frameProgress - props.wtPos)
    const xOffset = depth * 2
    points.push(`${20 + i + xOffset},${centerY - y}`)
  }

  return `M ${points.join(' L ')}`
}

function frame3dOpacity(frameIndex) {
  const frameProgress = frameIndex / frameCount
  const distance = Math.abs(frameProgress - props.wtPos)
  return Math.max(0.1, 1 - distance * 2)
}
</script>

<style scoped>
.wt-display {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #0f0f0f;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid #333;
}

.wt-canvas {
  width: 100%;
  height: auto;
  background: linear-gradient(135deg, #1a1a1a 0%, #0f0f0f 100%);
  border: 1px solid #333;
  border-radius: 3px;
  cursor: crosshair;
}

.wt-canvas.view3d {
  filter: drop-shadow(0 2px 8px rgba(78, 205, 196, 0.1));
}

.wt-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
}

.wt-name {
  color: #999;
}

.wt-pos {
  color: #4ecdc4;
  font-family: 'Share Tech Mono', monospace;
}
</style>
