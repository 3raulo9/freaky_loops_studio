<template>
  <div class="playlist">

    <!-- ── Toolbar ──────────────────────────────────────────────────── -->
    <div class="pl-toolbar">

      <div class="tool-group">
        <button v-for="t in tools" :key="t.id" class="tool-btn"
          :class="{ active: playlistTool === t.id }"
          @click="playlistTool = t.id"
          :title="t.tip"
        >{{ t.icon }}</button>
      </div>

      <div class="divider" />

      <label class="tb-label">SNAP</label>
      <select v-model="snap" class="tb-select">
        <option value="cell">Cell</option>
        <option value="none">None</option>
      </select>

      <div class="divider" />

      <label class="tb-label">ZOOM</label>
      <input type="range" v-model.number="cellWidth" min="40" max="160" step="8" class="zoom-slider" />
      <span class="tb-val">{{ cellWidth }}px</span>

      <div class="divider" />

      <label class="use-pl-toggle">
        <input type="checkbox" v-model="usePlaylist" />
        <span>FOLLOW PLAYLIST</span>
      </label>

      <div class="tb-right">
        <button class="tb-btn" @click="addPlaylistTrack">+ TRACK</button>
        <button class="tb-btn" @click="addMarkerPrompt">+ MARKER</button>
      </div>

    </div>

    <!-- ── Main area: picker + timeline ───────────────────────────── -->
    <div class="pl-main">

      <!-- Pattern picker (left) -->
      <div class="pl-picker">
        <div class="picker-title">PATTERNS</div>
        <div class="picker-list">
          <div
            v-for="pat in patterns"
            :key="pat.id"
            class="picker-item"
            :class="{ selected: pickerPatternId === pat.id, current: currentPatternId === pat.id }"
            @click="pickerPatternId = pat.id"
            @dblclick="currentPatternId = pat.id"
            :title="'Double-click to edit in Channel Rack'"
          >
            <span class="picker-dot" :style="{ background: pat.color }" />
            <span class="picker-name">{{ pat.name }}</span>
            <span v-if="currentPatternId === pat.id" class="picker-active-badge">EDIT</span>
          </div>
        </div>
        <div class="picker-hint">Click = select for placing<br>Double-click = edit in rack</div>
      </div>

      <!-- Timeline -->
      <div class="pl-timeline" ref="timelineRef" @scroll="onTimelineScroll">

        <!-- Ruler row (sticky top) -->
        <div class="pl-ruler-row">
          <div class="ruler-corner" />
          <div
            v-for="c in PLAYLIST_CELLS"
            :key="c"
            class="ruler-cell"
            :class="{
              beat4:   (c-1) % 4 === 0,
              playing: isPlaying && displayCell === c-1,
            }"
            :style="{ width: cellWidth + 'px', minWidth: cellWidth + 'px' }"
            @click="addMarkerAt(c-1)"
            @contextmenu.prevent="removeMarkerAt(c-1)"
          >
            <span class="ruler-num">{{ c }}</span>
            <!-- Time marker -->
            <div
              v-if="markerAt(c-1)"
              class="time-marker"
              :title="'Right-click ruler to remove marker'"
            >{{ markerAt(c-1).label }}</div>
          </div>
        </div>

        <!-- Track rows -->
        <div
          v-for="track in playlistTracks"
          :key="track.id"
          class="pl-track-row"
          :class="{ muted: track.muted }"
          :style="{ '--track-color': track.color }"
        >
          <!-- Track header (sticky left) -->
          <div class="pl-track-header">
            <div
              class="track-led"
              :class="{ active: !track.muted, solo: track._soloed }"
              @click.stop="track.muted = !track.muted"
              @contextmenu.prevent="soloPlaylistTrack(track.id)"
              title="L: mute · R: solo"
            />
            <div class="track-color-strip" :style="{ background: track.color }" />
            <span class="track-name" @dblclick="startTrackRename(track)">{{ track.name }}</span>
            <button class="track-remove" @click="removePlaylistTrack(track.id)" title="Remove track">×</button>
          </div>

          <!-- Clip cells -->
          <div class="pl-track-cells"
            :style="{ width: (PLAYLIST_CELLS * cellWidth) + 'px' }"
            @mousedown.prevent="onCellsMouseDown($event, track)"
            @mousemove="onCellsMouseMove($event, track)"
            @mouseup="onCellsMouseUp"
            @contextmenu.prevent="onCellsRightClick($event, track)"
          >
            <!-- Beat grid lines -->
            <div class="grid-lines">
              <div
                v-for="c in PLAYLIST_CELLS"
                :key="c"
                class="grid-line"
                :class="{ beat4: (c-1) % 4 === 0 }"
                :style="{ left: (c-1) * cellWidth + 'px', width: cellWidth + 'px' }"
              />
            </div>
            <!-- Playhead -->
            <div
              v-if="isPlaying && displayCell >= 0"
              class="playhead"
              :style="{ left: displayCell * cellWidth + 'px' }"
            />
            <!-- Clips -->
            <div
              v-for="clip in clipsForTrack(track.id)"
              :key="clip.id"
              class="pl-clip"
              :class="{ drag: draggingClip === clip.id }"
              :style="{
                left:  clip.cell * cellWidth + 'px',
                width: (cellWidth - 2) + 'px',
                '--clip-color': patternColor(clip.patternId),
              }"
              @mousedown.stop="onClipMouseDown($event, clip)"
              @contextmenu.prevent.stop="removeClip(clip.id)"
              :title="patternName(clip.patternId) + ' — right-click to remove'"
            >
              <span class="clip-label">{{ patternName(clip.patternId) }}</span>
              <div class="clip-mini-preview">
                <div
                  v-for="note in previewNotes(clip)"
                  :key="note.id"
                  class="clip-note-dot"
                  :style="{ left: note.x + '%', bottom: note.y + '%' }"
                />
              </div>
            </div>
          </div>

        </div>

        <!-- Add track row -->
        <div class="pl-add-track-row">
          <div class="pl-track-header add-header">
            <button class="add-track-btn" @click="addPlaylistTrack">+ ADD TRACK</button>
          </div>
          <div :style="{ width: PLAYLIST_CELLS * cellWidth + 'px', height: '100%' }" />
        </div>

      </div>
    </div>

    <!-- Track rename overlay -->
    <div v-if="trackRenaming" class="rename-overlay" @click.self="trackRenaming=false">
      <div class="rename-box">
        <span class="rename-label">Rename track</span>
        <input ref="trackRenameInput" v-model="trackRenameName" class="rename-input"
               @keydown.enter="commitTrackRename" @keydown.esc="trackRenaming=false" maxlength="20" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitTrackRename">OK</button>
          <button class="rename-cancel" @click="trackRenaming=false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Add marker dialog -->
    <div v-if="markerDialog" class="rename-overlay" @click.self="markerDialog=false">
      <div class="rename-box">
        <span class="rename-label">Marker at cell {{ pendingMarkerCell + 1 }}</span>
        <input ref="markerInput" v-model="markerLabel" class="rename-input"
               placeholder="e.g. Intro, Verse, Drop…"
               @keydown.enter="commitMarker" @keydown.esc="markerDialog=false" maxlength="24" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitMarker">ADD</button>
          <button class="rename-cancel" @click="markerDialog=false">Cancel</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { useStudio } from '../store/studio.js'

