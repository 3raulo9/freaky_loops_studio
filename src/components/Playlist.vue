<template>
  <div class="playlist" @wheel.prevent="onWheel" @click="closeMenus" @keydown.esc="closeMenus">

<<<<<<< HEAD
    <!-- ── Toolbar ─────────────────────────────────────────────────────────────── -->
    <div class="pl-toolbar">

      <!-- Clip focus icons -->
      <div class="focus-group" title="Clip layer focus">
        <button class="focus-btn" :class="{ active: clipFocusMode === 'pattern' }"
          @click="clipFocusMode = 'pattern'; pickerTab = 'patterns'" title="Pattern clips (⌨)">
          <span class="focus-icon">⌨</span>
          <span class="focus-lbl">PAT</span>
        </button>
        <button class="focus-btn" :class="{ active: clipFocusMode === 'automation' }"
          @click="clipFocusMode = 'automation'; pickerTab = 'automation'" title="Automation clips (⌇)">
          <span class="focus-icon">⌇</span>
          <span class="focus-lbl">AUTO</span>
        </button>
=======
    <!-- ── Toolbar ──────────────────────────────────────────────────── -->
    <div class="pl-toolbar">

      <div class="tool-group">
        <button v-for="t in tools" :key="t.id" class="tool-btn"
          :class="{ active: playlistTool === t.id }"
          @click="playlistTool = t.id"
          :title="t.tip"
        >{{ t.icon }}</button>
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
      </div>

      <div class="divider" />

<<<<<<< HEAD
      <!-- Edit tools -->
      <div class="tool-group">
        <button v-for="t in tools" :key="t.id" class="tool-btn"
          :class="{ active: playlistTool === t.id }"
          @click="playlistTool = t.id" :title="t.tip">{{ t.icon }}</button>
      </div>

      <div class="divider" />

      <label class="tb-label">SNAP</label>
      <select v-model="snap" class="tb-select">
        <option value="cell">Cell</option>
        <option value="half">½ Cell</option>
=======
      <label class="tb-label">SNAP</label>
      <select v-model="snap" class="tb-select">
        <option value="cell">Cell</option>
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
        <option value="none">None</option>
      </select>

      <div class="divider" />

      <label class="tb-label">ZOOM</label>
<<<<<<< HEAD
      <input type="range" v-model.number="cellWidth" min="32" max="200" step="8" class="zoom-slider" />
=======
      <input type="range" v-model.number="cellWidth" min="40" max="160" step="8" class="zoom-slider" />
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
      <span class="tb-val">{{ cellWidth }}px</span>

      <div class="divider" />

      <label class="use-pl-toggle">
        <input type="checkbox" v-model="usePlaylist" />
<<<<<<< HEAD
        <span>FOLLOW</span>
=======
        <span>FOLLOW PLAYLIST</span>
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
      </label>

      <div class="tb-right">
        <button class="tb-btn" @click="addPlaylistTrack">+ TRACK</button>
<<<<<<< HEAD
        <button class="tb-btn" @click="addAutoTrack">+ AUTO</button>
=======
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
        <button class="tb-btn" @click="addMarkerPrompt">+ MARKER</button>
      </div>

    </div>

