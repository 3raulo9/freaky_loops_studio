import { Mp3Encoder } from '@breezystack/lamejs'
import { preloadGMInstrument } from './gmSynth.js'

// Mirror of the store's TICKS_PER_STEP (1/16 note). Kept local to avoid importing
// the whole store module graph into the render path.
const TICKS_PER_STEP = 120

// Instrument types whose DSP runs in a live AudioWorklet node — these can't be
// reproduced inside an OfflineAudioContext, so the offline renderer skips them.
const WORKLET_TYPES = new Set(['wasm', 'custom', 'subterra'])
export function isOfflineRenderable(ch) { return !WORKLET_TYPES.has(ch?.type) }

// ─── Shared helpers ────────────────────────────────────────────────────────────

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

function normalizeAudioBuffer(buffer, targetPeak = 0.97) {
  let peak = 0
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a }
  }
  if (peak <= 0 || peak >= targetPeak) return
  const gain = targetPeak / peak
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) data[i] *= gain
  }
}

// Sum several AudioBuffers (same sample rate) into one stereo buffer the length of
// the longest, optionally normalizing the result. Used to combine the offline mix
// with the real-time-captured plugin tracks.
export function mixBuffers(buffers, { normalize = true } = {}) {
  const valid = buffers.filter(b => b && b.length)
  if (!valid.length) return null
  const sr  = valid[0].sampleRate
  const len = Math.max(...valid.map(b => b.length))
  const out = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr })
  const L = out.getChannelData(0)
  const R = out.getChannelData(1)
  for (const b of valid) {
    const bl = b.getChannelData(0)
    const br = b.numberOfChannels > 1 ? b.getChannelData(1) : bl
    for (let i = 0; i < b.length; i++) { L[i] += bl[i]; R[i] += br[i] }
  }
  if (normalize) {
    let peak = 0
    for (let i = 0; i < len; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > peak) peak = a; if (b > peak) peak = b }
    if (peak > 0 && peak < 0.97) {
      const g = 0.97 / peak
      for (let i = 0; i < len; i++) { L[i] *= g; R[i] *= g }
    }
  }
  return out
}

// ─── Core: render tracks to an AudioBuffer ─────────────────────────────────────
// Mirrors the live scheduler: piano channels fire each note at its tick position
// for its full duration (gate), step channels fire on lit steps. The timeline is
// `bars` repetitions of `totalSteps` steps — song renders pass bars=1 with a flat
// totalSteps spanning the whole arrangement; pattern renders repeat the loop.
export async function renderAudioBuffer(tracks, options = {}) {
  const {
    bpm         = 120,
    totalSteps  = 16,
    swing       = 0,
    bars        = 2,
    sampleRate  = 44100,
    normalize   = true,
    tail        = 3.5,
    masterPitch = 0,
  } = options

  const secPerBeat   = 60 / bpm
  const secPerStep   = secPerBeat / 4
  const secPerTick   = secPerStep / TICKS_PER_STEP
  const loopDuration = totalSteps * secPerStep * bars
  const totalFrames  = Math.ceil(sampleRate * (loopDuration + tail))
  const patternTicks = totalSteps * TICKS_PER_STEP
  const START        = 0.01

  const offCtx = new OfflineAudioContext(2, totalFrames, sampleRate)

  // Decode GM soundfont samples into THIS offline context before scheduling, so
  // sampled GM voices are ready to play synchronously during the render.
  const gmProgs = [...new Set(
    tracks.filter(t => !t.muted && isOfflineRenderable(t) && t.params?.gmProgram != null)
          .map(t => Math.max(0, Math.min(127, t.params.gmProgram)))
  )]
  if (gmProgs.length) {
    try { await Promise.all(gmProgs.map(p => preloadGMInstrument(offCtx, p))) } catch (_) {}
  }

  tracks.forEach(track => {
    if (track.muted || !isOfflineRenderable(track) || typeof track.fn !== 'function') return

    const swingMix = track.swingMix ?? 1
    const out = offCtx.createGain();      out.gain.value = track.volume ?? 1
    const pan = offCtx.createStereoPanner(); pan.pan.value = track.pan ?? 0
    out.connect(pan); pan.connect(offCtx.destination)

    for (let rep = 0; rep < bars; rep++) {
      const repSec = rep * patternTicks * secPerTick

      if (track.mode === 'piano') {
        for (const n of (track.pianoNotes || [])) {
          if (n.muted) continue
          const startTick = n.startTick ?? 0
          const step      = Math.floor(startTick / TICKS_PER_STEP)
          const swingOff  = (step % 2 === 1) ? swing * swingMix * (secPerStep / 3) : 0
          const when      = START + repSec + startTick * secPerTick + swingOff
          const gate      = Math.max(0.05, (n.durationTicks ?? TICKS_PER_STEP) * secPerTick)
          track.fn(offCtx, when, {
            ...track.params,
            pitch:    n.pitch + masterPitch,
            velocity: n.velocity ?? 1,
            gate,
          }, out)
        }
      } else {
        const steps = track.pattern || []
        for (let s = 0; s < totalSteps; s++) {
          if (!steps[s]) continue
          const swingOff = (s % 2 === 1) ? swing * swingMix * (secPerStep / 3) : 0
          const when     = START + repSec + s * secPerStep + swingOff
          const vel      = track.stepVelocities?.[s] ?? 0.8
          track.fn(offCtx, when, { ...track.params, velocity: vel }, out)
        }
      }
    }
  })

  const rendered = await offCtx.startRendering()
  if (normalize) normalizeAudioBuffer(rendered)
  return rendered
}

