// Decode sample files the browser's decodeAudioData can't handle on its own:
//   • WAV files that wrap an Ogg Vorbis stream (format tags 0x674F–0x6771),
//     common in sample libraries — the inner Ogg stream is decoded directly;
//   • WavPack (.wv) — decoded by the Rust decoder (crates/dsp, WebAssembly).
// Everything else goes straight to decodeAudioData.

import { decodeWavPack } from './dsp.js'

const OGG_IN_WAV = new Set([0x674f, 0x6750, 0x6751, 0x676f, 0x6770, 0x6771])

const tag = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3])

/** Byte range of the Ogg stream inside an Ogg-wrapping WAV, or null. */
export function oggInWav(u8) {
  if (u8.length < 20 || tag(u8, 0) !== 'RIFF' || tag(u8, 8) !== 'WAVE') return null
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let fmt = -1
  for (let o = 12; o + 8 <= u8.length;) {
    const id = tag(u8, o), size = dv.getUint32(o + 4, true)
    if (id === 'fmt ' && o + 10 <= u8.length) fmt = dv.getUint16(o + 8, true)
    if (id === 'data') {
      if (!OGG_IN_WAV.has(fmt)) return null
      const start = o + 8, end = Math.min(u8.length, start + size)
      for (let i = start; i + 4 <= end; i++) if (u8[i] === 0x4f && tag(u8, i) === 'OggS') return [i, end]
      return null
    }
    o += 8 + size + (size & 1)
  }
  return null
}

/**
 * Keep only the first logical stream of an Ogg file. Some libraries append a
 * second stream (loop/metadata) after the audio has started, which breaks
 * decoders; pages are self-contained (own CRC), so dropping them is safe.
 */
export function oggFirstStream(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const pages = []
  let serial = null, other = false
  for (let i = 0; i + 27 <= u8.length && tag(u8, i) === 'OggS';) {
    const nseg = u8[i + 26]
    let body = 0
    for (let k = 0; k < nseg; k++) body += u8[i + 27 + k]
    const len = 27 + nseg + body
    const s = dv.getUint32(i + 14, true)
    if (serial === null) serial = s
    if (s === serial) pages.push([i, Math.min(u8.length, i + len)])
    else other = true
    i += len
  }
  if (!other) return u8
  const out = new Uint8Array(pages.reduce((n, [a, b]) => n + b - a, 0))
  let o = 0
  for (const [a, b] of pages) { out.set(u8.subarray(a, b), o); o += b - a }
  return out
}

/** Decode any supported sample file to an AudioBuffer on `ctx`. */
export async function decodeSampleFile(ctx, arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer)
  if (u8.length >= 4 && tag(u8, 0) === 'wvpk') {
    const pcm = await decodeWavPack(u8)
    if (!pcm) throw new Error('Unsupported WavPack file')
    const buf = ctx.createBuffer(pcm.channels, Math.max(1, pcm.frames), pcm.sampleRate)
    for (let c = 0; c < pcm.channels; c++) buf.copyToChannel(pcm.data[c], c)
    return buf
  }
  const ogg = oggInWav(u8)
  if (ogg) return await ctx.decodeAudioData(oggFirstStream(u8.slice(ogg[0], ogg[1])).slice().buffer)
  if (u8.length >= 4 && tag(u8, 0) === 'OggS') {
    const first = oggFirstStream(u8)
    if (first !== u8) return await ctx.decodeAudioData(first.slice().buffer)
  }
  return await ctx.decodeAudioData(arrayBuffer)
}
