// Map a parsed .flp pattern project (the JSON from crates/projfile, via
// WebAssembly) onto this app's saved-project format, so the normal project
// loader (_applyProject) does the rest. Pure data in, data out — the store
// handles parsing, asset resolution and loading samples/plugins afterwards.
//
// The file's world → ours:
//   channels        → channels (sampler / hosted plugin / substitute instrument)
//   layer channels  → their notes copied onto each child channel
//   patterns        → patterns (piano notes; one-bar drum patterns → steps)
//   playlist items  → pattern clips, audio clips, automation clips
//   mixer inserts   → mixer inserts that are actually used (+ effects by kind)

const TPQ = 480           // our ticks per quarter note
const TPS = TPQ / 4       // ticks per step (a 16th)

export const AUDIO_EXT = /\.(wav|mp3|ogg|flac|aif|aiff|wv|m4a)$/i

const PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a']

export const baseName = p => String(p ?? '').replace(/^.*[\\/]/, '')

// ── Instrument substitution by words in the channel / plugin name ────────────
// Ordered: first match wins. Drums map to the drum synths, everything else to
// the closest FM voice; plain "synth"-ish names fall through to the saw synth.
const DRUM_WORDS = [
  [/kick|\bbd\b|bass ?drum/, 'kick'],
  [/snare|\brim|clap|\bsd\b/, 'snare'],
  [/crash|cymbal|ride|splash/, 'clash'],
  [/hat|\bhh\b|\boh\b|\bch\b|shaker|tamb/, 'hihat'],
]
const VOICE_WORDS = [
  [/808|\bsub\b|bass/, 'bass'],
  [/rhodes|e\.? ?piano|electric piano|\bep\b|keys|piano/, 'rhodes'],
  [/wurl/, 'wurly'],
  [/organ/, 'organ'],
  [/string|violin|viola|ensemble/, 'strings'],
  [/cello/, 'cello'],
  [/pad|atmos|ambien|drone|texture|sweep/, 'pad'],
  [/choir|vox|voice|vocal|aah|ooh/, 'choir'],
  [/bell|chime|glock|celest|music ?box/, 'bell'],
  [/marimba|xylo|mallet|kalimba/, 'marimba'],
  [/pluck|harp|pizz/, 'pluck'],
  [/guitar|gtr/, 'guitar'],
  [/brass|horn|trumpet|trombone/, 'brass'],
  [/flute|whistle|pan ?pipe|recorder/, 'flute'],
  [/sax|clarinet|oboe|reed/, 'clarinet'],
  [/wobble|growl|dubstep/, 'wobble'],
  [/clav/, 'clav'],
]

/** Pick a stand-in instrument for a channel whose generator can't be hosted. */
export function pickSubstitute(text, fmKeys) {
  const t = text.toLowerCase()
  for (const [re, kind] of DRUM_WORDS) if (re.test(t)) return { drum: kind }
  if (/perc|tom|conga|bongo|drum|\bkit\b|beat/.test(t)) return { drum: 'snare' }
  for (const [re, key] of VOICE_WORDS) if (re.test(t) && fmKeys.includes(key)) return { fm: key }
  return { melodic: true }
}