const {
  patterns, currentPatternId, pickerPatternId, getPatData,
  playlistTracks, playlistClips, timeMarkers, usePlaylist,
  playlistTool, cellWidth, displayCell, isPlaying,
  addPlaylistTrack, removePlaylistTrack, soloPlaylistTrack,
  placeClip, removeClip, addTimeMarker, removeTimeMarker,
  PLAYLIST_CELLS,
} = useStudio()

// ── Tools ────────────────────────────────────────────────────────────────────
const tools = [
  { id: 'draw',  icon: '✏', tip: 'Draw — click to place/remove clips' },
  { id: 'paint', icon: '🖌', tip: 'Paint — drag to fill multiple cells' },
  { id: 'erase', icon: '✕', tip: 'Erase — click to remove clips' },
]
const snap = ref('cell')

// ── Clip helpers ─────────────────────────────────────────────────────────────
function clipsForTrack(trackId) {
  return playlistClips.filter(c => c.trackId === trackId)
}
function patternName(pid) {
  return patterns.find(p => p.id === pid)?.name ?? '?'
}
function patternColor(pid) {
  return patterns.find(p => p.id === pid)?.color ?? '#4ecdc4'
}

// Mini preview notes from pattern
function previewNotes(clip) {
  const notes = []
  const pat = patterns.find(p => p.id === clip.patternId)
  if (!pat) return notes
  // Collect a few notes for visual representation
  let id = 0
  const allChannelNotes = []
  getPatData && Object.entries(getPatData._internal ?? {})  // safe no-op if not exposed
  // Use the pianoNotes from the pattern's channel data (best effort)
  return notes  // return empty for now; full preview requires iterating patternData
}

