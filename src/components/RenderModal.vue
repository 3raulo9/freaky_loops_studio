<template>
  <div class="overlay" @click.self="!isRendering && $emit('close')">
    <div class="modal">

      <!-- ── Header ──────────────────────────────────────────────── -->
      <div class="modal-header">
        <span class="modal-hex">⬡</span>
        <span class="modal-title">RENDER / EXPORT</span>
        <button class="modal-close" @click="!isRendering && $emit('close')" :disabled="isRendering">✕</button>
      </div>

      <div class="modal-body">

        <!-- ── Format tabs ─────────────────────────────────────── -->
        <div class="format-tabs">
          <button
            v-for="f in formats"
            :key="f.id"
            class="fmt-tab"
            :class="{ active: format === f.id, unavailable: f.unavailable }"
            @click="!f.unavailable && (format = f.id)"
            :title="f.unavailable ? f.unavailableReason : f.description"
          >
            <span class="fmt-name">{{ f.label }}</span>
            <span class="fmt-desc">{{ f.unavailable ? 'N/A' : f.tag }}</span>
          </button>
        </div>

        <!-- ── OGG real-time notice ───────────────────────────── -->
        <div v-if="format === 'ogg'" class="notice">
          ⚠ OGG encoding plays back audio in real time to capture it — it takes as long as the audio duration.
        </div>

        <!-- ── WAV settings ───────────────────────────────────── -->
        <template v-if="format === 'wav'">
          <section class="sect">
            <div class="sect-label">SAMPLE RATE</div>
            <div class="pill-group">
              <label v-for="sr in wavSampleRates" :key="sr.v" class="pill" :class="{ active: wav.sampleRate === sr.v }">
                <input type="radio" :value="sr.v" v-model.number="wav.sampleRate" />{{ sr.l }}
              </label>
            </div>
          </section>

          <section class="sect">
            <div class="sect-label">BIT DEPTH</div>
            <div class="pill-group">
              <label v-for="bd in wavBitDepths" :key="bd.v" class="pill" :class="{ active: wav.bitDepth === bd.v }">
                <input type="radio" :value="bd.v" v-model.number="wav.bitDepth" />
                <span>{{ bd.l }}</span>
                <span class="pill-sub">{{ bd.sub }}</span>
              </label>
            </div>
          </section>

          <section class="sect">
            <div class="sect-label">PROCESSING</div>
            <label class="check-row">
              <input type="checkbox" v-model="wav.normalize" class="check" />
              Normalize to −0.3 dBFS
            </label>
            <label class="check-row" :class="{ dimmed: wav.bitDepth === 32 }">
              <input type="checkbox" v-model="wav.dither" :disabled="wav.bitDepth === 32" class="check" />
              Apply dither <span class="sub">PCM only</span>
            </label>
          </section>
        </template>

        <!-- ── MP3 settings ───────────────────────────────────── -->
        <template v-if="format === 'mp3'">
          <section class="sect">
            <div class="sect-label">BITRATE</div>
            <div class="pill-group">
              <label
                v-for="br in mp3Bitrates" :key="br.v"
                class="pill" :class="{ active: mp3.bitrate === br.v }"
              >
                <input type="radio" :value="br.v" v-model.number="mp3.bitrate" />
                <span>{{ br.l }}</span>
                <span class="pill-sub">{{ br.sub }}</span>
              </label>
            </div>
          </section>

          <section class="sect">
            <div class="sect-label">CHANNELS</div>
            <div class="pill-group">
              <label class="pill" :class="{ active: mp3.channels === 2 }">
                <input type="radio" :value="2" v-model.number="mp3.channels" />Stereo
              </label>
              <label class="pill" :class="{ active: mp3.channels === 1 }">
                <input type="radio" :value="1" v-model.number="mp3.channels" />Mono
              </label>
            </div>
          </section>

          <section class="sect">
            <div class="sect-label">PROCESSING</div>
            <label class="check-row">
              <input type="checkbox" v-model="mp3.normalize" class="check" />
              Normalize to −0.3 dBFS
            </label>
          </section>
        </template>

        <!-- ── OGG settings ───────────────────────────────────── -->
        <template v-if="format === 'ogg'">
          <section class="sect">
            <div class="sect-label">QUALITY / BITRATE</div>
            <div class="pill-group">
              <label
                v-for="br in oggBitrates" :key="br.v"
                class="pill" :class="{ active: ogg.bitrate === br.v }"
              >
                <input type="radio" :value="br.v" v-model.number="ogg.bitrate" />
                <span>{{ br.l }}</span>
                <span class="pill-sub">{{ br.sub }}</span>
              </label>
            </div>
          </section>

          <section class="sect">
            <div class="sect-label">CHANNELS</div>
            <div class="pill-group">
              <label class="pill" :class="{ active: ogg.channels === 2 }">
                <input type="radio" :value="2" v-model.number="ogg.channels" />Stereo
              </label>
              <label class="pill" :class="{ active: ogg.channels === 1 }">
                <input type="radio" :value="1" v-model.number="ogg.channels" />Mono
              </label>
            </div>
          </section>

          <section class="sect">
            <div class="sect-label">PROCESSING</div>
            <label class="check-row">
              <input type="checkbox" v-model="ogg.normalize" class="check" />
              Normalize to −0.3 dBFS
            </label>
          </section>
        </template>

        <!-- ── Shared: Loop settings ──────────────────────────── -->
        <section class="sect">
          <div class="sect-label">LOOP</div>
          <div class="two-col">
            <div class="setting-row">
              <span class="setting-lbl">Bars</span>
              <div class="pill-group">
                <label v-for="b in [1,2,4,8,16]" :key="b" class="pill sm" :class="{ active: bars === b }">
                  <input type="radio" :value="b" v-model.number="bars" />{{ b }}
                </label>
              </div>
            </div>
            <div class="setting-row">
              <span class="setting-lbl">Tail</span>
              <input type="range" v-model.number="tail" min="0" max="8" step="0.5" class="range-slider" />
              <span class="range-val">{{ tail }}s</span>
            </div>
          </div>
        </section>

        <!-- ── Channels for WAV (here to keep layout consistent) ── -->
        <section v-if="format === 'wav'" class="sect">
          <div class="sect-label">CHANNELS</div>
          <div class="pill-group">
            <label class="pill" :class="{ active: wav.channels === 2 }">
              <input type="radio" :value="2" v-model.number="wav.channels" />Stereo
            </label>
            <label class="pill" :class="{ active: wav.channels === 1 }">
              <input type="radio" :value="1" v-model.number="wav.channels" />Mono
            </label>
          </div>
        </section>

        <!-- ── Filename ───────────────────────────────────────── -->
        <section class="sect">
          <div class="sect-label">FILENAME</div>
          <div class="filename-row">
            <input v-model="filename" class="filename-input" maxlength="80" spellcheck="false" />
            <span class="filename-ext">.{{ currentExt }}</span>
          </div>
        </section>

      </div><!-- /modal-body -->

      <!-- ── Progress bar ───────────────────────────────────────── -->
      <div class="progress-wrap" :class="{ visible: isRendering }">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: progress + '%' }" />
        </div>
        <span class="progress-label">{{ progressLabel }}</span>
      </div>

      <!-- ── Error ──────────────────────────────────────────────── -->
      <div v-if="errorMsg" class="error-msg">⚠ {{ errorMsg }}</div>

      <!-- ── Footer ─────────────────────────────────────────────── -->
      <div class="modal-footer">
        <div class="render-meta">
          <span class="meta-item">⏱ {{ durationLabel }}</span>
          <span class="meta-item">💾 ~{{ sizeLabel }}</span>
          <span class="meta-item meta-fmt">{{ metaQuality }}</span>
        </div>
        <div class="footer-btns">
          <button class="btn-cancel" @click="$emit('close')" :disabled="isRendering">CANCEL</button>
          <button class="btn-render" @click="startRender" :disabled="isRendering">
            <span v-if="isRendering"><span class="spin">◐</span> {{ renderVerb }}…</span>
            <span v-else>▶ RENDER &amp; EXPORT</span>
          </button>
        </div>
      </div>

    </div><!-- /modal -->
  </div><!-- /overlay -->
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useStudio } from '../store/studio.js'
import {
  renderLoopToWav,
  renderLoopToMp3,
  renderLoopToOgg,
  getOggMimeType,
} from '../audio/export.js'