// ─── WAV encoder ───────────────────────────────────────────────────────────────

function encodeWavBlob(samples, numChannels, sampleRate, bitDepth, dither) {
  const isFloat        = bitDepth === 32
  const bytesPerSample = isFloat ? 4 : bitDepth / 8
  const dataSize       = samples.length * bytesPerSample
  const buf  = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  writeString(view, 0, 'RIFF')
  view.setUint32(4,  36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, isFloat ? 3 : 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]))
    if (isFloat) {
      view.setFloat32(offset, s, true); offset += 4
    } else if (bitDepth === 24) {
      if (dither) s = Math.max(-1, Math.min(1, s + (Math.random() * 2 - 1) / 16777216))
      const v = Math.round(s < 0 ? s * 8388608 : s * 8388607)
      view.setUint8(offset, v & 0xFF); view.setUint8(offset+1, (v>>8)&0xFF); view.setUint8(offset+2, (v>>16)&0xFF)
      offset += 3
    } else {
      if (dither) s = Math.max(-1, Math.min(1, s + (Math.random() * 2 - 1) / 65536))
      view.setInt16(offset, Math.round(s < 0 ? s * 32768 : s * 32767), true); offset += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}

function interleave(buffer, numChannels) {
  const srcCh = buffer.numberOfChannels
  const numCh = numChannels === 1 ? 1 : Math.min(srcCh, 2)
  const len   = buffer.length
  const out   = new Float32Array(len * numCh)
  const L = buffer.getChannelData(0)
  const R = srcCh > 1 ? buffer.getChannelData(1) : L
  if (numCh === 1) {
    for (let i = 0; i < len; i++) out[i] = (L[i] + R[i]) * 0.5
  } else {
    for (let i = 0; i < len; i++) { out[i*2] = L[i]; out[i*2+1] = R[i] }
  }
  return { samples: out, numCh }
}

// Either render the tracks offline, or use a pre-rendered buffer captured in real
// time (used when the project contains live AudioWorklet plugins).
async function resolveBuffer(tracks, options) {
  return options.buffer ?? await renderAudioBuffer(tracks, options)
}

export async function renderLoopToWav(tracks, options = {}) {
  const { channels = 2, bitDepth = 16, dither = true } = options
  const buffer = await resolveBuffer(tracks, options)
  const { samples, numCh } = interleave(buffer, channels)
  return { blob: encodeWavBlob(samples, numCh, buffer.sampleRate, bitDepth, dither && bitDepth !== 32), ext: 'wav' }
}

// ─── MP3 encoder (lamejs) ──────────────────────────────────────────────────────

function f32toI16(f32arr, start, end) {
  const out = new Int16Array(end - start)
  for (let i = start; i < end; i++)
    out[i - start] = Math.max(-32768, Math.min(32767, Math.round(f32arr[i] * 32767)))
  return out
}

export async function renderLoopToMp3(tracks, options = {}) {
  const { channels = 2, bitrate = 192 } = options
  const buffer  = await resolveBuffer(tracks, options)
  const numCh   = channels === 1 ? 1 : Math.min(buffer.numberOfChannels, 2)
  const len     = buffer.length
  const leftF32 = buffer.getChannelData(0)
  const rightF32 = numCh > 1 ? buffer.getChannelData(1) : leftF32

  const mp3enc  = new Mp3Encoder(numCh, buffer.sampleRate, bitrate)
  const BLOCK   = 1152
  const chunks  = []

  for (let i = 0; i < len; i += BLOCK) {
    const end = Math.min(i + BLOCK, len)
    const l   = f32toI16(leftF32, i, end)
    const buf = numCh > 1
      ? mp3enc.encodeBuffer(l, f32toI16(rightF32, i, end))
      : mp3enc.encodeBuffer(l)
    if (buf.length > 0) chunks.push(new Uint8Array(buf))
  }

  const tail = mp3enc.flush()
  if (tail.length > 0) chunks.push(new Uint8Array(tail))

  return { blob: new Blob(chunks, { type: 'audio/mpeg' }), ext: 'mp3' }
}

// ─── OGG/Opus encoder (MediaRecorder, real-time) ─────────────────────────────

export function getOggMimeType() {
  const candidates = [
    'audio/ogg;codecs=opus',
    'audio/ogg;codecs=vorbis',
    'audio/webm;codecs=opus',
    'audio/webm',
  ]
  return candidates.find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || null
}

export async function renderLoopToOgg(tracks, options = {}) {
  const { channels = 2, bitrate = 192 } = options
  const buffer    = await resolveBuffer(tracks, options)
  const mimeType  = getOggMimeType()
  if (!mimeType) throw new Error('OGG/Opus encoding is not supported in this browser.')

  const ext = mimeType.startsWith('audio/ogg') ? 'ogg' : 'webm'

  const blob = await new Promise((resolve, reject) => {
    const ctx    = new AudioContext({ sampleRate: buffer.sampleRate })
    const dest   = ctx.createMediaStreamDestination()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(dest)

    let recorder
    try {
      recorder = new MediaRecorder(dest.stream, {
        mimeType,
        audioBitsPerSecond: bitrate * 1000,
      })
    } catch (e) {
      ctx.close(); reject(e); return
    }

    const chunks = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => { ctx.close(); resolve(new Blob(chunks, { type: mimeType })) }
    recorder.onerror = e  => { ctx.close(); reject(e.error) }

    recorder.start(50)
    source.start(0)
    source.onended = () => setTimeout(() => recorder.stop(), 300)
  })

  return { blob, ext }
}

// ─── FLAC placeholder ─────────────────────────────────────────────────────────
export function isFlacSupported() { return false }
