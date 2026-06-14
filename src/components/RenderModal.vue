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

        <!-- ── Worklet-plugin notice ──────────────────────────── -->
        <div v-if="workletChannels.length" class="notice">
          ⚙ {{ workletChannels.length }} plugin channel{{ workletChannels.length > 1 ? 's' : '' }}
          ({{ workletChannels.map(c => c.name).join(', ') }}) —
          when used, only that part is captured in real time and mixed with the rest, which renders instantly.
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

        <!-- ── Render mode ─────────────────────────────────────── -->
        <section class="sect">
          <div class="sect-label">RENDER MODE</div>
          <div class="pill-group">
            <label class="pill" :class="{ active: renderMode === 'song' }">
              <input type="radio" value="song" v-model="renderMode" />Song (Playlist)
            </label>
            <label class="pill" :class="{ active: renderMode === 'pattern' }">
              <input type="radio" value="pattern" v-model="renderMode" />Pattern
            </label>
          </div>
          <!-- Pattern picker (only in pattern mode) -->
          <div v-if="renderMode === 'pattern'" class="pattern-pick-row">
            <span class="setting-lbl">Pattern</span>
            <div class="pattern-pill-list">
              <label
                v-for="pat in patterns"
                :key="pat.id"
                class="pill sm pat-pill"
                :class="{ active: renderPatternId === pat.id }"
                :style="renderPatternId === pat.id ? { borderColor: pat.color, color: pat.color } : {}"
              >
                <input type="radio" :value="pat.id" v-model="renderPatternId" />
                <span class="pat-dot" :style="{ background: pat.color }" />
                {{ pat.name }}
              </label>
            </div>
          </div>
          <!-- Song info (only in song mode) -->
          <div v-if="renderMode === 'song'" class="song-info">
            <span v-if="songTotalCells > 0">{{ songTotalCells }} bar{{ songTotalCells !== 1 ? 's' : '' }} · {{ activeSongClips }} clip{{ activeSongClips !== 1 ? 's' : '' }}</span>
            <span v-else class="warn-empty">No clips in playlist — add clips first or use Pattern mode.</span>
          </div>
        </section>

        <!-- ── Shared: Loop / Tail settings ───────────────────── -->
        <section class="sect">
          <div class="sect-label">{{ renderMode === 'song' ? 'TAIL' : 'LOOP' }}</div>
          <div class="two-col">
            <div v-if="renderMode === 'pattern'" class="setting-row">
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
          <button class="btn-render" @click="startRender" :disabled="isRendering || (renderMode === 'song' && songTotalCells === 0)">
            <span v-if="isRendering"><span class="spin">◐</span> {{ renderVerb }}…</span>
            <span v-else>▶ RENDER &amp; EXPORT</span>
          </button>
        </div>
      </div>

    </div><!-- /modal -->
  </div><!-- /overlay -->
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useStudio } from '../store/studio.js'
import {
  renderLoopToWav,
  renderLoopToMp3,
  renderLoopToOgg,
  getOggMimeType,
  isOfflineRenderable,
  mixBuffers,
} from '../audio/export.js'

defineEmits(['close'])

const {
  channels, bpm, totalSteps,
  getPatData, currentPatternId,
  patterns, playlistClips, playlistTracks,
  renderProjectToBuffer, renderRealtimeToBuffer,
} = useStudio()

// Channels whose DSP runs in a live AudioWorklet (Custom Synth / SUBTERRA / WASM).
// These can't run inside an OfflineAudioContext, so when one actually plays in the
// render we capture the live engine in real time instead (slower, but complete).
const workletChannels = computed(() => channels.filter(c => !isOfflineRenderable(c)))

// ── Render mode ───────────────────────────────────────────────────────────────
const renderMode      = ref('song')           // 'song' | 'pattern'
const renderPatternId = ref(currentPatternId.value)
watch(currentPatternId, id => { if (renderMode.value === 'pattern') renderPatternId.value = id })

