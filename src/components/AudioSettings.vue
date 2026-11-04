<template>
  <Teleport to="body">
    <div class="as-back" @mousedown.self="$emit('close')">
      <div class="as-win">
        <div class="as-hdr">
          <span>AUDIO SETTINGS</span>
          <button class="as-x" @click="$emit('close')">×</button>
        </div>

        <div class="as-body">
          <section>
            <h4>OUTPUT</h4>
            <label class="as-row">
              <span class="as-k">Driver</span>
              <select :value="form.driver" :disabled="busy" @change="pickDriver($event.target.value)">
                <option v-for="d in info.drivers" :key="d.id" :value="d.id" :disabled="!d.devices.length">
                  {{ d.name }}{{ d.devices.length ? '' : ' — none installed' }}
                </option>
              </select>
            </label>
            <label class="as-row">
              <span class="as-k">{{ form.driver === 'asio' ? 'ASIO driver' : 'Device' }}</span>
              <select :value="form.device ?? ''" :disabled="busy" @change="apply({ device: $event.target.value || null })">
                <option v-if="form.driver !== 'asio'" value="">System default</option>
                <option v-for="d in devices" :key="d" :value="d">{{ d }}</option>
              </select>
            </label>
            <div v-if="form.driver === 'asio'" class="as-row">
              <span class="as-k"></span>
              <button class="as-btn" :disabled="busy || info.running?.driver !== 'asio'" @click="openAsioPanel">Show ASIO panel</button>
            </div>
          </section>

          <section>
            <h4>BUFFER</h4>
            <label class="as-row">
              <span class="as-k">Buffer length</span>
              <select :value="form.buffer ?? 0" :disabled="busy || !bufferOptions.length" @change="apply({ buffer: +$event.target.value || null })">
                <option :value="0">{{ form.driver === 'shared' ? 'Set by Windows' : 'Driver default' }}</option>
                <option v-for="b in bufferOptions" :key="b" :value="b">{{ b }} smp ({{ ms(b) }} ms)</option>
              </select>
            </label>
            <label class="as-row">
              <span class="as-k">Sample rate</span>
              <select :value="form.rate ?? 0" :disabled="busy || form.driver === 'shared'" @change="apply({ rate: +$event.target.value || null })">
                <option :value="0">Device default</option>
                <option v-for="r in [44100, 48000, 88200, 96000]" :key="r" :value="r">{{ r }} Hz</option>
              </select>
            </label>
            <p v-if="form.driver === 'shared'" class="as-note">
              Shared mode mixes with other apps; Windows sets the buffer (about 10 ms plus its own queue).
              For the shortest delay between a key and its sound, pick the exclusive driver or ASIO.
            </p>
          </section>

          <section>
            <h4>STATUS</h4>
            <div class="as-status">
              <div v-if="busy" class="as-dim">Switching…</div>
              <template v-else-if="info.running?.device">
                <div><b>{{ info.running.device }}</b></div>
                <div class="as-dim">
                  {{ driverName(info.running.driver) }} · {{ info.running.rate }} Hz
                  <template v-if="info.running.buffer"> · {{ info.running.buffer }} smp ({{ ms(info.running.buffer, info.running.rate) }} ms)</template>
                  <template v-if="info.running.format && info.running.format !== 'shared'"> · {{ info.running.format }}</template>
                </div>
              </template>
              <div v-else class="as-err">No output device is running.</div>
              <div v-if="info.error && !busy" class="as-err">{{ driverName(form.driver) }} couldn't start: {{ info.error }} — playing through Windows audio instead.</div>
            </div>
            <div class="as-meters">
              <div class="as-meter">
                <span class="as-k">CPU</span>
                <div class="as-bar"><div class="as-fill" :class="{ hot: stats.loadPeak > 0.8 }" :style="{ width: Math.min(100, stats.load * 100) + '%' }" /></div>
                <span class="as-v">{{ Math.round(stats.load * 100) }}%<small> peak {{ Math.round(stats.loadPeak * 100) }}%</small></span>
              </div>
              <div class="as-meter">
                <span class="as-k">Output latency</span>
                <span class="as-v">{{ (stats.outputLatency * 1000).toFixed(1) }} ms<small v-if="stats.live"> · built-in sounds +{{ (stats.busLatency * 1000).toFixed(0) }} ms</small></span>
              </div>
              <div class="as-meter">
                <span class="as-k">Underruns</span>
                <span class="as-v" :class="{ bad: underruns > 0 }">{{ underruns }}</span>
                <button class="as-btn as-btn--sm" @click="resetUnderruns">Reset</button>
              </div>
            </div>
          </section>

          <div class="as-foot">
            <button class="as-btn" :class="{ on: tone }" @click="toggleTone">{{ tone ? '■ Stop test tone' : '▶ Test tone' }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { reactive, ref, computed, onMounted, onUnmounted } from 'vue'
import { getAudioConfig, setAudioConfig, openAsioPanel, testTone } from '../desktop/ipc.js'
import { useStudio } from '../store/studio.js'

defineEmits(['close'])
const { engineStats: stats } = useStudio()

const info = reactive({ drivers: [], running: null, error: null })
const form = reactive({ driver: 'shared', device: null, buffer: null, rate: null })
const busy = ref(false)
const tone = ref(false)
const base = reactive({ late: 0, bus: 0 })

const devices = computed(() => info.drivers.find(d => d.id === form.driver)?.devices ?? [])
const bufferOptions = computed(() => {
  if (form.driver === 'shared') return []
  const r = info.running
  if (r?.driver === form.driver && r.bufferSizes?.length) {
    // Long ASIO lists (granularity of a few samples): keep the useful steps.
    const nice = r.bufferSizes.filter(b => b <= 128 || b % 32 === 0 || b === r.buffer)
    return nice.length > 24 ? nice.filter((b, i) => i % 2 === 0 || b === r.buffer) : nice
  }
  return [64, 128, 144, 256, 512, 1024]
})
const underruns = computed(() => Math.max(0, stats.late - base.late) + Math.max(0, stats.busUnderruns - base.bus))

const driverName = id => info.drivers.find(d => d.id === id)?.name ?? id
const ms = (frames, rate = info.running?.rate || 48000) => (frames * 1000 / rate).toFixed(1)

function take(res) {
  if (!res) return
  info.drivers = res.drivers ?? []
  info.running = res.running ?? null
  info.error = res.error ?? null
  Object.assign(form, res.config ?? {})
}

async function apply(change) {
  Object.assign(form, change)
  busy.value = true
  try { take(await setAudioConfig({ ...form })) } finally { busy.value = false }
}

function pickDriver(id) {
  // A device name means nothing to another driver: start from its default.
  const list = info.drivers.find(d => d.id === id)?.devices ?? []
  apply({ driver: id, device: id === 'asio' ? (list[0] ?? null) : null, buffer: null, rate: null })
}

function resetUnderruns() {
  base.late = stats.late
  base.bus = stats.busUnderruns
}

function toggleTone() {
  tone.value = !tone.value
  testTone(tone.value, 440)
}

onMounted(async () => {
  resetUnderruns()
  take(await getAudioConfig())
})
onUnmounted(() => { if (tone.value) testTone(false) })
</script>

<style scoped>
.as-back {
  position: fixed; inset: 0; z-index: 10001; background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.as-win {
  width: min(520px, 94vw); max-height: 86vh; display: flex; flex-direction: column;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); color: var(--text-primary);
  font-family: 'Rajdhani', sans-serif;
}
.as-hdr {
  display: flex; align-items: center; justify-content: space-between; padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 11px; font-weight: 700; letter-spacing: 0.2em; color: var(--text-muted);
}
.as-x { background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; }
.as-x:hover { color: var(--text-primary); }
.as-body { overflow: auto; padding: 10px 16px 14px; display: flex; flex-direction: column; gap: 12px; }
section h4 { font-size: 10px; letter-spacing: 0.2em; color: #f0a030; margin: 0 0 6px; }
.as-row { display: flex; align-items: center; gap: 10px; padding: 3px 0; font-size: 13px; }
.as-k { width: 110px; flex: none; color: var(--text-muted); font-size: 12px; }
.as-row select {
  flex: 1; min-width: 0; background: var(--bg-control); color: var(--text-primary);
  border: 1px solid var(--border-subtle); border-radius: 3px; padding: 3px 6px; font-family: inherit; font-size: 13px;
}
.as-note { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); line-height: 1.35; }
.as-status { font-size: 13px; line-height: 1.5; }
.as-dim { color: var(--text-muted); font-size: 12px; }
.as-err { color: #e74c3c; font-size: 12px; }
.as-meters { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.as-meter { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.as-bar { flex: 1; height: 8px; background: var(--bg-deeper, #111); border: 1px solid var(--border-subtle); border-radius: 2px; overflow: hidden; }
.as-fill { height: 100%; background: #2ecc71; transition: width 0.25s; }
.as-fill.hot { background: #e67e22; }
.as-v { font-family: 'Share Tech Mono', monospace; font-size: 12px; }
.as-v small { color: var(--text-muted); margin-left: 6px; }
.as-v.bad { color: #e74c3c; }
.as-btn {
  padding: 4px 12px; border-radius: 3px; cursor: pointer;
  background: var(--bg-control); color: var(--text-primary); border: 1px solid var(--border-subtle);
  font-family: inherit; font-size: 12px; font-weight: 700; letter-spacing: 0.06em;
}
.as-btn:disabled { opacity: 0.5; cursor: default; }
.as-btn.on { border-color: #e74c3c; color: #e74c3c; }
.as-btn--sm { padding: 1px 8px; font-size: 11px; }
.as-foot { display: flex; justify-content: flex-end; }
</style>