// ── Effects by words in the plugin name ──────────────────────────────────────
const FX_WORDS = [
  [/meter|scope|spectr|analy|tuner|candy|edison|recorder|controller|peak ctrl|patcher|gross|vocod|pitcher|newtone|wave ?trav/, null],
  [/ping.?pong/, 'pingpong'],
  [/re+verb|plate|\bhall\b|\broom\b|convol|space/, 'reverb'],
  [/delay|echo/, 'delay'],
  [/flang/, 'flanger'],
  [/phas/, 'phaser'],
  [/chorus|ensemble/, 'chorus'],
  [/stereo|wide|widen|imager|enhanc|dimension|shaper.*stereo/, 'dimension'],
  [/limit|clipper|\bclip\b|maxim/, 'limiter'],
  [/compress|squash|multiband|dynamic|transient|soundgood|glue|\bcomp\b/, 'compressor'],
  [/bit ?crush|decimat|lo.?fi|redux/, 'bitcrusher'],
  [/dist|drive|overdrive|saturat|waveshap|fuzz|\bamp\b|blood|tube|tape/, 'distortion'],
  [/high ?pass|\bhpf?\b|low ?cut/, 'highpass'],
  [/filter|\blpf?\b|low ?pass|philter|formant|\bfast lp\b/, 'autofilter'],
  [/\beq\b|equali|param/, 'eq3'],
  [/\bgate\b|trance/, 'gate'],
  [/\bpan/, 'autopan'],
]

