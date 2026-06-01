<template>
  <div class="tb-midi" v-hint="'midi'">
    <div class="tb-ctrl-label">MIDI</div>
    <div
      class="tb-midi-row"
      title="MIDI sync indicator — click for Multilink"
      @click.stop="menu = !menu"
      @contextmenu.prevent.stop="menu = !menu"
    >
      <span
        class="tb-midi-led"
        :class="{ lit }"
        :style="{ background: ledColor, boxShadow: lit ? `0 0 9px ${ledColor}` : 'none' }"
      />
      <span class="tb-midi-text" :class="{ learn: midiLearnTarget }">
        {{ midiLearnTarget ? 'LEARN…' : (midiLastLabel || stateLabel) }}
      </span>
    </div>

    <!-- ── Multilink menu ──────────────────────────────────────────────────────-->
    <div v-if="menu" class="midi-menu" @click.stop>
      <div class="midi-menu-title">MIDI MULTILINK</div>

      <div v-if="!midiEnabled" class="midi-menu-item" @click="initMidi">⚡ Enable MIDI input</div>
      <div v-else class="midi-menu-note">{{ stateLabel }} · {{ midiLastLabel || 'waiting…' }}</div>

      <div class="midi-menu-sub">LINK TO CONTROLLER</div>
      <div
        v-for="(t, id) in MIDI_TARGETS"
        :key="id"
        class="midi-menu-item"
        :class="{ arming: midiLearnTarget === id }"
        @click="arm(id)"
      >
        {{ midiLearnTarget === id ? '◉ move a control…' : '＋ ' + t.label }}
      </div>

      <template v-if="midiLinks.length">
        <div class="midi-menu-sep" />
        <div class="midi-menu-sub">LINKS</div>
        <div v-for="l in midiLinks" :key="l.target" class="midi-link">
          <span class="midi-link-dot" :class="{ global: l.global }" />
          <span class="midi-link-name">{{ MIDI_TARGETS[l.target]?.label ?? l.target }}</span>
          <span class="midi-link-cc">CC{{ l.cc }}</span>
          <button class="midi-link-btn" :title="'Curve: ' + l.mode"
            @click="setLinkMode(l.target, l.mode === 'linear' ? 'log' : 'linear')">
            {{ l.mode === 'log' ? 'LOG' : 'LIN' }}
          </button>
          <button class="midi-link-btn" :class="{ on: l.global }" title="Global (permanent) link"
            @click="toggleLinkGlobal(l.target)">GLB</button>
          <button class="midi-link-btn danger" title="Remove link" @click="removeMidiLink(l.target)">×</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const {
  midiEnabled, midiSyncState, midiActivity, midiLastLabel, midiLearnTarget, midiLinks, MIDI_TARGETS,
  initMidi, armMidiLearn, cancelMidiLearn, removeMidiLink, setLinkMode, toggleLinkGlobal,
  beatTick, beatAccent,
} = useStudio()

const COLORS = { idle: '#5a5a70', unhandled: '#2ecc71', volatile: '#f39c12', global: '#3498db' }
const STATE_LABELS = { idle: 'No data', unhandled: 'Unhandled', volatile: 'Project link', global: 'Global link' }
const stateLabel = computed(() => STATE_LABELS[midiSyncState.value])

const flashBlue = computed(() => _barFlash.value)
const ledColor = computed(() => _barFlash.value ? '#3498db' : COLORS[midiSyncState.value])

// ── Blink driver ──────────────────────────────────────────────────────────────
const lit = ref(false)
let litT = null
function pulse(ms = 130) { lit.value = true; clearTimeout(litT); litT = setTimeout(() => { lit.value = false }, ms) }

// Flash on every inbound message.
watch(midiActivity, () => pulse(140))

// Idle heartbeat — a faint grey blink each polling cycle when nothing arrives.
let hb = null

// Blue downbeat flash (visual metronome) — only while a global link is active.
const _barFlash = ref(false)
watch(beatTick, () => {
  if (beatAccent.value && midiLinks.some(l => l.global)) {
    _barFlash.value = true; lit.value = true
    setTimeout(() => { _barFlash.value = false; lit.value = false }, 130)
  }
})

function arm(id) { midiLearnTarget.value === id ? cancelMidiLearn() : armMidiLearn(id) }

// ── Menu ──────────────────────────────────────────────────────────────────────
const menu = ref(false)
function onGlobalDown(e) { if (menu.value && !e.target.closest('.tb-midi')) menu.value = false }

onMounted(() => {
  hb = setInterval(() => { if (midiSyncState.value === 'idle' && !lit.value) pulse(80) }, 850)
  window.addEventListener('pointerdown', onGlobalDown, true)
})
onBeforeUnmount(() => {
  clearInterval(hb); clearTimeout(litT)
  window.removeEventListener('pointerdown', onGlobalDown, true)
})
</script>

<style scoped>
.tb-midi {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  flex-shrink: 0; padding: 0 5px; position: relative;
}
.tb-ctrl-label {
  font-family: 'Rajdhani', sans-serif; font-size: 7px; font-weight: 700;
  letter-spacing: 0.16em; color: #28283c; text-transform: uppercase;
}
.tb-midi-row {
  display: flex; align-items: center; gap: 5px;
  height: 18px; padding: 0 7px; cursor: pointer;
  border: 1px solid var(--border-subtle); border-radius: 4px; background: var(--bg-deeper);
}
.tb-midi-row:hover { border-color: #404068; }
.tb-midi-led {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  opacity: 0.45; transition: opacity 0.08s, box-shadow 0.08s;
}
.tb-midi-led.lit { opacity: 1; }
.tb-midi-text {
  font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #6a6a90;
  min-width: 58px; white-space: nowrap;
}
.tb-midi-text.learn { color: #f1c40f; }

/* ── Multilink menu ────────────────────────────────────────────────────────── */
.midi-menu {
  position: absolute; top: 40px; left: 0; z-index: 9999; min-width: 220px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 6px 24px #000000a0;
}
.midi-menu-title {
  padding: 4px 9px 5px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.16em; color: #3498db; border-bottom: 1px solid var(--border-subtle);
}
.midi-menu-sub {
  padding: 6px 9px 2px;
  font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700;
  letter-spacing: 0.14em; color: #40405a;
}
.midi-menu-note {
  padding: 5px 9px;
  font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #5a7a9a;
}
.midi-menu-item {
  padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.03em; color: #8080a0; cursor: pointer; border-radius: 4px;
}
.midi-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.midi-menu-item.arming { color: #f1c40f; }
.midi-menu-sep { height: 1px; background: var(--border-subtle); margin: 4px 2px; }

.midi-link {
  display: flex; align-items: center; gap: 5px; padding: 4px 8px;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; color: #9090b0;
}
.midi-link-dot { width: 7px; height: 7px; border-radius: 50%; background: #f39c12; flex-shrink: 0; }
.midi-link-dot.global { background: #3498db; }
.midi-link-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.midi-link-cc { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #50506e; }
.midi-link-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  padding: 1px 5px; border-radius: 3px;
  border: 1px solid var(--border-subtle); background: transparent; color: #6a6a90;
  cursor: pointer; transition: all 0.1s;
}
.midi-link-btn:hover { border-color: #7b4dd6; color: #c8a0ff; }
.midi-link-btn.on { border-color: #3498db; color: #3498db; }
.midi-link-btn.danger:hover { border-color: #e74c3c; color: #e74c3c; }
</style>
