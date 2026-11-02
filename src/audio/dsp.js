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