<<<<<<< HEAD
    <!-- ── Mini-map ────────────────────────────────────────────────────────────── -->
    <div class="pl-minimap" ref="minimapEl" @click="onMinimapClick">
      <div class="minimap-bg">
        <div
          v-for="clip in playlistClips"
          :key="clip.id"
          class="minimap-clip"
          :style="minimapClipStyle(clip)"
        />
        <div
          v-for="auto in automationClips"
          :key="auto.id"
          class="minimap-clip minimap-auto"
          :style="minimapAutoStyle(auto)"
        />
        <div class="minimap-viewport" :style="minimapViewportStyle" />
      </div>
    </div>

    <!-- ── Main area ───────────────────────────────────────────────────────────── -->
    <div class="pl-main">

      <!-- ── Picker panel ──────────────────────────────────────────────────────── -->
      <div class="pl-picker">
        <div class="picker-tabs">
          <button class="ptab" :class="{ active: pickerTab === 'patterns' }" @click="pickerTab = 'patterns'">PATTERNS</button>
          <button class="ptab" :class="{ active: pickerTab === 'automation' }" @click="pickerTab = 'automation'">PARAMS</button>
        </div>

        <!-- Patterns tab -->
        <div v-if="pickerTab === 'patterns'" class="picker-list">
          <div
            v-for="pat in patterns" :key="pat.id"
            class="picker-item"
            :class="{
              selected:  pickerPatternId === pat.id,
              current:   currentPatternId === pat.id,
              unused:    unusedPatternIds.has(pat.id),
            }"
            @click="pickerPatternId = pat.id"
            @dblclick="currentPatternId = pat.id"
            :title="unusedPatternIds.has(pat.id) ? 'Not placed in Playlist' : 'Double-click to edit'"
          >
            <span class="picker-dot" :style="{ background: pat.color }" />
            <span class="picker-name">{{ pat.name }}</span>
            <span v-if="currentPatternId === pat.id" class="picker-badge edit">EDIT</span>
            <span v-else-if="unusedPatternIds.has(pat.id)" class="picker-badge unused">–</span>
          </div>
        </div>

        <!-- Automation params tab -->
        <div v-else class="picker-list">
          <div class="picker-section">CHANNEL PARAMS</div>
          <div
            v-for="entry in autoParamOptions" :key="entry.key"
            class="picker-item"
            :class="{ selected: pickerAutoParam === entry.key }"
            @click="pickerAutoParam = entry.key"
          >
            <span class="picker-dot" :style="{ background: entry.color }" />
            <span class="picker-name">{{ entry.label }}</span>
          </div>
        </div>

        <div class="picker-actions">
          <button class="picker-action-btn" @click="highlightUnused" title="Highlight patterns not placed on timeline">SELECT UNUSED</button>
        </div>
        <div class="picker-hint">
          <template v-if="pickerTab === 'patterns'">Click = select · Dbl = edit</template>
          <template v-else>Select param, draw on track</template>
        </div>
      </div>

      <!-- ── Timeline ──────────────────────────────────────────────────────────── -->
      <div class="pl-timeline" ref="timelineRef" @scroll="onTimelineScroll">

        <!-- Ruler row -->
        <div class="pl-ruler-row">
          <div class="ruler-corner">PLAYLIST</div>
          <div
            v-for="c in PLAYLIST_CELLS" :key="c"
            class="ruler-cell"
            :class="{
              beat4:   (c - 1) % 4 === 0,
              playing: isPlaying && displayCell === c - 1,
            }"
            :style="{ width: cellWidth + 'px', minWidth: cellWidth + 'px' }"
            @click.exact="addMarkerAt(c - 1)"
            @contextmenu.prevent="removeMarkerAt(c - 1)"
          >
            <span class="ruler-num">{{ c }}</span>
            <div v-if="markerAt(c - 1)" class="time-marker">{{ markerAt(c - 1).label }}</div>
          </div>
        </div>

        <!-- Track rows -->
        <template v-for="track in visibleTracks" :key="track.id">
          <div
            class="pl-track-row"
            :class="{
              muted:    track.muted,
              grouped:  !!track.groupParentId,
              locked:   track.locked,
            }"
            :style="{ '--track-color': track.color, height: trackHeight + 'px' }"
          >
            <!-- Track header -->
            <div class="pl-track-header" @contextmenu.prevent="openTrackMenu($event, track)">
              <!-- Group indent + collapse arrow -->
              <div v-if="track.groupParentId" class="track-indent" />
              <button
                v-if="hasChildren(track)"
                class="track-collapse-btn"
                @click.stop="toggleTrackCollapse(track.id)"
                :title="track.collapsed ? 'Expand group' : 'Collapse group'"
              >{{ track.collapsed ? '▶' : '▼' }}</button>

              <div
                class="track-led"
                :class="{ active: !track.muted, solo: track._soloed }"
                @click.stop="track.muted = !track.muted"
                @contextmenu.prevent.stop="soloPlaylistTrack(track.id)"
                title="L: mute · R: solo"
              />
              <div class="track-color-strip" :style="{ background: track.color }" />
              <span class="track-name" @dblclick.stop="startTrackRename(track)">{{ track.name }}</span>
              <span v-if="track.locked" class="track-lock" title="Track locked">⚿</span>
              <button class="track-remove" @click.stop="removePlaylistTrack(track.id)" title="Remove track">×</button>
            </div>

            <!-- Clip cells area -->
            <div
              class="pl-track-cells"
              :style="{ width: PLAYLIST_CELLS * cellWidth + 'px' }"
              @mousedown.prevent="onCellsMouseDown($event, track)"
              @mousemove="onCellsMouseMove($event, track)"
              @mouseup="onCellsMouseUp"
              @contextmenu.prevent="onCellsRightClick($event, track)"
            >
              <!-- Grid lines -->
              <div class="grid-lines">
                <div
                  v-for="c in PLAYLIST_CELLS" :key="c"
                  class="grid-line"
                  :class="{ beat4: (c - 1) % 4 === 0 }"
                  :style="{ left: (c - 1) * cellWidth + 'px', width: cellWidth + 'px' }"
                />
              </div>

              <!-- Playhead -->
              <div
                v-if="isPlaying && displayCell >= 0"
                class="playhead"
                :style="{ left: displayCell * cellWidth + 'px' }"
              />

              <!-- Pattern clips -->
              <template v-if="clipFocusMode === 'pattern' || clipFocusMode === 'automation'">
                <div
                  v-for="clip in patternClipsForTrack(track.id)"
                  :key="clip.id"
                  class="pl-clip"
                  :class="{
                    ghost:    clipFocusMode === 'automation',
                    dragging: draggingClip?.id === clip.id,
                  }"
                  :style="patternClipStyle(clip)"
                  @mousedown.stop="onClipMouseDown($event, clip, track)"
                  @contextmenu.prevent.stop="openClipMenu($event, clip)"
                  :title="patternName(clip.patternId) + ' — right-click for options'"
                >
                  <span class="clip-label">{{ patternName(clip.patternId) }}</span>
                  <svg class="clip-preview-svg" preserveAspectRatio="none">
                    <rect
                      v-for="note in previewNotes(clip)"
                      :key="note.key"
                      :x="note.x + '%'" :y="note.y + '%'"
                      :width="note.w + '%'" height="12%"
                      :fill="patternColor(clip.patternId)"
                      opacity="0.7"
                    />
                  </svg>
                  <div
                    v-if="!track.locked"
                    class="clip-resize-handle"
                    @mousedown.stop="onResizeStart($event, clip)"
                    title="Drag to resize clip"
                  />
                </div>
              </template>

              <!-- Automation clips -->
              <template v-if="clipFocusMode === 'automation' || clipFocusMode === 'pattern'">
                <div
                  v-for="auto in autoClipsForTrack(track.id)"
                  :key="auto.id"
                  class="pl-auto-clip"
                  :class="{ ghost: clipFocusMode === 'pattern' }"
                  :style="autoClipStyle(auto)"
                  @mousedown.stop="onAutoClipMouseDown($event, auto, track)"
                  @contextmenu.prevent.stop="removeAutomationClip(auto.id)"
                  :title="auto.targetParam + ' automation — right-click to remove'"
                >
                  <span class="auto-label">{{ auto.targetParam }}</span>
                  <svg
                    class="auto-graph"
                    :viewBox="`0 0 ${(auto.width || 1) * cellWidth} ${trackHeight - 18}`"
                    preserveAspectRatio="none"
                    @click.stop="onAutoSvgClick($event, auto)"
                  >
                    <polyline :points="autoPolyline(auto)" class="auto-line" />
                    <circle
                      v-for="(node, ni) in auto.nodes" :key="ni"
                      :cx="node.x * (auto.width || 1) * cellWidth"
                      :cy="(1 - node.y) * (trackHeight - 18)"
                      r="5"
                      class="auto-node"
                      @mousedown.stop="onNodeDragStart($event, auto, ni)"
                      @contextmenu.prevent.stop="removeAutoNode(auto.id, ni)"
                    />
                  </svg>
                  <div
                    class="clip-resize-handle auto-resize"
                    @mousedown.stop="onAutoResizeStart($event, auto)"
                  />
                </div>
              </template>

              <!-- Drag ghost -->
              <div
                v-if="dragGhost && dragGhost.trackId === track.id"
                class="pl-clip drag-ghost-clip"
                :style="dragGhostStyle"
              />
            </div>
          </div>
        </template>
=======
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
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779

        <!-- Add track row -->
        <div class="pl-add-track-row">
          <div class="pl-track-header add-header">
            <button class="add-track-btn" @click="addPlaylistTrack">+ ADD TRACK</button>
          </div>
          <div :style="{ width: PLAYLIST_CELLS * cellWidth + 'px', height: '100%' }" />
        </div>

      </div>
    </div>

