<template>
  <div class="ses" @click="ctx = null">
    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <div class="ses-bar">
      <span class="ses-title">SESSION</span>
      <span class="ses-sub">launch patterns live · scenes are rows, tracks are columns</span>
      <div class="ses-bar-right">
        <label class="ses-lbl" v-hint="'Launched slots start on the next bar, or on every Nth bar.'">LAUNCH
          <select v-model.number="sessionQuantize" class="ses-sel">
            <option :value="1">1 bar</option>
            <option :value="2">2 bars</option>
            <option :value="4">4 bars</option>
            <option :value="8">8 bars</option>
          </select>
        </label>
        <button class="ses-btn" v-hint="'Add the clips playing right now as a new scene.'"
          :disabled="!playingCount" @click="captureSessionScene">CAPTURE</button>
        <button class="ses-btn" :class="{ rec: sessionRecording }"
          v-hint="'Record your launches into the playlist. Press again to stop and write the clips.'"
          @click="onRecord">● REC → PLAYLIST</button>
        <button class="ses-btn" v-hint="'Lay every scene end to end in the playlist, in order.'"
          @click="onScenesToPlaylist">SCENES → PLAYLIST</button>
        <button class="ses-btn ses-stopall" v-hint="'Stop every playing clip at the next launch point.'"
          @click="stopAllSessionClips">■ STOP ALL</button>
      </div>
    </div>

    <div class="ses-body">
      <!-- ── Pattern palette (drag onto slots) ───────────────────────── -->
      <aside class="ses-pal">
        <div class="ses-pal-title">PATTERNS</div>
        <div v-for="p in patterns" :key="p.id" class="ses-pal-item"
          :class="{ active: p.id === pickerPatternId }"
          draggable="true"
          @dragstart="onPaletteDrag($event, p.id)"
          @click="pickerPatternId = p.id"
          v-hint="'Click to pick, then click an empty slot — or drag it onto a slot.'">
          <span class="ses-pal-dot" :style="{ background: p.color }" />{{ p.name }}
        </div>
      </aside>

      <!-- ── Grid ─────────────────────────────────────────────────────── -->
      <div class="ses-grid-wrap">
        <table class="ses-grid">
          <thead>
            <tr>
              <th v-for="t in playlistTracks" :key="t.id" class="ses-track-hdr" :style="{ '--tc': t.color }">
                <span class="ses-track-name">{{ t.name }}</span>
                <button class="ses-mute" :class="{ on: t.muted }" @click.stop="t.muted = !t.muted"
                  v-hint="'Mute this track (its clips keep their place but go silent).'">M</button>
              </th>
              <th class="ses-scene-hdr">SCENES</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sc in sessionScenes" :key="sc.id">
              <td v-for="t in playlistTracks" :key="t.id" class="ses-cell"
                @dragover.prevent @drop.prevent="onDrop($event, t.id, sc.id)">
                <div v-if="slotOf(t.id, sc.id)" class="ses-slot"
                  :class="slotClass(t.id, sc.id)"
                  :style="{ '--pc': patternColor(slotOf(t.id, sc.id).patternId) }"
                  draggable="true"
                  @dragstart="onSlotDrag($event, t.id, sc.id)"
                  @click.stop="launchSessionSlot(t.id, sc.id)"
                  @dblclick.stop="openPattern(slotOf(t.id, sc.id).patternId)"
                  @contextmenu.prevent.stop="openCtx($event, t.id, sc.id)">
                  <span class="ses-play">{{ isPlayingSlot(t.id, sc.id) ? '■' : '▶' }}</span>
                  <span class="ses-slot-name">{{ patternName(slotOf(t.id, sc.id).patternId) }}</span>
                  <span class="ses-slot-len">{{ patternBars(slotOf(t.id, sc.id).patternId) }}</span>
                  <div v-if="isPlayingSlot(t.id, sc.id)" class="ses-progress"
                    :style="{ width: (sessionSlotProgress(t.id) * 100) + '%' }" />
                </div>
                <div v-else class="ses-empty"
                  @click.stop="setSessionSlot(t.id, sc.id, pickerPatternId)"
                  @contextmenu.prevent.stop="openCtx($event, t.id, sc.id)"
                  v-hint="'Click to place the picked pattern here.'">
                  <span class="ses-empty-stop" @click.stop="stopSessionTrack(t.id)">■</span>
                </div>
              </td>
              <td class="ses-scene">
                <button class="ses-scene-btn" :class="{ live: sceneIsLive(sc.id) }"
                  @click.stop="launchSessionScene(sc.id)"
                  @dblclick.stop="renameScene(sc)"
                  @contextmenu.prevent.stop="sceneCtx = sceneCtx === sc.id ? null : sc.id"
                  v-hint="'Launch the whole row. Double-click to rename.'">
                  <span class="ses-play">▶</span>{{ sc.name }}
                </button>
                <button v-if="sceneCtx === sc.id" class="ses-scene-del" @click.stop="removeSessionScene(sc.id); sceneCtx = null">✕</button>
              </td>
            </tr>
            <!-- Clip stop row -->
            <tr class="ses-stop-row">
              <td v-for="t in playlistTracks" :key="t.id">
                <button class="ses-track-stop" :class="{ live: !!sessionPlaying[t.id] }"
                  @click.stop="stopSessionTrack(t.id)" v-hint="'Stop this track at the next launch point.'">■</button>
              </td>
              <td><button class="ses-btn ses-add-scene" @click.stop="addSessionScene">+ SCENE</button></td>
            </tr>
          </tbody>
        </table>
        <button class="ses-add-track" @click.stop="addPlaylistTrack">+ TRACK</button>
      </div>
    </div>

    <!-- ── Slot context menu ───────────────────────────────────────────── -->
    <div v-if="ctx" class="ses-ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @click.stop>
      <template v-if="slotOf(ctx.track, ctx.scene)">
        <div class="ses-ctx-item" @click="launchSessionSlot(ctx.track, ctx.scene); ctx = null">Launch</div>
        <div class="ses-ctx-item" @click="openPattern(slotOf(ctx.track, ctx.scene).patternId); ctx = null">Edit pattern</div>
        <div class="ses-ctx-item" @click="duplicateDown(ctx.track, ctx.scene); ctx = null">Duplicate to next scene</div>
        <div class="ses-ctx-item" @click="setSessionSlot(ctx.track, ctx.scene, null); ctx = null">Clear slot</div>
        <div class="ses-ctx-sep" />
      </template>
      <div class="ses-ctx-hdr">SET PATTERN</div>
      <div v-for="p in patterns" :key="p.id" class="ses-ctx-item" @click="setSessionSlot(ctx.track, ctx.scene, p.id); ctx = null">
        <span class="ses-pal-dot" :style="{ background: p.color }" />{{ p.name }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useStudio, TICKS_PER_STEP } from '../store/studio.js'