export function pickEffect(text) {
  const t = text.toLowerCase()
  for (const [re, type] of FX_WORDS) if (re.test(t)) return { type, matched: true }
  return { type: null, matched: false }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

/**
 * @param P     parsed project (projfile JSON)
 * @param env   {
 *   desktop: bool,
 *   resolveSample(path) → string | null   (a URL/key the store can load),
 *   resolveVst(vst)     → { path } | null  (desktop plugin index hit),
 *   lib: { fmPresets, drumPresets, gmParams, gmKnobs, gmColor, gmSustains, makeEffect, effectDefs },
 * }
 * @returns { project, jobs: { samples: [{ kind, id, key, ... }] }, report }
 */
/**
 * A framework state blob (base64) in the tagged form the desktop host loads:
 * VST3 → '3' + u32 component length + component (no controller state),
 * VST2 → 'C' + chunk.
 */
function portableVstState(b64, format) {
  const blob = atob(b64)
  if (format === 'vst3') {
    const n = blob.length
    return btoa('3' + String.fromCharCode(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255) + blob)
  }
  return btoa('C' + blob)
}

export function mapPatternProject(P, env) {
  const { lib } = env
  const report = {
    version: P.version, tempo: P.tempo,
    channels: 0, patterns: 0, clips: 0, audioClips: 0, automationClips: 0, inserts: 0,
    plugins: [], substituted: [], samplesMissing: [], effectsMapped: 0, effectsSkipped: [],
    automationUnassigned: 0, notes: [],
  }
  const jobs = { samples: [] }
  // How this app's ids map back to the file's, for saving back to it.
  const link = {
    ch: {}, foreign: [], pat: {}, mx: {}, clips: {}, autos: {}, items: {}, unmapped: [],
    vstSameFormat: {}, arr: null, maxPat: 0, ppq: 0, scale: 1, barTicks: 0, tps: TPS,
  }

  const ppq = P.ppq || 96
  const scale = TPQ / ppq
  const [num, den] = P.timeSig?.length === 2 ? P.timeSig : [4, 4]
  const stepsPerBar = clamp(Math.round((num * 16) / (den || 4)), 1, 64)
  const barTicks = stepsPerBar * TPS            // ours
  const flBar = barTicks / scale                 // theirs
  if (num !== 4 || den !== 4) report.notes.push(`Time signature ${num}/${den}: bars are ${stepsPerBar} steps.`)

  const chByIid = new Map(P.channels.map(c => [c.iid, c]))
  const fmKeys = Object.keys(lib.fmPresets)

  // ── Mixer: keep master + inserts that matter, renumbered ───────────────────
  const inserts = P.inserts ?? []
  const used = new Set([0])
  for (const c of P.channels) if (c.mixer != null && c.mixer > 0) used.add(c.mixer)
  for (const t of inserts) if (t.index > 0 && (t.slots.length || t.name)) used.add(t.index)
  // Follow routing so buses fed by used inserts come along.
  for (let pass = 0; pass < 4; pass++) {
    for (const t of inserts) if (used.has(t.index)) for (const r of t.routes) if (r > 0) used.add(r)
  }
  const mxOrder = [...used].filter(i => i === 0 || inserts.some(t => t.index === i)).sort((a, b) => a - b)
  const mxIndex = new Map(mxOrder.map((fl, i) => [fl, i]))      // file insert → our index
  mxOrder.forEach((fl, i) => { link.mx['mx' + i] = fl })
  const mixerTracks = mxOrder.map((fl, i) => {
    const t = inserts.find(x => x.index === fl) ?? { name: '', volume: 1, pan: 0, slots: [], routes: [] }
    const fxSlots = []
    for (const s of t.slots ?? []) {
      const pl = s.plugin
      const label = pl.vst?.name || pl.internal || pl.name
      // A plugin effect that's installed runs as itself (in the engine, desktop).
      const hit = pl.vst && env.desktop ? env.resolveVst(pl.vst) : null
      if (hit) {
        const sameFormat = (hit.format ?? 'vst2') === (pl.vst.format ?? 'vst2')
        fxSlots.push({
          type: 'vst', enabled: s.enabled !== false, label, importedFrom: label,
          uid: `fx${fl}-${fxSlots.length}-${Math.random().toString(36).slice(2, 7)}`,
          vstPath: hit.path, vstState: sameFormat ? pl.vst.state ?? undefined : undefined,
          vstClassId: hit.format === 'vst3' && sameFormat && pl.vst.guid ? pl.vst.guid : undefined,
        })
        const status = hit.arch === 'x86' ? 'effect found, but 32-bit effects cannot run on an insert yet'
          : sameFormat && pl.vst.state ? 'effect loaded with its settings' : 'effect loaded'
        report.plugins.push({ name: label, status, path: hit.path })
        report.effectsMapped++
        continue
      }
      const { type } = pickEffect(`${pl.internal} ${pl.name} ${pl.vst?.name ?? ''}`)
      if (!type || !lib.effectDefs[type]) { report.effectsSkipped.push(label); continue }
      const fx = lib.makeEffect(type)
      fx.enabled = s.enabled !== false
      fx.importedFrom = label
      fxSlots.push(fx)
      report.effectsMapped++
    }
    const outs = (t.routes ?? []).filter(r => r !== fl)
    const toBus = outs.find(r => r > 0 && mxIndex.has(r))
    return {
      id: 'mx' + i,
      name: i === 0 ? 'MASTER' : (t.name || `INSERT ${fl}`).slice(0, 24),
      kind: i === 0 ? 'master' : 'insert',
      color: t.color || PALETTE[i % PALETTE.length],
      volume: clamp(t.volume ?? 1, 0, 1.25),
      pan: clamp(t.pan ?? 0, -1, 1),
      muted: !!t.muted,
      eq: { low: 0, mid: 0, high: 0 },
      fxSlots,
      phaseInvert: !!t.polarity,
      sends: {},
      output: i > 0 && toBus != null && !outs.includes(0) ? 'mx' + mxIndex.get(toBus) : null,
    }
  })
  // Keep the two send returns every project has.
  for (let r = 0; r < 2; r++) {
    mixerTracks.push({
      id: 'mxr' + r, name: 'RETURN ' + 'AB'[r], kind: 'return', color: '#7f8c8d', volume: 1, pan: 0, muted: false,
      eq: { low: 0, mid: 0, high: 0 }, fxSlots: r === 0 ? [lib.makeEffect('reverb')] : [lib.makeEffect('delay')],
      phaseInvert: false, sends: {}, output: null,
    })
  }
  report.inserts = mixerTracks.length - 3

  // ── Channels ──────────────────────────────────────────────────────────────
  const ourId = new Map()             // file channel iid → our channel id
  const channels = []
  let nextId = 1
  const layerChildren = new Map()     // layer iid → child iids
  for (const c of P.channels) {
    if (c.kind === 'layer') { layerChildren.set(c.iid, c.children ?? []); continue }
    if (c.kind === 'audioclip' || c.kind === 'automation') continue
    const id = String(nextId++)
    ourId.set(c.iid, id)
    const name = (c.name || c.plugin?.internal || 'Channel').trim()
    const base = {
      id, name: name.slice(0, 24), color: c.color || PALETTE[channels.length % PALETTE.length],
      mode: 'piano', volume: clamp(c.volume ?? 0.78, 0, 1.25), pan: clamp(c.pan ?? 0, -1, 1),
      mixerTrack: mxIndex.get(c.mixer ?? 0) ?? 0, muted: c.enabled === false,
      zipped: false, loopEnabled: false, loopLength: 16, cutSelf: false, swingMix: 1, groupId: null,
      activeModules: [], effects: [],
    }
    const pl = c.plugin ?? {}
    const sf2 = (pl.paths ?? []).find(p => /\.sf2$/i.test(p))
    const pluginSample = (pl.paths ?? []).find(p => AUDIO_EXT.test(p))
    const samplePath = c.sample || (c.kind === 'generator' ? pluginSample : '') || ''

    if (pl.vst) {
      const hit = env.desktop ? env.resolveVst(pl.vst) : null
      if (hit) {
        // A VST2 and a VST3 build save different states: only pass the state on
        // when the installed build is the one the project used.
        const sameFormat = (hit.format ?? 'vst2') === (pl.vst.format ?? 'vst2')
        link.vstSameFormat[id] = sameFormat
        const state = sameFormat ? pl.vst.state ?? undefined : undefined
        channels.push({
          ...base, type: 'vst', vstPath: hit.path, vstState: state,
          vstClassId: hit.format === 'vst3' && sameFormat && pl.vst.guid ? pl.vst.guid : undefined,
          instrumentType: 'vst', params: { pitch: 60 }, knobs: [], fnKey: 'melodic', sustains: true,
        })
        const status = !sameFormat ? `loaded (${hit.format === 'vst3' ? 'VST3' : 'VST2'} build, default sound)`
          : state ? 'loaded with its settings' : 'loaded'
        report.plugins.push({ name: pl.vst.name || name, status, path: hit.path })
        continue
      }
      report.plugins.push({ name: pl.vst.name || name, status: env.desktop ? 'not installed — stand-in used' : 'needs the desktop app — stand-in used', path: pl.vst.path })
    }

    if (c.kind === 'sampler' || (!pl.vst && pluginSample && !sf2)) {
      channels.push({
        ...base, type: 'audiofile', instrumentType: 'audiofile', sampleName: baseName(samplePath) || name,
        params: {
          pitch: 60, rootNote: c.rootNote ?? 60, fineTune: Math.round((c.pitchCents ?? 0)) / 100, keyTrack: 1,
          startOffset: 0, endOffset: 1, reverse: !!c.reversed,
          envDelay: 0, envAttack: 0.001, envDecay: 0.1, envSustain: 1, envRelease: 0.05,
        },
        knobs: [{ key: 'pitch', label: 'NOTE', min: 0, max: 127, decimals: 0 }],
        fnKey: 'melodic', sustains: false,
      })
      if (samplePath) jobs.samples.push({ kind: 'channel', id, path: samplePath })
      continue
    }

    // Sound-font player: the font itself when it's on this machine (desktop).
    const sf2Here = sf2 && env.desktop ? env.resolvePath?.(sf2) : null
    if (sf2Here) {
      const prog = clamp(pl.program ?? 0, 0, 127)
      channels.push({
        ...base, type: 'sf2', instrumentType: 'sf2',
        params: { pitch: 60, sf2Path: sf2Here, sf2Bank: 0, sf2Program: prog },
        knobs: [], fnKey: 'melodic', sustains: true,
      })
      report.plugins.push({ name: `${name} (${baseName(sf2)})`, status: 'sound font loaded', path: sf2Here })
      continue
    }
    if (sf2) {
      const prog = clamp(pl.program ?? 0, 0, 127)
      channels.push({
        ...base, type: 'gm', instrumentType: 'gm', color: c.color || lib.gmColor(prog),
        params: lib.gmParams(prog), knobs: lib.gmKnobs(), fnKey: 'melodic', sustains: lib.gmSustains(prog),
      })
      report.substituted.push({ name, as: `General MIDI #${prog + 1} (sound font ${baseName(sf2)})` })
      continue
    }

    // A native-format generator: use a VST build of the same plugin when one
    // is installed. Plugins made with the common plugin framework keep their
    // settings in a blob both builds read, so those come back as saved;
    // anything else starts from the plugin's defaults.
    const native = env.desktop && pl.internal ? env.resolveNative?.(pl.internal) : null
    if (native) {
      const state = pl.portableState ? portableVstState(pl.portableState, native.format) : undefined
      channels.push({
        ...base, type: 'vst', vstPath: native.path, vstState: state,
        instrumentType: 'vst', params: { pitch: 60 }, knobs: [], fnKey: 'melodic', sustains: true,
      })
      report.plugins.push({ name: pl.internal, status: state ? 'loaded (VST build, with its settings)' : 'loaded (VST build, default sound)', path: native.path })
      continue
    }

    const sub = pickSubstitute(`${name} ${pl.internal ?? ''}`, fmKeys)
    if (sub.drum) {
      const d = lib.drumPresets[sub.drum] ?? lib.drumPresets.kick
      channels.push({ ...base, type: d.type, instrumentType: d.instrumentType, params: { ...d.params }, knobs: d.knobs.map(k => ({ ...k })), fnKey: sub.drum, sustains: false })
      report.substituted.push({ name, as: `${sub.drum} drum synth`, plugin: pl.vst?.name || pl.internal })
    } else if (sub.fm) {
      const f = lib.fmPresets[sub.fm]
      channels.push({ ...base, type: 'melodic', instrumentType: '', params: { ...f.params }, knobs: f.knobs.map(k => ({ ...k })), fnKey: 'fm:' + sub.fm, sustains: !!f.sustains })
      report.substituted.push({ name, as: f.name, plugin: pl.vst?.name || pl.internal })
    } else {
      channels.push({
        ...base, type: 'melodic', instrumentType: '', fnKey: 'melodic', sustains: true,
        params: { pitch: 60, decay: 0.4, attack: 0.01, wave: 'sawtooth' },
        knobs: [
          { key: 'pitch', label: 'NOTE', min: 24, max: 96, decimals: 0 },
          { key: 'decay', label: 'DECAY', min: 0.05, max: 2.0, decimals: 2 },
          { key: 'attack', label: 'ATCK', min: 0.001, max: 0.2, decimals: 3 },
        ],
      })
      report.substituted.push({ name, as: 'saw synth', plugin: pl.vst?.name || pl.internal })
    }
  }
  report.channels = channels.length

  // ── Patterns ──────────────────────────────────────────────────────────────
  // notes per (pattern, our channel), with layer notes fanned out to children.
  const patNotes = new Map()   // pid → Map(chId → notes[])
  const patLen = new Map()     // pid → length in our ticks (whole bars)
  const patterns = []
  // Patterns the playlist uses (empty, unused ones are leftovers — skip them).
  const usedPats = new Set()
  for (const a of P.arrangements ?? []) for (const it of a.items) if (it[3] === 0) usedPats.add(it[4])
  for (const pt of P.patterns ?? []) {
    if (!pt.notes.length && !usedPats.has(pt.iid)) continue
    const pid = 'p' + pt.iid
    const byCh = new Map()
    let end = 0
    const add = (iid, n) => {
      const id = ourId.get(iid)
      if (!id) return
      if (!byCh.has(id)) byCh.set(id, [])
      byCh.get(id).push(n)
    }
    for (const r of pt.notes) {
      const [chIid, pos, len, key, vel, pan, fine, release, slide, modX, modY] = r
      if (vel === 0) continue
      const n = {
        pitch: clamp(key, 0, 127), startTick: Math.round(pos * scale),
        durationTicks: len > 0 ? Math.max(1, Math.round(len * scale)) : TPS,
        velocity: clamp(vel / 128, 0, 1), step: len === 0,
      }
      // What the note carries beyond pitch/time/velocity, kept for saving back.
      const extra = [pan ?? 64, fine ?? 120, release ?? 64, modX ?? 128, modY ?? 128, len === 0 ? 1 : 0]
      if (extra.some((v, i) => v !== [64, 120, 64, 128, 128, 0][i])) n.flp = extra
      if (slide) n.slide = true
      if (fine != null && fine !== 120) n.fine = (fine - 120) / 100
      end = Math.max(end, n.startTick + n.durationTicks)
      const kids = layerChildren.get(chIid)
      if (kids) for (const k of kids) add(k, { ...n, layer: chIid })
      else add(chIid, n)
    }
    const declared = pt.length > 0 ? pt.length * scale : 0
    const len = Math.max(barTicks, Math.ceil(Math.max(end, declared) / barTicks) * barTicks)
    patLen.set(pid, len)
    patNotes.set(pid, byCh)
    patterns.push({ id: pid, name: pt.name || `Pattern ${pt.iid}`, color: pt.color || PALETTE[patterns.length % PALETTE.length] })
    link.pat[pid] = pt.iid
  }
  if (!patterns.length) { patterns.push({ id: 'p1', name: 'Pattern 1', color: PALETTE[0] }); patNotes.set('p1', new Map()); patLen.set('p1', barTicks) }
  report.patterns = patterns.length

  // A channel shows as steps when every note it has, in every pattern, is a
  // step hit inside a one-bar pattern (our step rows repeat each bar).
  const stepsOk = new Map(channels.map(c => [c.id, true]))
  const hasNotes = new Set()
  for (const [pid, byCh] of patNotes) for (const [id, notes] of byCh) {
    hasNotes.add(id)
    const ok = patLen.get(pid) <= barTicks && notes.every(n => n.step && n.startTick % TPS === 0 && n.startTick < barTicks && n.startTick / TPS < 32)
    if (!ok) stepsOk.set(id, false)
  }

  const patternData = {}
  for (const [pid, byCh] of patNotes) {
    patternData[pid] = {}
    for (const [id, notes] of byCh) {
      const ch = channels.find(c => c.id === id)
      if (ch && stepsOk.get(id) && hasNotes.has(id) && ch.type !== 'vst') {
        ch.mode = 'steps'
        const steps = Array(32).fill(false), vels = Array(32).fill(0.8), pitches = Array(32).fill(0)
        for (const n of notes) {
          const s = n.startTick / TPS
          steps[s] = true
          vels[s] = n.velocity
          pitches[s] = n.pitch - 60
        }
        patternData[pid][id] = { steps, pianoNotes: [], stepVelocities: vels, stepPitches: pitches }
      } else {
        patternData[pid][id] = {
          steps: Array(32).fill(false),
          pianoNotes: notes.map(n => ({
            pitch: n.pitch, startTick: n.startTick, durationTicks: n.durationTicks, velocity: n.velocity,
            ...(n.slide ? { slide: true } : {}), ...(n.flp ? { flp: n.flp } : {}), ...(n.layer != null ? { flpLayer: n.layer } : {}),
          })),
        }
      }
    }
  }
  const patternLengthOverrides = {}
  for (const [pid, len] of patLen) patternLengthOverrides[pid] = len

  // ── Playlist ──────────────────────────────────────────────────────────────
  const arrs = P.arrangements ?? []
  const arr = arrs.find(a => a.iid === P.currentArrangement && a.items.length) ?? arrs.find(a => a.items.length) ?? arrs[0]
  if (arrs.filter(a => a.items.length).length > 1) report.notes.push(`${arrs.filter(a => a.items.length).length} arrangements in the file — opened "${arr?.name || 'the current one'}".`)
  const items = arr?.items ?? []
  const maxTrack = items.reduce((m, it) => Math.max(m, it[2]), -1)
  const tracks = []
  for (let i = 0; i <= Math.max(maxTrack, 1); i++) {
    const t = arr?.tracks?.find(x => x.index === i)
    tracks.push({
      id: 'pt' + (i + 1), name: t?.name || `Track ${i + 1}`, color: t?.color || PALETTE[i % PALETTE.length],
      muted: t ? t.enabled === false : false, _soloed: false, locked: false, collapsed: false, groupParentId: null, height: 52,
    })
  }

  const playlistClips = []
  const automationClips = []
  let clipSeq = 0, autoSeq = 0
  const ctrlBySource = new Map((P.controllers ?? []).map(r => [r[0], r]))
  const secPerTick = 60 / (P.tempo || 120) / ppq

  items.forEach((it, k) => {
    const before = playlistClips.length + automationClips.length
    placeItem(it, k)
    if (playlistClips.length + automationClips.length === before) link.unmapped.push(k)
  })
  function placeItem(it, k) {
    const [pos, len, track, kind, ref, startOff, , muted] = it
    if (len <= 0) return
    const trackId = 'pt' + (track + 1)
    const sPos = pos * scale, sLen = len * scale
    if (kind === 0) {
      const pid = 'p' + ref
      if (!patNotes.has(pid)) return
      const plen = patLen.get(pid)
      // Long clips repeat their pattern: split at each repeat so every piece
      // plays from the right place. Mid-bar starts use a negative slip.
      let s = sPos, c = Math.max(0, (startOff ?? -1) > 0 ? startOff * scale : 0)
      const stop = sPos + sLen
      let guard = 0
      while (s < stop - 1 && guard++ < 512) {
        const inPat = c % plen
        const seg = Math.min(plen - inPat, stop - s)
        const cell = Math.floor(s / barTicks + 1e-9)
        const o = s - cell * barTicks
        const id = 'c' + (++clipSeq)
        link.clips[id] = k
        playlistClips.push({
          id, trackId, cell, width: Math.max(1, Math.ceil((o + seg) / barTicks - 1e-9)),
          patternId: pid, muted: !!muted, slipOffset: Math.round((inPat - o) / TPS),
        })
        s += seg; c += seg
      }
      return
    }
    const src = chByIid.get(ref)
    if (!src) return
    if (src.kind === 'audioclip' || (src.kind === 'sampler' && src.sample)) {
      const id = 'c' + (++clipSeq)
      link.clips[id] = k
      link.items[k] = it
      playlistClips.push({
        id, trackId, type: 'audio', cell: sPos / barTicks, width: Math.max(1, Math.ceil(sLen / barTicks)),
        sampleName: baseName(src.sample) || src.name, color: src.color || tracks[track]?.color, volume: clamp(src.volume / 0.78, 0, 2),
        startOffset: 0, endOffset: 1, muted: !!muted, warpEnabled: false, clipBpm: null, warpMode: 'complex',
        mixerTrack: mxIndex.get(src.mixer ?? 0) ?? 0,
      })
      jobs.samples.push({
        kind: 'clip', id, path: src.sample,
        startSec: Math.max(0, startOff ?? 0) * secPerTick, lenSec: len * secPerTick,
      })
      report.audioClips++
    } else if (src.kind === 'automation') {
      const ctl = ctrlBySource.get(src.iid)
      const tgt = automationTarget(ctl, ourId, mxIndex)
      if (!tgt) report.automationUnassigned++
      const trimBeats = Math.max(0, startOff ?? 0) / ppq
      const lenBeats = len / ppq
      let nodes = (src.automation ?? []).map(p => ({ x: (p.pos - trimBeats) / lenBeats, y: clamp(tgt ? tgt.map(p.value) : p.value, 0, 1), tension: clamp(p.tension ?? 0, -1, 1) }))
      nodes = trimNodes(nodes)
      if (!nodes.length) nodes = [{ x: 0, y: 0.5, tension: 0 }, { x: 1, y: 0.5, tension: 0 }]
      const aid = 'a' + (++autoSeq)
      link.autos[aid] = k
      link.items[k] = it
      automationClips.push({
        id: aid, trackId, cell: sPos / barTicks, width: Math.max(0.25, sLen / barTicks),
        targetChannelId: tgt?.id ?? null, targetParam: tgt?.param ?? 'volume', nodes, name: src.name,
      })
      report.automationClips++
    }
  }
  report.clips = playlistClips.length

  const timeMarkers = (arr?.markers ?? []).filter(m => !m.signature && !m.kind).map((m, i) => ({
    id: 'm' + (i + 1), cell: (m.pos * scale) / barTicks, label: m.name || `Marker ${i + 1}`, color: PALETTE[i % PALETTE.length],
  }))

  for (const [iid, id] of ourId) link.ch[id] = iid
  link.foreign = P.channels.filter(c => !ourId.has(c.iid)).map(c => c.iid)
  link.maxPat = (P.patterns ?? []).reduce((m, p) => Math.max(m, p.iid), 0)
  link.arr = arr ? arr.iid : null
  Object.assign(link, { ppq, scale, barTicks })

  const project = {
    version: 1,
    bpm: Math.round((P.tempo || 120) * 1000) / 1000,
    totalSteps: stepsPerBar,
    swing: 0,
    channels,
    channelGroups: [],
    patterns,
    patternData,
    patternLengthOverrides,
    currentPatternId: patterns[0].id,
    playlistTracks: tracks,
    playlistClips,
    timeMarkers,
    automationClips,
    mixerTracks,
  }
  return { project, jobs, report, link, usePlaylist: playlistClips.length > 0 || automationClips.length > 0 }
}

// Clamp a node list to the clip window [0, 1], interpolating the edges.
function trimNodes(nodes) {
  if (!nodes.length) return nodes
  const at = x => {
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i]
      if (x <= b.x) return b.x === a.x ? b.y : a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x))
    }
    return nodes[nodes.length - 1].y
  }
  const inside = nodes.filter(n => n.x > 0 && n.x < 1)
  return [{ x: 0, y: at(0), tension: 0 }, ...inside, { x: 1, y: at(1), tension: 0 }]
}

