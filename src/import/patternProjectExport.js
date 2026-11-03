// Saving an imported pattern project back to its own format.
//
// The import keeps the original file plus a `link` from this app's ids to the
// file's (channel iids, pattern iids, mixer inserts, playlist items). Right
// after the import a `snapshot` of the project is taken in the file's units;
// at save time the same view is taken again and only what differs becomes an
// edit for the writer (crates/projfile write.rs). Everything else — and
// everything this app doesn't model — is copied from the original verbatim.

const NOTE_DEFAULTS = [64, 120, 64, 128, 128]   // pan, fine pitch, release, mod X, mod Y

const round = Math.round

/** One note row in file units: [ch, pos, len, key, vel, pan, fine, release, slide, modX, modY]. */
function noteRow(ch, n, link) {
  const x = n.flp ?? []
  const zeroLen = x[5] === 1
  return [
    ch,
    round(n.startTick / link.scale),
    zeroLen ? 0 : Math.max(1, round(n.durationTicks / link.scale)),
    n.pitch,
    Math.max(0, Math.min(128, round((n.velocity ?? 0.78) * 128))),
    x[0] ?? NOTE_DEFAULTS[0], x[1] ?? NOTE_DEFAULTS[1], x[2] ?? NOTE_DEFAULTS[2],
    n.slide ? 1 : 0,
    x[3] ?? NOTE_DEFAULTS[3], x[4] ?? NOTE_DEFAULTS[4],
  ]
}

function channelRows(ch, data, chRef, link) {
  if (!data) return []
  const rows = []
  if (ch.mode === 'steps' && Array.isArray(data.steps)) {
    data.steps.forEach((on, s) => {
      if (!on) return
      const v = data.stepVelocities?.[s] ?? 0.78
      rows.push([chRef, round((s * link.tps) / link.scale), 0, 60 + (data.stepPitches?.[s] ?? 0), Math.max(0, Math.min(128, round(v * 128))), ...NOTE_DEFAULTS.slice(0, 3), 0, ...NOTE_DEFAULTS.slice(3)])
    })
  } else {
    // Notes fanned out from a layer channel stay the layer's (it keeps its own).
    for (const n of data.pianoNotes ?? []) if (n.flpLayer == null) rows.push(noteRow(chRef, n, link))
  }
  rows.sort((a, b) => a[1] - b[1] || a[3] - b[3])
  return rows
}

/**
 * The project as the file sees it.
 * @param s     { bpm, totalSteps, channels, patterns, patternData, patternLengthOverrides,
 *                playlistTracks, playlistClips, automationClips, mixerTracks }
 * @param link  from the import
 * @param vstStates  channel id → current plugin state (tagged base64), when known
 */