// Song metrics (muted tracks ignored, same as live playback)
const mutedTrackIds = computed(() => new Set(playlistTracks.filter(t => t.muted).map(t => t.id)))
const activeSongClips = computed(() =>
  playlistClips.filter(c => !c.muted && !mutedTrackIds.value.has(c.trackId)).length
)
const songTotalCells = computed(() => {
  const clips = playlistClips.filter(c => !c.muted && !mutedTrackIds.value.has(c.trackId))
  if (!clips.length) return 0
  return Math.max(...clips.map(c => c.cell + (c.width || 1)))
})

// Whether any live-worklet plugin channel (Custom Synth / SUBTERRA / WASM) has
// notes in this render — if so the realtime capture path runs and is mixed in.
function workletHasContent() {
  const wk = workletChannels.value.filter(c => !c.muted)
  if (!wk.length) return false
  if (renderMode.value === 'pattern') {
    return wk.some(c => (getPatData(c.id, renderPatternId.value).pianoNotes || []).length > 0)
  }
  const muted = mutedTrackIds.value
  return playlistClips.some(clip => {
    if (clip.muted || clip.type === 'audio' || muted.has(clip.trackId)) return false
    return wk.some(c => (getPatData(c.id, clip.patternId).pianoNotes || []).length > 0)
  })
}

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
watch([bpm, bars, format, renderMode, songTotalCells], () => {
  if (renderMode.value === 'song') {
    filename.value = `freaky-song-${bpm.value}bpm-${songTotalCells.value}bar`
  } else {
    filename.value = `freaky-loop-${bpm.value}bpm-${bars.value}bar`
  }
}, { immediate: true })