defineEmits(['close'])

const { channels, bpm, totalSteps, swing } = useStudio()

// ── Format definitions ────────────────────────────────────────────────────────
const oggMime = typeof window !== 'undefined' ? getOggMimeType() : null

const formats = [
  {
    id: 'wav',
    label: 'WAV',
    tag: 'Lossless',
    description: 'Uncompressed PCM — best for DAW import',
  },
  {
    id: 'mp3',
    label: 'MP3',
    tag: 'Lossy',
    description: 'MPEG Layer III — universal compatibility',
  },
  {
    id: 'ogg',
    label: oggMime?.startsWith('audio/ogg') ? 'OGG' : 'WEBM',
    tag: oggMime?.includes('opus') ? 'Opus' : 'Vorbis',
    description: 'Open lossy format — great for web',
    unavailable: !oggMime,
    unavailableReason: 'OGG encoding is not supported in this browser.',
  },
  {
    id: 'flac',
    label: 'FLAC',
    tag: 'Lossless',
    description: 'Lossless compressed — coming soon',
    unavailable: true,
    unavailableReason: 'FLAC export coming soon.',
  },
]

const format = ref('wav')

// ── Per-format settings ───────────────────────────────────────────────────────
const wav = ref({ sampleRate: 44100, bitDepth: 24, channels: 2, normalize: true, dither: true })
const mp3 = ref({ bitrate: 192, channels: 2, normalize: true })
const ogg = ref({ bitrate: 192, channels: 2, normalize: true })