<<<<<<< HEAD
    <!-- ── Track context menu ─────────────────────────────────────────────────── -->
    <div
      v-if="trackMenu"
      class="ctx-menu"
      :style="{ top: trackMenu.y + 'px', left: trackMenu.x + 'px' }"
      @click.stop
    >
      <div class="ctx-item" @click="ctxRename">Rename…</div>
      <div v-if="!trackMenu.track.groupParentId" class="ctx-item" @click="ctxGroupAbove">Group with above track</div>
      <div v-else class="ctx-item" @click="ctxUngroup">Remove from group</div>
      <div v-if="hasChildren(trackMenu.track)" class="ctx-item" @click="ctxToggleCollapse">
        {{ trackMenu.track.collapsed ? 'Expand group' : 'Collapse group' }}
      </div>
      <div class="ctx-item" @click="ctxToggleLock">
        {{ trackMenu.track.locked ? '🔓 Unlock track' : '⚿ Lock to content' }}
      </div>
      <div class="ctx-sep" />
      <div class="ctx-item danger" @click="ctxRemoveTrack">Remove track</div>
    </div>

    <!-- ── Clip context menu ──────────────────────────────────────────────────── -->
    <div
      v-if="clipMenu"
      class="ctx-menu"
      :style="{ top: clipMenu.y + 'px', left: clipMenu.x + 'px' }"
      @click.stop
    >
      <div class="ctx-item" @click="ctxDuplicateClip">Duplicate clip</div>
      <div class="ctx-sep" />
      <div class="ctx-item danger" @click="ctxRemoveClip">Remove clip</div>
    </div>

    <!-- ── Track rename overlay ───────────────────────────────────────────────── -->
    <div v-if="trackRenaming" class="rename-overlay" @click.self="trackRenaming = false">
      <div class="rename-box">
        <span class="rename-label">Rename track</span>
        <input ref="trackRenameInput" v-model="trackRenameName" class="rename-input"
          @keydown.enter="commitTrackRename" @keydown.esc="trackRenaming = false" maxlength="24" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitTrackRename">OK</button>
          <button class="rename-cancel" @click="trackRenaming = false">Cancel</button>
=======
    <!-- Track rename overlay -->
    <div v-if="trackRenaming" class="rename-overlay" @click.self="trackRenaming=false">
      <div class="rename-box">
        <span class="rename-label">Rename track</span>
        <input ref="trackRenameInput" v-model="trackRenameName" class="rename-input"
               @keydown.enter="commitTrackRename" @keydown.esc="trackRenaming=false" maxlength="20" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitTrackRename">OK</button>
          <button class="rename-cancel" @click="trackRenaming=false">Cancel</button>
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
        </div>
      </div>
    </div>

<<<<<<< HEAD
    <!-- ── Marker dialog ──────────────────────────────────────────────────────── -->
    <div v-if="markerDialog" class="rename-overlay" @click.self="markerDialog = false">
      <div class="rename-box">
        <span class="rename-label">Marker at bar {{ pendingMarkerCell + 1 }}</span>
        <input ref="markerInput" v-model="markerLabel" class="rename-input"
          placeholder="e.g. Intro, Verse, Drop…"
          @keydown.enter="commitMarker" @keydown.esc="markerDialog = false" maxlength="24" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitMarker">ADD</button>
          <button class="rename-cancel" @click="markerDialog = false">Cancel</button>
=======
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
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
<<<<<<< HEAD
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'

const {
  patterns, currentPatternId, pickerPatternId,
  patternData, channels,
  playlistTracks, playlistClips, automationClips, timeMarkers, usePlaylist,
  playlistTool, cellWidth, trackHeight, clipFocusMode, displayCell, isPlaying,
  addPlaylistTrack, removePlaylistTrack, soloPlaylistTrack,
  placeClip, removeClip, moveClip, resizeClip,
  addTimeMarker, removeTimeMarker,
  groupTrackWithAbove, ungroupTrack, toggleTrackCollapse, setTrackLocked,
  addAutomationClip, removeAutomationClip, addAutoNode, removeAutoNode, resizeAutomationClip,
  getUnusedPatternIds,
  PLAYLIST_CELLS,
} = useStudio()

// ── Tools ─────────────────────────────────────────────────────────────────────
const tools = [
  { id: 'draw',  icon: '✏',  tip: 'Draw — click to place/toggle clips (D)' },
  { id: 'paint', icon: '🖌',  tip: 'Paint — drag to fill cells (P)' },
  { id: 'erase', icon: '✕',  tip: 'Erase — click/drag to remove clips (E)' },
]
const snap = ref('cell')

// ── Picker state ───────────────────────────────────────────────────────────────
const pickerTab       = ref('patterns')
const pickerAutoParam = ref('volume')

const unusedPatternIds = computed(() => new Set(getUnusedPatternIds()))

function highlightUnused() {
  // Toggle dim on unused — already handled via .unused CSS class
}

// Automation param options derived from channels
const autoParamOptions = computed(() => {
  const opts = []
  channels.forEach(ch => {
    opts.push({ key: ch.id + '_volume', label: ch.name + ' VOL', color: ch.color, channelId: ch.id, param: 'volume' })
    opts.push({ key: ch.id + '_pan',    label: ch.name + ' PAN', color: ch.color, channelId: ch.id, param: 'pan'    })
  })
  return opts
})

// ── Computed visible tracks (respects group collapse) ─────────────────────────
const visibleTracks = computed(() => {
  const collapsed = new Set()
  playlistTracks.forEach(t => { if (t.collapsed) collapsed.add(t.id) })
  return playlistTracks.filter(t => {
    if (!t.groupParentId) return true
    return !collapsed.has(t.groupParentId)
  })
})

function hasChildren(track) {
  return playlistTracks.some(t => t.groupParentId === track.id)
}

// ── Clip helpers ──────────────────────────────────────────────────────────────
function patternClipsForTrack(trackId) { return playlistClips.filter(c => c.trackId === trackId) }
function autoClipsForTrack(trackId)    { return automationClips.filter(a => a.trackId === trackId) }
function patternName(pid)  { return patterns.find(p => p.id === pid)?.name  ?? '?' }
function patternColor(pid) { return patterns.find(p => p.id === pid)?.color ?? '#4ecdc4' }