// ── Marker helpers ───────────────────────────────────────────────────────────
function markerAt(cell) { return timeMarkers.find(m => m.cell === cell) }

const markerDialog = ref(false)
const markerLabel  = ref('Section')
const markerInput  = ref(null)
let   pendingMarkerCell = 0

function addMarkerPrompt() {
  pendingMarkerCell = 0
  markerLabel.value = 'Section'
  markerDialog.value = true
  nextTick(() => markerInput.value?.select())
}

function addMarkerAt(cell) {
  if (playlistTool.value !== 'draw') return
  if (markerAt(cell)) return
  pendingMarkerCell = cell
  markerLabel.value = 'Section'
  markerDialog.value = true
  nextTick(() => markerInput.value?.select())
}

function removeMarkerAt(cell) {
  const m = markerAt(cell)
  if (m) removeTimeMarker(m.id)
}

function commitMarker() {
  if (markerLabel.value.trim()) addTimeMarker(pendingMarkerCell, markerLabel.value.trim())
  markerDialog.value = false
}

// ── Mouse interaction for clip placement ────────────────────────────────────
const draggingClip   = ref(null)
let isPainting       = false
let paintStartCell   = -1

function cellFromEvent(e, trackEl) {
  const rect = trackEl.getBoundingClientRect()
  const x = e.clientX - rect.left
  return Math.floor(x / cellWidth.value)
}

function onCellsMouseDown(e, track) {
  if (e.button !== 0) return
  const cells = e.currentTarget
  const cell  = cellFromEvent(e, cells)
  if (cell < 0 || cell >= PLAYLIST_CELLS) return
  const tool = playlistTool.value

  if (tool === 'erase') {
    const clip = playlistClips.find(c => c.trackId === track.id && c.cell === cell)
    if (clip) removeClip(clip.id)
    return
  }

  if (tool === 'draw') {
    const clip = playlistClips.find(c => c.trackId === track.id && c.cell === cell)
    if (clip) { removeClip(clip.id); return }
    placeClip(track.id, cell, pickerPatternId.value)
  }

  if (tool === 'paint') {
    isPainting     = true
    paintStartCell = cell
    placeClip(track.id, cell, pickerPatternId.value)
    window.addEventListener('mouseup', stopPainting, { once: true })
  }
}

function onCellsMouseMove(e, track) {
  if (!isPainting || playlistTool.value !== 'paint') return
  const cell = cellFromEvent(e, e.currentTarget)
  if (cell >= 0 && cell < PLAYLIST_CELLS) placeClip(track.id, cell, pickerPatternId.value)
}

function onCellsMouseUp() { isPainting = false }
function stopPainting()   { isPainting = false }

function onCellsRightClick(e, track) {
  const cell = cellFromEvent(e, e.currentTarget)
  const clip = playlistClips.find(c => c.trackId === track.id && c.cell === cell)
  if (clip) removeClip(clip.id)
}

function onClipMouseDown(e, clip) {
  if (playlistTool.value === 'erase') removeClip(clip.id)
}

// ── Track rename ──────────────────────────────────────────────────────────────
const trackRenaming     = ref(false)
const trackRenameName   = ref('')
const trackRenameInput  = ref(null)
let   trackRenameTarget = null

function startTrackRename(track) {
  trackRenameTarget   = track
  trackRenameName.value = track.name
  trackRenaming.value   = true
  nextTick(() => trackRenameInput.value?.select())
}

function commitTrackRename() {
  if (trackRenameTarget && trackRenameName.value.trim())
    trackRenameTarget.name = trackRenameName.value.trim()
  trackRenaming.value = false
}

// ── Timeline ref (for potential scroll sync) ──────────────────────────────────
const timelineRef = ref(null)
function onTimelineScroll() {}
</script>

