// ──────────────────────────────────────────────────────────────────────────
//  Toolbar panel registry
//
//  The toolbar is not a monolith — it's an array of standalone micro-panels.
//  This registry is the single source of truth for *what* panels exist; the
//  container (TopBar.vue) owns *where* they sit and *whether* they're mounted.
// ──────────────────────────────────────────────────────────────────────────
import AddPanel       from './AddPanel.vue'
import LogoPanel      from './LogoPanel.vue'
import HintBarPanel   from './HintBarPanel.vue'
import TransportPanel from './TransportPanel.vue'
import TimecodePanel  from './TimecodePanel.vue'
import BpmPanel       from './BpmPanel.vue'
import SwingPanel     from './SwingPanel.vue'
import StepsPanel     from './StepsPanel.vue'
import ModePanel      from './ModePanel.vue'
import SnapPanel      from './SnapPanel.vue'
import MetronomePanel from './MetronomePanel.vue'
import PatternPanel   from './PatternPanel.vue'
import MasterPanel    from './MasterPanel.vue'
import MidiSyncPanel  from './MidiSyncPanel.vue'
import MeterPanel     from './MeterPanel.vue'
import ToolsPanel     from './ToolsPanel.vue'
import WindowsPanel   from './WindowsPanel.vue'

// A `spacer` is a special flex-filler pseudo-panel — it has no component, it
// just pushes everything after it to the far edge of the dock.
export const SPACER_ID = 'spacer'

export const PANELS = {
  logo:      { label: 'Logo',        component: LogoPanel      },
  add:       { label: 'Add Channel', component: AddPanel       },
  hint:      { label: 'Hint Bar',    component: HintBarPanel, grow: true },
  transport: { label: 'Transport',   component: TransportPanel },
  timecode:  { label: 'Timecode',    component: TimecodePanel  },
  bpm:       { label: 'Tempo',       component: BpmPanel       },
  swing:     { label: 'Swing',       component: SwingPanel     },
  steps:     { label: 'Steps',       component: StepsPanel     },
  mode:      { label: 'Pat / Song',  component: ModePanel      },
  metro:     { label: 'Metronome',   component: MetronomePanel },
  snap:      { label: 'Snap',        component: SnapPanel      },
  pattern:   { label: 'Pattern',     component: PatternPanel   },
  midi:      { label: 'MIDI Sync',   component: MidiSyncPanel  },
  master:    { label: 'Master Vol / Pitch', component: MasterPanel },
  meter:     { label: 'System Monitor', component: MeterPanel },
  tools:     { label: 'Tools',       component: ToolsPanel     },
  windows:   { label: 'Windows',     component: WindowsPanel   },
}

// Default layout: ordered list of { id, visible, row }. `row` 0 = primary
// (top) row, 1 = secondary (lower) row — the toolbar stacks two rows, with the
// wide hint/status bar living on its own lower row. The serialized user layout
// is reconciled against this so newly-added panels still appear after upgrades.
export const DEFAULT_LAYOUT = [
  // ── Primary row ────────────────────────────────────────────────────────────
  { id: 'logo',      visible: true, row: 0 },
  { id: 'add',       visible: true, row: 0 },
  { id: 'transport', visible: true, row: 0 },
  { id: 'timecode',  visible: true, row: 0 },
  { id: 'bpm',       visible: true, row: 0 },
  { id: 'swing',     visible: true, row: 0 },
  { id: 'steps',     visible: true, row: 0 },
  { id: 'mode',      visible: true, row: 0 },
  { id: 'metro',     visible: true, row: 0 },
  { id: 'snap',      visible: true, row: 0 },
  { id: SPACER_ID,   visible: true, row: 0 },
  { id: 'master',    visible: true, row: 0 },
  { id: 'meter',     visible: true, row: 0 },
  { id: 'tools',     visible: true, row: 0 },
  { id: 'windows',   visible: true, row: 0 },
  // ── Secondary row ──────────────────────────────────────────────────────────
  { id: 'hint',      visible: true, row: 1 },
  { id: 'pattern',   visible: true, row: 1 },
  { id: 'midi',      visible: true, row: 1 },
]