const {
  patterns, pickerPatternId, currentPatternId, mainView, playlistTracks, addPlaylistTrack,
  totalSteps, getPatternLengthTicks,
  sessionScenes, sessionPlaying, sessionQueued, sessionQuantize, sessionRecording,
  getSessionSlot, setSessionSlot, moveSessionSlot, addSessionScene, removeSessionScene, renameSessionScene,
  captureSessionScene, launchSessionSlot, launchSessionScene, stopSessionTrack, stopAllSessionClips,
  sessionSlotProgress, toggleSessionRecording, sessionScenesToPlaylist,
} = useStudio()

const ctx = ref(null)        // { x, y, track, scene }
const sceneCtx = ref(null)

const playingCount = computed(() => Object.keys(sessionPlaying).length)

const slotOf = (t, sc) => getSessionSlot(t, sc)
const patternOf = id => patterns.find(p => p.id === id)
const patternName = id => patternOf(id)?.name ?? '(deleted)'
const patternColor = id => patternOf(id)?.color ?? '#666'
function patternBars(id) {
  const bars = Math.max(1, Math.ceil(getPatternLengthTicks(id) / (totalSteps.value * TICKS_PER_STEP)))
  return bars + (bars === 1 ? ' bar' : ' bars')
}
const isPlayingSlot = (t, sc) => sessionPlaying[t]?.sceneId === sc
const isQueuedSlot = (t, sc) => sessionQueued[t]?.sceneId === sc && sessionQueued[t]?.patternId
function slotClass(t, sc) {
  return {
    playing: isPlayingSlot(t, sc),
    queued: isQueuedSlot(t, sc),
    stopping: isPlayingSlot(t, sc) && sessionQueued[t] && !sessionQueued[t].patternId,
  }
}
const sceneIsLive = sc => playlistTracks.some(t => isPlayingSlot(t.id, sc))