const wavSampleRates = [
  { v: 44100, l: '44.1 kHz' },
  { v: 48000, l: '48 kHz'   },
  { v: 96000, l: '96 kHz'   },
]
const wavBitDepths = [
  { v: 16, l: '16-bit', sub: 'PCM'   },
  { v: 24, l: '24-bit', sub: 'PCM'   },
  { v: 32, l: '32-bit', sub: 'Float' },
]
const mp3Bitrates = [
  { v: 128, l: '128 kbps', sub: 'Good'       },
  { v: 192, l: '192 kbps', sub: 'High'       },
  { v: 256, l: '256 kbps', sub: 'Very High'  },
  { v: 320, l: '320 kbps', sub: 'Maximum'    },
]
const oggBitrates = [
  { v:  96, l:  '96 kbps', sub: 'Good'   },
  { v: 128, l: '128 kbps', sub: 'High'   },
  { v: 192, l: '192 kbps', sub: 'V. High'},
  { v: 256, l: '256 kbps', sub: 'Max'    },
]

// ── Shared loop settings ──────────────────────────────────────────────────────
const bars = ref(2)
const tail = ref(3.5)

// ── Filename ──────────────────────────────────────────────────────────────────
const currentExt = computed(() => {
  if (format.value === 'wav') return 'wav'
  if (format.value === 'mp3') return 'mp3'
  return oggMime?.startsWith('audio/ogg') ? 'ogg' : 'webm'
})
const filename = ref('')
watch([bpm, bars, format], () => {
  filename.value = `freaky-loop-${bpm.value}bpm-${bars.value}bar`
}, { immediate: true })

// ── Metadata ──────────────────────────────────────────────────────────────────
const duration = computed(() => {
  const secPerStep = (60 / bpm.value) / 4
  return bars.value * totalSteps.value * secPerStep + tail.value
})
const durationLabel = computed(() => {
  const s = duration.value
  return s < 60 ? s.toFixed(1) + 's' : (s / 60).toFixed(2) + 'm'
})

const sizeLabel = computed(() => {
  let bytes
  if (format.value === 'wav') {
    bytes = duration.value * wav.value.channels * wav.value.sampleRate * (wav.value.bitDepth / 8)
  } else if (format.value === 'mp3') {
    bytes = (mp3.value.bitrate * 1000 / 8) * duration.value
  } else {
    bytes = (ogg.value.bitrate * 1000 / 8) * duration.value
  }
  return bytes < 1024 * 1024
    ? Math.round(bytes / 1024) + ' KB'
    : (bytes / 1024 / 1024).toFixed(1) + ' MB'
})

