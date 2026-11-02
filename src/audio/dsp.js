// Rust DSP (crates/dsp) compiled to WebAssembly: time-stretch and tempo
// detection. It loads in the background at startup; until it's ready — or if
// WebAssembly is unavailable — callers fall back to the JavaScript versions in
// warp.js, which produce the same results.
//
// Rebuild after changing the Rust code: `npm run build:dsp`.

import wasmUrl from '../wasm/fls_dsp.wasm?url'

let ex = null
let enabled = true

export const dspReady = (async () => {
  try {
    const bytes = await (await fetch(wasmUrl)).arrayBuffer()
    const { instance } = await WebAssembly.instantiate(bytes, {})
    ex = instance.exports
    return true
  } catch (err) {
    console.warn('[dsp] WebAssembly DSP unavailable — using the JavaScript fallback.', err)
    return false
  }
})()

/** True once the WebAssembly module is loaded (and not disabled). */
export function hasWasmDsp() { return !!ex && enabled }

/** Force the JavaScript path (for A/B checks); `true` restores WebAssembly. */
export function setWasmDspEnabled(on) { enabled = !!on }

// Copy planar channels into linear memory, run `call(inPtr, outPtr)`, read
// `outLen` frames back out, and free both buffers.
function run(channels, len, outLen, call) {
  const nCh = channels.length
  const inN = nCh * len, outN = nCh * outLen
  const inPtr = ex.fls_alloc(inN)
  const outPtr = outN ? ex.fls_alloc(outN) : 0
  try {
    // Views are created after both allocations: growing memory detaches old views.
    const mem = new Float32Array(ex.memory.buffer)
    channels.forEach((d, c) => mem.set(d.subarray(0, len), inPtr / 4 + c * len))
    const ret = call(inPtr, outPtr)
    if (!outN) return ret
    const view = new Float32Array(ex.memory.buffer, outPtr, outN)
    return Array.from({ length: nCh }, (_, c) => view.slice(c * outLen, (c + 1) * outLen))
  } finally {
    ex.fls_free(inPtr, inN)
    if (outN) ex.fls_free(outPtr, outN)
  }
}

/** WSOLA stretch of planar channels; returns new channels, or null to fall back. */
export function wasmWsola(channels, len, ratio, frame, overlap, tol) {
  if (!hasWasmDsp()) return null
  const outLen = ex.fls_stretched_len(len, ratio, frame)
  return run(channels, len, outLen, (i, o) => ex.fls_wsola(i, channels.length, len, ratio, frame, overlap, tol, o, outLen))
}

/** Granular stretch (`jitter` in samples); returns new channels, or null. */
export function wasmGranular(channels, len, ratio, grain, jitter) {
  if (!hasWasmDsp()) return null
  const outLen = ex.fls_stretched_len(len, ratio, grain)
  const seed = (Math.random() * 0xffffffff) >>> 0
  return run(channels, len, outLen, (i, o) => ex.fls_granular(i, channels.length, len, ratio, grain, jitter, seed, o, outLen))
}

/** Tempo in BPM, null when there's no clear pulse, undefined to fall back. */
export function wasmDetectBpm(channels, len, sampleRate, minBpm, maxBpm) {
  if (!hasWasmDsp()) return undefined
  const bpm = run(channels, len, 0, (i) => ex.fls_detect_bpm(i, channels.length, len, sampleRate, minBpm, maxBpm))
  return bpm > 0 ? bpm : null
}

/**
 * Transcribe mono audio to notes ('melody' → MIDI pitches, 'drums' → 0 kick /
 * 1 snare / 2 hat). Returns [{ start, end, key, velocity }] in samples, or null
 * when the WebAssembly module isn't available.
 */
export function wasmTranscribe(mono, sampleRate, mode = 'melody', sensitivity = 0.5) {
  if (!hasWasmDsp()) return null
  const MAX = 4096
  const inPtr = ex.fls_alloc(mono.length)
  const outPtr = ex.fls_alloc(MAX * 4)
  try {
    new Float32Array(ex.memory.buffer).set(mono, inPtr / 4)
    const n = ex.fls_transcribe(inPtr, mono.length, sampleRate, mode === 'drums' ? 1 : 0, sensitivity, outPtr, MAX)
    const v = new Float32Array(ex.memory.buffer, outPtr, n * 4)
    return Array.from({ length: n }, (_, i) => ({ start: v[i * 4], end: v[i * 4 + 1], key: v[i * 4 + 2], velocity: v[i * 4 + 3] }))
  } finally {
    ex.fls_free(inPtr, mono.length)
    ex.fls_free(outPtr, MAX * 4)
  }
}

/**
 * Parse a pattern-project (.flp) file with the Rust reader (crates/projfile).
 * Resolves to the project description, or `{ error }` for unreadable files.
 * There's no JavaScript fallback: without WebAssembly the import is unavailable.
 */
export async function parsePatternProject(bytes) {
  await dspReady
  if (!ex?.fls_parse_project) return { error: 'The project reader needs WebAssembly, which is unavailable here.' }
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const ptr = ex.fls_alloc_bytes(src.length)
  try {
    new Uint8Array(ex.memory.buffer, ptr, src.length).set(src)
    const len = ex.fls_parse_project(ptr, src.length)
    const out = new Uint8Array(ex.memory.buffer, ex.fls_result_ptr(), len)
    return JSON.parse(new TextDecoder().decode(out))
  } finally {
    ex.fls_free_bytes(ptr, src.length)
  }
}

/** Decode a WavPack (.wv) file → { channels, sampleRate, frames, data: Float32Array[] } or null. */
export async function decodeWavPack(bytes) {
  await dspReady
  if (!ex?.fls_decode_wavpack) return null
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const ptr = ex.fls_alloc_bytes(src.length)
  try {
    new Uint8Array(ex.memory.buffer, ptr, src.length).set(src)
    const len = ex.fls_decode_wavpack(ptr, src.length)
    if (!len) return null
    const base = ex.fls_result_ptr()
    const hdr = new Uint32Array(ex.memory.buffer.slice(base, base + 12))
    const [channels, sampleRate, frames] = hdr
    const data = []
    for (let c = 0; c < channels; c++) {
      data.push(new Float32Array(ex.memory.buffer.slice(base + 12 + c * frames * 4, base + 12 + (c + 1) * frames * 4)))
    }
    return { channels, sampleRate, frames, data }
  } finally {
    ex.fls_free_bytes(ptr, src.length)
  }
}