function patternClipStyle(clip) {
  return {
    left:  clip.cell * cellWidth.value + 'px',
    width: (clip.width || 1) * cellWidth.value - 3 + 'px',
    '--clip-color': patternColor(clip.patternId),
  }
}

function autoClipStyle(auto) {
  return {
    left:  auto.cell * cellWidth.value + 'px',
    width: (auto.width || 1) * cellWidth.value - 3 + 'px',
    '--clip-color': '#4ecdc4',
  }
}

// ── Clip preview notes from patternData ───────────────────────────────────────
function previewNotes(clip) {
  const notes = []
  if (!patternData) return notes
  const pd = patternData[clip.patternId]
  if (!pd) return notes
  const totalSteps = 32
  let idx = 0
  channels.forEach(ch => {
    const d = pd[ch.id]
    if (!d) return
    if (ch.mode === 'steps') {
      d.steps.forEach((on, si) => {
        if (on) notes.push({ key: idx++, x: (si / totalSteps) * 100, y: 20, w: (1 / totalSteps) * 100 * 0.8 })
      })
    } else if (d.pianoNotes?.length) {
      const pitches = d.pianoNotes.map(n => n.pitch)
      const minP = Math.min(...pitches), maxP = Math.max(...pitches)
      const range = maxP - minP || 1
      d.pianoNotes.forEach(n => {
        notes.push({ key: idx++, x: (n.step / totalSteps) * 100, y: ((maxP - n.pitch) / range) * 76 + 10, w: (1 / totalSteps) * 100 * 0.85 })
      })
    }
  })
  return notes
}

// ── Automation graph helpers ──────────────────────────────────────────────────
function autoPolyline(auto) {
  const W = (auto.width || 1) * cellWidth.value
  const H = trackHeight.value - 18
  return auto.nodes.map(n => `${n.x * W},${(1 - n.y) * H}`).join(' ')
}

// ── Marker helpers ────────────────────────────────────────────────────────────
=======
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
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
function markerAt(cell) { return timeMarkers.find(m => m.cell === cell) }

const markerDialog = ref(false)
const markerLabel  = ref('Section')
const markerInput  = ref(null)
let   pendingMarkerCell = 0

function addMarkerPrompt() {
<<<<<<< HEAD
  pendingMarkerCell = 0; markerLabel.value = 'Section'; markerDialog.value = true
  nextTick(() => markerInput.value?.select())
}
function addMarkerAt(cell) {
  if (playlistTool.value !== 'draw') return
  if (markerAt(cell)) return
  pendingMarkerCell = cell; markerLabel.value = 'Section'; markerDialog.value = true
  nextTick(() => markerInput.value?.select())
}
function removeMarkerAt(cell) {
  const m = markerAt(cell); if (m) removeTimeMarker(m.id)
}
=======
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

>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
function commitMarker() {
  if (markerLabel.value.trim()) addTimeMarker(pendingMarkerCell, markerLabel.value.trim())
  markerDialog.value = false
}

<<<<<<< HEAD
// ── Add automation track helper ───────────────────────────────────────────────
function addAutoTrack() {
  addPlaylistTrack()
  const track = playlistTracks[playlistTracks.length - 1]
  track.name  = 'Automation ' + playlistTracks.length
  track.color = '#4ecdc4'
  clipFocusMode.value = 'automation'
  pickerTab.value     = 'automation'
}

// ── Snap helper ───────────────────────────────────────────────────────────────
function snapCell(raw) {
  if (snap.value === 'none') return raw
  if (snap.value === 'half') return Math.round(raw * 2) / 2
  return Math.floor(raw)
}
function cellFromX(x) { return snapCell(x / cellWidth.value) }

// ── Pattern clip mouse interactions ──────────────────────────────────────────
const draggingClip  = ref(null)
const dragGhost     = ref(null)
let   isPainting    = false

function onCellsMouseDown(e, track) {
  if (e.button !== 0) return
  if (track.locked) return
  const rect    = e.currentTarget.getBoundingClientRect()
  const rawCell = cellFromX(e.clientX - rect.left)
  const cell    = Math.max(0, Math.min(PLAYLIST_CELLS - 1, Math.floor(rawCell)))
  const tool    = playlistTool.value

  if (clipFocusMode.value === 'automation') {
    if (tool === 'draw' || tool === 'paint') {
      const existing = automationClips.find(a => a.trackId === track.id && cell >= a.cell && cell < a.cell + (a.width || 1))
      if (!existing) {
        const opt = autoParamOptions.value.find(o => o.key === pickerAutoParam.value)
        addAutomationClip(track.id, cell, opt?.channelId ?? null, opt?.param ?? 'volume')
      }
    }
    if (tool === 'erase') {
      const a = automationClips.find(x => x.trackId === track.id && cell >= x.cell && cell < x.cell + (x.width || 1))
      if (a) removeAutomationClip(a.id)
    }
    return
  }

  if (tool === 'erase') {
    const clip = playlistClips.find(c => c.trackId === track.id && cell >= c.cell && cell < c.cell + (c.width || 1))
    if (clip) removeClip(clip.id)
    return
  }
  if (tool === 'draw') {
    const clip = playlistClips.find(c => c.trackId === track.id && cell >= c.cell && cell < c.cell + (c.width || 1))
    if (clip) { removeClip(clip.id); return }
    placeClip(track.id, cell, pickerPatternId.value)
    return
  }
  if (tool === 'paint') {
    isPainting = true
=======
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
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
    placeClip(track.id, cell, pickerPatternId.value)
    window.addEventListener('mouseup', stopPainting, { once: true })
  }
}

function onCellsMouseMove(e, track) {
<<<<<<< HEAD
  if (draggingClip.value) { onDragMove(e); return }
  if (!isPainting || playlistTool.value !== 'paint') return
  const rect = e.currentTarget.getBoundingClientRect()
  const cell = Math.max(0, Math.min(PLAYLIST_CELLS - 1, Math.floor(cellFromX(e.clientX - rect.left))))
  placeClip(track.id, cell, pickerPatternId.value)
=======
  if (!isPainting || playlistTool.value !== 'paint') return
  const cell = cellFromEvent(e, e.currentTarget)
  if (cell >= 0 && cell < PLAYLIST_CELLS) placeClip(track.id, cell, pickerPatternId.value)
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
}

function onCellsMouseUp() { isPainting = false }
function stopPainting()   { isPainting = false }

