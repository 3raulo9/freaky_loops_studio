import { ref, reactive, computed } from 'vue'
import { playKick, playSnare, playHiHat, playClash } from '../audio/synths.js'
import { playMelodicNote } from '../audio/melodic.js'

// ─── Piano / note constants ────────────────────────────────────────────────────
export const PIANO_LOW   = 36
export const PIANO_HIGH  = 84
export const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
export const PIANO_KEYS  = Array.from({ length: PIANO_HIGH - PIANO_LOW + 1 }, (_, i) => PIANO_HIGH - i)
export const PLAYLIST_BARS = 32

export function midiToLabel(m) { return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1) }
export function isBlackKey(m)  { return [1, 3, 6, 8, 10].includes(m % 12) }

// ─── PC keyboard → semitone offset ────────────────────────────────────────────
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
    mode:  'piano',     // 'steps' | 'piano'  (drums always 'steps')
    volume:     0.8,
    pan:        0,      // -1 (left) to 1 (right)
    mixerTrack: 0,
    muted:      false,
    _soloed:    false,
    pattern:    Array(32).fill(false),
    pianoNotes: [],
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

  // ── Initial channels ────────────────────────────────────────────────────────
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

  // ── UI state ─────────────────────────────────────────────────────────────────
  const selectedChannelId = ref(channels[0].id)
  const selectedChannel   = computed(() => channels.find(c => c.id === selectedChannelId.value) ?? channels[0])
  const mainView          = ref('sequencer')   // 'sequencer' | 'playlist'
  const pianoRollOpen     = ref(false)
  const kbOctave          = ref(4)

  // ── Sequencer state ───────────────────────────────────────────────────────────
  const bpm         = ref(120)
  const totalSteps  = ref(16)
  const swing       = ref(0)
  const isPlaying   = ref(false)
  const displayStep = ref(-1)
  const exportBars  = ref(2)
  const isRendering = ref(false)

  // ── Playlist ──────────────────────────────────────────────────────────────────
  const playlist    = reactive(Array.from({ length: PLAYLIST_BARS }, () => reactive({})))
  const usePlaylist = ref(false)

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
    trackGains   = []
    trackPanners = []
    channels.forEach(ch => {
      const g = audioCtx.createGain()
      g.gain.value = ch.volume
      const p = audioCtx.createStereoPanner()
      p.pan.value = ch.pan
      g.connect(p)
      p.connect(audioCtx.destination)
      trackGains.push(g)
      trackPanners.push(p)
    })
  }

  function syncVolumes() {
    channels.forEach((ch, i) => {
      if (trackGains[i])   trackGains[i].gain.value  = ch.volume
      if (trackPanners[i]) trackPanners[i].pan.value  = ch.pan
    })
  }

  // ── Lookahead scheduler ───────────────────────────────────────────────────────
  const LOOK_AHEAD = 0.12
  const TICK_MS    = 25
  let schedulerTimer = null
  let nextNoteTime   = 0
  let schedStep      = 0
  let currentBar     = 0
  const noteQueue    = []

  function isActiveInBar(ch, bar) {
    if (!usePlaylist.value) return true
    return !!playlist[bar % PLAYLIST_BARS]?.[ch.id]
  }

  function scheduleStep(step, when) {
    noteQueue.push({ step, time: when })
    syncVolumes()
    channels.forEach((ch, ci) => {
      if (ch.muted || !isActiveInBar(ch, currentBar)) return
      const dest = trackGains[ci] ?? audioCtx.destination
      if (ch.mode === 'steps') {
        if (ch.pattern[step]) ch.fn(audioCtx, when, { ...ch.params }, dest)
      } else {
        ch.pianoNotes.filter(n => n.step === step).forEach(note => {
          ch.fn(audioCtx, when, { ...ch.params, pitch: note.pitch, velocity: note.velocity ?? 1 }, dest)
        })
      }
    })
  }

  function tick() {
    if (!audioCtx) return
    const secPerBeat = 60 / bpm.value
    const secPerStep = secPerBeat / 4
    const steps = totalSteps.value
    while (nextNoteTime < audioCtx.currentTime + LOOK_AHEAD) {
      const swingOff = schedStep % 2 === 1 ? swing.value * secPerBeat * 0.5 : 0
      scheduleStep(schedStep % steps, nextNoteTime + swingOff)
      nextNoteTime += secPerStep
      schedStep++
      if (schedStep % steps === 0) currentBar++
    }
  }

  function drawLoop() {
    if (!isPlaying.value) return
    const now = audioCtx?.currentTime ?? 0
    while (noteQueue.length && noteQueue[0].time <= now + 0.01) {
      displayStep.value = noteQueue[0].step
      noteQueue.shift()
    }
    requestAnimationFrame(drawLoop)
  }

  function startPlay() {
    initAudio()
    isPlaying.value = true
    schedStep = 0; currentBar = 0
    nextNoteTime = audioCtx.currentTime + 0.05
    noteQueue.length = 0
    displayStep.value = -1
    schedulerTimer = setInterval(tick, TICK_MS)
    requestAnimationFrame(drawLoop)
  }

  function stopPlay() {
    isPlaying.value = false
    clearInterval(schedulerTimer)
    schedulerTimer = null
    noteQueue.length = 0
    displayStep.value = -1
  }

  function togglePlay() { isPlaying.value ? stopPlay() : startPlay() }

  // ── Keyboard live play ────────────────────────────────────────────────────────
  const pressedKeys = new Set()

  function playNote(ch, pitch) {
    if (!audioCtx) initAudio()
    const ci   = channels.indexOf(ch)
    const dest = (ci >= 0 && trackGains[ci]) ? trackGains[ci] : audioCtx.destination
    const when = audioCtx.currentTime + 0.005
    if (ch.type === 'drum') {
      ch.fn(audioCtx, when, { ...ch.params }, dest)
    } else {
      ch.fn(audioCtx, when, { ...ch.params, pitch, velocity: 1 }, dest)
    }
  }

  function handleKeyDown(e) {
    if (e.repeat) return
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
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
    const ch = channels.find(c => c.id === channelId)
    if (ch) ch.pattern[step] = !ch.pattern[step]
  }

  function togglePianoNote(channelId, step, pitch) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    const idx = ch.pianoNotes.findIndex(n => n.step === step && n.pitch === pitch)
    if (idx >= 0) ch.pianoNotes.splice(idx, 1)
    else          ch.pianoNotes.push({ step, pitch, velocity: 1 })
  }

  function hasNote(channelId, step, pitch) {
    return channels.find(c => c.id === channelId)?.pianoNotes.some(n => n.step === step && n.pitch === pitch) ?? false
  }

  function clearChannel(channelId) {
    const ch = channels.find(c => c.id === channelId)
    if (ch) { ch.pattern.fill(false); ch.pianoNotes.length = 0 }
  }

  function clearAll() {
    channels.forEach(ch => { ch.pattern.fill(false); ch.pianoNotes.length = 0 })
  }

  // ── Solo ──────────────────────────────────────────────────────────────────────
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

  // ── Playlist ──────────────────────────────────────────────────────────────────
  function togglePlaylistBlock(bar, channelId) {
    playlist[bar][channelId] = !playlist[bar][channelId]
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
    const target = idx + dir
    if (target < 0 || target >= channels.length) return
    const [ch] = channels.splice(idx, 1)
    channels.splice(target, 0, ch)
  }

  // ── WAV export ────────────────────────────────────────────────────────────────
  async function exportWav() {
    if (isRendering.value) return
    isRendering.value = true
    try {
      const { renderLoopToWav } = await import('../audio/export.js')
      const blob = await renderLoopToWav(channels, bpm.value, totalSteps.value, swing.value, exportBars.value)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `freaky-loop-${bpm.value}bpm-${exportBars.value}bar.wav`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      isRendering.value = false
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  _store = {
    channels, selectedChannelId, selectedChannel, mainView, kbOctave,
    pianoRollOpen,
    bpm, totalSteps, swing, isPlaying, displayStep, exportBars, isRendering,
    playlist, usePlaylist, PLAYLIST_BARS,
    togglePlay, startPlay, stopPlay,
    toggleStep, togglePianoNote, hasNote, clearChannel, clearAll,
    soloChannel, togglePlaylistBlock,
    addChannel, removeChannel, moveChannel,
    playNote, handleKeyDown, handleKeyUp,
    exportWav,
  }
  return _store
}
