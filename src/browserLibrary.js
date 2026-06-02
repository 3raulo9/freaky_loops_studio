// ──────────────────────────────────────────────────────────────────────────
//  Browser asset library — a curated set of real, working synth samples.
//
//  No random placeholders: every entry is a hand-tuned DSP voice (`spec`) that
//  renders a distinct, usable sound. The same spec drives the browser preview
//  and any channel you drag it into, and is serialized with the project.
// ──────────────────────────────────────────────────────────────────────────

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12)
const saw = ph => 2 * (ph - Math.floor(ph + 0.5))
const sqr = ph => (ph - Math.floor(ph)) < 0.5 ? 1 : -1
const clampDb = x => Math.max(-1, Math.min(1, x))

const DEFAULT_DUR = { kick: 0.5, sub808: 0.9, snare: 0.3, clap: 0.35, hat: 0.1, openhat: 0.45, tom: 0.45, bass: 0.55, pluck: 0.6, pad: 1.6, lead: 0.7, riser: 1.2, impact: 0.9, perc: 0.3 }

export function sampleDuration(spec) {
  return spec.dur ?? DEFAULT_DUR[spec.engine] ?? 0.5
}

// Render a voice into a mono Float32Array. Pure DSP — no AudioContext needed.
export function fillSample(d, sr, spec) {
  const E = spec.engine
  const N = d.length
  const dur = N / sr
  const rnd = mulberry32(spec.seed ?? 12345)
  let ph = 0, ph2 = 0, lp = 0

  for (let i = 0; i < N; i++) {
    const t = i / sr
    let s = 0

    if (E === 'kick') {
      const { f0 = 50, f1 = 180, pDecay = 0.03, aDecay = 0.18, click = 0.15, drive = 1.3 } = spec
      const f = f0 + (f1 - f0) * Math.exp(-t / pDecay)
      ph += f / sr
      s = Math.sin(2 * Math.PI * ph) * Math.exp(-t / aDecay)
      if (t < 0.006) s += (rnd() * 2 - 1) * click * (1 - t / 0.006)
      s = Math.tanh(s * drive)

    } else if (E === 'sub808') {
      const { note = 33, aDecay = 0.6, drive = 1.5, click = 0.06 } = spec
      const f = midiToFreq(note)
      ph += f / sr
      s = Math.tanh(Math.sin(2 * Math.PI * ph) * drive) * Math.exp(-t / aDecay)
      if (t < 0.004) s += (rnd() * 2 - 1) * click

    } else if (E === 'snare') {
      const { tone = 190, noiseDecay = 0.12, toneDecay = 0.09, snap = 0.6 } = spec
      const ne = Math.exp(-t / noiseDecay), te = Math.exp(-t / toneDecay)
      ph += tone / sr; ph2 += (tone * 1.6) / sr
      const body = (Math.sin(2 * Math.PI * ph) + 0.6 * Math.sin(2 * Math.PI * ph2)) * te * (1 - snap)
      s = (rnd() * 2 - 1) * ne * snap + body * 1.1

    } else if (E === 'clap') {
      const { decay = 0.13, bursts = 3, spread = 0.011 } = spec
      let env = 0
      for (let bI = 0; bI < bursts; bI++) {
        const bt = t - bI * spread
        if (bt >= 0) env = Math.max(env, Math.exp(-bt / 0.008))
      }
      env = Math.max(env, Math.exp(-t / decay) * 0.45)
      const n = rnd() * 2 - 1
      lp += (n - lp) * 0.55                 // bandpass-ish (keep highs)
      s = (n - lp) * env

    } else if (E === 'hat' || E === 'openhat') {
      const { decay = E === 'openhat' ? 0.35 : 0.045, metallic = 0.35 } = spec
      let n = rnd() * 2 - 1
      if (metallic > 0) n += metallic * (Math.sign(Math.sin(2 * Math.PI * 6300 * t)) + Math.sign(Math.sin(2 * Math.PI * 8200 * t))) * 0.25
      lp += (n - lp) * 0.15                 // remove lows → high-passed noise
      s = (n - lp) * Math.exp(-t / decay)

    } else if (E === 'tom' || E === 'perc') {
      const { f0 = 120, f1 = 200, aDecay = 0.25, pDecay = 0.05, noise = 0 } = spec
      const f = f0 + (f1 - f0) * Math.exp(-t / pDecay)
      ph += f / sr
      s = Math.sin(2 * Math.PI * ph) * Math.exp(-t / aDecay)
      if (noise > 0) s += (rnd() * 2 - 1) * noise * Math.exp(-t / 0.03)

    } else if (E === 'bass') {
      const { note = 36, aDecay = 0.4, cutoff = 0.28 } = spec
      const f = midiToFreq(note)
      ph += f / sr
      const env = Math.exp(-t / aDecay)
      const co = cutoff * (0.25 + 0.75 * env)
      lp += (saw(ph) - lp) * co
      s = lp * env * 1.2

    } else if (E === 'pluck') {
      const { note = 60, aDecay = 0.22, cutoff = 0.45, wave = 'saw' } = spec
      const f = midiToFreq(note)
      ph += f / sr
      const env = Math.exp(-t / aDecay)
      const co = cutoff * (0.2 + 0.8 * env)
      lp += ((wave === 'square' ? sqr(ph) : saw(ph)) - lp) * co
      s = lp * env

    } else if (E === 'pad') {
      const { note = 60, attack = 0.35, release = 0.9, detune = 8 } = spec
      const ds = detune / 1200
      const aEnv = Math.min(1, t / attack)
      const rEnv = Math.min(1, (dur - t) / release)
      const env = aEnv * Math.max(0, rEnv)
      const fr = [midiToFreq(note), midiToFreq(note + 7), midiToFreq(note + 12)]
      let acc = 0
      for (const f of fr) acc += Math.sin(2 * Math.PI * f * (1 + ds) * t) + Math.sin(2 * Math.PI * f * (1 - ds) * t)
      s = (acc / (fr.length * 2)) * env

    } else if (E === 'lead') {
      const { note = 64, aDecay = 0.5, wave = 'square', vibrato = 5 } = spec
      const f = midiToFreq(note) * (1 + 0.01 * Math.sin(2 * Math.PI * vibrato * t))
      ph += f / sr
      const env = Math.exp(-t / aDecay)
      lp += ((wave === 'saw' ? saw(ph) : sqr(ph)) - lp) * 0.45
      s = lp * env

    } else if (E === 'riser') {
      const p = t / dur
      const n = rnd() * 2 - 1
      lp += (n - lp) * (0.02 + 0.5 * p)
      const tone = Math.sin(2 * Math.PI * (180 + 1800 * p * p) * t) * 0.3
      s = ((n - lp) * 0.7 + tone) * Math.min(1, p * 4)

    } else if (E === 'impact') {
      ph += 58 / sr
      const boom = Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.3)
      s = (boom + (rnd() * 2 - 1) * Math.exp(-t / 0.05) * 0.5)

    } else {                                  // generic tone
      const { note = 60, aDecay = 0.4 } = spec
      ph += midiToFreq(note) / sr
      s = (Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph)) * Math.exp(-t / aDecay)
    }

    d[i] = clampDb(s) * 0.85
  }
}

