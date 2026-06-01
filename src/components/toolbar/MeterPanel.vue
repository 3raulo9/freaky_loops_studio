<template>
  <!-- Self-contained meter: drives its own high-frequency polling loop so the
       oscilloscope/CPU graph repaints without re-rendering neighbour panels. -->
  <div class="tb-meter">
    <canvas ref="scopeCanvas" class="tb-scope" :width="SCOPE_W" :height="SCOPE_H" />
    <div class="tb-cpu-row">
      <span class="tb-cpu-lbl">CPU</span>
      <div class="tb-cpu-bar">
        <div class="tb-cpu-fill" :style="{ width: audioLoad + '%', background: cpuColor }" />
      </div>
      <span class="tb-cpu-val">{{ audioLoad }}%</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const { audioLoad, getAnalyser } = useStudio()

const SCOPE_W = 112
const SCOPE_H = 28
const scopeCanvas = ref(null)
let raf = null
let buf = null

function drawScope() {
  const canvas = scopeCanvas.value
  if (!canvas) { raf = requestAnimationFrame(drawScope); return }
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height

  const style = getComputedStyle(document.documentElement)
  ctx.fillStyle = style.getPropertyValue('--bg-deeper').trim() || '#07070f'
  ctx.fillRect(0, 0, w, h)

  const analyser = getAnalyser()
  if (!analyser) {
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2)
    ctx.strokeStyle = style.getPropertyValue('--border-subtle').trim() || '#1a1a28'; ctx.lineWidth = 1; ctx.stroke()
    raf = requestAnimationFrame(drawScope)
    return
  }

  if (!buf || buf.length !== analyser.fftSize) {
    buf = new Float32Array(analyser.fftSize)
  }
  analyser.getFloatTimeDomainData(buf)

  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const waveColor = peak > 0.8 ? '#e74c3c' : peak > 0.5 ? '#f39c12' : '#2ecc71'

  if (peak > 0.05) {
    ctx.fillStyle = `rgba(46,204,113,${Math.min(0.07, peak * 0.06)})`
    ctx.fillRect(0, 0, w, h)
  }

  ctx.beginPath()
  ctx.strokeStyle = waveColor
  ctx.lineWidth = 1.5
  const sl = w / buf.length
  for (let i = 0; i < buf.length; i++) {
    const x = i * sl
    const y = (1 - (buf[i] + 1) / 2) * h
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()

  raf = requestAnimationFrame(drawScope)
}

const cpuColor = computed(() => {
  const l = audioLoad.value
  return l > 75 ? '#e74c3c' : l > 45 ? '#f39c12' : '#2ecc71'
})

onMounted(drawScope)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>