function onCellsRightClick(e, track) {
<<<<<<< HEAD
  if (clipFocusMode.value === 'automation') return
  const rect = e.currentTarget.getBoundingClientRect()
  const cell = Math.max(0, Math.min(PLAYLIST_CELLS - 1, Math.floor(cellFromX(e.clientX - rect.left))))
  const clip = playlistClips.find(c => c.trackId === track.id && cell >= c.cell && cell < c.cell + (c.width || 1))
  if (clip) removeClip(clip.id)
}

// ── Clip drag (move) ──────────────────────────────────────────────────────────
function onClipMouseDown(e, clip, track) {
  if (playlistTool.value === 'erase') { removeClip(clip.id); return }
  if (playlistTool.value !== 'draw') return
  draggingClip.value = clip
  dragGhost.value = { trackId: track.id, cell: clip.cell, width: clip.width || 1, color: patternColor(clip.patternId) }
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup',   onDragEnd, { once: true })
}

function onDragMove(e) {
  if (!draggingClip.value) return
  const tl = timelineRef.value
  if (!tl) return
  const tlRect = tl.getBoundingClientRect()
  const relY   = e.clientY - tlRect.top + tl.scrollTop - 28
  const tIdx   = Math.max(0, Math.min(visibleTracks.value.length - 1, Math.floor(relY / trackHeight.value)))
  const track  = visibleTracks.value[tIdx]
  if (!track) return
  const relX = e.clientX - tlRect.left + tl.scrollLeft - 140
  const cell = Math.max(0, Math.min(PLAYLIST_CELLS - (draggingClip.value.width || 1), Math.floor(cellFromX(relX))))
  dragGhost.value = { trackId: track.id, cell, width: draggingClip.value.width || 1, color: patternColor(draggingClip.value.patternId) }
}

function onDragEnd() {
  if (draggingClip.value && dragGhost.value) {
    moveClip(draggingClip.value.id, dragGhost.value.trackId, dragGhost.value.cell)
  }
  draggingClip.value = null
  dragGhost.value    = null
  window.removeEventListener('mousemove', onDragMove)
}

const dragGhostStyle = computed(() => {
  if (!dragGhost.value) return {}
  return {
    left:  dragGhost.value.cell * cellWidth.value + 'px',
    width: (dragGhost.value.width || 1) * cellWidth.value - 3 + 'px',
    '--clip-color': dragGhost.value.color || '#4ecdc4',
    opacity: 0.5,
  }
})

// ── Clip resize ───────────────────────────────────────────────────────────────
let resizingClip     = null
let resizeStartX     = 0
let resizeStartWidth = 1

function onResizeStart(e, clip) {
  resizingClip = clip; resizeStartX = e.clientX; resizeStartWidth = clip.width || 1
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup',   onResizeEnd, { once: true })
}
function onResizeMove(e) {
  if (!resizingClip) return
  resizeClip(resizingClip.id, resizeStartWidth + Math.round((e.clientX - resizeStartX) / cellWidth.value))
}
function onResizeEnd() { resizingClip = null; window.removeEventListener('mousemove', onResizeMove) }

// ── Automation clip interaction ───────────────────────────────────────────────
function onAutoClipMouseDown(e, auto, track) {
  if (playlistTool.value === 'erase') removeAutomationClip(auto.id)
}

function onAutoSvgClick(e, auto) {
  if (playlistTool.value !== 'draw') return
  const rect = e.currentTarget.getBoundingClientRect()
  const x = (e.clientX - rect.left)  / rect.width
  const y = 1 - (e.clientY - rect.top) / rect.height
  addAutoNode(auto.id, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)))
}

// Drag automation node
let draggingNode     = null
let draggingNodeAuto = null
let draggingNodeRect = null

function onNodeDragStart(e, auto, ni) {
  draggingNode = ni; draggingNodeAuto = auto
  const svg = e.currentTarget.closest('svg')
  draggingNodeRect = svg ? svg.getBoundingClientRect() : null
  window.addEventListener('mousemove', onNodeDragMove)
  window.addEventListener('mouseup',   onNodeDragEnd, { once: true })
}
function onNodeDragMove(e) {
  if (draggingNode === null || !draggingNodeAuto || !draggingNodeRect) return
  const rect = draggingNodeRect
  const x = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width))
  const y = Math.max(0,    Math.min(1,    1 - (e.clientY - rect.top) / rect.height))
  draggingNodeAuto.nodes[draggingNode].x = x
  draggingNodeAuto.nodes[draggingNode].y = y
  draggingNodeAuto.nodes.sort((a, b) => a.x - b.x)
}
function onNodeDragEnd() {
  draggingNode = null; draggingNodeAuto = null; draggingNodeRect = null
  window.removeEventListener('mousemove', onNodeDragMove)
}

// Automation clip resize
let resizingAuto = null; let resizeAutoStartX = 0; let resizeAutoStartW = 1
function onAutoResizeStart(e, auto) {
  resizingAuto = auto; resizeAutoStartX = e.clientX; resizeAutoStartW = auto.width || 1
  window.addEventListener('mousemove', onAutoResizeMove)
  window.addEventListener('mouseup',   onAutoResizeEnd, { once: true })
}
function onAutoResizeMove(e) {
  if (!resizingAuto) return
  resizeAutomationClip(resizingAuto.id, resizeAutoStartW + Math.round((e.clientX - resizeAutoStartX) / cellWidth.value))
}
function onAutoResizeEnd() { resizingAuto = null; window.removeEventListener('mousemove', onAutoResizeMove) }

// ── Track context menu ────────────────────────────────────────────────────────
const trackMenu = ref(null)
function openTrackMenu(e, track) { closeMenus(); trackMenu.value = { x: e.clientX, y: e.clientY, track } }
function ctxRename()         { startTrackRename(trackMenu.value.track); trackMenu.value = null }
function ctxGroupAbove()     { groupTrackWithAbove(trackMenu.value.track.id); trackMenu.value = null }
function ctxUngroup()        { ungroupTrack(trackMenu.value.track.id); trackMenu.value = null }
function ctxToggleCollapse() { toggleTrackCollapse(trackMenu.value.track.id); trackMenu.value = null }
function ctxToggleLock()     { setTrackLocked(trackMenu.value.track.id, !trackMenu.value.track.locked); trackMenu.value = null }
function ctxRemoveTrack()    { removePlaylistTrack(trackMenu.value.track.id); trackMenu.value = null }

