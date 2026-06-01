<template>
  <div
    class="tb-timecode"
    v-hint="'timecode'"
    @click="timecodeAsMins = !timecodeAsMins"
    :title="timecodeAsMins ? 'Click → Bars:Beats:Ticks' : 'Click → Min:Sec:Ms'"
  >
    <div class="tb-timecode-val">{{ timecodeDisplay }}</div>
    <div class="tb-timecode-mode">{{ timecodeAsMins ? 'MIN · SEC · MS' : 'BAR · BEAT · TICK' }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const { bpm, totalSteps, getPlayheadTimeSeconds } = useStudio()

const timecodeAsMins = ref(false)
const currentTimeSec = ref(0)
let raf = null

function tick() {
  currentTimeSec.value = getPlayheadTimeSeconds()
  raf = requestAnimationFrame(tick)
}

const timecodeDisplay = computed(() => {
  const t = currentTimeSec.value
  if (timecodeAsMins.value) {
    const min = Math.floor(t / 60)
    const sec = Math.floor(t % 60)
    const ms  = Math.floor((t % 1) * 100)
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(ms).padStart(2, '0')}`
  }
  const spb   = 60 / bpm.value
  const spbar = 4 * spb
  const bar  = Math.floor(t / spbar) + 1
  const beat = Math.floor((t % spbar) / spb) + 1
  const tick = Math.floor(((t % spb) / spb) * totalSteps.value) + 1
  return `${String(bar).padStart(3, '0')}:${beat}:${String(tick).padStart(2, '0')}`
})

onMounted(tick)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>