// ── Metadata ──────────────────────────────────────────────────────────────────
const duration = computed(() => {
  const secPerStep = (60 / bpm.value) / 4
  if (renderMode.value === 'song') {
    return songTotalCells.value * totalSteps.value * secPerStep + tail.value
  }
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
  let timer

  try {
    const renderOpts = {
      mode:      renderMode.value,        // 'song' | 'pattern'
      patternId: renderPatternId.value,
      bars:      bars.value,
      tail:      tail.value,
    }
    const sampleRate = format.value === 'wav' ? wav.value.sampleRate
                     : format.value === 'mp3' ? 44100 : 48000
    const normalize  = format.value === 'wav' ? wav.value.normalize
                     : format.value === 'mp3' ? mp3.value.normalize
                     : ogg.value.normalize

    // The whole project renders offline through a faithful rebuild of the live
    // signal chain (mixer EQ/FX/sends + master limiter + playlist audio clips), so
    // the export sounds like playback. Live AudioWorklet plugins (Custom Synth /
    // SUBTERRA / WASM) can't run offline, so when one actually plays it is captured
    // in real time and mixed into the offline render.
    let buffer
    if (workletHasContent()) {
      progressLabel.value = 'Capturing plugins in real time…'
      const rtBuf = await renderRealtimeToBuffer({
        ...renderOpts, normalize: false,
        onProgress: p => { progress.value = Math.min(90, p * 88) },
      })
      progressLabel.value = 'Rendering the rest offline & mixing…'
      const offBuf = await renderProjectToBuffer({ ...renderOpts, sampleRate: rtBuf.sampleRate, normalize: false })
      buffer = mixBuffers([offBuf, rtBuf], { normalize })
      progressLabel.value = 'Encoding…'
    } else if (format.value === 'ogg') {
      progressLabel.value = 'Rendering offline…'
      buffer = await renderProjectToBuffer({ ...renderOpts, sampleRate, normalize })
      progressLabel.value = 'Encoding in real time (plays back audio)…'
      const est = duration.value * 1000
      const start = Date.now()
      timer = setInterval(() => { progress.value = Math.min(95, ((Date.now() - start) / est) * 100) }, 100)
    } else {
      progressLabel.value = 'Rendering offline…'
      timer = setInterval(() => { if (progress.value < 88) progress.value += (90 - progress.value) * 0.06 }, 80)
      buffer = await renderProjectToBuffer({ ...renderOpts, sampleRate, normalize })
    }

    let result
    if (format.value === 'wav') {
      result = await renderLoopToWav([], {
        buffer,
        bitDepth: wav.value.bitDepth,
        channels: wav.value.channels,
        dither:   wav.value.dither,
      })
    } else if (format.value === 'mp3') {
      result = await renderLoopToMp3([], {
        buffer,
        bitrate:  mp3.value.bitrate,
        channels: mp3.value.channels,
      })
    } else if (format.value === 'ogg') {
      result = await renderLoopToOgg([], {
        buffer,
        bitrate:  ogg.value.bitrate,
        channels: ogg.value.channels,
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
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 24px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04);
  display: flex; flex-direction: column; overflow: hidden;
}

/* ── Header ──────────────────────────────────────────────────────── */
.modal-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px 12px;
  background: var(--bg-header); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
}
.modal-hex   { font-size: 20px; color: #e74c3c; filter: drop-shadow(0 0 5px #e74c3c66); }
.modal-title { font-family:'Rajdhani',sans-serif; font-size:16px; font-weight:700; letter-spacing:.18em; color:var(--text-primary); }
.modal-close { margin-left:auto; background:transparent; border:none; color:var(--text-muted); font-size:15px; cursor:pointer; padding:4px 7px; border-radius:4px; transition:color .1s; }
.modal-close:hover:not(:disabled) { color:#e74c3c; }
.modal-close:disabled { opacity:.3; cursor:default; }

/* ── Format tabs ─────────────────────────────────────────────────── */
.format-tabs {
  display: flex; gap: 0;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.fmt-tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 10px 6px; gap: 2px;
  border: none; border-right: 1px solid var(--border-subtle); border-bottom: 3px solid transparent;
  background: var(--bg-control); cursor: pointer; transition: all 0.12s;
}
.fmt-tab:last-child { border-right: none; }
.fmt-tab:hover:not(.unavailable) { background: var(--bg-hover); }
.fmt-tab.active {
  background: var(--bg-hover); border-bottom-color: #e74c3c;
}
.fmt-tab.unavailable { opacity: 0.35; cursor: not-allowed; }
.fmt-name {
  font-family:'Rajdhani',sans-serif; font-size:14px; font-weight:700;
  letter-spacing:.1em; color:var(--text-muted);
}
.fmt-tab.active .fmt-name { color:var(--text-primary); }
.fmt-tab.unavailable .fmt-name { color:var(--text-muted); }
.fmt-desc {
  font-family:'Share Tech Mono',monospace; font-size:9px; color:var(--text-muted);
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

.sect { padding:12px 0 4px; border-bottom:1px solid var(--border-subtle); }
.sect:last-child { border-bottom:none; }
.sect-label {
  font-family:'Rajdhani',sans-serif; font-size:9px; font-weight:700;
  letter-spacing:.22em; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px;
}

/* ── Pills ───────────────────────────────────────────────────────── */
.pill-group { display:flex; gap:5px; flex-wrap:wrap; }
.pill {
  display:flex; align-items:center; gap:4px; padding:5px 11px;
  border:1px solid var(--border); border-radius:5px;
  font-family:'Rajdhani',sans-serif; font-size:12px; font-weight:600;
  letter-spacing:.06em; color:var(--text-muted); cursor:pointer; transition:all .12s; user-select:none;
}
.pill.sm { padding:4px 9px; }
.pill input[type="radio"] { display:none; }
.pill:hover { border-color:#4a4a6a; color:#9090b8; }
.pill.active { border-color:#e74c3c; color:#e74c3c; background:#1a0a0a; }
.pill-sub { font-size:9px; color:#404058; margin-left:2px; }
.pill.active .pill-sub { color:#a03020; }

/* ── Render mode extras ──────────────────────────────────────────── */
.pattern-pick-row {
  margin-top: 10px;
  display: flex; align-items: flex-start; gap: 10px;
}
.pattern-pick-row .setting-lbl { padding-top: 5px; }
.pattern-pill-list { display: flex; flex-wrap: wrap; gap: 5px; }
.pat-pill { gap: 5px; }
.pat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.song-info {
  margin-top: 8px;
  font-family:'Share Tech Mono',monospace; font-size:10px; color:var(--text-muted);
}
.warn-empty { color:#b05020; }

/* ── Setting rows ────────────────────────────────────────────────── */
.two-col { display:flex; flex-direction:column; gap:8px; }
.setting-row { display:flex; align-items:center; gap:10px; }
.setting-lbl {
  font-family:'Rajdhani',sans-serif; font-size:11px; font-weight:600;
  letter-spacing:.1em; color:var(--text-muted); width:40px; flex-shrink:0;
}

/* ── Range ───────────────────────────────────────────────────────── */
.range-slider { flex:1; accent-color:#e74c3c; height:3px; cursor:pointer; }
.range-val { font-family:'Share Tech Mono',monospace; font-size:12px; color:#e74c3c; min-width:30px; text-align:right; }

/* ── Checkboxes ──────────────────────────────────────────────────── */
.check-row {
  display:flex; align-items:center; gap:9px; padding:5px 0; cursor:pointer;
  font-family:'Rajdhani',sans-serif; font-size:13px; font-weight:600;
  letter-spacing:.05em; color:var(--text-muted); user-select:none; transition:color .1s;
}
.check-row:hover:not(.dimmed) { color:var(--text-primary); }
.check-row.dimmed { opacity:.35; cursor:not-allowed; }
.check { accent-color:#e74c3c; width:14px; height:14px; cursor:inherit; }
.sub { font-size:10px; color:var(--text-muted); margin-left:3px; }

/* ── Filename ────────────────────────────────────────────────────── */
.filename-row { display:flex; align-items:center; }
.filename-input {
  flex:1; background:var(--bg-control); border:1px solid var(--border); border-right:none;
  color:var(--text-primary); padding:7px 10px; border-radius:5px 0 0 5px;
  font-family:'Share Tech Mono',monospace; font-size:12px; outline:none; transition:border-color .1s;
}
.filename-input:focus { border-color:#e74c3c; }
.filename-ext {
  background:var(--bg-panel); border:1px solid var(--border); border-left:none;
  color:var(--text-muted); padding:7px 10px; border-radius:0 5px 5px 0;
  font-family:'Share Tech Mono',monospace; font-size:12px;
}

/* ── Progress ────────────────────────────────────────────────────── */
.progress-wrap { padding:0 18px; max-height:0; overflow:hidden; transition:max-height .2s; }
.progress-wrap.visible { max-height:52px; padding:10px 18px; }
.progress-track { height:4px; background:var(--border-subtle); border-radius:2px; overflow:hidden; }
.progress-fill {
  height:100%; background:linear-gradient(90deg,#e74c3c,#f39c12);
  border-radius:2px; transition:width .15s ease-out; box-shadow:0 0 8px #e74c3c66;
}
.progress-label { display:block; margin-top:5px; font-family:'Share Tech Mono',monospace; font-size:10px; color:var(--text-muted); }

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
  background:var(--bg-header); border-top:1px solid var(--border-subtle);
  flex-shrink:0; flex-wrap:wrap;
}
.render-meta { display:flex; gap:12px; flex-wrap:wrap; }
.meta-item { font-family:'Share Tech Mono',monospace; font-size:10px; color:var(--text-muted); }
.meta-fmt  { color:var(--text-muted); }
.footer-btns { margin-left:auto; display:flex; gap:8px; }
.btn-cancel {
  font-family:'Rajdhani',sans-serif; font-size:13px; font-weight:700; letter-spacing:.1em;
  padding:8px 18px; border:1px solid var(--border); border-radius:6px;
  background:transparent; color:var(--text-muted); cursor:pointer; transition:all .1s;
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
