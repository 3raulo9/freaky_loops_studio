// ─── Audio Warping & Time-Stretch engine ────────────────────────────────────
//
//   Ableton-style, pitch-independent time-stretching plus tempo detection.
//   Everything here is OFFLINE: given a source AudioBuffer and a stretch ratio,
//   we render a brand-new AudioBuffer that is longer/shorter in time but keeps
//   the original pitch. The caller then plays that buffer with a normal
//   AudioBufferSourceNode, so this slots cleanly into the existing buffer-based
//   playback engine (no realtime AudioWorklet required).
//
//   Warp modes (mapped onto two algorithms):
//     • repitch  → no stretch; caller uses playbackRate (pitch follows tempo)
//     • beats    → WSOLA, short grains (punchy, good for drums)
//     • tones    → WSOLA, long grains (smooth, good for melodic/harmonic)
//     • complex  → WSOLA, medium grains (general purpose)
//     • texture  → granular smear (pads / ambient / sound-design)
//
//   `ratio` is OUTPUT length / INPUT length. ratio > 1 = slower/longer,
//   ratio < 1 = faster/shorter. Pitch is preserved for every mode except
//   repitch.

export const WARP_MODES = ['repitch', 'beats', 'tones', 'complex', 'texture']

// ── Window ───────────────────────────────────────────────────────────────────
function hann(n) {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

// ── Mono mixdown (for correlation / onset analysis) ──────────────────────────
function mixdownMono(channels, len) {
  const out = new Float32Array(len)
  const n = channels.length
  for (let c = 0; c < n; c++) {
    const d = channels[c]
    for (let i = 0; i < len; i++) out[i] += d[i]
  }
  if (n > 1) for (let i = 0; i < len; i++) out[i] /= n
  return out
}

// ─── WSOLA time-stretch ──────────────────────────────────────────────────────
//   Waveform Similarity Overlap-Add. Each synthesis frame is read from a
//   position chosen (within a tolerance window) to maximise waveform similarity
//   with the natural continuation of the previously placed frame — this keeps
//   phase coherent and avoids the "robotic" artefacts of plain OLA.
function wsola(ctx, buffer, ratio, { frame, overlap, tol }) {
  const sr   = buffer.sampleRate
  const nCh  = buffer.numberOfChannels
  const inLen = buffer.length
  const inData = []
  for (let c = 0; c < nCh; c++) inData.push(buffer.getChannelData(c))
  const mono = nCh > 1 ? mixdownMono(inData, inLen) : inData[0]

  const synHop = Math.max(1, Math.floor(frame / overlap))
  const anaHop = Math.max(1, Math.round(synHop / ratio))
  const win    = hann(frame)

  const outLen  = Math.max(frame, Math.floor(inLen * ratio) + frame)
  const outData = []
  for (let c = 0; c < nCh; c++) outData.push(new Float32Array(outLen))
  const norm = new Float32Array(outLen)

  let anaIdx = 0          // current analysis read index (samples)
  let synPos = 0          // current synthesis write index (samples)
  let delta  = 0          // similarity offset for the current frame

  // Cross-correlation between input window at `a` and the natural-progression
  // window at `b`, evaluated over `frame` samples (uses mono signal).
  function corr(a, b) {
    let sum = 0
    for (let i = 0; i < frame; i += 2) {     // stride 2 ≈ 2× faster, negligible quality loss
      const ia = a + i, ib = b + i
      if (ia < 0 || ib < 0 || ia >= inLen || ib >= inLen) continue
      sum += mono[ia] * mono[ib]
    }
    return sum
  }

  while (synPos + frame < outLen && anaIdx < inLen) {
    const readIdx = anaIdx + delta
    // Overlap-add the chosen window into the output (all channels, same offset).
    for (let i = 0; i < frame; i++) {
      const ri = readIdx + i
      if (ri < 0 || ri >= inLen) continue
      const w = win[i]
      for (let c = 0; c < nCh; c++) outData[c][synPos + i] += inData[c][ri] * w
      norm[synPos + i] += w
    }
    // Natural continuation of the frame we just placed.
    const natural = readIdx + synHop
    // Advance analysis pointer, then search ±tol for best-matching next frame.
    anaIdx += anaHop
    let best = -Infinity, bestDelta = 0
    for (let d = -tol; d <= tol; d += 2) {
      const score = corr(anaIdx + d, natural)
      if (score > best) { best = score; bestDelta = d }
    }
    delta = bestDelta
    synPos += synHop
  }

  // Weighted-OLA normalisation: divide out the accumulated window envelope so
  // varying overlap can't amplitude-modulate the result.
  const outBuf = ctx.createBuffer(nCh, outLen, sr)
  for (let c = 0; c < nCh; c++) {
    const src = outData[c], dst = outBuf.getChannelData(c)
    for (let i = 0; i < outLen; i++) {
      const n = norm[i]
      dst[i] = n > 1e-4 ? src[i] / n : src[i]
    }
  }
  return outBuf
}

// ─── Granular smear (texture mode) ───────────────────────────────────────────
function granular(ctx, buffer, ratio, { grain, jitter }) {
  const sr    = buffer.sampleRate
  const nCh   = buffer.numberOfChannels
  const inLen = buffer.length
  const inData = []
  for (let c = 0; c < nCh; c++) inData.push(buffer.getChannelData(c))

  const synHop = Math.max(1, Math.floor(grain / 4))   // 75% overlap
  const win    = hann(grain)
  const outLen = Math.max(grain, Math.floor(inLen * ratio) + grain)
  const outData = []
  for (let c = 0; c < nCh; c++) outData.push(new Float32Array(outLen))
  const norm = new Float32Array(outLen)

  let synPos = 0
  while (synPos + grain < outLen) {
    // Map output position back to an input read position, plus random jitter.
    const base = synPos / ratio
    const jit  = (Math.random() * 2 - 1) * jitter * sr
    let read   = Math.floor(base + jit)
    if (read < 0) read = 0
    if (read + grain >= inLen) read = Math.max(0, inLen - grain - 1)
    for (let i = 0; i < grain; i++) {
      const ri = read + i
      if (ri < 0 || ri >= inLen) continue
      const w = win[i]
      for (let c = 0; c < nCh; c++) outData[c][synPos + i] += inData[c][ri] * w
      norm[synPos + i] += w
    }
    synPos += synHop
  }

  const outBuf = ctx.createBuffer(nCh, outLen, sr)
  for (let c = 0; c < nCh; c++) {
    const src = outData[c], dst = outBuf.getChannelData(c)
    for (let i = 0; i < outLen; i++) {
      const n = norm[i]
      dst[i] = n > 1e-4 ? src[i] / n : src[i]
    }
  }
  return outBuf
}

// ─── Public: time-stretch a buffer by `ratio`, preserving pitch ──────────────
//   Returns a NEW AudioBuffer. For ratio ≈ 1 or mode 'repitch', returns the
//   original buffer unchanged (the caller handles repitch via playbackRate).
export function timeStretch(ctx, buffer, ratio, mode = 'complex') {
  if (!buffer) return buffer
  if (mode === 'repitch') return buffer
  if (!isFinite(ratio) || ratio <= 0) return buffer
  if (Math.abs(ratio - 1) < 0.002) return buffer

  switch (mode) {
    case 'beats':   return wsola(ctx, buffer, ratio, { frame: 1024, overlap: 2, tol: 256 })
    case 'tones':   return wsola(ctx, buffer, ratio, { frame: 4096, overlap: 4, tol: 512 })
    case 'texture': return granular(ctx, buffer, ratio, { grain: 4096, jitter: 0.02 })
    case 'complex':
    default:        return wsola(ctx, buffer, ratio, { frame: 2048, overlap: 4, tol: 512 })
  }
}

// ─── Tempo (BPM) detection ───────────────────────────────────────────────────
//   Onset-envelope autocorrelation. Builds a spectral-flux-ish onset signal
//   (positive energy differences across short frames), removes its local mean,
//   then autocorrelates over the lag range for `minBpm..maxBpm` and returns the
//   strongest periodicity. Octave-folds the result into a musical range.
export function detectBpm(buffer, { minBpm = 70, maxBpm = 180 } = {}) {
  if (!buffer) return null
  const sr   = buffer.sampleRate
  const len  = buffer.length
  const nCh  = buffer.numberOfChannels
  const data = []
  for (let c = 0; c < nCh; c++) data.push(buffer.getChannelData(c))
  const mono = nCh > 1 ? mixdownMono(data, len) : data[0]

  // Onset envelope: rectified energy difference per analysis frame.
  const hop   = 512
  const frame = 1024
  const nFrames = Math.floor((len - frame) / hop)
  if (nFrames < 8) return null
  const env = new Float32Array(nFrames)
  let prevE = 0
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop
    let e = 0
    for (let i = 0; i < frame; i++) { const s = mono[start + i]; e += s * s }
    env[f] = Math.max(0, e - prevE)
    prevE = e
  }
  // Remove local mean (high-pass the envelope) to flatten slow loudness drift.
  const win = 16
  for (let f = nFrames - 1; f >= 0; f--) {
    let m = 0, cnt = 0
    for (let k = Math.max(0, f - win); k <= Math.min(nFrames - 1, f + win); k++) { m += env[k]; cnt++ }
    env[f] = Math.max(0, env[f] - m / cnt)
  }

  const fps     = sr / hop                       // envelope frames per second
  const minLag  = Math.floor((fps * 60) / maxBpm)
  const maxLag  = Math.ceil((fps * 60) / minBpm)
  if (maxLag <= minLag || maxLag >= nFrames) return null

  let bestLag = minLag, bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let f = 0; f + lag < nFrames; f++) sum += env[f] * env[f + lag]
    if (sum > bestScore) { bestScore = sum; bestLag = lag }
  }
  if (bestScore <= 0) return null

  let bpm = (fps * 60) / bestLag
  // Octave-fold into a sensible range.
  while (bpm < 80)  bpm *= 2
  while (bpm > 170) bpm /= 2
  return Math.round(bpm * 10) / 10
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
//   Stretch ratio that makes audio recorded at `clipBpm` play back at
//   `projectBpm`. output/input = clipBpm / projectBpm (slower project = longer).
export function tempoRatio(clipBpm, projectBpm) {
  if (!clipBpm || !projectBpm) return 1
  return clipBpm / projectBpm
}