function openPattern(id) {
  if (!patternOf(id)) return
  currentPatternId.value = id
  mainView.value = 'sequencer'
}
function openCtx(e, track, scene) {
  ctx.value = { x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 260), track, scene }
}
function duplicateDown(track, scene) {
  const i = sessionScenes.findIndex(s => s.id === scene)
  if (i === sessionScenes.length - 1) addSessionScene()
  moveSessionSlot(track, scene, track, sessionScenes[i + 1].id, true)
}
function renameScene(sc) {
  const name = prompt('Scene name:', sc.name)
  if (name) renameSessionScene(sc.id, name.trim())
}
function onRecord() {
  const placed = toggleSessionRecording()
  if (!sessionRecording.value && placed) mainView.value = 'playlist'
}
function onScenesToPlaylist() {
  if (sessionScenesToPlaylist() > 0) mainView.value = 'playlist'
}

// Drag & drop: patterns from the palette, slots between cells (Ctrl = copy).
function onPaletteDrag(e, patternId) {
  e.dataTransfer.setData('text/x-fls-pattern', patternId)
  e.dataTransfer.effectAllowed = 'copy'
}
function onSlotDrag(e, track, scene) {
  e.dataTransfer.setData('text/x-fls-slot', JSON.stringify({ track, scene }))
  e.dataTransfer.effectAllowed = 'copyMove'
}
function onDrop(e, track, scene) {
  const pid = e.dataTransfer.getData('text/x-fls-pattern')
  if (pid) { setSessionSlot(track, scene, pid); return }
  const raw = e.dataTransfer.getData('text/x-fls-slot')
  if (raw) {
    const from = JSON.parse(raw)
    moveSessionSlot(from.track, from.scene, track, scene, e.ctrlKey)
  }
}
</script>