// ── Clip context menu ─────────────────────────────────────────────────────────
const clipMenu = ref(null)
function openClipMenu(e, clip) { closeMenus(); clipMenu.value = { x: e.clientX, y: e.clientY, clip } }
function ctxDuplicateClip() {
  const c = clipMenu.value.clip
  placeClip(c.trackId, c.cell + (c.width || 1), c.patternId, c.width || 1)
  clipMenu.value = null
}
function ctxRemoveClip() { removeClip(clipMenu.value.clip.id); clipMenu.value = null }
function closeMenus()    { trackMenu.value = null; clipMenu.value = null }

// ── Track rename ──────────────────────────────────────────────────────────────
const trackRenaming    = ref(false)
const trackRenameName  = ref('')
const trackRenameInput = ref(null)
let   trackRenameTarget = null

function startTrackRename(track) {
  closeMenus(); trackRenameTarget = track
  trackRenameName.value = track.name; trackRenaming.value = true
  nextTick(() => trackRenameInput.value?.select())
}
function commitTrackRename() {
  if (trackRenameTarget && trackRenameName.value.trim()) trackRenameTarget.name = trackRenameName.value.trim()
  trackRenaming.value = false
}

// ── Scroll wheel shortcuts ────────────────────────────────────────────────────
function onWheel(e) {
  if (e.ctrlKey) {
    cellWidth.value = Math.max(32, Math.min(200, cellWidth.value + (e.deltaY > 0 ? -8 : 8)))
  } else if (e.altKey) {
    trackHeight.value = Math.max(28, Math.min(120, trackHeight.value + (e.deltaY > 0 ? -4 : 4)))
  } else if (timelineRef.value) {
    timelineRef.value.scrollLeft += e.deltaX || e.deltaY * 0.5
  }
}

// ── Mini-map ──────────────────────────────────────────────────────────────────
const minimapEl   = ref(null)
const timelineRef = ref(null)
const scrollLeft  = ref(0)

function onTimelineScroll() { scrollLeft.value = timelineRef.value?.scrollLeft ?? 0 }

const totalTimelineWidth = computed(() => PLAYLIST_CELLS * cellWidth.value)

function minimapClipStyle(clip) {
  const total = playlistTracks.length || 1
  const tIdx  = playlistTracks.findIndex(t => t.id === clip.trackId)
  return {
    left:       (clip.cell / PLAYLIST_CELLS * 100) + '%',
    width:      ((clip.width || 1) / PLAYLIST_CELLS * 100) + '%',
    top:        (tIdx / total * 100) + '%',
    height:     (1 / total * 100) + '%',
    background: patternColor(clip.patternId),
    opacity:    0.7,
  }
}

function minimapAutoStyle(auto) {
  const total = playlistTracks.length || 1
  const tIdx  = playlistTracks.findIndex(t => t.id === auto.trackId)
  return {
    left:    (auto.cell / PLAYLIST_CELLS * 100) + '%',
    width:   ((auto.width || 1) / PLAYLIST_CELLS * 100) + '%',
    top:     (tIdx / total * 100) + '%',
    height:  (1 / total * 100) + '%',
    background: '#4ecdc4',
    opacity: 0.6,
  }
}

const minimapViewportStyle = computed(() => {
  const tl = timelineRef.value
  if (!tl) return { left: '0%', width: '100%' }
  const visW  = tl.clientWidth - 140
  return {
    left:  (scrollLeft.value / totalTimelineWidth.value * 100) + '%',
    width: Math.min(100, visW / totalTimelineWidth.value * 100) + '%',
  }
})