const metaQuality = computed(() => {
  if (format.value === 'wav')  return `${wav.value.sampleRate/1000}kHz · ${wav.value.bitDepth}-bit · ${wav.value.channels===2?'Stereo':'Mono'}`
  if (format.value === 'mp3')  return `${mp3.value.bitrate} kbps · ${mp3.value.channels===2?'Stereo':'Mono'}`
  return `${ogg.value.bitrate} kbps · ${ogg.value.channels===2?'Stereo':'Mono'}`
})

const renderVerb = computed(() => format.value === 'ogg' ? 'ENCODING (real-time)' : 'RENDERING')

// ── Render ────────────────────────────────────────────────────────────────────
const isRendering   = ref(false)
const progress      = ref(0)
const progressLabel = ref('')
const errorMsg      = ref('')

async function startRender() {
  if (isRendering.value) return
  isRendering.value = true
  progress.value    = 0
  errorMsg.value    = ''

  // For OGG: fake progress doesn't work (it's real-time), show pulsing instead
  const isOgg = format.value === 'ogg'
  let timer

  if (!isOgg) {
    progressLabel.value = 'Rendering offline…'
    timer = setInterval(() => {
      if (progress.value < 88) progress.value += (90 - progress.value) * 0.06
    }, 80)
  } else {
    progressLabel.value = 'Encoding in real time (plays back audio)…'
    // Fake a time-based progress for OGG
    const est = duration.value * 1000
    const start = Date.now()
    timer = setInterval(() => {
      progress.value = Math.min(95, ((Date.now() - start) / est) * 100)
    }, 100)
  }

  try {
    const shared = {
      bpm:        bpm.value,
      totalSteps: totalSteps.value,
      swing:      swing.value,
      bars:       bars.value,
      tail:       tail.value,
    }

    let result
    if (format.value === 'wav') {
      progressLabel.value = `Rendering WAV — ${wav.value.sampleRate/1000}kHz · ${wav.value.bitDepth}-bit…`
      result = await renderLoopToWav(channels, {
        ...shared,
        sampleRate: wav.value.sampleRate,
        bitDepth:   wav.value.bitDepth,
        channels:   wav.value.channels,
        normalize:  wav.value.normalize,
        dither:     wav.value.dither,
      })
    } else if (format.value === 'mp3') {
      progressLabel.value = `Rendering audio, then encoding MP3 at ${mp3.value.bitrate} kbps…`
      result = await renderLoopToMp3(channels, {
        ...shared,
        bitrate:   mp3.value.bitrate,
        channels:  mp3.value.channels,
        normalize: mp3.value.normalize,
        sampleRate: 44100, // lamejs works best at 44100
      })
    } else if (format.value === 'ogg') {
      progressLabel.value = `Encoding OGG/Opus at ${ogg.value.bitrate} kbps — playing back in real time…`
      result = await renderLoopToOgg(channels, {
        ...shared,
        bitrate:   ogg.value.bitrate,
        channels:  ogg.value.channels,
        normalize: ogg.value.normalize,
        sampleRate: 48000, // Opus prefers 48kHz
      })
    }

    clearInterval(timer)
    progress.value      = 100
    progressLabel.value = 'Done! Saving…'

    const url = URL.createObjectURL(result.blob)
    const a   = document.createElement('a')
    a.href     = url
    a.download = (filename.value.trim() || 'freaky-loop') + '.' + result.ext
    a.click()
    URL.revokeObjectURL(url)

    await new Promise(r => setTimeout(r, 700))
  } catch (err) {
    clearInterval(timer)
    errorMsg.value = err.message || 'Unknown render error.'
    progressLabel.value = 'Render failed.'
    console.error(err)
    await new Promise(r => setTimeout(r, 100))
  } finally {
    isRendering.value = false
    progress.value    = 0
  }
}
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0,0,0,0.72);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(3px);
}
.modal {
  width: 540px; max-width: 96vw; max-height: 90vh;
  background: #12121e; border: 1px solid #252538; border-radius: 10px;
  box-shadow: 0 24px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04);
  display: flex; flex-direction: column; overflow: hidden;
}

