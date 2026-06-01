<template>
  <div class="tb-master">
    <!-- ── Main Volume (linear→log gain, unity at 0.8) ───────────────────────── -->
    <div class="tb-ms-ctrl">
      <div class="tb-ms-label">MAIN VOL</div>
      <div
        class="tb-ms-track"
        @pointerdown="startDrag($event, 'vol')"
        @wheel.prevent="onWheel($event, 'vol')"
        @contextmenu.prevent="setMasterVolume(0.8)"
        @mouseenter="hintVol" @mousemove="hintVol" @mouseleave="clearHint()"
      >
        <div class="tb-ms-unity" />
        <div class="tb-ms-fill" :style="{ width: volPct + '%' }" />
        <div class="tb-ms-thumb" :style="{ left: volPct + '%' }" />
      </div>
    </div>

    <!-- ── Master Pitch (bipolar) + range selector ───────────────────────────── -->
    <div class="tb-ms-ctrl">
      <div class="tb-ms-label">PITCH</div>
      <div class="tb-ms-pitchrow">
        <div
          class="tb-ms-track tb-ms-track--bipolar"
          @pointerdown="startDrag($event, 'pitch')"
          @wheel.prevent="onWheel($event, 'pitch')"
          @contextmenu.prevent="setMasterPitch(0)"
          @mouseenter="hintPitch" @mousemove="hintPitch" @mouseleave="clearHint()"
        >
          <div class="tb-ms-center" />
          <div class="tb-ms-thumb tb-ms-thumb--pitch" :style="{ left: pitchPct + '%' }" />
        </div>
        <input
          class="tb-ms-range"
          type="number" min="1" max="48"
          :value="masterPitchRange"
          title="Pitch range (semitones)"
          @change="setMasterPitchRange(+$event.target.value)"
          @mouseenter="hintPitch" @mouseleave="clearHint()"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'
import { setHintRaw, clearHint } from './hintBus.js'

const {
  masterVolume, masterPitch, masterPitchRange,
  setMasterVolume, setMasterPitch, setMasterPitchRange,
} = useStudio()

const volPct   = computed(() => masterVolume.value * 100)          // slider 0..1 → 0..100%
const pitchPct = computed(() => (masterPitch.value + 1) / 2 * 100) // -1..1 → 0..100%

// ── Readout maths ─────────────────────────────────────────────────────────────
const volPercent = computed(() => Math.round(masterVolume.value / 0.8 * 100))
const volDb = computed(() => {
  if (masterVolume.value <= 0) return '-∞'
  const db = 20 * Math.log10(masterVolume.value / 0.8)
  return (db >= 0 ? '+' : '') + db.toFixed(1)
})
const pitchCents = computed(() => Math.round(masterPitch.value * masterPitchRange.value * 100))

function hintVol()   { setHintRaw(`Main volume: ${volPercent.value}% (${volDb.value} dB)`) }
function hintPitch() {
  const c = pitchCents.value
  setHintRaw(`Master pitch: ${c >= 0 ? '+' : ''}${c} cents (range ±${masterPitchRange.value} st)`)
}

// ── Drag (relative pixel delta, Ctrl = ×0.1 fine) ─────────────────────────────
let target = null, startX = 0, startVal = 0, trackW = 1
function startDrag(e, which) {
  if (e.button !== 0) return
  e.preventDefault()
  target = which
  startX = e.clientX
  trackW = e.currentTarget.getBoundingClientRect().width || 1
  startVal = which === 'vol' ? masterVolume.value : masterPitch.value
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', stopDrag)
}
function onDrag(e) {
  const fine = e.ctrlKey || e.metaKey
  // Bipolar pitch spans 2 units across the track; volume spans 1.
  const span = target === 'pitch' ? 2 : 1
  let d = ((e.clientX - startX) / trackW) * span * (fine ? 0.1 : 1)
  if (target === 'vol') { setMasterVolume(startVal + d); hintVol() }
  else                  { setMasterPitch(startVal + d);  hintPitch() }
}
function stopDrag() {
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
}

// ── Wheel fine-stepping (±0.01) ───────────────────────────────────────────────
function onWheel(e, which) {
  const step = (e.deltaY < 0 ? 1 : -1) * 0.01
  if (which === 'vol') { setMasterVolume(masterVolume.value + step); hintVol() }
  else                 { setMasterPitch(masterPitch.value + step);  hintPitch() }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
})
</script>

<style scoped>
.tb-master { display: flex; align-items: center; gap: 10px; flex-shrink: 0; padding: 0 4px; }
.tb-ms-ctrl { display: flex; flex-direction: column; gap: 3px; }
.tb-ms-label {
  font-family: 'Rajdhani', sans-serif; font-size: 7px; font-weight: 700;
  letter-spacing: 0.16em; color: #28283c; text-transform: uppercase;
}
.tb-ms-pitchrow { display: flex; align-items: center; gap: 5px; }

.tb-ms-track {
  position: relative; width: 84px; height: 14px;
  background: var(--bg-deeper); border: 1px solid var(--border-subtle); border-radius: 7px;
  cursor: ew-resize;
}
.tb-ms-fill {
  position: absolute; left: 0; top: 0; bottom: 0;
  background: linear-gradient(90deg, #2ecc71, #f1c40f 80%, #e74c3c);
  border-radius: 7px 0 0 7px; opacity: 0.55;
}
.tb-ms-unity {
  position: absolute; left: 80%; top: -1px; bottom: -1px; width: 1px;
  background: #c8c8e0aa;   /* 0 dB unity marker at 0.8 */
}
.tb-ms-center {
  position: absolute; left: 50%; top: -1px; bottom: -1px; width: 1px;
  background: #c8c8e0aa;   /* pitch-neutral center */
}
.tb-ms-thumb {
  position: absolute; top: 50%; width: 9px; height: 16px;
  transform: translate(-50%, -50%);
  background: linear-gradient(180deg, #d0d0e8, #6a6a98);
  border: 1px solid #1a1a28; border-radius: 3px; pointer-events: none;
  box-shadow: 0 1px 2px #000000a0;
}
.tb-ms-thumb--pitch { background: linear-gradient(180deg, #c8a0ff, #7b4dd6); }
.tb-ms-track--bipolar { width: 70px; cursor: ew-resize; }

.tb-ms-range {
  width: 30px; height: 18px;
  background: var(--bg-control); border: 1px solid var(--border-subtle); border-radius: 4px;
  color: var(--text-muted); text-align: center;
  font-family: 'Share Tech Mono', monospace; font-size: 11px; outline: none;
  -moz-appearance: textfield;
}
.tb-ms-range::-webkit-inner-spin-button { opacity: 0.4; }
.tb-ms-range:focus { border-color: #7b4dd6; }
</style>