export function projectView(s, link, vstStates = {}) {
  const chKey = id => (link.ch[id] != null ? String(link.ch[id]) : 'n' + id)
  const view = { tempo: s.bpm, stepsPerBar: s.totalSteps, channels: {}, newChannels: [], patterns: {}, items: [], inserts: {} }

  for (const ch of s.channels) {
    const mt = s.mixerTracks[ch.mixerTrack]
    const v = {
      name: ch.name, color: ch.color, volume: +(+ch.volume).toFixed(4), pan: +(+ch.pan).toFixed(4),
      mixer: mt && link.mx[mt.id] != null ? link.mx[mt.id] : 0, enabled: !ch.muted,
    }
    const linked = link.ch[ch.id] != null
    // A plugin's state only goes back when it's the build the file used.
    if (ch.type === 'vst' && (!linked || link.vstSameFormat?.[ch.id])) v.state = vstStates[ch.id] ?? ch.vstState ?? null
    if (linked) view.channels[chKey(ch.id)] = v
    else view.newChannels.push({ id: ch.id, type: ch.type, vstPath: ch.vstPath, vstClassId: ch.vstClassId, sampleName: ch.sampleName, ...v })
  }

  for (const p of s.patterns) {
    const notes = {}
    const pd = s.patternData[p.id] ?? {}
    for (const ch of s.channels) {
      const rows = channelRows(ch, pd[ch.id], link.ch[ch.id] ?? 'n' + ch.id, link)
      if (rows.length) notes[chKey(ch.id)] = JSON.stringify(rows)
    }
    const len = s.patternLengthOverrides?.[p.id]
    view.patterns[link.pat[p.id] != null ? String(link.pat[p.id]) : 'n' + p.id] = {
      id: p.id, name: p.name, color: p.color, length: len ? round(len / link.scale) : null, notes,
    }
  }

  const trackIndex = new Map(s.playlistTracks.map((t, i) => [t.id, i]))
  const barFL = link.barTicks / link.scale
  const stepFL = link.tps / link.scale
  for (const c of s.playlistClips) {
    const track = trackIndex.get(c.trackId) ?? 0
    const k = link.clips[c.id] ?? -1
    if (c.type === 'audio') {
      const o = link.items[k]
      if (!o) continue                       // a new audio clip has no channel in the file
      view.items.push({ k, row: [round(c.cell * barFL), round((c.width || 1) * barFL), track, 1, o[4], o[5], o[6], c.muted ? 1 : 0] })
      continue
    }
    const pat = link.pat[c.patternId] != null ? link.pat[c.patternId] : 'n' + c.patternId
    const slip = c.slipOffset ?? 0
    const lead = slip < 0 ? -slip * stepFL : 0
    const pos = round(c.cell * barFL + lead)
    const len = round((c.width || 1) * barFL - lead)
    const start = slip > 0 ? round(slip * stepFL) : 0
    view.items.push({ k, row: [pos, len, track, 0, pat, start, start + len, c.muted ? 1 : 0] })
  }
  for (const a of s.automationClips ?? []) {
    const k = link.autos[a.id] ?? -1
    const o = link.items[k]
    if (!o) continue
    const track = trackIndex.get(a.trackId) ?? 0
    view.items.push({ k, row: [round(a.cell * barFL), round(a.width * barFL), track, 1, o[4], o[5], o[6], 0] })
  }
  view.items.sort((a, b) => a.row[0] - b.row[0] || a.row[2] - b.row[2])

  for (const mt of s.mixerTracks) {
    if (link.mx[mt.id] == null) continue
    view.inserts[link.mx[mt.id]] = { name: mt.name, color: mt.color, volume: +(+mt.volume).toFixed(4), pan: +(+mt.pan).toFixed(4), muted: !!mt.muted }
  }
  return view
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Fields of `b` that differ from `a`. */
function changed(a, b, keys) {
  const out = {}
  for (const k of keys) if (!same(a?.[k], b[k])) out[k] = b[k]
  return out
}

/**
 * Edits that turn the snapshot into `now`, plus notes on what can't be saved.
 * @returns { edits, notes: string[] }
 */
export function buildEdits(snapshot, now, link) {
  const edits = {}
  const notes = []
  if (now.tempo !== snapshot.tempo) edits.tempo = now.tempo
  if (now.stepsPerBar !== snapshot.stepsPerBar && now.stepsPerBar % 4 === 0) edits.timeSig = [now.stepsPerBar / 4, 4]

  // Channels.
  const chEdits = {}
  for (const [iid, v] of Object.entries(now.channels)) {
    const d = changed(snapshot.channels[iid], v, ['name', 'color', 'volume', 'pan', 'mixer', 'enabled', 'state'])
    if (d.state === null) delete d.state
    if (Object.keys(d).length) chEdits[iid] = d
  }
  if (Object.keys(chEdits).length) edits.channels = chEdits
  const gone = Object.keys(snapshot.channels).filter(iid => !now.channels[iid]).map(Number)
  if (gone.length) edits.deleteChannels = gone
  const newRef = new Map()        // 'n' + our id → -1 - k
  if (now.newChannels.length) {
    edits.newChannels = now.newChannels.map((c, k) => {
      newRef.set('n' + c.id, -1 - k)
      const base = { name: c.name, color: c.color, volume: c.volume, pan: c.pan, mixer: c.mixer }
      if (c.type === 'vst' && c.vstPath) {
        return { ...base, kind: 'vst', vst: { path: c.vstPath, name: c.name, state: c.state ?? undefined, guid: c.vstClassId } }
      }
      if (c.type !== 'audiofile') notes.push(`"${c.name}" uses an instrument the file format doesn't have — saved as an empty sampler channel with its notes.`)
      else notes.push(`"${c.name}": the sample isn't linked by path — load it again in the other app.`)
      return { ...base, kind: 'sampler' }
    })
  }
  const ref = r => (typeof r === 'string' && r.startsWith('n') ? newRef.get(r) : r)
  const rowsOf = json => JSON.parse(json).map(row => [ref(row[0]), ...row.slice(1)])

  // Patterns.
  const patEdits = {}
  const newPats = []
  const patIid = new Map()
  let nextPat = link.maxPat + 1
  for (const [key, p] of Object.entries(now.patterns)) {
    if (key.startsWith('n')) {
      const iid = nextPat++
      patIid.set(key, iid)
      newPats.push({ iid, name: p.name, color: p.color, length: p.length ?? undefined, rows: Object.values(p.notes).flatMap(rowsOf) })
      continue
    }
    const was = snapshot.patterns[key]
    const e = changed(was, p, ['name', 'color', 'length'])
    if (e.length === null) delete e.length
    const keys = new Set([...Object.keys(was?.notes ?? {}), ...Object.keys(p.notes)])
    const dirty = [...keys].filter(k => was?.notes?.[k] !== p.notes[k])
    if (dirty.length) {
      const keep = [...link.foreign, ...[...keys].filter(k => !dirty.includes(k) && !k.startsWith('n')).map(Number)]
      e.notes = { keep, rows: dirty.flatMap(k => (p.notes[k] ? rowsOf(p.notes[k]) : [])) }
    }
    if (Object.keys(e).length) patEdits[key] = e
  }
  if (Object.keys(patEdits).length) edits.patterns = patEdits
  if (newPats.length) edits.newPatterns = newPats
  const deadPats = Object.keys(snapshot.patterns).filter(k => !k.startsWith('n') && !now.patterns[k]).map(Number)
  if (deadPats.length) edits.deletePatterns = deadPats

  // Playlist: untouched items keep their original records.
  if (!same(snapshot.items, now.items) && link.arr != null) {
    const piecesOf = list => {
      const m = new Map()
      for (const it of list) if (it.k >= 0) m.set(it.k, [...(m.get(it.k) ?? []), JSON.stringify(it.row)])
      return m
    }
    const was = piecesOf(snapshot.items)
    const cur = piecesOf(now.items)
    const out = []
    const emitted = new Set()
    for (const it of now.items) {
      // An item whose pieces are all as imported goes back as its original record.
      if (it.k >= 0 && same(was.get(it.k), cur.get(it.k))) {
        if (!emitted.has(it.k)) out.push({ o: it.k })
        emitted.add(it.k)
        continue
      }
      const row = it.row.slice()
      if (row[3] === 0 && typeof row[4] === 'string') row[4] = patIid.get(row[4])
      if (row[4] == null) continue
      // The first piece reuses the original record (its id and settings).
      const first = it.k >= 0 && !emitted.has(it.k)
      if (first) emitted.add(it.k)
      out.push([...row, first ? it.k : -1])
    }
    // Items the app never showed (unsupported kinds) stay as they were.
    for (const k of link.unmapped) out.push({ o: k })
    edits.arrangement = { iid: link.arr, items: out }
  }

  // Mixer inserts.
  const insEdits = {}
  for (const [i, v] of Object.entries(now.inserts)) {
    const d = changed(snapshot.inserts[i], v, ['name', 'color', 'volume', 'pan', 'muted'])
    if (Object.keys(d).length) insEdits[i] = d
  }
  if (Object.keys(insEdits).length) edits.inserts = insEdits

  return { edits, notes }
}
