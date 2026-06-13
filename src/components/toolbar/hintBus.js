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
  'title':             'Project — * marks unsaved changes',
  'transport.play':    'Play / Pause  ·  Space',
  'transport.stop':    'Stop & rewind to the start',
  'transport.rec':     'Arm record  ·  right-click to choose what to capture',
  'transport.recwarn': '⚠ Nothing armed to record — right-click to pick a filter',
  'timecode':          'Song position  ·  click to switch Bars/Beats ↔ Min/Sec',
  'bpm':               'Tempo — drag to change, Ctrl-drag to fine-tune, scroll to nudge',
  'bpm.tap':           'Tap tempo — click in time, or right-click the readout',
  'swing':             'Global swing amount',
  'steps':             'Steps per pattern',
  'mode.pat':          'Pattern mode — loop a single pattern',
  'mode.song':         'Song mode — arrange patterns on the playlist',
  'pattern':           'Active pattern — drag/scroll to switch, F2 to rename',
  'pattern.menu':      'Pattern menu — new, duplicate, split by channel, delete',
  'metro':             'Metronome — right-click to pick the click sound',
  'snap':              'Global grid snap',
  'sysmon':            'System monitor — audio load, memory, active voices, dropouts',
  'midi':              'MIDI sync — click to enable input & link hardware controllers',
  'tools.kb':          'QWERTY → MIDI typing keyboard',
  'tools.undo':        'Undo last action',
  'tools.redo':        'Redo',
  'tools.save':        'Save project (.freak)',
  'tools.open':        'Open project (.freak)',
  'win.playlist':      'Playlist / Song editor  ·  F5',
  'win.rack':          'Channel Rack  ·  F6',
  'win.piano':         'Piano Roll  ·  F7',
  'win.browser':       'Browser  ·  Alt+F8  ·  drag a file here to peek',
  'win.mixer':         'Mixer  ·  F9',
  'win.render':        'Render / export audio',
  'win.theme':         'Theme settings',
  'win.layout':        'Workspace layout presets',
}

// ── Centralized hint broker ───────────────────────────────────────────────────
//  One reactive packet, broadcast to every visualization module (toolbar Hint
//  Bar + Extended HUD). label = control description, value = live-parsed reading
//  during a drag, shortcut = key binding.
const _id       = ref(null)
const _raw      = ref('')
const _label    = ref('')   // control name (HUD)
const _value    = ref('')   // live formatted value (HUD)
const _shortcut = ref('')

export const hintId       = _id
export const hintText     = computed(() => _raw.value || (_id.value && HINTS[_id.value]) || '')
export const hintLabel    = computed(() => _label.value || (_id.value && HINTS[_id.value]) || '')
export const hintValue    = _value
export const hintShortcut = _shortcut
export const hintActive   = computed(() => !!hintText.value)

export function setHint(id) {
  _raw.value = ''; _value.value = ''; _shortcut.value = ''
  _label.value = ''
  _id.value = id
}
export function setHintRaw(text) {                      // dynamic string only
  _id.value = null; _value.value = ''; _shortcut.value = ''
  _label.value = text; _raw.value = text
}
// Rich packet: { label, value, shortcut } → bar shows "label: value", HUD splits them.
export function setHintRich({ label = '', value = '', shortcut = '' } = {}) {
  _id.value = null
  _label.value = label
  _value.value = value
  _shortcut.value = shortcut
  _raw.value = value ? `${label}: ${value}${shortcut ? '  (' + shortcut + ')' : ''}` : label
}
export function clearHint(id) {
  if (!id || _id.value === id) _id.value = null
  _raw.value = ''; _label.value = ''; _value.value = ''; _shortcut.value = ''
}

// ── Live-interpolation value parsers (allocation-light) ───────────────────────
export function fmtFreq(v) {                            // v∈[0,1] → exponential Hz
  const hz = 20 * Math.pow(1000, Math.max(0, Math.min(1, v)))
  return hz >= 1000 ? (hz / 1000).toFixed(2) + ' kHz' : Math.round(hz) + ' Hz'
}
export function fmtDb(db) { return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB' }
export function fmtPct(v) { return Math.round(v * 100) + '%' }

// `v-hint="'transport.play'"`  → looks the id up in HINTS (registered tooltips).
// `v-hint="'Free-form text…'"` → any value containing whitespace is shown verbatim,
//   so components can describe a control inline without registering a HINTS entry.
//   (No HINTS id contains whitespace, so the two forms never collide.)
function applyHint(v) {
  if (v == null) return
  if (typeof v === 'string' && /\s/.test(v)) setHintRaw(v)
  else setHint(v)
}

export const vHint = {
  mounted(el, binding) {
    el.__hintVal = binding.value
    el.__hintEnter = () => applyHint(el.__hintVal)
    el.__hintLeave = () => clearHint(el.__hintVal)
    el.addEventListener('mouseenter', el.__hintEnter)
    el.addEventListener('mouseleave', el.__hintLeave)
  },
  updated(el, binding) { el.__hintVal = binding.value },
  beforeUnmount(el) {
    el.removeEventListener('mouseenter', el.__hintEnter)
    el.removeEventListener('mouseleave', el.__hintLeave)
    clearHint(el.__hintVal)
  },
}