// Copy a fractional region [startFrac, endFrac] of a buffer into a new buffer.
function sliceBuffer(ctx, buf, startFrac, endFrac) {
  const s = Math.max(0, Math.floor(startFrac * buf.length))
  const e = Math.min(buf.length, Math.floor(endFrac * buf.length))
  const len = Math.max(1, e - s)
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    out.getChannelData(c).set(buf.getChannelData(c).subarray(s, e))
  }
  return out
}

// ─── Piecewise time-stretch from warp markers ────────────────────────────────
//   `segments` = [{ srcStartFrac, srcEndFrac, outDurSec }], each a region of the
//   source buffer stretched to its own target duration. Regions are stretched
//   independently (so individual transients can be pinned to the grid) and
//   concatenated with a short equal-power crossfade to hide the seams.
export function timeStretchSegments(ctx, buf, segments, mode = 'complex') {
  if (!buf || !segments?.length) return buf
  const sr  = buf.sampleRate
  const nCh = buf.numberOfChannels
  const xf  = Math.min(256, Math.floor(sr * 0.005))   // ~5 ms seam crossfade

  const parts = []
  for (const seg of segments) {
    const sub    = sliceBuffer(ctx, buf, seg.srcStartFrac, seg.srcEndFrac)
    const subDur = sub.duration
    const ratio  = seg.outDurSec / Math.max(1e-4, subDur)
    parts.push(timeStretch(ctx, sub, ratio, mode))
  }

  // Total length with crossfade overlaps removed.
  let total = 0
  parts.forEach((p, i) => { total += p.length - (i > 0 ? xf : 0) })
  total = Math.max(1, total)

  const out = ctx.createBuffer(nCh, total, sr)
  for (let c = 0; c < nCh; c++) {
    const dst = out.getChannelData(c)
    let pos = 0
    parts.forEach((p, i) => {
      const src = p.getChannelData(Math.min(c, p.numberOfChannels - 1))
      const start = i > 0 ? pos - xf : pos
      for (let j = 0; j < src.length; j++) {
        const d = start + j
        if (d < 0 || d >= total) continue
        if (i > 0 && j < xf) {
          const t = j / xf
          dst[d] = dst[d] * Math.cos(t * Math.PI / 2) + src[j] * Math.sin(t * Math.PI / 2)
        } else {
          dst[d] = src[j]
        }
      }
      pos = start + src.length
    })
  }
  return out
}