// Tiny signed waveform for the browser row painter (rendered, not random).
function visualWave(spec) {
  const sr = 8000
  const len = Math.max(8, Math.ceil(sr * Math.min(0.5, sampleDuration(spec))))
  const tmp = new Float32Array(len)
  fillSample(tmp, sr, spec)
  const n = 48, out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = tmp[Math.min(len - 1, Math.floor((i / n) * len))]
  return out
}

// ── Curated library ───────────────────────────────────────────────────────────
//  Every entry is a synthesized voice (rendered live from its `spec`), so they
//  are labelled as synth instruments — not as audio files they aren't.
const LIBRARY = [
  { folder: 'Kicks', color: '#e74c3c', cat: 'kick', items: [
    ['Punch Kick',     { engine: 'kick', f0: 52, f1: 200, pDecay: 0.028, aDecay: 0.16, click: 0.18, drive: 1.4 }],
    ['Deep House Kick',{ engine: 'kick', f0: 46, f1: 130, pDecay: 0.04,  aDecay: 0.26, click: 0.06, drive: 1.1 }],
    ['Trap Kick',      { engine: 'kick', f0: 44, f1: 240, pDecay: 0.02,  aDecay: 0.34, click: 0.1,  drive: 1.6 }],
    ['Tight Kick',     { engine: 'kick', f0: 58, f1: 180, pDecay: 0.02,  aDecay: 0.1,  click: 0.22, drive: 1.5 }],
    ['Lo-Fi Kick',     { engine: 'kick', f0: 50, f1: 110, pDecay: 0.05,  aDecay: 0.2,  click: 0.04, drive: 0.9 }],
  ]},
  { folder: 'Snares & Claps', color: '#f39c12', cat: 'snare', items: [
    ['Acoustic Snare', { engine: 'snare', tone: 190, noiseDecay: 0.14, toneDecay: 0.1,  snap: 0.55 }],
    ['Trap Snare',     { engine: 'snare', tone: 240, noiseDecay: 0.1,  toneDecay: 0.06, snap: 0.72 }],
    ['Rim Snap',       { engine: 'snare', tone: 420, noiseDecay: 0.04, toneDecay: 0.03, snap: 0.5  }],
    ['808 Clap',       { engine: 'clap',  decay: 0.12, bursts: 3, spread: 0.011 }],
    ['Wide Clap',      { engine: 'clap',  decay: 0.18, bursts: 4, spread: 0.014 }],
  ]},
  { folder: 'Hi-Hats', color: '#f1c40f', cat: 'hat', items: [
    ['Closed Hat',     { engine: 'hat',     decay: 0.04, metallic: 0.3 }],
    ['Tight Hat',      { engine: 'hat',     decay: 0.025, metallic: 0.45 }],
    ['Open Hat',       { engine: 'openhat', decay: 0.32, metallic: 0.35 }],
    ['Metallic Hat',   { engine: 'hat',     decay: 0.07, metallic: 0.7 }],
  ]},
  { folder: 'Toms & Perc', color: '#1abc9c', cat: 'tone', items: [
    ['Low Tom',        { engine: 'tom', f0: 95,  f1: 150, aDecay: 0.32, pDecay: 0.06 }],
    ['Hi Tom',         { engine: 'tom', f0: 160, f1: 240, aDecay: 0.24, pDecay: 0.05 }],
    ['Conga',          { engine: 'perc', f0: 220, f1: 300, aDecay: 0.18, pDecay: 0.03, noise: 0.05 }],
    ['Wood Block',     { engine: 'perc', f0: 800, f1: 900, aDecay: 0.07, pDecay: 0.01, noise: 0.1 }],
  ]},
  { folder: '808 & Bass', color: '#e84393', cat: 'bass', items: [
    ['808 Sub A',      { engine: 'sub808', note: 33, aDecay: 0.7, drive: 1.4 }],
    ['808 Sub F',      { engine: 'sub808', note: 29, aDecay: 0.8, drive: 1.6 }],
    ['808 Distorted',  { engine: 'sub808', note: 31, aDecay: 0.6, drive: 3.2 }],
    ['Synth Bass',     { engine: 'bass', note: 36, aDecay: 0.4, cutoff: 0.3 }],
    ['Reese Bass',     { engine: 'bass', note: 31, aDecay: 0.7, cutoff: 0.5 }],
  ]},
  { folder: 'Plucks & Leads', color: '#9b59b6', cat: 'pluck', items: [
    ['Saw Pluck',      { engine: 'pluck', note: 60, aDecay: 0.22, cutoff: 0.45, wave: 'saw' }],
    ['Square Pluck',   { engine: 'pluck', note: 60, aDecay: 0.2,  cutoff: 0.5,  wave: 'square' }],
    ['Bell Pluck',     { engine: 'pluck', note: 72, aDecay: 0.35, cutoff: 0.8,  wave: 'saw' }],
    ['Synth Lead',     { engine: 'lead',  note: 64, aDecay: 0.6,  wave: 'saw',    vibrato: 5 }],
    ['Acid Lead',      { engine: 'lead',  note: 52, aDecay: 0.5,  wave: 'square', vibrato: 6 }],
  ]},
  { folder: 'Pads', color: '#3498db', cat: 'pad', items: [
    ['Warm Pad',       { engine: 'pad', note: 57, attack: 0.4, release: 1.0, detune: 7 }],
    ['String Pad',     { engine: 'pad', note: 60, attack: 0.25, release: 1.2, detune: 12 }],
    ['Glass Pad',      { engine: 'pad', note: 64, attack: 0.5, release: 0.8, detune: 5 }],
  ]},
  { folder: 'FX', color: '#95a5a6', cat: 'noise', items: [
    ['Riser',          { engine: 'riser', dur: 1.4 }],
    ['Impact',         { engine: 'impact' }],
    ['Noise Hit',      { engine: 'hat', decay: 0.18, metallic: 0.1 }],
  ]},
]

