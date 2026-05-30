// Shared Web Audio helpers used by synths.js, melodic.js, and fm.js.

// Asymmetric harsh clipping for the Distortion module
export function makeHarshCurve(drive, crunch) {
  const n = 256
  const curve = new Float32Array(n)
  const amt = drive * 180 + crunch * 100
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = x >= 0
      ? Math.min(1,  x * (1 + amt / 25))
      : Math.max(-1, x * (1 + (amt * 0.55) / 25))
  }
  return curve
}

// Synthetic reverb IR — created once per AudioContext
const _reverbCache = new WeakMap()
export function getOrCreateReverb(ctx) {
  if (_reverbCache.has(ctx)) return _reverbCache.get(ctx)
  const sr = ctx.sampleRate, len = Math.floor(sr * 1.8)
  const buf = ctx.createBuffer(2, len, sr)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
  }
  const conv = ctx.createConvolver()
  conv.buffer = buf
  _reverbCache.set(ctx, conv)
  return conv
}

// Post-processing chain: Distortion → Filter → FX sends → dest
// Call this instead of sourceNode.connect(dest).
// All params default to no-op so existing sounds are unchanged without modules.
export function buildProcessChain(ctx, sourceNode, dest, p = {}) {
  const {
    drive    = null, crunch  = 0,     distMix = 0.5,
    lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
    reverbSend = 0, delaySend = 0,
  } = p

  let cur = sourceNode

  // ── Distortion module ─────────────────────────────────────────────────────
  if (drive !== null) {
    const outG   = ctx.createGain()
    const shaper = ctx.createWaveShaper()
    shaper.curve      = makeHarshCurve(drive, crunch)
    shaper.oversample = '4x'
    const dry = ctx.createGain(); dry.gain.value = 1 - distMix
    const wet = ctx.createGain(); wet.gain.value = distMix
    cur.connect(dry);    dry.connect(outG)
    cur.connect(shaper); shaper.connect(wet); wet.connect(outG)
    cur = outG
  }

  // ── Filter module ─────────────────────────────────────────────────────────
  if (hpCutoff > 30) {
    const hpf = ctx.createBiquadFilter()
    hpf.type = 'highpass'; hpf.frequency.value = hpCutoff; hpf.Q.value = filterQ
    cur.connect(hpf); cur = hpf
  }
  if (lpCutoff < 18000) {
    const lpf = ctx.createBiquadFilter()
    lpf.type = 'lowpass'; lpf.frequency.value = lpCutoff; lpf.Q.value = filterQ
    cur.connect(lpf); cur = lpf
  }

  // ── FX module ─────────────────────────────────────────────────────────────
  if (reverbSend > 0.01 || delaySend > 0.01) {
    const dryG = ctx.createGain(); dryG.gain.value = 1.0
    cur.connect(dryG); dryG.connect(dest)

    if (reverbSend > 0.01) {
      const rvG    = ctx.createGain(); rvG.gain.value = reverbSend
      const reverb = getOrCreateReverb(ctx)
      cur.connect(rvG); rvG.connect(reverb); reverb.connect(dest)
    }
    if (delaySend > 0.01) {
      const dlG  = ctx.createGain(); dlG.gain.value = delaySend * 0.8
      const dly  = ctx.createDelay(1.0); dly.delayTime.value = 0.25
      const dlFb = ctx.createGain(); dlFb.gain.value = 0.35
      cur.connect(dlG); dlG.connect(dly)
      dly.connect(dlFb); dlFb.connect(dly)
      dly.connect(dest)
    }
    return
  }

  cur.connect(dest)
}

// Convenience: destructure the shared module params from a params object
export function extractModuleParams({
  drive    = null, crunch  = 0,     distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}) {
  return { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend }
}