/* ── Header ──────────────────────────────────────────────────────── */
.modal-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px 12px;
  background: #0c0c14; border-bottom: 1px solid #1c1c2c; flex-shrink: 0;
}
.modal-hex   { font-size: 20px; color: #e74c3c; filter: drop-shadow(0 0 5px #e74c3c66); }
.modal-title { font-family:'Rajdhani',sans-serif; font-size:16px; font-weight:700; letter-spacing:.18em; color:#d0d0e8; }
.modal-close { margin-left:auto; background:transparent; border:none; color:#40405a; font-size:15px; cursor:pointer; padding:4px 7px; border-radius:4px; transition:color .1s; }
.modal-close:hover:not(:disabled) { color:#e74c3c; }
.modal-close:disabled { opacity:.3; cursor:default; }

/* ── Format tabs ─────────────────────────────────────────────────── */
.format-tabs {
  display: flex; gap: 0;
  border-bottom: 1px solid #1a1a28;
  flex-shrink: 0;
}
.fmt-tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 10px 6px; gap: 2px;
  border: none; border-right: 1px solid #1a1a28; border-bottom: 3px solid transparent;
  background: #0e0e1a; cursor: pointer; transition: all 0.12s;
}
.fmt-tab:last-child { border-right: none; }
.fmt-tab:hover:not(.unavailable) { background: #141428; }
.fmt-tab.active {
  background: #141428; border-bottom-color: #e74c3c;
}
.fmt-tab.unavailable { opacity: 0.35; cursor: not-allowed; }
.fmt-name {
  font-family:'Rajdhani',sans-serif; font-size:14px; font-weight:700;
  letter-spacing:.1em; color:#9090b0;
}
.fmt-tab.active .fmt-name { color:#e0e0f0; }
.fmt-tab.unavailable .fmt-name { color:#404058; }
.fmt-desc {
  font-family:'Share Tech Mono',monospace; font-size:9px; color:#35354a;
}
.fmt-tab.active .fmt-desc { color:#e74c3c; }

/* ── Notice ──────────────────────────────────────────────────────── */
.notice {
  margin: 10px 18px 0;
  padding: 8px 12px; border-radius: 5px;
  background: #1a1408; border: 1px solid #3a2808;
  font-family:'Share Tech Mono',monospace; font-size:10px; color:#a07030; line-height:1.5;
}

/* ── Body ────────────────────────────────────────────────────────── */
.modal-body { flex:1; overflow-y:auto; padding:0 18px; }

.sect { padding:12px 0 4px; border-bottom:1px solid #14141e; }
.sect:last-child { border-bottom:none; }
.sect-label {
  font-family:'Rajdhani',sans-serif; font-size:9px; font-weight:700;
  letter-spacing:.22em; color:#35355a; text-transform:uppercase; margin-bottom:8px;
}

/* ── Pills ───────────────────────────────────────────────────────── */
.pill-group { display:flex; gap:5px; flex-wrap:wrap; }
.pill {
  display:flex; align-items:center; gap:4px; padding:5px 11px;
  border:1px solid #252535; border-radius:5px;
  font-family:'Rajdhani',sans-serif; font-size:12px; font-weight:600;
  letter-spacing:.06em; color:#50506a; cursor:pointer; transition:all .12s; user-select:none;
}
.pill.sm { padding:4px 9px; }
.pill input[type="radio"] { display:none; }
.pill:hover { border-color:#4a4a6a; color:#9090b8; }
.pill.active { border-color:#e74c3c; color:#e74c3c; background:#1a0a0a; }
.pill-sub { font-size:9px; color:#404058; margin-left:2px; }
.pill.active .pill-sub { color:#a03020; }

/* ── Setting rows ────────────────────────────────────────────────── */
.two-col { display:flex; flex-direction:column; gap:8px; }
.setting-row { display:flex; align-items:center; gap:10px; }
.setting-lbl {
  font-family:'Rajdhani',sans-serif; font-size:11px; font-weight:600;
  letter-spacing:.1em; color:#50506a; width:40px; flex-shrink:0;
}

/* ── Range ───────────────────────────────────────────────────────── */
.range-slider { flex:1; accent-color:#e74c3c; height:3px; cursor:pointer; }
.range-val { font-family:'Share Tech Mono',monospace; font-size:12px; color:#e74c3c; min-width:30px; text-align:right; }

/* ── Checkboxes ──────────────────────────────────────────────────── */
.check-row {
  display:flex; align-items:center; gap:9px; padding:5px 0; cursor:pointer;
  font-family:'Rajdhani',sans-serif; font-size:13px; font-weight:600;
  letter-spacing:.05em; color:#9090b0; user-select:none; transition:color .1s;
}
.check-row:hover:not(.dimmed) { color:#c0c0d8; }
.check-row.dimmed { opacity:.35; cursor:not-allowed; }
.check { accent-color:#e74c3c; width:14px; height:14px; cursor:inherit; }
.sub { font-size:10px; color:#40405a; margin-left:3px; }

/* ── Filename ────────────────────────────────────────────────────── */
.filename-row { display:flex; align-items:center; }
.filename-input {
  flex:1; background:#0e0e1c; border:1px solid #2a2a3c; border-right:none;
  color:#c0c0e0; padding:7px 10px; border-radius:5px 0 0 5px;
  font-family:'Share Tech Mono',monospace; font-size:12px; outline:none; transition:border-color .1s;
}
.filename-input:focus { border-color:#e74c3c; }
.filename-ext {
  background:#181828; border:1px solid #2a2a3c; border-left:none;
  color:#404060; padding:7px 10px; border-radius:0 5px 5px 0;
  font-family:'Share Tech Mono',monospace; font-size:12px;
}

/* ── Progress ────────────────────────────────────────────────────── */
.progress-wrap { padding:0 18px; max-height:0; overflow:hidden; transition:max-height .2s; }
.progress-wrap.visible { max-height:52px; padding:10px 18px; }
.progress-track { height:4px; background:#1a1a2c; border-radius:2px; overflow:hidden; }
.progress-fill {
  height:100%; background:linear-gradient(90deg,#e74c3c,#f39c12);
  border-radius:2px; transition:width .15s ease-out; box-shadow:0 0 8px #e74c3c66;
}
.progress-label { display:block; margin-top:5px; font-family:'Share Tech Mono',monospace; font-size:10px; color:#404060; }

/* ── Error ───────────────────────────────────────────────────────── */
.error-msg {
  margin:8px 18px; padding:8px 12px; border-radius:5px;
  background:#1a0808; border:1px solid #5a1010;
  font-family:'Share Tech Mono',monospace; font-size:11px; color:#e07070;
}

/* ── Footer ──────────────────────────────────────────────────────── */
.modal-footer {
  display:flex; align-items:center; gap:12px;
  padding:12px 18px 14px;
  background:#0c0c14; border-top:1px solid #1a1a28;
  flex-shrink:0; flex-wrap:wrap;
}
.render-meta { display:flex; gap:12px; flex-wrap:wrap; }
.meta-item { font-family:'Share Tech Mono',monospace; font-size:10px; color:#30304a; }
.meta-fmt  { color:#404060; }
.footer-btns { margin-left:auto; display:flex; gap:8px; }
.btn-cancel {
  font-family:'Rajdhani',sans-serif; font-size:13px; font-weight:700; letter-spacing:.1em;
  padding:8px 18px; border:1px solid #252535; border-radius:6px;
  background:transparent; color:#50506a; cursor:pointer; transition:all .1s;
}
.btn-cancel:hover:not(:disabled) { border-color:#4a4a6a; color:#9090b0; }
.btn-cancel:disabled { opacity:.3; cursor:default; }
.btn-render {
  font-family:'Rajdhani',sans-serif; font-size:14px; font-weight:700; letter-spacing:.1em;
  padding:8px 22px; border:1px solid #e74c3c; border-radius:6px;
  background:#1a0808; color:#e74c3c; cursor:pointer; transition:all .12s; min-width:170px;
}
.btn-render:hover:not(:disabled) { background:#e74c3c; color:#fff; box-shadow:0 0 16px #e74c3c55; }
.btn-render:disabled { opacity:.5; cursor:default; }
.spin { display:inline-block; animation:spin .6s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
</style>
