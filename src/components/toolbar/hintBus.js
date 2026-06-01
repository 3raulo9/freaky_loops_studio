// ──────────────────────────────────────────────────────────────────────────
//  Global hover-hint delegation bus
//
//  Every toolbar control offloads its tooltip to ONE dedicated renderer (the
//  Hint Bar panel) instead of each managing its own tooltip DOM. A control
//  registers its hint ID on hover via the `v-hint` directive; the Hint Bar
//  looks the ID up in this dictionary and paints the text. Decoupled — panels
//  stay lightweight and tooltip rendering lives in a single place.
// ──────────────────────────────────────────────────────────────────────────
import { ref, computed } from 'vue'

export const HINTS = {
  'transport.play':    'Play / Pause  ·  Space',
  'transport.stop':    'Stop & rewind to the start',
  'transport.rec':     'Arm record  ·  right-click to choose what to capture',
  'transport.recwarn': '⚠ Nothing armed to record — right-click to pick a filter',
  'timecode':          'Song position  ·  click to switch Bars/Beats ↔ Min/Sec',
  'bpm':               'Project tempo (BPM)',
  'swing':             'Global swing amount',
  'steps':             'Steps per pattern',
  'mode.pat':          'Pattern mode — loop a single pattern',
  'mode.song':         'Song mode — arrange patterns on the playlist',
  'snap':              'Global grid snap',
  'tools.kb':          'QWERTY → MIDI typing keyboard',
  'tools.undo':        'Undo last action',
  'tools.redo':        'Redo',
  'tools.save':        'Save project (.freak)',
  'tools.open':        'Open project (.freak)',
  'win.rack':          'Channel Rack',
  'win.piano':         'Piano Roll',
  'win.playlist':      'Playlist / Song editor',
  'win.mixer':         'Mixer',
  'win.render':        'Render / export audio',
  'win.theme':         'Theme settings',
}

const _id = ref(null)

export const hintId   = _id
export const hintText = computed(() => (_id.value && HINTS[_id.value]) || '')

export function setHint(id)   { _id.value = id }
export function clearHint(id) { if (!id || _id.value === id) _id.value = null }

// `v-hint="'transport.play'"` — the global hover delegation primitive.
export const vHint = {
  mounted(el, binding) {
    el.__hintId = binding.value
    el.__hintEnter = () => setHint(el.__hintId)
    el.__hintLeave = () => clearHint(el.__hintId)
    el.addEventListener('mouseenter', el.__hintEnter)
    el.addEventListener('mouseleave', el.__hintLeave)
  },
  updated(el, binding) { el.__hintId = binding.value },
  beforeUnmount(el) {
    el.removeEventListener('mouseenter', el.__hintEnter)
    el.removeEventListener('mouseleave', el.__hintLeave)
    clearHint(el.__hintId)
  },
}