// Build warp segments from markers ([{ pos, beat }], pos = 0..1 of the source).
// Material before the first / after the last marker plays unstretched.
export function buildWarpSegments(markers, projectBpm, bufDuration) {
  if (!markers || markers.length < 1 || !projectBpm || !bufDuration) return null
  const m = [...markers].filter(x => x && isFinite(x.pos) && isFinite(x.beat))
                        .sort((a, b) => a.pos - b.pos)
  if (m.length < 1) return null
  const secPerBeat = 60 / projectBpm
  const segs = []
  // Leading unstretched region.
  if (m[0].pos > 0.0001) segs.push({ srcStartFrac: 0, srcEndFrac: m[0].pos, outDurSec: m[0].pos * bufDuration })
  // Stretched regions between consecutive markers.
  for (let i = 0; i < m.length - 1; i++) {
    const beats = m[i + 1].beat - m[i].beat
    if (m[i + 1].pos <= m[i].pos || beats <= 0) continue
    segs.push({ srcStartFrac: m[i].pos, srcEndFrac: m[i + 1].pos, outDurSec: beats * secPerBeat })
  }
  // Trailing unstretched region.
  const last = m[m.length - 1]
  if (last.pos < 0.9999) segs.push({ srcStartFrac: last.pos, srcEndFrac: 1, outDurSec: (1 - last.pos) * bufDuration })
  return segs.length ? segs : null
}