// Controller record [source, parameter, kind, a, b] → our automation target.
// kind 1 = channel (a = channel), 2 = mixer (a = insert, b = slot), 3 = project.
function automationTarget(ctl, ourId, mxIndex) {
  if (!ctl) return null
  const [, par, kind, a] = ctl
  if (kind === 1) {
    const id = ourId.get(a)
    if (!id) return null
    if (par === 0 || par === 0x11) return { id, param: 'volume', map: v => v / 1.25 }
    if (par === 1 || par === 0x10) return { id, param: 'pan', map: v => v }
    return null
  }
  if (kind === 2) {
    const i = mxIndex.get(a)
    if (i == null) return null
    if (i === 0 && par === 0x1fc0) return { id: '__master', param: 'volume', map: v => v }
    if (i > 0 && par === 0x1fc0) return { id: 'mx:mx' + i, param: 'volume', map: v => v }
    if (i > 0 && par === 0x1fc1) return { id: 'mx:mx' + i, param: 'pan', map: v => v }
    return null
  }
  if (kind === 3) {
    // Tempo clips span 60–180 BPM by default; ours span 40–220.
    if (par === 5) return { id: '__tempo', param: 'tempo', map: v => (60 + v * 120 - 40) / 180 }
    if (par === 0) return { id: '__master', param: 'volume', map: v => v }
  }
  return null
}
