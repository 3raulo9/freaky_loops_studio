<template>
  <div class="nfx" :style="{ '--acc': channel.color }">
    <div class="nfx-hdr" @click="open = !open">
      <span class="nfx-caret">{{ open ? '▾' : '▸' }}</span>
      <span class="nfx-title">NOTE FX</span>
      <span v-if="summary" class="nfx-summary">{{ summary }}</span>
    </div>

    <div v-if="open" class="nfx-body">
      <!-- Arpeggiator -->
      <template v-if="!isDrum">
        <div class="nfx-row">
          <button class="nfx-tog" :class="{ on: p.arpEnabled }" @click="set('arpEnabled', !p.arpEnabled)"
            v-hint="'Arpeggiator: play held notes and chords as a repeating run, in time with the song.'">ARP</button>
          <select class="nfx-sel" :value="p.arpMode ?? 'up'" @change="set('arpMode', $event.target.value)" :disabled="!p.arpEnabled">
            <option value="up">Up</option><option value="down">Down</option>
            <option value="updown">Up/Down</option><option value="random">Random</option>
          </select>
          <select class="nfx-sel nfx-sel--sm" :value="p.arpRate ?? '1/16'" @change="set('arpRate', $event.target.value)" :disabled="!p.arpEnabled">
            <option v-for="r in ARP_RATES" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <div v-if="p.arpEnabled" class="nfx-row">
          <label class="nfx-lbl">GATE</label>
          <input type="range" min="0.05" max="1" step="0.01" :value="p.arpGate ?? 0.5" @input="set('arpGate', +$event.target.value)" />
          <span class="nfx-val">{{ Math.round((p.arpGate ?? 0.5) * 100) }}%</span>
          <select class="nfx-sel nfx-sel--xs" v-hint="'Octave range'" :value="p.arpRange ?? 1" @change="set('arpRange', +$event.target.value)">
            <option v-for="o in [1, 2, 3, 4]" :key="o" :value="o">{{ o }} oct</option>
          </select>
        </div>

        <!-- Chord -->
        <div class="nfx-row">
          <label class="nfx-lbl" v-hint="'Chord: every note becomes a chord. Diatonic chords follow the scale below.'">CHORD</label>
          <select class="nfx-sel" :value="p.fxChord ?? 'off'" @change="set('fxChord', $event.target.value)">
            <option value="off">Off</option>
            <optgroup label="In scale">
              <option v-for="(d, k) in DIATONIC_CHORDS" :key="k" :value="k">{{ d.label }}</option>
            </optgroup>
            <optgroup label="Fixed">
              <option v-for="(c, k) in CHORD_TYPES" :key="k" :value="k">{{ c.label }}</option>
            </optgroup>
          </select>
          <select class="nfx-sel nfx-sel--xs" :value="p.fxChordInv ?? 0" @change="set('fxChordInv', +$event.target.value)"
            :disabled="!p.fxChord || p.fxChord === 'off'" v-hint="'Chord inversion'">
            <option v-for="i in [0, 1, 2, 3]" :key="i" :value="i">inv {{ i }}</option>
          </select>
        </div>

        <!-- Scale lock -->
        <div class="nfx-row">
          <label class="nfx-lbl" v-hint="'Scale lock: wrong notes snap to the nearest note of this scale.'">SCALE</label>
          <select class="nfx-sel nfx-sel--xs" :value="p.fxScaleRoot ?? 0" @change="set('fxScaleRoot', +$event.target.value)">
            <option v-for="(n, i) in NOTE_NAMES" :key="i" :value="i">{{ n }}</option>
          </select>
          <select class="nfx-sel" :value="p.fxScale ?? 'off'" @change="set('fxScale', $event.target.value)">
            <option value="off">Off</option>
            <option v-for="(_, k) in SCALE_DEFS" :key="k" :value="k">{{ k }}</option>
          </select>
        </div>

        <!-- Transpose -->
        <div class="nfx-row">
          <label class="nfx-lbl">TRANSP</label>
          <input type="range" min="-24" max="24" step="1" :value="p.fxTranspose ?? 0" @input="set('fxTranspose', +$event.target.value)"
            @dblclick="set('fxTranspose', 0)" />
          <span class="nfx-val">{{ (p.fxTranspose ?? 0) > 0 ? '+' : '' }}{{ p.fxTranspose ?? 0 }}</span>
        </div>
      </template>

      <!-- Groove pool -->
      <div class="nfx-row">
        <label class="nfx-lbl" v-hint="'Groove: shift timing and accents to a feel — swing, shuffle, laid back, push. Amount blends it in.'">GROOVE</label>
        <select class="nfx-sel" :value="p.groove ?? 'none'" @change="set('groove', $event.target.value)">
          <option v-for="(g, k) in GROOVES" :key="k" :value="k">{{ g.label }}</option>
        </select>
        <input type="range" min="0" max="1" step="0.01" :value="p.grooveAmount ?? 1"
          :disabled="!p.groove || p.groove === 'none'" @input="set('grooveAmount', +$event.target.value)"
          v-hint="'Groove amount'" />
      </div>
      <button v-if="p.groove && p.groove !== 'none'" class="nfx-reset" @click="applyGrooveToAll"
        v-hint="'Give every channel this groove so the whole beat sits in the same pocket.'">USE ON ALL CHANNELS</button>

      <!-- Velocity -->
      <div class="nfx-row">
        <label class="nfx-lbl" v-hint="'Velocity: force every note to one level, or scale what was played.'">VEL</label>
        <select class="nfx-sel nfx-sel--sm" :value="p.fxVelMode ?? 'off'" @change="set('fxVelMode', $event.target.value)">
          <option value="off">As played</option><option value="fixed">Fixed</option><option value="scale">Scale</option>
        </select>
        <input type="range" min="0" max="1" step="0.01" :value="p.fxVel ?? (p.fxVelMode === 'scale' ? 1 : 0.8)"
          :disabled="!p.fxVelMode || p.fxVelMode === 'off'" @input="set('fxVel', +$event.target.value)" />
      </div>
      <div class="nfx-row">
        <label class="nfx-lbl" v-hint="'Random velocity: each note loses up to this much velocity, for a human feel.'">RAND</label>
        <input type="range" min="0" max="1" step="0.01" :value="p.fxVelRandom ?? 0" @input="set('fxVelRandom', +$event.target.value)"
          @dblclick="set('fxVelRandom', 0)" />
        <span class="nfx-val">{{ Math.round((p.fxVelRandom ?? 0) * 100) }}%</span>
      </div>

      <!-- Chance -->
      <div class="nfx-row">
        <label class="nfx-lbl" v-hint="'Chance: each note of this channel only plays this often — great for evolving hats and percussion.'">CHANCE</label>
        <input type="range" min="0" max="1" step="0.01" :value="p.fxChance ?? 1" @input="set('fxChance', +$event.target.value)"
          @dblclick="set('fxChance', 1)" />
        <span class="nfx-val">{{ Math.round((p.fxChance ?? 1) * 100) }}%</span>
      </div>

      <button v-if="summary" class="nfx-reset" @click="reset">RESET NOTE FX</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { SCALE_DEFS, NOTE_NAMES, useStudio } from '../store/studio.js'
