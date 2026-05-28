// Renders one loop cycle into a WAV Blob using OfflineAudioContext.

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

function encodeWav(samples, numChannels, sampleRate) {
  const bytesPerSample = 2   // 16-bit PCM
  const dataSize  = samples.length * bytesPerSample
  const buf  = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  writeString(view, 0, 'RIFF')
  view.setUint32(4,  36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1,  true)                               // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, 16, true)                               // bits per sample
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return new Blob([view], { type: 'audio/wav' })
}

function bufferToWavBlob(audioBuffer) {
  const numCh  = audioBuffer.numberOfChannels
  const len    = audioBuffer.length
  const interleaved = new Float32Array(len * numCh)

  if (numCh === 2) {
    const L = audioBuffer.getChannelData(0)
    const R = audioBuffer.getChannelData(1)
    for (let i = 0; i < len; i++) {
      interleaved[i * 2]     = L[i]
      interleaved[i * 2 + 1] = R[i]
    }
  } else {
    interleaved.set(audioBuffer.getChannelData(0))
  }

  return encodeWav(interleaved, numCh, audioBuffer.sampleRate)
}

/**
 * @param {object[]}  tracks     - reactive track array (same shape as DrumMachine)
 * @param {number}    bpm
 * @param {number}    totalSteps
 * @param {number}    swing      - 0–0.25 fractional swing offset
 * @param {number}    bars       - how many loop repetitions to render
 */
export async function renderLoopToWav(tracks, bpm, totalSteps, swing, bars = 1) {
  const SAMPLE_RATE  = 44100
  const secPerBeat   = 60 / bpm
  const secPerStep   = secPerBeat / 4          // 16th-note grid
  const loopDuration = totalSteps * secPerStep * bars
  const tail         = 3.5                     // silence tail for long decays (clash)
  const totalSec     = loopDuration + tail

  const offCtx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * totalSec), SAMPLE_RATE)

  // Schedule every bar
  for (let bar = 0; bar < bars; bar++) {
    const barOffset = bar * totalSteps * secPerStep
    for (let step = 0; step < totalSteps; step++) {
      const swingOffset = (step % 2 === 1) ? swing * secPerBeat * 0.5 : 0
      const when = 0.01 + barOffset + step * secPerStep + swingOffset

      tracks.forEach(track => {
        if (!track.pattern[step] || track.muted) return
        const vol = offCtx.createGain()
        vol.gain.value = track.volume
        vol.connect(offCtx.destination)
        track.fn(offCtx, when, { ...track.params }, vol)
      })
    }
  }

  const rendered = await offCtx.startRendering()
  return bufferToWavBlob(rendered)
}