function onMinimapClick(e) {
  const rect = minimapEl.value?.getBoundingClientRect()
  if (!rect || !timelineRef.value) return
  const frac = (e.clientX - rect.left) / rect.width
  timelineRef.value.scrollLeft = frac * totalTimelineWidth.value - (timelineRef.value.clientWidth - 140) / 2
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return
  if (e.key === 'd' || e.key === 'D') playlistTool.value = 'draw'
  if (e.key === 'p' || e.key === 'P') playlistTool.value = 'paint'
  if (e.key === 'e' || e.key === 'E') playlistTool.value = 'erase'
  if (e.key === 'Escape') closeMenus()
}
onMounted(()        => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(()  => window.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.playlist {
  display: flex; flex-direction: column; flex: 1; overflow: hidden;
  background: #0c0c16; user-select: none;
}

/* ── Toolbar ─────────────────────────────────────────────────────────────────── */
.pl-toolbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 12px; background: #0a0a12; border-bottom: 1px solid #1a1a28; flex-shrink: 0;
}
.focus-group { display: flex; gap: 2px; }
.focus-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 38px; height: 32px; border-radius: 5px; border: 1px solid #252535;
  background: transparent; cursor: pointer; transition: all 0.1s; color: #404060; gap: 1px;
}
.focus-btn:hover  { border-color: #4a4a6a; color: #8080b0; }
.focus-btn.active { border-color: #4ecdc4; background: #0a1a1a; color: #4ecdc4; }
.focus-icon { font-size: 13px; line-height: 1; }
.focus-lbl  { font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700; letter-spacing: 0.12em; }
=======
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
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
.tool-group { display: flex; gap: 3px; }
.tool-btn {
  width: 28px; height: 28px; border-radius: 5px; border: 1px solid #252535;
  background: transparent; cursor: pointer; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.1s; color: #50506a;
}
.tool-btn:hover  { border-color: #4a4a6a; color: #9090b8; }
.tool-btn.active { border-color: #e74c3c; background: #1a0808; color: #e74c3c; }
<<<<<<< HEAD
.divider { width: 1px; height: 22px; background: #1e1e2e; flex-shrink: 0; }
.tb-label { font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700; letter-spacing: 0.15em; color: #404058; }
.tb-select {
  background: #141420; border: 1px solid #252535; color: #8080a0;
  padding: 3px 6px; border-radius: 4px; font-family: 'Rajdhani', sans-serif; font-size: 11px; cursor: pointer; outline: none;
}
.zoom-slider { width: 70px; accent-color: #e74c3c; cursor: pointer; }
.tb-val { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #40405a; min-width: 30px; }
.use-pl-toggle {
  display: flex; align-items: center; gap: 5px; cursor: pointer;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #50506a;
}
.use-pl-toggle input { accent-color: #4ecdc4; cursor: pointer; }
.tb-right { margin-left: auto; display: flex; gap: 5px; }
.tb-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em; padding: 4px 10px; border: 1px dashed #252535;
  border-radius: 5px; background: transparent; color: #404058; cursor: pointer; transition: all 0.12s;
}
.tb-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }

/* ── Mini-map ─────────────────────────────────────────────────────────────────── */
.pl-minimap {
  height: 22px; flex-shrink: 0; background: #060610; border-bottom: 1px solid #141424;
  cursor: pointer; overflow: hidden; position: relative;
}
.minimap-bg {
  position: absolute; top: 0; bottom: 0; left: 140px; right: 0;
}
.minimap-clip { position: absolute; border-radius: 1px; pointer-events: none; min-width: 2px; }
.minimap-auto { opacity: 0.5; }
.minimap-viewport {
  position: absolute; top: 0; bottom: 0;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); pointer-events: none;
}

/* ── Main body ───────────────────────────────────────────────────────────────── */
.pl-main { display: flex; flex: 1; overflow: hidden; }

/* ── Picker panel ────────────────────────────────────────────────────────────── */
.pl-picker {
  width: 160px; min-width: 160px; background: #090912;
  border-right: 1px solid #1a1a28; display: flex; flex-direction: column; overflow: hidden;
}
.picker-tabs { display: flex; border-bottom: 1px solid #111118; }
.ptab {
  flex: 1; padding: 7px 4px; background: transparent; border: none;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.12em; color: #30304a; cursor: pointer; transition: all 0.1s;
  border-bottom: 2px solid transparent;
}
.ptab:hover { color: #6060a0; }
.ptab.active { color: #4ecdc4; border-bottom-color: #4ecdc4; }
.picker-list { flex: 1; overflow-y: auto; }
.picker-section { font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #252535; padding: 6px 10px 3px; letter-spacing: 0.1em; }
.picker-item {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  cursor: pointer; border-bottom: 1px solid #0c0c14; transition: background 0.08s;
}
.picker-item:hover    { background: #121220; }
.picker-item.selected { background: #141428; }
.picker-item.current  { border-left: 2px solid #e74c3c; }
.picker-item.unused   { opacity: 0.4; }
.picker-dot  { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.picker-name {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
=======
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
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
  letter-spacing: 0.08em; color: #8080a0; flex: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.picker-item.selected .picker-name { color: #c0c0e0; }
<<<<<<< HEAD
.picker-badge { font-family: 'Share Tech Mono', monospace; font-size: 8px; padding: 1px 4px; border-radius: 3px; flex-shrink: 0; }
.picker-badge.edit   { color: #e74c3c; background: #1a0808; border: 1px solid #e74c3c44; }
.picker-badge.unused { color: #404058; background: #0e0e1a; border: 1px solid #252535; }
.picker-actions { padding: 6px 8px; border-top: 1px solid #111118; }
.picker-action-btn {
  width: 100%; padding: 5px; background: transparent; border: 1px dashed #252535;
  border-radius: 4px; font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.1em; color: #404058; cursor: pointer; transition: all 0.1s;
}
.picker-action-btn:hover { border-color: #f39c12; color: #f39c12; }
.picker-hint { padding: 6px 10px 8px; font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #25253a; line-height: 1.6; border-top: 1px solid #111118; }

/* ── Timeline ────────────────────────────────────────────────────────────────── */
.pl-timeline { flex: 1; overflow: auto; position: relative; }

/* ── Ruler ───────────────────────────────────────────────────────────────────── */
.pl-ruler-row { display: flex; position: sticky; top: 0; z-index: 10; background: #080810; border-bottom: 1px solid #1a1a28; min-height: 28px; }
.ruler-corner {
  width: 140px; min-width: 140px; position: sticky; left: 0; z-index: 11;
=======
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
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
  background: #060608; border-right: 1px solid #1a1a28;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #252540; display: flex; align-items: center; padding-left: 10px;
}
.ruler-cell {
  border-right: 1px solid #0e0e18; flex-shrink: 0; position: relative;
<<<<<<< HEAD
  display: flex; align-items: center; padding-left: 4px; cursor: pointer; transition: background 0.08s;
}
.ruler-cell:hover   { background: #0e0e20; }
.ruler-cell.beat4   { border-left: 2px solid #1e1e30; }
.ruler-cell.playing { background: rgba(255,255,255,0.06); }
=======
  display: flex; align-items: center; padding-left: 4px; cursor: pointer;
  transition: background 0.08s;
}
.ruler-cell:hover { background: #0e0e20; }
.ruler-cell.beat4 { border-left: 2px solid #1e1e30; }
.ruler-cell.playing { background: rgba(255,255,255,0.08); }
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
.ruler-num { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #35355a; }
.time-marker {
  position: absolute; top: 0; left: 0; right: 0;
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
<<<<<<< HEAD
  letter-spacing: 0.08em; color: #e74c3c; background: #180808;
=======
  letter-spacing: 0.08em; color: #e74c3c; background: #1a0808;
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
  border-bottom: 2px solid #e74c3c; padding: 0 4px; line-height: 26px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 1;
}

<<<<<<< HEAD
/* ── Track row ───────────────────────────────────────────────────────────────── */
.pl-track-row { display: flex; border-bottom: 1px solid #0c0c14; transition: opacity 0.1s; }
.pl-track-row.muted  { opacity: 0.35; }
.pl-track-row.grouped .pl-track-header { background: #0c0c18; }
.pl-track-row.locked .pl-track-cells   { cursor: not-allowed; }

/* ── Track header ────────────────────────────────────────────────────────────── */
=======
/* ── Track row ───────────────────────────────────────────────────── */
.pl-track-row {
  display: flex; min-height: 52px; border-bottom: 1px solid #0c0c14;
  transition: opacity 0.1s;
}
.pl-track-row.muted { opacity: 0.35; }

/* Track header (sticky left) */
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
.pl-track-header {
  width: 140px; min-width: 140px; flex-shrink: 0;
  position: sticky; left: 0; z-index: 5;
  background: #0a0a14; border-right: 1px solid #1a1a28;
<<<<<<< HEAD
  display: flex; align-items: center; gap: 4px; padding: 0 5px 0 4px;
}
.track-indent { width: 12px; flex-shrink: 0; }
.track-collapse-btn {
  width: 14px; height: 14px; flex-shrink: 0; background: transparent; border: none;
  color: #505070; cursor: pointer; font-size: 8px; padding: 0; line-height: 1;
  display: flex; align-items: center; justify-content: center; border-radius: 2px; transition: color 0.1s;
}
.track-collapse-btn:hover { color: #9090c0; }
.track-led {
  width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
  background: #1a1a28; border: 1px solid #252535; cursor: pointer; transition: all 0.12s;
}
.track-led.active { background: #2ecc71; border-color: #2ecc71; box-shadow: 0 0 5px #2ecc7166; }
.track-led.solo   { background: #f39c12; border-color: #f39c12; box-shadow: 0 0 5px #f39c1266; }
.track-color-strip { width: 3px; align-self: stretch; flex-shrink: 0; border-radius: 1px; }
.track-name {
  flex: 1; font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; color: #8080a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text;
}
.track-lock   { font-size: 10px; color: #f39c12; opacity: 0.7; flex-shrink: 0; }
.track-remove { font-size: 13px; background: transparent; border: none; color: #2a2a3c; cursor: pointer; padding: 1px 3px; border-radius: 3px; flex-shrink: 0; transition: color 0.1s; }
.track-remove:hover { color: #e74c3c; }

/* ── Clip cells area ─────────────────────────────────────────────────────────── */
.pl-track-cells { position: relative; flex-shrink: 0; cursor: crosshair; overflow: visible; }
.grid-lines { position: absolute; inset: 0; pointer-events: none; }
.grid-line  { position: absolute; top: 0; bottom: 0; border-left: 1px solid #0e0e1a; pointer-events: none; }
.grid-line.beat4 { border-left-color: #151525; }
.playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.55); pointer-events: none; z-index: 6; box-shadow: 0 0 6px rgba(255,255,255,0.3); }

/* ── Pattern clip ────────────────────────────────────────────────────────────── */
.pl-clip {
  position: absolute; top: 3px; bottom: 3px;
  background: color-mix(in srgb, var(--clip-color) 28%, #0e0e1a);
  border: 1px solid color-mix(in srgb, var(--clip-color) 55%, transparent);
  border-radius: 4px; overflow: hidden; cursor: grab; z-index: 2; transition: filter 0.08s;
}
.pl-clip:hover  { filter: brightness(1.2); }
.pl-clip.ghost  { opacity: 0.2; pointer-events: none; }
.pl-clip.dragging { opacity: 0.3; pointer-events: none; }
.clip-label {
  position: absolute; top: 2px; left: 4px; right: 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.08em; color: var(--clip-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  pointer-events: none; text-shadow: 0 0 4px rgba(0,0,0,0.9); z-index: 1;
}
.clip-preview-svg {
  position: absolute; inset: 14px 8px 3px 3px;
  width: calc(100% - 11px); height: calc(100% - 17px); pointer-events: none;
}
.clip-resize-handle {
  position: absolute; right: 0; top: 0; bottom: 0; width: 7px; cursor: ew-resize; z-index: 3;
  background: linear-gradient(to left, rgba(255,255,255,0.08), transparent); border-radius: 0 3px 3px 0;
}
.clip-resize-handle:hover { background: linear-gradient(to left, rgba(255,255,255,0.18), transparent); }
.drag-ghost-clip { pointer-events: none; z-index: 8; border-style: dashed; }

/* ── Automation clip ─────────────────────────────────────────────────────────── */
.pl-auto-clip {
  position: absolute; top: 3px; bottom: 3px;
  background: #0a1a1a; border: 1px solid #1a4a4a;
  border-radius: 4px; overflow: hidden; cursor: crosshair; z-index: 2;
}
.pl-auto-clip.ghost { opacity: 0.2; pointer-events: none; }
.auto-label {
  position: absolute; top: 2px; left: 4px;
  font-family: 'Share Tech Mono', monospace; font-size: 8px;
  color: #4ecdc4; letter-spacing: 0.08em; pointer-events: none;
  text-shadow: 0 0 4px rgba(0,0,0,0.9); z-index: 1;
}
.auto-graph { position: absolute; inset: 14px 8px 2px 2px; width: calc(100% - 10px); height: calc(100% - 16px); overflow: visible; }
.auto-line  { fill: none; stroke: #4ecdc4; stroke-width: 1.5; opacity: 0.85; }
.auto-node  { fill: #4ecdc4; stroke: #0a1a1a; stroke-width: 1.5; cursor: grab; }
.auto-node:hover { r: 7; }
.auto-resize { background: linear-gradient(to left, rgba(78,205,196,0.12), transparent); }

/* ── Add track row ───────────────────────────────────────────────────────────── */
.pl-add-track-row { display: flex; min-height: 36px; }
.add-header { width: 140px; min-width: 140px; position: sticky; left: 0; background: #0a0a14; border-right: 1px solid #1a1a28; }
=======
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
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
.add-track-btn {
  width: 100%; height: 100%; background: transparent; border: none;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; color: #303048; cursor: pointer; transition: color 0.1s;
}
.add-track-btn:hover { color: #4ecdc4; }

<<<<<<< HEAD
/* ── Context menus ───────────────────────────────────────────────────────────── */
.ctx-menu {
  position: fixed; z-index: 3000; background: #14141e; border: 1px solid #2a2a3e;
  border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,0.7); min-width: 180px; padding: 4px 0;
}
.ctx-item {
  padding: 7px 16px; font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.08em; color: #9090b8; cursor: pointer; transition: background 0.08s;
}
.ctx-item:hover { background: #1e1e32; color: #d0d0ee; }
.ctx-item.danger:hover { background: #1a0808; color: #e74c3c; }
.ctx-sep { height: 1px; background: #1e1e2e; margin: 4px 0; }

/* ── Rename / marker overlay ─────────────────────────────────────────────────── */
.rename-overlay {
  position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,0.6);
=======
/* ── Rename / marker overlay ────────────────────────────────────── */
.rename-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.55);
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
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
<<<<<<< HEAD
.rename-input:focus { border-color: #4ecdc4; }
.rename-btns { display: flex; gap: 8px; justify-content: flex-end; }
.rename-ok {
  padding: 6px 18px; background: #4ecdc422; border: 1px solid #4ecdc4; color: #4ecdc4;
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 700; transition: all 0.1s;
}
.rename-ok:hover { background: #4ecdc4; color: #000; }
=======
.rename-input:focus { border-color: #e74c3c; }
.rename-btns { display: flex; gap: 8px; justify-content: flex-end; }
.rename-ok {
  padding: 6px 18px; background: #e74c3c22; border: 1px solid #e74c3c; color: #e74c3c;
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 700;
  transition: all 0.1s;
}
.rename-ok:hover { background: #e74c3c; color: #fff; }
>>>>>>> c365a8b23b5942bd29ae02edd52e2c5e03b54779
.rename-cancel {
  padding: 6px 14px; background: transparent; border: 1px solid #252535; color: #606080;
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 13px;
}
</style>