import { CHORD_TYPES, DIATONIC_CHORDS } from '../noteFx.js'
import { GROOVES } from '../grooves.js'

const props = defineProps({ channel: { type: Object, required: true } })
const { pushUndo, channels } = useStudio()

function applyGrooveToAll() {
  pushUndo()
  for (const ch of channels) {
    ch.params.groove = p.value.groove
    ch.params.grooveAmount = p.value.grooveAmount ?? 1
  }
}

const ARP_RATES = ['1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32']
const open = ref(true)
const p = computed(() => props.channel.params)
const isDrum = computed(() => props.channel.type === 'drum')

let lastUndoKey = ''
function set(key, value) {
  // One undo step per control, not per slider tick.
  if (lastUndoKey !== key) { pushUndo(); lastUndoKey = key }
  props.channel.params[key] = value
}

function reset() {
  pushUndo()
  lastUndoKey = ''
  for (const k of ['arpEnabled', 'fxChord', 'fxChordInv', 'fxScale', 'fxTranspose', 'fxVelMode', 'fxVel', 'fxVelRandom', 'fxChance', 'groove', 'grooveAmount']) {
    delete props.channel.params[k]
  }
}

const summary = computed(() => {
  const x = p.value, out = []
  if (x.arpEnabled) out.push('arp')
  if (x.fxChord && x.fxChord !== 'off') out.push((CHORD_TYPES[x.fxChord] ?? DIATONIC_CHORDS[x.fxChord])?.label.toLowerCase())
  if (x.fxScale && x.fxScale !== 'off') out.push(NOTE_NAMES[x.fxScaleRoot ?? 0] + ' ' + x.fxScale)
  if (x.fxTranspose) out.push((x.fxTranspose > 0 ? '+' : '') + x.fxTranspose + ' st')
  if (x.fxVelMode && x.fxVelMode !== 'off') out.push('vel')
  if (x.fxVelRandom) out.push('rand')
  if (x.fxChance != null && x.fxChance < 1) out.push(Math.round(x.fxChance * 100) + '%')
  if (x.groove && x.groove !== 'none') out.push(GROOVES[x.groove]?.label.toLowerCase())
  return out.join(' · ')
})
</script>