<style scoped>
.ses { display: flex; flex-direction: column; height: 100%; background: var(--bg-base); color: var(--text-primary); font-family: 'Rajdhani', sans-serif; position: relative; }
.ses-bar { display: flex; align-items: center; gap: 12px; padding: 7px 12px; background: var(--bg-header); border-bottom: 1px solid var(--border-subtle); }
.ses-title { font-weight: 700; letter-spacing: 0.22em; font-size: 12px; }
.ses-sub { color: var(--text-muted); font-size: 11px; }
.ses-bar-right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.ses-lbl { font-size: 10px; letter-spacing: 0.14em; color: var(--text-muted); display: flex; align-items: center; gap: 5px; }
.ses-sel { background: var(--bg-control); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 3px; font-size: 11px; padding: 1px 3px; }
.ses-btn {
  background: var(--bg-control); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 3px;
  font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; padding: 3px 9px; cursor: pointer;
}
.ses-btn:hover:not(:disabled) { border-color: #f0a030; color: #f0a030; }
.ses-btn:disabled { opacity: 0.4; cursor: default; }
.ses-btn.rec { background: #5a1414; border-color: #e74c3c; color: #ffb0a8; animation: ses-blink 1s steps(2) infinite; }
.ses-stopall:hover { border-color: #e74c3c !important; color: #e74c3c !important; }

.ses-body { flex: 1; display: flex; min-height: 0; }
.ses-pal { width: 150px; flex-shrink: 0; overflow-y: auto; background: var(--bg-panel); border-right: 1px solid var(--border-subtle); padding: 6px 0; }
.ses-pal-title { font-size: 9px; letter-spacing: 0.2em; color: var(--text-muted); padding: 2px 10px 6px; font-weight: 700; }
.ses-pal-item { display: flex; align-items: center; gap: 7px; padding: 4px 10px; font-size: 13px; cursor: grab; }
.ses-pal-item:hover { background: var(--bg-hover); }
.ses-pal-item.active { background: color-mix(in srgb, #f0a030 18%, transparent); box-shadow: inset 2px 0 #f0a030; }
.ses-pal-dot { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; display: inline-block; }

.ses-grid-wrap { flex: 1; overflow: auto; padding: 8px; display: flex; align-items: flex-start; gap: 8px; }
.ses-grid { border-collapse: separate; border-spacing: 3px; }
.ses-track-hdr {
  min-width: 132px; height: 28px; padding: 0 6px; background: var(--bg-panel); border-radius: 3px;
  border-top: 3px solid var(--tc); text-align: left; font-size: 12px; font-weight: 700;
}
.ses-track-hdr { position: relative; }
.ses-track-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; max-width: 96px; vertical-align: middle; }
.ses-mute { position: absolute; right: 5px; top: 5px; width: 18px; height: 16px; font-size: 9px; font-weight: 700; border-radius: 2px; cursor: pointer; background: var(--bg-control); color: var(--text-muted); border: 1px solid var(--border-subtle); }
.ses-mute.on { background: #f0a030; color: #111; border-color: #f0a030; }
.ses-scene-hdr { font-size: 9px; letter-spacing: 0.2em; color: var(--text-muted); text-align: left; padding-left: 4px; }

.ses-cell { width: 132px; height: 30px; padding: 0; }
.ses-slot {
  position: relative; height: 30px; display: flex; align-items: center; gap: 6px; padding: 0 7px; overflow: hidden;
  background: color-mix(in srgb, var(--pc) 45%, var(--bg-control)); border: 1px solid color-mix(in srgb, var(--pc) 70%, #000);
  border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: 600; color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,0.5);
}
.ses-slot:hover { filter: brightness(1.15); }
.ses-slot.playing { background: color-mix(in srgb, var(--pc) 75%, var(--bg-control)); border-color: #fff; box-shadow: 0 0 0 1px var(--pc), 0 0 10px color-mix(in srgb, var(--pc) 60%, transparent); }
.ses-slot.queued { animation: ses-blink 0.5s steps(2) infinite; border-color: #f0a030; }
.ses-slot.stopping { animation: ses-blink 0.5s steps(2) infinite; }
.ses-play { font-size: 9px; width: 10px; flex-shrink: 0; }
.ses-slot-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ses-slot-len { font-size: 9px; opacity: 0.75; font-family: 'Share Tech Mono', monospace; }
.ses-progress { position: absolute; left: 0; bottom: 0; height: 3px; background: #fff; opacity: 0.85; pointer-events: none; }
.ses-empty {
  height: 30px; border-radius: 3px; background: var(--bg-control); border: 1px dashed var(--border-subtle);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.ses-empty:hover { border-color: #f0a030; background: var(--bg-hover); }
.ses-empty-stop { font-size: 8px; color: var(--text-muted); opacity: 0.45; padding: 4px 8px; }
.ses-empty-stop:hover { opacity: 1; color: #e74c3c; }

.ses-scene { white-space: nowrap; }
.ses-scene-btn {
  min-width: 120px; height: 30px; text-align: left; padding: 0 9px; display: inline-flex; align-items: center; gap: 7px;
  background: var(--bg-panel); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 3px;
  font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}
.ses-scene-btn:hover { border-color: #2ecc71; color: #2ecc71; }
.ses-scene-btn.live { border-color: #2ecc71; box-shadow: inset 3px 0 #2ecc71; }
.ses-scene-del { margin-left: 3px; height: 24px; background: #5a1414; color: #ffb0a8; border: 1px solid #e74c3c; border-radius: 3px; cursor: pointer; }
.ses-stop-row td { padding-top: 4px; }
.ses-track-stop {
  width: 100%; height: 22px; background: var(--bg-panel); color: var(--text-muted); border: 1px solid var(--border-subtle);
  border-radius: 3px; cursor: pointer; font-size: 10px;
}
.ses-track-stop.live { color: #e74c3c; border-color: #e74c3c; }
.ses-track-stop:hover { color: #e74c3c; }
.ses-add-scene { width: 100%; }
.ses-add-track {
  writing-mode: vertical-rl; height: 120px; margin-top: 34px; background: var(--bg-panel); color: var(--text-muted);
  border: 1px dashed var(--border); border-radius: 3px; cursor: pointer; font-family: inherit; font-weight: 700; letter-spacing: 0.15em; font-size: 10px;
}
.ses-add-track:hover { color: #f0a030; border-color: #f0a030; }

.ses-ctx {
  position: fixed; z-index: 500; min-width: 190px; max-height: 60vh; overflow-y: auto; padding: 4px 0;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 4px; box-shadow: 0 10px 26px rgba(0,0,0,0.45);
}
.ses-ctx-item { display: flex; align-items: center; gap: 7px; padding: 4px 12px; font-size: 13px; cursor: pointer; }
.ses-ctx-item:hover { background: var(--bg-hover); }
.ses-ctx-sep { height: 1px; margin: 4px 8px; background: var(--border-subtle); }
.ses-ctx-hdr { padding: 4px 12px 2px; font-size: 9px; letter-spacing: 0.18em; color: var(--text-muted); font-weight: 700; }

@keyframes ses-blink { 50% { opacity: 0.45; } }
</style>
