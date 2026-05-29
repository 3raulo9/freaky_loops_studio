import { ref, reactive, computed } from 'vue'
import { playKick, playSnare, playHiHat, playClash } from '../audio/synths.js'
import { playMelodicNote } from '../audio/melodic.js'

// ─── Constants ─────────────────────────────────────────────────────────────────
export const PIANO_LOW   = 36
export const PIANO_HIGH  = 84
export const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
export const PIANO_KEYS  = Array.from({ length: PIANO_HIGH - PIANO_LOW + 1 }, (_, i) => PIANO_HIGH - i)
export const PLAYLIST_BARS  = 32
export const PLAYLIST_CELLS = 32

export function midiToLabel(m) { return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1) }
export function isBlackKey(m)  { return [1, 3, 6, 8, 10].includes(m % 12) }

const KB_SEMITONES = {
  KeyZ:0, KeyS:1, KeyX:2, KeyD:3, KeyC:4, KeyV:5, KeyG:6, KeyB:7, KeyH:8, KeyN:9, KeyJ:10, KeyM:11,
  KeyQ:12, Digit2:13, KeyW:14, Digit3:15, KeyE:16, KeyR:17, Digit5:18, KeyT:19, Digit6:20, KeyY:21, Digit7:22, KeyU:23, KeyI:24,
}

// ─── Channel factory ───────────────────────────────────────────────────────────
let _cid = 0
const COLORS = ['#e74c3c','#f39c12','#2ecc71','#9b59b6','#4ecdc4','#e67e22','#1abc9c','#e91e63','#3498db','#16a085']

function makeChannel(overrides = {}) {
  return reactive({
    id:    String(++_cid),
    name:  'SYNTH',
    color: '#4ecdc4',
    type:  'melodic',
    mode:  'piano',
    volume:     0.8,
    pan:        0,
    mixerTrack: 0,
    muted:      false,
    _soloed:    false,
    params: { pitch: 60, decay: 0.4, attack: 0.01, wave: 'sawtooth' },
    knobs: [
      { key: 'pitch',  label: 'NOTE',  min: 24,   max: 96,  decimals: 0 },
      { key: 'decay',  label: 'DECAY', min: 0.05, max: 2.0, decimals: 2 },
      { key: 'attack', label: 'ATCK',  min: 0.001, max: 0.2, decimals: 3 },
    ],
    fn: playMelodicNote,
    ...overrides,
  })
}

// ─── Singleton store ───────────────────────────────────────────────────────────
let _store = null

