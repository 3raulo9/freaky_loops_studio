import lamejs from 'lamejs'

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

// ─── Core: render tracks to an AudioBuffer ─────────────────────────────────────
async function renderAudioBuffer(tracks, options = {}) {
  const {
    bpm        = 120,
    totalSteps = 16,
    swing      = 0,
    bars       = 2,
    sampleRate = 44100,
    normalize  = true,
    tail       = 3.5,
  } = options

  const secPerBeat   = 60 / bpm
  const secPerStep   = secPerBeat / 4
  const loopDuration = totalSteps * secPerStep * bars
  const totalFrames  = Math.ceil(sampleRate * (loopDuration + tail))

  const offCtx = new OfflineAudioContext(2, totalFrames, sampleRate)

  for (let bar = 0; bar < bars; bar++) {
    const barOffset = bar * totalSteps * secPerStep
    for (let step = 0; step < totalSteps; step++) {
      const swingOffset = (step % 2 === 1) ? swing * secPerBeat * 0.5 : 0
      const when = 0.01 + barOffset + step * secPerStep + swingOffset

      tracks.forEach(track => {
        if (track.muted) return
        const vol = offCtx.createGain()
        vol.gain.value = track.volume
        vol.connect(offCtx.destination)

        if (track.mode === 'piano') {
          ;(track.pianoNotes || []).filter(n => n.step === step).forEach(note => {
            track.fn(offCtx, when, { ...track.params, pitch: note.pitch, velocity: note.velocity ?? 1 }, vol)
          })
        } else {
          if (track.pattern[step]) track.fn(offCtx, when, { ...track.params }, vol)
        }
      })
    }
  }

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

export async function renderLoopToWav(tracks, options = {}) {
  const { channels = 2, bitDepth = 16, dither = true } = options
  const buffer = await renderAudioBuffer(tracks, options)
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
  const buffer  = await renderAudioBuffer(tracks, options)
  const numCh   = channels === 1 ? 1 : Math.min(buffer.numberOfChannels, 2)
  const len     = buffer.length
  const leftF32 = buffer.getChannelData(0)
  const rightF32 = numCh > 1 ? buffer.getChannelData(1) : leftF32

  const mp3enc  = new lamejs.Mp3Encoder(numCh, buffer.sampleRate, bitrate)
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
  const buffer    = await renderAudioBuffer(tracks, options)
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
