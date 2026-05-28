<template>
  <div class="knob-root" :title="`${label}: ${Math.round(mappedValue * 100) / 100}`">
    <svg
      :width="size"
      :height="size"
      :viewBox="`0 0 ${size} ${size}`"
      class="knob-svg"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDrag"
    >
      <defs>
        <!-- Knob body gradient (3D look) -->
        <radialGradient :id="`kg-${uid}`" cx="38%" cy="32%" r="65%">
          <stop offset="0%"   stop-color="#888" />
          <stop offset="55%"  stop-color="#3a3a3a" />
          <stop offset="100%" stop-color="#1a1a1a" />
        </radialGradient>
        <!-- Glow filter for active arc -->
        <filter :id="`glow-${uid}`" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      <!-- Outer ring shadow -->
      <circle :cx="cx" :cy="cy" :r="r + 3.5" fill="#080808" opacity="0.85" />

      <!-- Track arc (full range) -->
      <path
        :d="trackArcPath"
        fill="none"
        stroke="#222"
        :stroke-width="arcW + 1"
        stroke-linecap="round"
      />
      <path
        :d="trackArcPath"
        fill="none"
        stroke="#383838"
        :stroke-width="arcW - 1"
        stroke-linecap="round"
      />

      <!-- Value arc (filled portion) -->
      <path
        v-if="normalizedValue > 0.005"
        :d="valueArcPath"
        fill="none"
        :stroke="color"
        :stroke-width="arcW - 1"
        stroke-linecap="round"
        :filter="`url(#glow-${uid})`"
        opacity="0.9"
      />

      <!-- Knob body -->
      <circle :cx="cx" :cy="cy" :r="r" :fill="`url(#kg-${uid})`" />

      <!-- Knurling marks (decorative tick lines around edge) -->
      <g v-for="i in 12" :key="i">
        <line
          :x1="cx + (r - 3) * Math.cos((i - 1) * 30 * DEG)"
          :y1="cy + (r - 3) * Math.sin((i - 1) * 30 * DEG)"
          :x2="cx + (r + 0.5) * Math.cos((i - 1) * 30 * DEG)"
          :y2="cy + (r + 0.5) * Math.sin((i - 1) * 30 * DEG)"
          stroke="#111"
          stroke-width="1"
          opacity="0.5"
        />
      </g>

      <!-- Indicator dot line (pointer) -->
      <line
        :x1="cx + (r * 0.28) * indicatorCos"
        :y1="cy + (r * 0.28) * indicatorSin"
        :x2="cx + (r * 0.82) * indicatorCos"
        :y2="cy + (r * 0.82) * indicatorSin"
        stroke="#ffffff"
        stroke-width="2.5"
        stroke-linecap="round"
        opacity="0.95"
      />
    </svg>

    <!-- Label + live value below -->
    <div class="knob-label-area">
      <span class="knob-label">{{ label }}</span>
      <span class="knob-value" :style="{ color }">{{ displayValue }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { type: Number, default: 0.5 },
  min:        { type: Number, default: 0 },
  max:        { type: Number, default: 1 },
  label:      { type: String, default: '' },
  color:      { type: String, default: '#4ecdc4' },
  size:       { type: Number, default: 60 },
  decimals:   { type: Number, default: 2 },
})
const emit = defineEmits(['update:modelValue'])

// Unique ID so multiple SVG gradients don't clash
const uid = Math.random().toString(36).slice(2, 7)

const DEG = Math.PI / 180

const cx = computed(() => props.size / 2)
const cy = computed(() => props.size / 2)
const r  = computed(() => props.size / 2 - 7)
const arcW = 4

// normalizedValue: 0 → 1 based on modelValue within [min, max]
const normalizedValue = computed(() =>
  Math.min(1, Math.max(0, (props.modelValue - props.min) / (props.max - props.min)))
)

const mappedValue = computed(() => props.modelValue)

const displayValue = computed(() => {
  const v = props.modelValue
  return props.decimals === 0 ? Math.round(v).toString() : v.toFixed(props.decimals)
})

// Knob sweep: from -135° (7 o'clock) to +135° (5 o'clock), 270° total
// Angles measured from 12 o'clock (top), positive = clockwise
const START_ANG = -135  // degrees from top
const RANGE_ANG = 270   // total sweep degrees

function angleToXY(angleDeg, radius) {
  const rad = (angleDeg - 90) * DEG  // offset so 0° = top
  return { x: cx.value + radius * Math.cos(rad), y: cy.value + radius * Math.sin(rad) }
}

function arcPath(fromAngle, toAngle) {
  const rr = r.value + 5
  const start = angleToXY(fromAngle, rr)
  const end   = angleToXY(toAngle,   rr)
  const large = (toAngle - fromAngle) > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${rr} ${rr} 0 ${large} 1 ${end.x} ${end.y}`
}

const trackArcPath = computed(() => arcPath(START_ANG, START_ANG + RANGE_ANG))
const valueArcPath = computed(() => {
  const endAng = START_ANG + normalizedValue.value * RANGE_ANG
  return arcPath(START_ANG, endAng)
})

// Indicator pointer direction
const indicatorAngleDeg = computed(() => START_ANG + normalizedValue.value * RANGE_ANG)
const indicatorCos = computed(() => Math.cos((indicatorAngleDeg.value - 90) * DEG))
const indicatorSin = computed(() => Math.sin((indicatorAngleDeg.value - 90) * DEG))

// ─── Drag logic ──────────────────────────────────────────────────────────────
const dragging = ref(false)
let dragStartY = 0
let dragStartValue = 0

function startDrag(e) {
  dragging.value = true
  dragStartY = e.touches ? e.touches[0].clientY : e.clientY
  dragStartValue = props.modelValue
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup',  stopDrag)
  window.addEventListener('touchmove', onDrag, { passive: false })
  window.addEventListener('touchend',  stopDrag)
}

function onDrag(e) {
  if (!dragging.value) return
  e.preventDefault()
  const clientY = e.touches ? e.touches[0].clientY : e.clientY
  const dy = dragStartY - clientY          // up = positive = increase
  const sensitivity = (props.max - props.min) / 160
  const newVal = Math.min(props.max, Math.max(props.min, dragStartValue + dy * sensitivity))
  emit('update:modelValue', newVal)
}

function stopDrag() {
  dragging.value = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup',  stopDrag)
  window.removeEventListener('touchmove', onDrag)
  window.removeEventListener('touchend',  stopDrag)
}

onBeforeUnmount(stopDrag)
</script>

<style scoped>
.knob-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  user-select: none;
}

.knob-svg {
  cursor: ns-resize;
  display: block;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
  transition: filter 0.15s;
}
.knob-svg:active {
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
}

.knob-label-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.knob-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #666680;
}

.knob-value {
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px;
  min-width: 32px;
  text-align: center;
}
</style>