export function useStudio() {
  if (_store) return _store

  // ── Channels (instrument definitions, no step data here) ─────────────────────
  const channels = reactive([
    makeChannel({
      name: 'KICK', color: '#e74c3c', type: 'drum', mode: 'steps', volume: 0.9,
      params: { pitch: 60, decay: 0.55, punch: 0.65 },
      knobs: [
        { key: 'pitch', label: 'PITCH', min: 30,  max: 140, decimals: 0 },
        { key: 'decay', label: 'DECAY', min: 0.15, max: 1.6, decimals: 2 },
        { key: 'punch', label: 'PUNCH', min: 0,   max: 1,   decimals: 2 },
      ],
      fn: playKick,
    }),
    makeChannel({
      name: 'SNARE', color: '#f39c12', type: 'drum', mode: 'steps', volume: 0.8,
      params: { snap: 0.7, tone: 210, decay: 0.28 },
      knobs: [
        { key: 'snap',  label: 'SNAP',  min: 0,   max: 1,   decimals: 2 },
        { key: 'tone',  label: 'TONE',  min: 80,  max: 700, decimals: 0 },
        { key: 'decay', label: 'DECAY', min: 0.04, max: 0.9, decimals: 2 },
      ],
      fn: playSnare,
    }),
    makeChannel({
      name: 'HI-HAT', color: '#2ecc71', type: 'drum', mode: 'steps', volume: 0.65,
      params: { decay: 0.07, tone: 0.5, mix: 0.75 },
      knobs: [
        { key: 'decay', label: 'DECAY', min: 0.01, max: 0.45, decimals: 2 },
        { key: 'tone',  label: 'TONE',  min: 0,   max: 1,   decimals: 2 },
        { key: 'mix',   label: 'MIX',   min: 0,   max: 1,   decimals: 2 },
      ],
      fn: playHiHat,
    }),
    makeChannel({
      name: 'CLASH', color: '#9b59b6', type: 'drum', mode: 'steps', volume: 0.7,
      params: { decay: 1.2, tone: 0.45, ring: 0.4 },
      knobs: [
        { key: 'decay', label: 'DECAY', min: 0.2, max: 4.0, decimals: 2 },
        { key: 'tone',  label: 'TONE',  min: 0,   max: 1,   decimals: 2 },
        { key: 'ring',  label: 'RING',  min: 0,   max: 1,   decimals: 2 },
      ],
      fn: playClash,
    }),
  ])

  // ── Pattern system ─────────────────────────────────────────────────────────────
  // patterns[]: metadata (id, name, color)
  // patternData[patternId][channelId] = { steps: bool[], pianoNotes: Note[] }
  let _pid = 0
  const patterns = reactive([
    { id: 'p1', name: 'Pattern 1', color: '#4ecdc4' },
  ])
  const patternData = reactive({ p1: {} })
  const currentPatternId = ref('p1')
  const pickerPatternId  = ref('p1')   // selected in playlist picker

  function getPatData(channelId, patternId = currentPatternId.value) {
    if (!patternData[patternId]) patternData[patternId] = {}
    if (!patternData[patternId][channelId]) {
      patternData[patternId][channelId] = reactive({
        steps:      Array(32).fill(false),
        pianoNotes: [],
      })
    }
    return patternData[patternId][channelId]
  }

  // Expose helpers for templates/components
  function getSteps(channelId, patternId)      { return getPatData(channelId, patternId).steps }
  function getPianoNotes(channelId, patternId) { return getPatData(channelId, patternId).pianoNotes }

  function addPattern() {
    const id    = 'p' + (++_pid + 1)
    const num   = patterns.length + 1
    const color = COLORS[patterns.length % COLORS.length]
    patterns.push({ id, name: 'Pattern ' + num, color })
    patternData[id] = {}
    currentPatternId.value = id
  }

  function removePattern(id) {
    if (patterns.length <= 1) return
    const idx = patterns.findIndex(p => p.id === id)
    if (idx < 0) return
    patterns.splice(idx, 1)
    delete patternData[id]
    if (currentPatternId.value === id) currentPatternId.value = patterns[0].id
    if (pickerPatternId.value === id)  pickerPatternId.value  = patterns[0].id
    // Remove all playlist clips that used this pattern
    for (let i = playlistClips.length - 1; i >= 0; i--) {
      if (playlistClips[i].patternId === id) playlistClips.splice(i, 1)
    }
  }

  function duplicatePattern(id) {
    const src = patterns.find(p => p.id === id)
    if (!src) return
    const newId  = 'p' + (++_pid + 1)
    const newPat = { id: newId, name: src.name + ' (copy)', color: src.color }
    patterns.push(newPat)
    patternData[newId] = {}
    if (patternData[id]) {
      Object.keys(patternData[id]).forEach(cid => {
        patternData[newId][cid] = reactive({
          steps:      [...(patternData[id][cid].steps || Array(32).fill(false))],
          pianoNotes: (patternData[id][cid].pianoNotes || []).map(n => ({ ...n })),
        })
      })
    }
    currentPatternId.value = newId
  }

  // ── Playlist tracks & clips ────────────────────────────────────────────────────
  const playlistTracks = reactive([
    { id: 'pt1', name: 'Track 1', color: '#e74c3c', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null },
    { id: 'pt2', name: 'Track 2', color: '#3498db', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null },
  ])
  let _clipId = 0
  const playlistClips = reactive([])

  // Time markers on the ruler
  const timeMarkers = reactive([])   // { id, cell, label, color }
  let _markerId = 0

  const usePlaylist    = ref(false)
  const playlistTool   = ref('draw')    // 'draw' | 'paint' | 'erase' | 'select'
  const cellWidth      = ref(80)        // px per cell (zoom)
  const trackHeight    = ref(52)        // px per track (vertical zoom)
  const clipFocusMode  = ref('pattern') // 'pattern' | 'automation'

  function addPlaylistTrack() {
    const idx   = playlistTracks.length + 1
    const color = COLORS[idx % COLORS.length]
    playlistTracks.push({ id: 'pt' + idx + Date.now(), name: 'Track ' + idx, color, muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null })
  }

  function removePlaylistTrack(id) {
    const idx = playlistTracks.findIndex(t => t.id === id)
    if (idx < 0 || playlistTracks.length <= 1) return
    playlistTracks.splice(idx, 1)
    for (let i = playlistClips.length - 1; i >= 0; i--) {
      if (playlistClips[i].trackId === id) playlistClips.splice(i, 1)
    }
  }

  function soloPlaylistTrack(id) {
    const already = playlistTracks.find(t => t.id === id)?._soloed
    if (already) {
      playlistTracks.forEach(t => { t.muted = false; t._soloed = false })
    } else {
      playlistTracks.forEach(t => { t._soloed = false; t.muted = t.id !== id })
      const t = playlistTracks.find(t => t.id === id)
      if (t) { t.muted = false; t._soloed = true }
    }
  }

  function placeClip(trackId, cell, patternId, width = 1) {
    const w = Math.max(1, width)
    const collision = playlistClips.find(c =>
      c.trackId === trackId &&
      cell < c.cell + (c.width || 1) &&
      cell + w > c.cell
    )
    if (collision) return
    playlistClips.push({ id: 'c' + (++_clipId), trackId, cell, patternId: patternId ?? pickerPatternId.value, width: w, slipOffset: 0, muted: false })
  }

  function splitClip(clipId, atCell) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    const leftWidth = atCell - clip.cell
    if (leftWidth <= 0 || leftWidth >= (clip.width || 1)) return
    const rightWidth = (clip.width || 1) - leftWidth
    clip.width = leftWidth
    playlistClips.push({
      id: 'c' + (++_clipId),
      trackId: clip.trackId,
      cell: atCell,
      patternId: clip.patternId,
      width: rightWidth,
      slipOffset: 0,
      muted: clip.muted || false,
    })
  }

  function makeUniqueClip(clipId) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    const srcPat = patterns.find(p => p.id === clip.patternId)
    if (!srcPat) return
    const newId = 'p' + (++_pid + 1)
    patterns.push({ id: newId, name: srcPat.name + ' *', color: srcPat.color })
    patternData[newId] = {}
    const srcData = patternData[clip.patternId]
    if (srcData) {
      Object.keys(srcData).forEach(cid => {
        const d = srcData[cid]
        if (d) patternData[newId][cid] = reactive({
          steps: [...(d.steps || Array(32).fill(false))],
          pianoNotes: (d.pianoNotes || []).map(n => ({ ...n })),
        })
      })
    }
    clip.patternId = newId
  }

  function moveClip(clipId, newTrackId, newCell) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    const w = clip.width || 1
    const collision = playlistClips.find(c =>
      c.id !== clipId && c.trackId === newTrackId &&
      newCell < c.cell + (c.width || 1) && newCell + w > c.cell
    )
    if (collision) return
    clip.trackId = newTrackId
    clip.cell    = Math.max(0, Math.min(PLAYLIST_CELLS - w, newCell))
  }

  function resizeClip(clipId, newWidth) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    clip.width = Math.max(1, Math.min(PLAYLIST_CELLS - clip.cell, newWidth))
  }

  function removeClip(clipId) {
    const idx = playlistClips.findIndex(c => c.id === clipId)
    if (idx >= 0) playlistClips.splice(idx, 1)
  }

  function addTimeMarker(cell, label = 'Marker') {
    timeMarkers.push({ id: 'm' + (++_markerId), cell, label })
  }

  function removeTimeMarker(id) {
    const idx = timeMarkers.findIndex(m => m.id === id)
    if (idx >= 0) timeMarkers.splice(idx, 1)
  }

  // ── Track grouping / locking ───────────────────────────────────────────────────
  function groupTrackWithAbove(trackId) {
    const idx = playlistTracks.findIndex(t => t.id === trackId)
    if (idx <= 0) return
    const parent = playlistTracks[idx - 1]
    // Don't nest already-child tracks
    if (parent.groupParentId) return
    playlistTracks[idx].groupParentId = parent.id
  }

  function ungroupTrack(trackId) {
    const t = playlistTracks.find(t => t.id === trackId)
    if (t) t.groupParentId = null
  }

  function toggleTrackCollapse(trackId) {
    const t = playlistTracks.find(t => t.id === trackId)
    if (t) t.collapsed = !t.collapsed
  }

  function setTrackLocked(trackId, val) {
    const t = playlistTracks.find(t => t.id === trackId)
    if (t) t.locked = val
  }

  // ── Automation clips ───────────────────────────────────────────────────────────
  const automationClips = reactive([])
  let _autoId = 0

  function addAutomationClip(trackId, cell, targetChannelId = null, targetParam = 'volume') {
    automationClips.push({
      id: 'a' + (++_autoId), trackId, cell, width: 4,
      targetChannelId, targetParam,
      nodes: [
        { x: 0,   y: 0.75, tension: 0 },
        { x: 0.5, y: 0.75, tension: 0 },
        { x: 1,   y: 0.75, tension: 0 },
      ],
    })
  }

  function removeAutomationClip(id) {
    const idx = automationClips.findIndex(a => a.id === id)
    if (idx >= 0) automationClips.splice(idx, 1)
  }

  function addAutoNode(clipId, x, y) {
    const clip = automationClips.find(a => a.id === clipId)
    if (!clip) return
    clip.nodes.push({ x, y, tension: 0 })
    clip.nodes.sort((a, b) => a.x - b.x)
  }

  function removeAutoNode(clipId, nodeIdx) {
    const clip = automationClips.find(a => a.id === clipId)
    if (!clip || clip.nodes.length <= 2) return
    clip.nodes.splice(nodeIdx, 1)
  }

  function resizeAutomationClip(clipId, newWidth) {
    const clip = automationClips.find(a => a.id === clipId)
    if (!clip) return
    clip.width = Math.max(1, Math.min(PLAYLIST_CELLS - clip.cell, newWidth))
  }

  // ── Unused patterns helper ────────────────────────────────────────────────────
  function getUnusedPatternIds() {
    const used = new Set(playlistClips.map(c => c.patternId))
    return patterns.filter(p => !used.has(p.id)).map(p => p.id)
  }

  // ── UI state ─────────────────────────────────────────────────────────────────
  const selectedChannelId = ref(channels[0].id)
  const selectedChannel   = computed(() => channels.find(c => c.id === selectedChannelId.value) ?? channels[0])
  const mainView          = ref('sequencer')
  const pianoRollOpen     = ref(false)
  const renderModalOpen   = ref(false)
  const kbOctave          = ref(4)

  // ── Sequencer state ───────────────────────────────────────────────────────────
  const bpm         = ref(120)
  const totalSteps  = ref(16)
  const swing       = ref(0)
  const isPlaying        = ref(false)
  const displayStep      = ref(-1)
  const displayCell      = ref(0)
  const playbackStartCell = ref(0)
  // ── Audio engine ──────────────────────────────────────────────────────────────
  let audioCtx    = null
  let trackGains  = []
  let trackPanners = []

  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    rebuildGains()
  }

  function rebuildGains() {
    if (!audioCtx) return
    trackGains = []; trackPanners = []
    channels.forEach(ch => {
      const g = audioCtx.createGain(); g.gain.value = ch.volume
      const p = audioCtx.createStereoPanner(); p.pan.value = ch.pan
      g.connect(p); p.connect(audioCtx.destination)
      trackGains.push(g); trackPanners.push(p)
    })
  }

  function syncVolumes() {
    channels.forEach((ch, i) => {
      if (trackGains[i])   trackGains[i].gain.value  = ch.volume
      if (trackPanners[i]) trackPanners[i].pan.value  = ch.pan
    })
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────────
  const LOOK_AHEAD = 0.12
  const TICK_MS    = 25
  let schedulerTimer = null
  let nextNoteTime   = 0
  let schedStep      = 0
  let schedCell      = 0
  const noteQueue    = []
  let playbackStartAudioTime   = 0
  let playbackStartCellSeconds = 0

  function getPatternsForCell(cell) {
    if (!usePlaylist.value) return [currentPatternId.value]
    const playingTrackIds = new Set(playlistTracks.filter(t => !t.muted).map(t => t.id))
    return playlistClips
      .filter(c => {
        const w = c.width || 1
        const cellMod = cell % PLAYLIST_CELLS
        return cellMod >= c.cell && cellMod < c.cell + w && playingTrackIds.has(c.trackId) && !c.muted
      })
      .map(c => c.patternId)
  }

  function scheduleStep(step, when, cell) {
    noteQueue.push({ step, time: when, cell: cell % PLAYLIST_CELLS })
    syncVolumes()
    const pids = getPatternsForCell(cell)
    channels.forEach((ch, ci) => {
      if (ch.muted) return
      const dest = trackGains[ci] ?? audioCtx.destination
      pids.forEach(pid => {
        const d = getPatData(ch.id, pid)
        if (ch.mode === 'steps') {
          if (d.steps[step]) ch.fn(audioCtx, when, { ...ch.params }, dest)
        } else {
          d.pianoNotes.filter(n => n.step === step).forEach(note => {
            ch.fn(audioCtx, when, { ...ch.params, pitch: note.pitch, velocity: note.velocity ?? 1 }, dest)
          })
        }
      })
    })
  }

  function tick() {
    if (!audioCtx) return
    const secPerBeat = 60 / bpm.value
    const secPerStep = secPerBeat / 4
    const steps = totalSteps.value
    while (nextNoteTime < audioCtx.currentTime + LOOK_AHEAD) {
      const swingOff = schedStep % 2 === 1 ? swing.value * secPerBeat * 0.5 : 0
      scheduleStep(schedStep % steps, nextNoteTime + swingOff, schedCell)
      nextNoteTime += secPerStep
      schedStep++
      if (schedStep % steps === 0) schedCell++
    }
  }

  function getSecPerCell() {
    return totalSteps.value * (60 / bpm.value) / 4
  }

  function getPlayheadTimeSeconds() {
    if (!isPlaying.value || !audioCtx) return displayCell.value * getSecPerCell()
    return playbackStartCellSeconds + Math.max(0, audioCtx.currentTime - playbackStartAudioTime)
  }

  function drawLoop() {
    if (!isPlaying.value) return
    const now = audioCtx?.currentTime ?? 0
    while (noteQueue.length && noteQueue[0].time <= now + 0.01) {
      displayStep.value = noteQueue[0].step
      displayCell.value = noteQueue[0].cell
      noteQueue.shift()
    }
    requestAnimationFrame(drawLoop)
  }

  function startPlay() {
    initAudio()
    isPlaying.value = true
    const startCell = playbackStartCell.value
    schedStep = 0; schedCell = startCell
    nextNoteTime = audioCtx.currentTime + 0.05
    playbackStartAudioTime   = audioCtx.currentTime
    playbackStartCellSeconds = startCell * getSecPerCell()
    noteQueue.length = 0; displayStep.value = -1; displayCell.value = startCell
    schedulerTimer = setInterval(tick, TICK_MS)
    requestAnimationFrame(drawLoop)
  }

  function stopPlay() {
    isPlaying.value = false
    clearInterval(schedulerTimer); schedulerTimer = null
    noteQueue.length = 0; displayStep.value = -1
    // Keep displayCell at last position (like FL Studio — playhead stays where it stopped)
  }

  function togglePlay() { isPlaying.value ? stopPlay() : startPlay() }

  // ── Keyboard live play ────────────────────────────────────────────────────────
  const pressedKeys = new Set()

  function playNote(ch, pitch) {
    if (!audioCtx) initAudio()
    const ci   = channels.indexOf(ch)
    const dest = (ci >= 0 && trackGains[ci]) ? trackGains[ci] : audioCtx.destination
    const when = audioCtx.currentTime + 0.005
    if (ch.type === 'drum') ch.fn(audioCtx, when, { ...ch.params }, dest)
    else ch.fn(audioCtx, when, { ...ch.params, pitch, velocity: 1 }, dest)
  }

  function handleKeyDown(e) {
    if (e.repeat || ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return
    if (e.code === 'BracketLeft')  { kbOctave.value = Math.max(0, kbOctave.value - 1); return }
    if (e.code === 'BracketRight') { kbOctave.value = Math.min(8, kbOctave.value + 1); return }
    const semi = KB_SEMITONES[e.code]
    if (semi === undefined || pressedKeys.has(e.code)) return
    pressedKeys.add(e.code)
    playNote(selectedChannel.value, 12 * (kbOctave.value + 1) + semi)
  }

  function handleKeyUp(e) { pressedKeys.delete(e.code) }

  // ── Pattern editing ───────────────────────────────────────────────────────────
  function toggleStep(channelId, step) {
    const d = getPatData(channelId); d.steps[step] = !d.steps[step]
  }

  function togglePianoNote(channelId, step, pitch) {
    const d   = getPatData(channelId)
    const idx = d.pianoNotes.findIndex(n => n.step === step && n.pitch === pitch)
    if (idx >= 0) d.pianoNotes.splice(idx, 1)
    else          d.pianoNotes.push({ step, pitch, velocity: 1 })
  }

  function hasNote(channelId, step, pitch) {
    return getPatData(channelId).pianoNotes.some(n => n.step === step && n.pitch === pitch)
  }

  function clearChannel(channelId) {
    const d = getPatData(channelId); d.steps.fill(false); d.pianoNotes.length = 0
  }

  function clearAll() {
    channels.forEach(ch => {
      const d = getPatData(ch.id); d.steps.fill(false); d.pianoNotes.length = 0
    })
  }

  // ── Channel solo ──────────────────────────────────────────────────────────────
  function soloChannel(id) {
    const already = channels.find(c => c.id === id)?._soloed
    if (already) {
      channels.forEach(c => { c.muted = false; c._soloed = false })
    } else {
      channels.forEach(c => { c._soloed = false; c.muted = c.id !== id })
      const ch = channels.find(c => c.id === id)
      if (ch) { ch.muted = false; ch._soloed = true }
    }
  }

  // ── Channel management ────────────────────────────────────────────────────────
  let colorCursor = 4

  function addChannel() {
    const ch = makeChannel({
      name:  'SYNTH ' + (channels.filter(c => c.type === 'melodic').length + 1),
      color: COLORS[colorCursor++ % COLORS.length],
    })
    channels.push(ch)
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
  }

  function removeChannel(id) {
    const idx = channels.findIndex(c => c.id === id)
    if (idx < 0 || channels.length <= 1) return
    channels.splice(idx, 1)
    if (audioCtx) rebuildGains()
    if (selectedChannelId.value === id) selectedChannelId.value = channels[0].id
    if (pianoRollOpen.value && selectedChannelId.value === id) pianoRollOpen.value = false
  }

  function moveChannel(id, dir) {
    const idx = channels.findIndex(c => c.id === id)
    const t   = idx + dir
    if (t < 0 || t >= channels.length) return
    const [ch] = channels.splice(idx, 1)
    channels.splice(t, 0, ch)
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  _store = {
    // Channels
    channels, selectedChannelId, selectedChannel,
    soloChannel, addChannel, removeChannel, moveChannel,
    // Patterns
    patterns, currentPatternId, pickerPatternId, patternData,
    getPatData, getSteps, getPianoNotes,
    addPattern, removePattern, duplicatePattern,
    // Pattern editing
    toggleStep, togglePianoNote, hasNote, clearChannel, clearAll,
    // Playlist
    playlistTracks, playlistClips, timeMarkers, usePlaylist,
    playlistTool, cellWidth, trackHeight, clipFocusMode, displayCell, playbackStartCell,
    addPlaylistTrack, removePlaylistTrack, soloPlaylistTrack,
    placeClip, removeClip, moveClip, resizeClip, splitClip, makeUniqueClip,
    addTimeMarker, removeTimeMarker,
    PLAYLIST_CELLS,
    // Track groups/lock
    groupTrackWithAbove, ungroupTrack, toggleTrackCollapse, setTrackLocked,
    // Automation
    automationClips, addAutomationClip, removeAutomationClip,
    addAutoNode, removeAutoNode, resizeAutomationClip,
    // Utilities
    getUnusedPatternIds,
    // UI state
    mainView, pianoRollOpen, renderModalOpen, kbOctave,
    // Sequencer
    bpm, totalSteps, swing, isPlaying, displayStep,
    togglePlay, startPlay, stopPlay,
    getPlayheadTimeSeconds,
    // Keyboard
    playNote, handleKeyDown, handleKeyUp,
  }
  return _store
}
