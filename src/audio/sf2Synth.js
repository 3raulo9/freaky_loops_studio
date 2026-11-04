// ─── Sound-font channel (desktop) ─────────────────────────────────────────────
//   Plays one preset of a SoundFont 2 file the way a sound-font player does.
//   The desktop host reads the preset (crates/host/src/sf2.rs) and hands over
//   its zones plus only the samples they use; here each note starts every
//   zone that covers its key and velocity:
//
//     buffer source (pitch from root key / tuning, loop) → gain (level,
//     delay-attack-hold-decay-sustain envelope, release on note-off) → pan → dest
//
//   AudioBuffers belong to no particular context, so one loaded preset serves
//   the live context and offline renders alike.
//
//   Integration with the channel API (same as the other instruments):
//     makeSf2PlayFn({ sf2Path, sf2Bank, sf2Program }) → fn(ctx, time, params, dest)
//   With `hold`, fn returns a voice whose .stop(when) runs the release.

import { loadSf2PresetNative } from '../desktop/ipc.js'

const presets = new Map()   // "path|bank|program" → { info, buffers, ready, error }

const keyOf = (path, bank, program) => `${path}|${bank}|${program}`

/** Load (once) and return { info, buffers }; rejects with the host's reason. */
export function loadSf2Preset(path, bank = 0, program = 0) {
  const key = keyOf(path, bank, program)
  const have = presets.get(key)
  if (have) return have.ready
  const entry = { info: null, buffers: null, error: null }
  entry.ready = (async () => {
    const res = await loadSf2PresetNative(path, bank, program)
    if (!res || res.error) throw new Error(res?.error ?? 'the desktop app did not answer')
    const bin = await (await fetch(res.url)).arrayBuffer()
    const pcm = new Float32Array(bin)
    entry.buffers = res.info.samples.map(s => {
      const b = new AudioBuffer({ length: Math.max(1, s.frames), numberOfChannels: 1, sampleRate: Math.min(384000, Math.max(3000, s.rate)) })
      b.copyToChannel(pcm.subarray(s.offset, s.offset + s.frames), 0)
      return b
    })
    entry.info = res.info
    return entry
  })()
  entry.ready.catch(e => { entry.error = e.message; presets.delete(key) })
  presets.set(key, entry)
  return entry.ready
}

/** The loaded preset, if ready (no waiting). */
export function sf2PresetNow(path, bank = 0, program = 0) {
  const e = presets.get(keyOf(path, bank, program))
  return e?.info ? e : null
}

const cbToGain = cb => Math.pow(10, -cb / 200)

// Start one zone; returns { release(t) }.
function startZone(ctx, entry, z, pitch, velocity, time, dest) {
  const buf = entry.buffers[z.sample]
  if (!buf) return null
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = Math.pow(2, ((pitch - z.root) * z.scale + z.tune) / 1200)
  if (z.loop && z.loopEnd > z.loopStart + 8) {
    src.loop = true
    src.loopStart = z.loopStart / buf.sampleRate
    src.loopEnd = z.loopEnd / buf.sampleRate
  }
  const amp = ctx.createGain()
  // Level: the zone's attenuation and a concave velocity curve. Attenuation is
  // applied at 0.4× like the hardware most fonts were voiced on (and the
  // players that follow it) — taken literally, many fonts come out 20 dB quiet.
  const peak = Math.min(2, cbToGain(z.attenuation * 0.4) * velocity * velocity * 0.7)
  const env = z.env
  const g = amp.gain
  let t = time + env.delay
  g.setValueAtTime(0, time)
  g.setValueAtTime(0, t)
  g.linearRampToValueAtTime(peak, t + Math.max(0.001, env.attack))
  t += Math.max(0.001, env.attack) + env.hold
  g.setValueAtTime(peak, t)
  const sus = Math.max(0.0001, peak * cbToGain(env.sustain))
  if (sus < peak * 0.999) g.exponentialRampToValueAtTime(sus, t + Math.max(0.001, env.decay))
  let tail = amp
  if (z.pan) {
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, z.pan / 500))
    amp.connect(p)
    tail = p
  }
  src.connect(amp)
  tail.connect(dest)
  src.start(time)
  if (!src.loop) {
    // A one-shot sample ends by itself: release the nodes when it does.
    src.onended = () => { try { tail.disconnect() } catch (_) {} }
  }
  return {
    release(at) {
      const r = Math.max(0.005, env.release)
      try {
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at)
        else { g.cancelScheduledValues(at); g.setValueAtTime(g.value, at) }
        g.setTargetAtTime(0, at, r / 5)
        src.stop(at + r + 0.05)
      } catch (_) {}
      setTimeout(() => { try { tail.disconnect() } catch (_) {} }, (at - ctx.currentTime + r + 0.2) * 1000)
    },
  }
}

export function makeSf2PlayFn(params) {
  const path = params?.sf2Path
  const bank = params?.sf2Bank ?? 0
  const program = params?.sf2Program ?? 0
  if (path) loadSf2Preset(path, bank, program).catch(() => {})

  return function playSf2(ctx, time, p, dest) {
    const { pitch = 60, velocity = 1, gate = 0.5, hold = false } = p ?? {}
    const entry = path && sf2PresetNow(path, bank, program)
    if (!entry) {
      if (path) loadSf2Preset(path, bank, program).catch(() => {})
      return
    }
    const key = Math.round(pitch)
    const vel = Math.round(Math.max(0, Math.min(1, velocity)) * 127)
    const out = dest ?? ctx.destination
    const voices = []
    for (const z of entry.info.zones) {
      if (key < z.key[0] || key > z.key[1] || vel < z.vel[0] || vel > z.vel[1]) continue
      const v = startZone(ctx, entry, z, pitch, Math.max(0, Math.min(1, velocity)), time, out)
      if (v) voices.push(v)
    }
    const voice = { stop(at) { for (const v of voices) v.release(at ?? ctx.currentTime) } }
    if (hold) return voice
    voice.stop(time + Math.max(0.02, gate))
  }
}