<style scoped>
.playlist { display: flex; flex-direction: column; flex: 1; overflow: hidden; background: #0c0c16; }

/* ── Toolbar ─────────────────────────────────────────────────────── */
.pl-toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 7px 14px; background: #0a0a12; border-bottom: 1px solid #1a1a28; flex-shrink: 0;
}
.tool-group { display: flex; gap: 3px; }
.tool-btn {
  width: 28px; height: 28px; border-radius: 5px; border: 1px solid #252535;
  background: transparent; cursor: pointer; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.1s; color: #50506a;
}
.tool-btn:hover  { border-color: #4a4a6a; color: #9090b8; }
.tool-btn.active { border-color: #e74c3c; background: #1a0808; color: #e74c3c; }
.divider { width: 1px; height: 22px; background: #252535; }
.tb-label {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #404058; text-transform: uppercase;
}
.tb-select {
  background: #141420; border: 1px solid #252535; color: #8080a0;
  padding: 3px 6px; border-radius: 4px; font-family: 'Rajdhani', sans-serif;
  font-size: 11px; cursor: pointer; outline: none;
}
.zoom-slider { width: 70px; accent-color: #e74c3c; height: 3px; cursor: pointer; }
.tb-val { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #40405a; min-width: 30px; }
.use-pl-toggle {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; color: #50506a; user-select: none;
}
.use-pl-toggle input { accent-color: #e74c3c; cursor: pointer; }
.tb-right { margin-left: auto; display: flex; gap: 6px; }
.tb-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; padding: 4px 10px; border: 1px dashed #252535;
  border-radius: 5px; background: transparent; color: #404058; cursor: pointer; transition: all 0.12s;
}
.tb-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }

/* ── Main body ───────────────────────────────────────────────────── */
.pl-main { display: flex; flex: 1; overflow: hidden; }

/* ── Picker panel ────────────────────────────────────────────────── */
.pl-picker {
  width: 160px; min-width: 160px; background: #0a0a14;
  border-right: 1px solid #1a1a28;
  display: flex; flex-direction: column; overflow: hidden;
}
.picker-title {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.2em; color: #303048; text-transform: uppercase;
  padding: 8px 10px 5px; border-bottom: 1px solid #111118;
}
.picker-list { flex: 1; overflow-y: auto; }
.picker-item {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  cursor: pointer; border-bottom: 1px solid #0c0c14;
  transition: background 0.08s; position: relative;
}
.picker-item:hover   { background: #121220; }
.picker-item.selected { background: #141428; }
.picker-item.current  { border-left: 2px solid #e74c3c; }
.picker-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.picker-name {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; color: #8080a0; flex: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.picker-item.selected .picker-name { color: #c0c0e0; }
.picker-active-badge {
  font-family: 'Share Tech Mono', monospace; font-size: 8px;
  color: #e74c3c; background: #1a0808; border: 1px solid #e74c3c33;
  padding: 1px 4px; border-radius: 3px;
}
.picker-hint {
  padding: 8px 10px; font-family: 'Share Tech Mono', monospace;
  font-size: 9px; color: #25253a; line-height: 1.6; border-top: 1px solid #111118;
}

/* ── Timeline ────────────────────────────────────────────────────── */
.pl-timeline { flex: 1; overflow: auto; position: relative; }

/* ── Ruler ───────────────────────────────────────────────────────── */
.pl-ruler-row {
  display: flex; position: sticky; top: 0; z-index: 10;
  background: #080810; border-bottom: 1px solid #1a1a28;
  min-height: 28px;
}
.ruler-corner {
  width: 140px; min-width: 140px;
  position: sticky; left: 0; z-index: 11;
  background: #060608; border-right: 1px solid #1a1a28;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #252540; display: flex; align-items: center; padding-left: 10px;
}
.ruler-cell {
  border-right: 1px solid #0e0e18; flex-shrink: 0; position: relative;
  display: flex; align-items: center; padding-left: 4px; cursor: pointer;
  transition: background 0.08s;
}
.ruler-cell:hover { background: #0e0e20; }
.ruler-cell.beat4 { border-left: 2px solid #1e1e30; }
.ruler-cell.playing { background: rgba(255,255,255,0.08); }
.ruler-num { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #35355a; }
.time-marker {
  position: absolute; top: 0; left: 0; right: 0;
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; color: #e74c3c; background: #1a0808;
  border-bottom: 2px solid #e74c3c; padding: 0 4px; line-height: 26px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 1;
}

/* ── Track row ───────────────────────────────────────────────────── */
.pl-track-row {
  display: flex; min-height: 52px; border-bottom: 1px solid #0c0c14;
  transition: opacity 0.1s;
}
.pl-track-row.muted { opacity: 0.35; }

/* Track header (sticky left) */
.pl-track-header {
  width: 140px; min-width: 140px; flex-shrink: 0;
  position: sticky; left: 0; z-index: 5;
  background: #0a0a14; border-right: 1px solid #1a1a28;
  display: flex; align-items: center; gap: 5px; padding: 0 6px 0 4px;
}
.track-led {
  width: 10px; height: 10px; border-radius: 50%;
  background: #1a1a28; border: 1px solid #252535;
  cursor: pointer; flex-shrink: 0; transition: all 0.12s;
}
.track-led.active { background: #2ecc71; border-color: #2ecc71; box-shadow: 0 0 5px #2ecc7188; }
.track-led.solo   { background: #f39c12; border-color: #f39c12; box-shadow: 0 0 5px #f39c1288; }
.track-color-strip { width: 3px; align-self: stretch; background: var(--track-color); border-radius: 1px; flex-shrink: 0; }
.track-name {
  flex: 1; font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; color: #8080a0; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; cursor: text;
}
.track-remove {
  font-size: 13px; background: transparent; border: none; color: #2a2a3c;
  cursor: pointer; padding: 2px 4px; border-radius: 3px; flex-shrink: 0; transition: color 0.1s;
}
.track-remove:hover { color: #e74c3c; }

/* Track cells area */
.pl-track-cells {
  position: relative; flex-shrink: 0; min-height: 52px; cursor: crosshair;
}

/* Grid lines */
.grid-lines { position: absolute; inset: 0; pointer-events: none; }
.grid-line {
  position: absolute; top: 0; bottom: 0;
  border-left: 1px solid #0e0e18;
}
.grid-line.beat4 { border-left-color: #161628; }

/* Playhead */
.playhead {
  position: absolute; top: 0; bottom: 0; width: 2px;
  background: rgba(255,255,255,0.6); pointer-events: none; z-index: 3;
  box-shadow: 0 0 6px rgba(255,255,255,0.4);
}

/* Clip block */
.pl-clip {
  position: absolute; top: 3px; bottom: 3px;
  background: color-mix(in srgb, var(--clip-color) 35%, #0e0e1a);
  border: 1px solid color-mix(in srgb, var(--clip-color) 60%, transparent);
  border-radius: 4px; overflow: hidden; cursor: pointer;
  transition: filter 0.08s; z-index: 2;
}
.pl-clip:hover { filter: brightness(1.15); }
.clip-label {
  position: absolute; top: 2px; left: 4px; right: 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.08em; color: var(--clip-color); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; pointer-events: none;
  text-shadow: 0 0 4px rgba(0,0,0,0.8);
}
.clip-mini-preview {
  position: absolute; inset: 14px 2px 2px 2px;
  pointer-events: none; overflow: hidden;
}
.clip-note-dot {
  position: absolute; width: 2px; height: 2px; border-radius: 1px;
  background: var(--clip-color); opacity: 0.8;
}

/* Add track row */
.pl-add-track-row { display: flex; min-height: 36px; }
.add-header {
  width: 140px; min-width: 140px; position: sticky; left: 0;
  background: #0a0a14; border-right: 1px solid #1a1a28;
}
.add-track-btn {
  width: 100%; height: 100%; background: transparent; border: none;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; color: #303048; cursor: pointer; transition: color 0.1s;
}
.add-track-btn:hover { color: #4ecdc4; }

/* ── Rename / marker overlay ────────────────────────────────────── */
.rename-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
}
.rename-box {
  background: #181828; border: 1px solid #2a2a3c; border-radius: 8px;
  padding: 20px 24px; display: flex; flex-direction: column; gap: 10px;
  min-width: 280px; box-shadow: 0 12px 40px rgba(0,0,0,0.8);
}
.rename-label { font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0.1em; color: #606080; }
.rename-input {
  background: #0e0e1c; border: 1px solid #3a3a5a; color: #e0e0ee;
  padding: 7px 10px; border-radius: 5px; font-family: 'Rajdhani', sans-serif;
  font-size: 16px; font-weight: 700; letter-spacing: 0.1em; outline: none;
}
.rename-input:focus { border-color: #e74c3c; }
.rename-btns { display: flex; gap: 8px; justify-content: flex-end; }
.rename-ok {
  padding: 6px 18px; background: #e74c3c22; border: 1px solid #e74c3c; color: #e74c3c;
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 700;
  transition: all 0.1s;
}
.rename-ok:hover { background: #e74c3c; color: #fff; }
.rename-cancel {
  padding: 6px 14px; background: transparent; border: 1px solid #252535; color: #606080;
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 13px;
}
</style>