const assets = []
const assetMap = new Map()
const tokenIndex = new Map()
let sortedTokens = []
export const browserFolders = []

function addToken(tok, idx) {
  let arr = tokenIndex.get(tok)
  if (!arr) tokenIndex.set(tok, (arr = []))
  if (arr[arr.length - 1] !== idx) arr.push(idx)
}

;(function build() {
  let seed = 7
  LIBRARY.forEach((grp, gi) => {
    const folder = { id: 'fld-' + gi, name: grp.folder, count: grp.items.length, childIdx: [] }
    grp.items.forEach(([name, spec]) => {
      const idx = assets.length
      const fullSpec = { ...spec, seed: (seed += 101) }
      const asset = {
        id: 'a' + idx, idx,
        name,
        // These are live-synthesized instruments, not sample files.
        type: 'synth',
        cat: grp.cat, color: grp.color, spec: fullSpec,
        wave: visualWave(fullSpec),
      }
      assets.push(asset)
      assetMap.set(asset.id, asset)
      folder.childIdx.push(idx)
      asset.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).forEach(tok => addToken(tok, idx))
    })
    browserFolders.push(folder)
  })
  sortedTokens = [...tokenIndex.keys()].sort()
})()

export const browserAssetCount = assets.length
export function getAsset(id) { return assetMap.get(id) }
export function assetAt(idx) { return assets[idx] }

function lowerBound(prefix) {
  let lo = 0, hi = sortedTokens.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedTokens[mid] < prefix) lo = mid + 1; else hi = mid }
  return lo
}
function prefixMatches(prefix, out) {
  for (let i = lowerBound(prefix); i < sortedTokens.length && sortedTokens[i].startsWith(prefix); i++) {
    for (const idx of tokenIndex.get(sortedTokens[i])) out.add(idx)
  }
}

// Prefix search across all query terms (AND). Returns asset indexes.
export function searchAssets(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  let result = null
  for (const term of terms) {
    const ids = new Set()
    prefixMatches(term, ids)
    if (result == null) result = ids
    else { for (const id of result) if (!ids.has(id)) result.delete(id) }
    if (result.size === 0) break
  }
  return [...result].sort((a, b) => a - b)
}