<style scoped>
.nfx { margin: 8px 10px; border: 1px solid var(--border-subtle); border-radius: 4px; background: var(--bg-control); font-family: 'Rajdhani', sans-serif; }
.nfx-hdr { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; border-bottom: 1px solid transparent; }
.nfx-hdr:hover { background: var(--bg-hover); }
.nfx-caret { color: var(--text-muted); font-size: 10px; width: 10px; }
.nfx-title { font-size: 10px; font-weight: 700; letter-spacing: 0.2em; color: var(--text-primary); white-space: nowrap; }
.nfx-summary { margin-left: auto; min-width: 0; font-size: 10px; color: var(--acc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nfx-body { padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 5px; }
/* Labels sit above their controls so the narrow sidebar keeps full-width selects. */
.nfx-row { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 5px; min-height: 22px; }
.nfx-row input[type=range] { flex: 1; min-width: 40px; accent-color: var(--acc); }
.nfx-lbl { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; color: var(--text-muted); flex: 0 0 100%; margin-top: 2px; }
.nfx-val { font-family: 'Share Tech Mono', monospace; font-size: 10px; width: 32px; text-align: right; color: var(--text-primary); }
.nfx-sel { flex: 1; min-width: 0; height: 20px; background: var(--bg-panel); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 3px; font-size: 11px; padding: 0 2px; }
.nfx-sel--sm { flex: 0 0 58px; }
.nfx-sel--xs { flex: 0 0 50px; }
.nfx-sel:disabled, .nfx-row input:disabled { opacity: 0.4; }
.nfx-tog {
  width: 46px; flex-shrink: 0; height: 20px; border-radius: 3px; cursor: pointer; font-family: inherit;
  font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
  background: var(--bg-panel); color: var(--text-muted); border: 1px solid var(--border-subtle);
}
.nfx-tog.on { background: var(--acc); color: #111; border-color: var(--acc); }
.nfx-reset {
  margin-top: 2px; height: 20px; background: none; border: 1px dashed var(--border); border-radius: 3px; cursor: pointer;
  color: var(--text-muted); font-family: inherit; font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
}
.nfx-reset:hover { color: #e74c3c; border-color: #e74c3c; }
</style>
