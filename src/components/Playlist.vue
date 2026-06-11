<template>
  <div class="playlist" @wheel.prevent="onWheel" @click="closeMenus" @keydown.esc="closeMenus">

    <!-- Floating picker-drag ghost — follows cursor until snapped to a track (Section 1.3) -->
    <div v-if="pickerDrag && !hoverGhost" class="picker-drag-float"
      :style="{
        left:  pickerDragPos.x + 'px',
        top:   pickerDragPos.y + 'px',
        width: pickerDrag.floatW + 'px',
        '--clip-color': pickerDrag.color,
      }" />

    <!-- ── Toolbar ─────────────────────────────────────────────────────────────── -->
    <div class="pl-toolbar">

      <!-- Arrangements dropdown -->
      <div class="arr-group" title="Playlist Arrangements">
        <select class="arr-select" :value="currentPlaylistId" @change="switchPlaylist($event.target.value)">
          <option v-for="pl in playlists" :key="pl.id" :value="pl.id">{{ pl.name }}</option>
        </select>
        <button class="arr-btn" @click="openArrMenu" title="Arrangement options">▾</button>
      </div>

      <div class="divider" />

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
      </div>

      <div class="divider" />

      <!-- Edit tools -->
      <div class="tool-group">
        <button v-for="t in tools" :key="t.id" class="tool-btn"
          :class="{ active: playlistTool === t.id }"
          @click="playlistTool = t.id" :title="t.tip">{{ t.icon }}</button>
      </div>

      <div class="divider" />

      <!-- Snap -->
      <label class="tb-label">SNAP</label>
      <select class="tb-select snap-select" v-model="localSnap" title="Snap resolution">
        <option value="none">None</option>
        <option value="beat">1 Beat</option>
        <option value="bar">1 Bar</option>
        <option value="2bar">2 Bars</option>
        <option value="4bar">4 Bars</option>
      </select>

      <div class="divider" />

      <!-- Zoom -->
      <label class="tb-label">ZOOM</label>
      <div class="zoom-quick-btns">
        <button class="zoom-q" @click="cellWidth = 32"  title="Shift+1">◾</button>
        <button class="zoom-q" @click="cellWidth = 64"  title="Shift+2">◾</button>
        <button class="zoom-q" @click="cellWidth = 96"  title="Shift+3">◾</button>
        <button class="zoom-q" @click="cellWidth = 140" title="Shift+4">◾</button>
        <button class="zoom-q" @click="cellWidth = 200" title="Shift+5">◾</button>
      </div>
      <input type="range" v-model.number="cellWidth" min="32" max="200" step="8" class="zoom-slider" />

      <div class="divider" />

      <!-- Loop region toggle -->
      <button class="loop-btn"
        :class="{ active: !!loopRegion }"
        @click="toggleLoopRegion"
        title="Toggle loop region (drawn in ruler by Ctrl+drag)">
        ⟳ LOOP
      </button>

      <div class="divider" />

      <label class="use-pl-toggle">
        <input type="checkbox" v-model="usePlaylist" />
        <span>PLAYLIST</span>
      </label>

      <label class="use-pl-toggle">
        <input type="checkbox" v-model="autoScroll" />
        <span>▶▶ SCROLL</span>
      </label>

      <div class="tb-right">
        <span class="cull-stat" :title="`Clips painted / total (bounding-box culled)`">▦ {{ renderedClipCount }}/{{ totalClipCount }}</span>
        <button class="tb-btn" @click="addPlaylistTrack">+ TRACK</button>
        <button class="tb-btn" @click="addAutoTrack">+ AUTO</button>
        <button class="tb-btn" @click="addMarkerPrompt">+ MARKER</button>
      </div>

    </div>

    <!-- Arrangement menu -->
    <div v-if="arrMenu" class="ctx-menu" :style="{ top: arrMenu.y + 'px', left: arrMenu.x + 'px' }" @click.stop>
      <div class="ctx-item" @click="ctxCloneArr">Clone arrangement</div>
      <div class="ctx-item" @click="ctxAddArr">Add empty arrangement</div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="ctxRenameArr">Rename current…</div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="openMergeDialog">Merge with…</div>
      <div class="ctx-sep" />
      <div class="ctx-item danger" @click="ctxDeleteArr" :class="{ disabled: playlists.length <= 1 }">Delete arrangement</div>
    </div>

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
            @mousedown.prevent="onPickerItemDown($event, pat)"
            @dblclick="currentPatternId = pat.id"
            :title="unusedPatternIds.has(pat.id) ? 'Not placed in Playlist' : 'Drag to place · Dbl-click to edit'"
          >
            <!-- Compressed MIDI thumbnail (Section 1.2) -->
            <canvas class="picker-mini-canvas"
              :ref="el => onPickerCanvasRef(pat.id, el)" />
            <!-- Info row -->
            <div class="picker-item-row">
              <span class="picker-dot" :style="{ background: pat.color }" />
              <span class="picker-name">{{ pat.name }}</span>
              <span v-if="patternBarLabel(pat.id)" class="picker-badge bars">{{ patternBarLabel(pat.id) }}</span>
              <span v-if="currentPatternId === pat.id" class="picker-badge edit">EDIT</span>
              <span v-else-if="unusedPatternIds.has(pat.id)" class="picker-badge unused">–</span>
            </div>
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
          <div class="ruler-cells-area" :style="{ width: PLAYLIST_CELLS * cellWidth + 'px' }">
            <div
              v-for="c in PLAYLIST_CELLS" :key="c"
              class="ruler-cell"
              :class="{
                beat4:   (c - 1) % 4 === 0,
                playing: isPlaying && displayCell === c - 1,
              }"
              :style="{ width: cellWidth + 'px', minWidth: cellWidth + 'px' }"
              @mousedown.prevent="onRulerMouseDown($event, c - 1)"
              @contextmenu.prevent="onRulerRightClick($event, c - 1)"
            >
              <span class="ruler-num">{{ c }}</span>
              <div v-if="markerAt(c - 1)" class="time-marker">{{ markerAt(c - 1).label }}</div>
            </div>
            <!-- Loop region highlight band -->
            <div v-if="loopRegion" class="loop-region-band"
              :style="loopRegionBandStyle"
              title="Loop region — right-click to clear"
              @contextmenu.prevent="clearLoopRegion()" />
            <!-- Playhead needle drawn by canvas overlay -->
          </div>
        </div>

        <!-- Track rows (vertically culled; spacers preserve scroll height/offsets) -->
        <div v-if="trackWindow.topPad" class="pl-cull-spacer" :style="{ height: trackWindow.topPad + 'px' }" />
        <template v-for="track in trackWindow.slice" :key="track.id">
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
              :data-tool="playlistTool"
              :style="{ width: PLAYLIST_CELLS * cellWidth + 'px' }"
              @mousedown.prevent="onCellsMouseDown($event, track)"
              @mousemove="onCellsMouseMove($event, track)"
              @mouseup="onCellsMouseUp"
              @mouseleave="hoverGhost = null"
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

              <!-- Playhead drawn by canvas overlay -->

              <!-- Pattern clips -->
              <template v-if="clipFocusMode === 'pattern' || clipFocusMode === 'automation'">
                <div
                  v-for="clip in visibleClipsForTrack(track.id)"
                  :key="clip.id"
                  class="pl-clip"
                  :class="{
                    ghost:       clipFocusMode === 'automation',
                    dragging:    draggingClip?.id === clip.id,
                    selected:    selectedClipIds.has(clip.id),
                    'clip-muted':  clip.muted,
                    'tool-slice':  playlistTool === 'slice',
                    'tool-slip':   playlistTool === 'slip',
                  }"
                  :style="patternClipStyle(clip)"
                  @mousedown.stop="onClipMouseDown($event, clip, track)"
                  @mousemove="onClipSliceHover($event, clip)"
                  @mouseleave="slicePreview = null"
                  @contextmenu.prevent.stop="openClipMenu($event, clip)"
                >
                  <!-- Left resize handle (Step 8/9) — drag to window from left edge -->
                  <div v-if="!track.locked"
                    class="clip-left-handle"
                    @mousedown.stop="onLeftResizeStart($event, clip)" />

                  <!-- Title bar: solid theme color strip with name + dropdown -->
                  <div class="clip-titlebar" :style="{ background: clipColor(clip) }">
                    <button
                      class="clip-dropdown-btn"
                      @mousedown.stop
                      @click.stop="openClipMenu($event, clip)"
                      title="Clip options"
                    >▼</button>
                    <span
                      class="clip-titlebar-name"
                      :class="{ 'name-muted': clip.muted }"
                    >{{ clipLabel(clip) }}</span>
                    <!-- Step 11: source-offset badge ("⊳N" shows which bar content starts from) -->
                    <span v-if="(clip.slipOffset ?? 0) > 0"
                      class="clip-offset-badge"
                      :title="'Content starts at bar ' + (Math.floor((clip.slipOffset ?? 0) / totalSteps) + 1)">
                      ⊳{{ Math.floor((clip.slipOffset ?? 0) / totalSteps) + 1 }}
                    </span>
                    <!-- Step 6: progress fill sweeps across titlebar as playhead passes through -->
                    <div v-if="isPlaying && clipLocalHeadX(clip) >= 0"
                      class="clip-title-progress"
                      :style="{
                        width: (clipLocalHeadX(clip) / ((clip.width || 1) * cellWidth - 4)) * 100 + '%'
                      }" />
                  </div>

                  <!-- Body: translucent theme color with canvas note preview -->
                  <div class="clip-body" :style="{ background: hexToRgba(clipColor(clip), 0.18) }">
                    <canvas
                      :ref="el => onClipCanvasRef(clip.id, el)"
                      class="clip-note-canvas"
                    />
                    <!-- Step 6: real-time vertical playhead inside the clip body -->
                    <div v-if="isPlaying && clipLocalHeadX(clip) >= 0"
                      class="clip-local-head"
                      :style="{ left: clipLocalHeadX(clip) + 'px' }" />
                    <!-- Step 10: snapped slice preview line before committing the cut -->
                    <div v-if="slicePreview?.clipId === clip.id"
                      class="clip-slice-preview"
                      :style="{ left: slicePreview.x + 'px' }" />
                  </div>

                  <!-- Right resize handle -->
                  <div v-if="!track.locked"
                    class="clip-resize-handle"
                    @mousedown.stop="onResizeStart($event, clip)" />

                  <!-- Step 9: right-edge truncation indicator — dot pattern signals hidden content -->
                  <div
                    v-if="(clip.slipOffset ?? 0) + (clip.width || 1) * totalSteps < patternWidthCells(clip.patternId) * totalSteps"
                    class="clip-truncated-edge" />
                </div>
              </template>

              <!-- Automation clips -->
              <template v-if="clipFocusMode === 'automation' || clipFocusMode === 'pattern'">
                <div
                  v-for="auto in visibleAutoForTrack(track.id)"
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

              <!-- Hover ghost: shows full pattern footprint before you click (Step 3) -->
              <div
                v-if="hoverGhost && hoverGhost.trackId === track.id && !dragGhost"
                class="pl-clip hover-ghost-clip"
                :style="{
                  left:  hoverGhost.cell * cellWidth + 'px',
                  width: hoverGhost.width * cellWidth - 3 + 'px',
                  '--clip-color': hoverGhost.color,
                }"
              />

              <!-- Drag ghost -->
              <div
                v-if="dragGhost && dragGhost.trackId === track.id"
                class="pl-clip drag-ghost-clip"
                :style="dragGhostStyle"
              />
            </div>
          </div>
        </template>
        <div v-if="trackWindow.botPad" class="pl-cull-spacer" :style="{ height: trackWindow.botPad + 'px' }" />

        <!-- Add track row -->
        <div class="pl-add-track-row">
          <div class="pl-track-header add-header">
            <button class="add-track-btn" @click="addPlaylistTrack">+ ADD TRACK</button>
          </div>
          <div :style="{ width: PLAYLIST_CELLS * cellWidth + 'px', height: '100%' }" />
        </div>

      </div>
      <!-- ── Playhead canvas overlay ─────────────────────────────────────────── -->
      <canvas ref="playheadCanvas" class="pl-playhead-canvas" />

    </div>

    <!-- ── Track context menu ─────────────────────────────────────────────────── -->
    <div
      v-if="trackMenu"
      class="ctx-menu"
      :style="{ top: trackMenu.y + 'px', left: trackMenu.x + 'px' }"
      @click.stop
    >
      <div class="ctx-item" @click="ctxRename">Rename…</div>
      <div class="ctx-item" @click="ctxAutoName">Auto name</div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="ctxPickTrackColor">
        Change color…
        <input ref="trackColorInput" type="color" class="hidden-color"
          @change="onTrackColorPicked($event)" />
      </div>
      <div class="ctx-sep" />
      <div v-if="!trackMenu.track.groupParentId" class="ctx-item" @click="ctxGroupAbove">Group with above track</div>
      <div v-else class="ctx-item" @click="ctxUngroup">Remove from group</div>
      <div v-if="hasChildren(trackMenu.track)" class="ctx-item" @click="ctxToggleCollapse">
        {{ trackMenu.track.collapsed ? 'Expand group' : 'Collapse group' }}
      </div>
      <div class="ctx-item" @click="ctxToggleLock">
        {{ trackMenu.track.locked ? 'Unlock track' : 'Lock to content' }}
      </div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="ctxCloneTrack">Clone track</div>
      <div class="ctx-item" @click="ctxMoveUp">Move up</div>
      <div class="ctx-item" @click="ctxMoveDown">Move down</div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="ctxConsolidate">Consolidate lane clips</div>
      <div class="ctx-item" @click="ctxMergePatternClips">Merge pattern clips</div>
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
      <div class="ctx-item" @click="ctxRenameClip">Rename and color…</div>
      <div class="ctx-item" @click="ctxPickClipColor">
        Change color…
        <input ref="clipColorInput" type="color" class="hidden-color"
          @change="onClipColorPicked($event)" />
      </div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="ctxDuplicateClip">Duplicate clip</div>
      <div class="ctx-item" @click="ctxMakeUnique">Make Unique</div>
      <div class="ctx-item" @click="ctxSelectSimilar">Select all similar clips</div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="ctxBeatSlice('bar')">Chop into Bars</div>
      <div class="ctx-item" @click="ctxBeatSlice('beat')">Chop into Beats</div>
      <div class="ctx-sep" />
      <div class="ctx-item danger" @click="ctxRemoveClip">Remove clip</div>
    </div>

    <!-- ── Select box overlay ───────────────────────────────────────────────────── -->
    <div
      v-if="selectBox"
      class="select-box"
      :style="{
        left:   selectBox.left   + 'px',
        top:    selectBox.top    + 'px',
        width:  selectBox.width  + 'px',
        height: selectBox.height + 'px',
      }"
    />

    <!-- ── Track rename overlay ───────────────────────────────────────────────── -->
    <div v-if="trackRenaming" class="rename-overlay" @click.self="trackRenaming = false">
      <div class="rename-box">
        <span class="rename-label">Rename track</span>
        <input ref="trackRenameInput" v-model="trackRenameName" class="rename-input"
          @keydown.enter="commitTrackRename" @keydown.esc="trackRenaming = false" maxlength="24" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitTrackRename">OK</button>
          <button class="rename-cancel" @click="trackRenaming = false">Cancel</button>
        </div>
      </div>
    </div>

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
        </div>
      </div>
    </div>

    <!-- ── Clip rename dialog ──────────────────────────────────────────────────── -->
    <div v-if="clipRenameDialog" class="rename-overlay" @click.self="clipRenameDialog = false">
      <div class="rename-box">
        <span class="rename-label">Rename clip</span>
        <input ref="clipRenameInput" v-model="clipRenameName" class="rename-input"
          @keydown.enter="commitClipRename" @keydown.esc="clipRenameDialog = false" maxlength="32" />
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <label style="font-family:Rajdhani,sans-serif;font-size:11px;color:#606080">Color</label>
          <input type="color" v-model="clipRenameColor" style="width:36px;height:24px;border:none;background:none;cursor:pointer" />
        </div>
        <div class="rename-btns">
          <button class="rename-ok" @click="commitClipRename">OK</button>
          <button class="rename-cancel" @click="clipRenameDialog = false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── Arrangement rename dialog ──────────────────────────────────────────── -->
    <div v-if="arrRenameDialog" class="rename-overlay" @click.self="arrRenameDialog = false">
      <div class="rename-box">
        <span class="rename-label">Rename arrangement</span>
        <input ref="arrRenameInput" v-model="arrRenameName" class="rename-input"
          @keydown.enter="commitArrRename" @keydown.esc="arrRenameDialog = false" maxlength="32" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitArrRename">OK</button>
          <button class="rename-cancel" @click="arrRenameDialog = false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── Merge arrangement dialog ────────────────────────────────────────────── -->
    <div v-if="mergeDialog" class="rename-overlay" @click.self="mergeDialog = false">
      <div class="rename-box" style="min-width:340px">
        <span class="rename-label">Merge arrangement</span>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <div style="display:flex;align-items:center;gap:8px">
            <label class="rename-label" style="min-width:120px">Source</label>
            <select class="tb-select" v-model="mergeSourceId" style="flex:1">
              <option v-for="pl in playlists" :key="pl.id" :value="pl.id"
                :disabled="pl.id === currentPlaylistId">{{ pl.name }}</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label class="rename-label" style="min-width:120px">Position</label>
            <select class="tb-select" v-model="mergePosition" style="flex:1">
              <option value="start">Start</option>
              <option value="end">End</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label class="rename-label" style="min-width:120px">Mode</label>
            <select class="tb-select" v-model="mergeMode" style="flex:1">
              <option value="merge">Merge</option>
              <option value="insert">Insert</option>
              <option value="replace">Replace</option>
            </select>
          </div>
        </div>
        <div class="rename-btns" style="margin-top:12px">
          <button class="rename-ok" @click="commitMerge">Accept</button>
          <button class="rename-cancel" @click="mergeDialog = false">Cancel</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useStudio, TICKS_PER_STEP } from '../store/studio.js'

const {
  patterns, currentPatternId, pickerPatternId,
  patternData, channels,
  playlistTracks, playlistClips, automationClips, timeMarkers, usePlaylist,
  playlistTool, cellWidth, trackHeight, clipFocusMode, displayCell, displayStep, playbackStartCell, isPlaying,
  bpm, totalSteps, getPlayheadTimeSeconds, gridSnap, ppq, snapBars,
  loopRegion, setLoopRegion, clearLoopRegion,
  addPlaylistTrack, removePlaylistTrack, soloPlaylistTrack,
  placeClip, removeClip, moveClip, resizeClip, splitClip, setSlipOffset, makeUniqueClip, consolidateTrack,
  addTimeMarker, removeTimeMarker,
  groupTrackWithAbove, ungroupTrack, toggleTrackCollapse, setTrackLocked,
  clonePlaylistTrack, movePlaylistTrackUp, movePlaylistTrackDown, setTrackColor, autoNameTrack,
  insertTime, deleteTime, beatSliceClip, duplicateClips,
  playlists, currentPlaylistId, switchPlaylist, clonePlaylist, addPlaylist, renamePlaylist, deletePlaylist, mergePlaylist,
  addAutomationClip, removeAutomationClip, addAutoNode, removeAutoNode, resizeAutomationClip,
  getUnusedPatternIds, getPatternLengthTicks,
  PLAYLIST_CELLS,
} = useStudio()

// ── Tools ─────────────────────────────────────────────────────────────────────
const tools = [
  { id: 'draw',   icon: '✏',  tip: 'Draw — click to place/toggle clips (D)' },
  { id: 'paint',  icon: '🖌',  tip: 'Paint — drag to fill cells (P)' },
  { id: 'erase',  icon: '✕',  tip: 'Erase — click/drag to remove clips (X)' },
  { id: 'slice',  icon: '✂',  tip: 'Slice — cut clip at cursor (C)' },
  { id: 'mute',   icon: '⊘',  tip: 'Mute — toggle individual clip mute (T)' },
  { id: 'select', icon: '⬚',  tip: 'Select — drag box to select clips (E)' },
  { id: 'slip',   icon: '↔',  tip: 'Slip — drag to shift pattern content inside clip boundary (S)' },
]
// ── Auto-scroll & selection ───────────────────────────────────────────────────
const autoScroll      = ref(true)
const selectedClipIds = ref(new Set())
const selectBox       = ref(null)   // { left, top, width, height } viewport coords
let selectStartX = 0, selectStartY = 0

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
function patternName(pid)    { return patterns.find(p => p.id === pid)?.name  ?? '?' }
function patternColor(pid)   { return patterns.find(p => p.id === pid)?.color ?? '#4ecdc4' }
function clipLabel(clip)     { return clip._label ?? patternName(clip.patternId) }
function clipColor(clip)     { return clip._color  ?? patternColor(clip.patternId) }

// In-clip playhead position (px from clip left edge), or -1 when out of range.
// Used by Step 6 to draw the real-time bar:beat indicator inside the clip body.
function clipLocalHeadX(clip) {
  const localCell = displayCell.value - clip.cell
  if (localCell < 0 || localCell >= (clip.width || 1)) return -1
  const localStep      = localCell * totalSteps.value + Math.max(0, displayStep.value)
  const totalClipSteps = (clip.width || 1) * totalSteps.value
  const progress       = localStep / totalClipSteps
  return progress * ((clip.width || 1) * cellWidth.value - 4)
}

// Returns the width of a pattern in playlist cells (= number of bars).
function patternWidthCells(patId) {
  const ticks = getPatternLengthTicks(patId)
  return Math.max(1, Math.ceil(ticks / (totalSteps.value * TICKS_PER_STEP)))
}
// Returns "N BAR" label string for the picker, only shown for multi-bar patterns.
function patternBarLabel(patId) {
  const bars = patternWidthCells(patId)
  return bars > 1 ? bars + (bars === 1 ? ' BAR' : ' BAR') : null
}

function patternClipStyle(clip) {
  const color = clipColor(clip)
  return {
    left:  clip.cell * cellWidth.value + 'px',
    width: (clip.width || 1) * cellWidth.value - 2 + 'px',
    '--clip-color': color,
    borderColor: hexToRgba(color, 0.5),
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
// Returns normalised note positions { x%, y%, w% } relative to the clip's
// *visible window* (clip.width cells, offset by clip.slipOffset steps).
// This ensures the canvas preview exactly matches what the scheduler plays.
function previewNotes(clip) {
  const notes = []
  if (!patternData) return notes
  const pd = patternData[clip.patternId]
  if (!pd) return notes

  // The visible window the clip plays: [slipOffset … slipOffset + clipWidth] in steps.
  const slipOff     = clip.slipOffset ?? 0
  const clipSteps   = (clip.width || 1) * totalSteps.value
  const windowTicks = clipSteps * TICKS_PER_STEP   // total visible ticks
  const slipTicks   = slipOff * TICKS_PER_STEP     // tick offset into the pattern

  let idx = 0
  // Gather all pianoNotes across channels (steps-mode channels mirror their
  // active steps as C5 notes so the same tick-accurate rendering applies here).
  const allNotes = []
  channels.forEach(ch => {
    const d = pd[ch.id]
    if (!d?.pianoNotes?.length) return
    d.pianoNotes.forEach(n => { allNotes.push({ n, ch }) })
  })
  if (allNotes.length) {
    const pitches = allNotes.map(({ n }) => n.pitch)
    const minP = Math.min(...pitches), maxP = Math.max(...pitches)
    const range = maxP - minP || 1
    allNotes.forEach(({ n }) => {
      const rawTick = n.startTick ?? (n.step ?? 0) * TICKS_PER_STEP
      const relTick = rawTick - slipTicks
      if (relTick < 0 || relTick >= windowTicks) return
      const x = (relTick / windowTicks) * 100
      const w = Math.max(0.5, ((n.durationTicks ?? TICKS_PER_STEP) / windowTicks) * 100 - 0.2)
      const y = ((maxP - n.pitch) / range) * 76 + 10
      notes.push({ key: idx++, x, y, w })
    })
  }
  return notes
}

// ── Canvas clip preview engine ────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return `rgba(255,255,255,${alpha})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const clipCanvases   = new Map()
const pickerCanvases = new Map()

// ── Picker mini-canvas (Section 1.2 — compressed MIDI thumbnail) ─────────────
function onPickerCanvasRef(patId, el) {
  if (el) { pickerCanvases.set(patId, el); requestAnimationFrame(() => drawPickerCanvas(patId, el)) }
  else      pickerCanvases.delete(patId)
}

function drawPickerCanvas(patId, canvas) {
  const W = canvas.offsetWidth || 100
  const H = canvas.offsetHeight || 14
  if (W < 4 || H < 2) return
  const dpr = window.devicePixelRatio || 1
  canvas.width  = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  const pd = patternData[patId]
  if (!pd) return
  const color    = patternColor(patId)
  const patTicks = getPatternLengthTicks(patId)
  if (patTicks <= 0) return

  // Collect all notes (step + piano) normalised to pixels
  const rects = []
  // Unified rendering: steps-mode channels mirror active steps as C5 pianoNotes,
  // so a single tick-accurate pass covers both steps and piano-roll channels.
  const allNotesPicker = []
  channels.forEach(ch => {
    const d = pd[ch.id]
    if (!d?.pianoNotes?.length) return
    d.pianoNotes.forEach(n => allNotesPicker.push(n))
  })
  if (!allNotesPicker.length) return
  const pickerPitches = allNotesPicker.map(n => n.pitch)
  const minP2 = Math.min(...pickerPitches), maxP2 = Math.max(...pickerPitches), range2 = maxP2 - minP2 || 1
  allNotesPicker.forEach(n => {
    const x = ((n.startTick ?? 0) / patTicks) * W
    const w = Math.max(0.8, ((n.durationTicks ?? TICKS_PER_STEP) / patTicks) * W - 0.3)
    const y = ((maxP2 - n.pitch) / range2) * (H - 2) + 1
    rects.push({ x, y, w, h: 2 })
  })
  if (!rects.length) return
  ctx.fillStyle = hexToRgba(color, 0.75)
  rects.forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h))
}

function redrawAllPickerCanvases() {
  nextTick(() => pickerCanvases.forEach((el, pid) => drawPickerCanvas(pid, el)))
}

function onClipCanvasRef(clipId, el) {
  if (el) {
    clipCanvases.set(clipId, el)
    requestAnimationFrame(() => drawClipCanvas(clipId, el))
  } else {
    clipCanvases.delete(clipId)
  }
}

function drawClipCanvas(clipId, canvas) {
  const clip = playlistClips.find(c => c.id === clipId)
  if (!clip || !canvas) return

  const clipW = (clip.width || 1) * cellWidth.value - 4
  const TITLE_H = 18
  const clipH   = Math.max(4, trackHeight.value - TITLE_H - 6)

  const dpr = window.devicePixelRatio || 1
  canvas.width  = Math.round(clipW * dpr)
  canvas.height = Math.round(clipH * dpr)

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, clipW, clipH)

  const color    = clipColor(clip)
  const isActive = clip.patternId === currentPatternId.value || clip.patternId === pickerPatternId.value
  const noteAlpha = isActive ? 0.85 : 0.28
  const clipBars  = clip.width || 1   // 1 playlist cell = 1 bar
  const pxPerBar  = cellWidth.value   // pixels per bar at current zoom

  // ── Step 13: Adaptive LOD ─────────────────────────────────────────────────────
  // Ultra-narrow (extreme zoom-out): solid color block only, no sub-elements.
  if (clipW < 6) {
    ctx.fillStyle = hexToRgba(color, noteAlpha * 0.55)
    ctx.fillRect(0, 0, clipW, clipH)
    return
  }
  // Narrow: skip note details, just draw the bar-separator skeleton.
  const skipNotes = clipW < 16

  // ── Bar separator lines (Steps 4 + 5) ────────────────────────────────────────
  ctx.lineWidth = 1
  for (let b = 1; b < clipBars; b++) {
    const bx = (b / clipBars) * clipW
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, clipH); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath(); ctx.moveTo(bx + 0.5, 0); ctx.lineTo(bx + 0.5, clipH); ctx.stroke()
  }

  // ── Beat sub-divisions (visible above ~100px per bar, Step 13 zoom-in) ────────
  if (pxPerBar > 100) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    for (let b = 0; b < clipBars; b++) {
      for (let beat = 1; beat < 4; beat++) {
        const bx = ((b * 4 + beat) / (clipBars * 4)) * clipW
        ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, clipH); ctx.stroke()
      }
    }
  }

  // ── Step-level micro-grid (visible above ~280px per bar — extreme zoom-in) ────
  if (pxPerBar > 280) {
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    ctx.lineWidth = 1
    const stepsPerBar = totalSteps.value   // 16 steps = 1 bar
    for (let b = 0; b < clipBars; b++) {
      for (let s = 0; s < stepsPerBar; s++) {
        if (s % 4 === 0) continue   // already drawn as beat
        const sx = ((b * stepsPerBar + s) / (clipBars * stepsPerBar)) * clipW
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, clipH); ctx.stroke()
      }
    }
  }

  // ── Step 14: Ghost-tail zone — dim overlay for empty space beyond last note ──
  // Pattern length (via time marker or auto-calculated) vs. actual note extent.
  const patLenTicks  = getPatternLengthTicks(clip.patternId)
  const clipLenTicks = (clip.width || 1) * totalSteps.value * TICKS_PER_STEP
  const normLen      = Math.max(patLenTicks, clipLenTicks)   // what the clip represents

  // Find the tick of the last note in any piano channel of this pattern.
  let lastNoteTick = 0
  const pd = patternData[clip.patternId]
  if (pd) {
    Object.values(pd).forEach(d => {
      if (!d?.pianoNotes) return
      d.pianoNotes.forEach(n => {
        const end = (n.startTick ?? 0) + (n.durationTicks ?? TICKS_PER_STEP)
        if (end > lastNoteTick) lastNoteTick = end
      })
    })
  }

  // ── Step 14: Ghost-tail zone — transparent grid block for empty pattern padding ──
  // Shows deliberate empty space (e.g. a 5-bar melody in an 8-bar time-marker slot).
  if (lastNoteTick < normLen && normLen > 0) {
    const tailStartX   = (lastNoteTick / normLen) * clipW
    const tailWidth    = clipW - tailStartX
    // Transparent fill — lighter than note area so content vs. silence is clear at a glance
    ctx.fillStyle = 'rgba(0,0,0,0.09)'
    ctx.fillRect(tailStartX, 0, tailWidth, clipH)
    // Bar-separator lines inside the ghost block (same visual language as the rest of the clip)
    if (tailWidth > 4) {
      const ticksPerBar = totalSteps.value * TICKS_PER_STEP
      const totalBarsN  = Math.ceil(normLen / ticksPerBar)
      ctx.strokeStyle = 'rgba(255,255,255,0.13)'
      ctx.lineWidth = 1
      for (let b = 1; b < totalBarsN; b++) {
        const bx = (b * ticksPerBar / normLen) * clipW
        if (bx <= tailStartX + 0.5) continue
        ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, clipH); ctx.stroke()
      }
    }
  }

  // Collect normalised notes via existing previewNotes helper (returns x%, y%, w%)
  if (skipNotes) return
  const notes = previewNotes(clip)
  if (!notes.length) return

  ctx.fillStyle = hexToRgba(color, noteAlpha)
  const noteH = Math.max(1.5, clipH * 0.13)
  notes.forEach(n => {
    const x = (n.x / 100) * clipW
    const y = (n.y / 100) * clipH
    const w = Math.max(1.5, (n.w / 100) * clipW - 0.5)
    ctx.fillRect(x, y, w, noteH)
  })
}

function redrawAllClipCanvases() {
  nextTick(() => clipCanvases.forEach((el, id) => drawClipCanvas(id, el)))
}

watch([cellWidth, trackHeight, currentPatternId, pickerPatternId], redrawAllClipCanvases)
watch(patternData,    redrawAllClipCanvases,   { deep: true })
watch(patternData,    redrawAllPickerCanvases,  { deep: true })
// Redraw clip canvases when slipOffset, width, or any clip property changes (Step 12)
watch(playlistClips,  redrawAllClipCanvases,   { deep: true })

// ── Automation graph helpers ──────────────────────────────────────────────────
function autoPolyline(auto) {
  const W = (auto.width || 1) * cellWidth.value
  const H = trackHeight.value - 18
  return auto.nodes.map(n => `${n.x * W},${(1 - n.y) * H}`).join(' ')
}

// ── Marker helpers ────────────────────────────────────────────────────────────
function markerAt(cell) { return timeMarkers.find(m => m.cell === cell) }

const markerDialog = ref(false)
const markerLabel  = ref('Section')
const markerInput  = ref(null)
let   pendingMarkerCell = 0

function addMarkerPrompt() {
  pendingMarkerCell = 0; markerLabel.value = 'Section'; markerDialog.value = true
  nextTick(() => markerInput.value?.select())
}
function addMarkerAt(cell) {
  if (markerAt(cell)) return
  pendingMarkerCell = cell; markerLabel.value = 'Section'; markerDialog.value = true
  nextTick(() => markerInput.value?.select())
}
function removeMarkerAt(cell) {
  const m = markerAt(cell); if (m) removeTimeMarker(m.id)
}
function commitMarker() {
  if (markerLabel.value.trim()) addTimeMarker(pendingMarkerCell, markerLabel.value.trim())
  markerDialog.value = false
}

// ── Add automation track helper ───────────────────────────────────────────────
function addAutoTrack() {
  addPlaylistTrack()
  const track = playlistTracks[playlistTracks.length - 1]
  track.name  = 'Automation ' + playlistTracks.length
  track.color = '#4ecdc4'
  clipFocusMode.value = 'automation'
  pickerTab.value     = 'automation'
}

// ── Local snap (overrides global gridSnap for Playlist) ──────────────────────
const SNAP_OPTIONS = [
  { id: 'none', label: 'None', cells: 0 },
  { id: 'beat', label: '1 Beat', cells: 0.25 },
  { id: 'bar',  label: '1 Bar',  cells: 1 },
  { id: '2bar', label: '2 Bars', cells: 2 },
  { id: '4bar', label: '4 Bars', cells: 4 },
]
const localSnap = ref('bar')

function snapCellLocal(rawCell) {
  const opt = SNAP_OPTIONS.find(o => o.id === localSnap.value)
  if (!opt || opt.cells === 0) return rawCell
  return Math.round(rawCell / opt.cells) * opt.cells
}

// ── Snap helper — routes through the global PPQ quantization engine ───────────
//   1 playlist cell = 1 bar. Line mode adapts its division to the zoom level.
function lineTau() {
  const bar = ppq.value * 4
  const px = cellWidth.value                       // pixels per bar
  const frac = px > 240 ? 16 : px > 120 ? 8 : px > 60 ? 4 : px > 30 ? 2 : 1
  return bar / frac
}
function snapCell(raw) {
  const local = snapCellLocal(raw)
  return local
}
function cellFromX(x) { return snapCell(x / cellWidth.value) }

// ── Loop region ───────────────────────────────────────────────────────────────
const loopRegionBandStyle = computed(() => {
  if (!loopRegion.value) return {}
  const TICKS = totalSteps.value * 4    // ticks per bar (cell)
  const startCell = loopRegion.value.startTick / TICKS
  const endCell   = loopRegion.value.endTick   / TICKS
  const startPx = startCell * cellWidth.value
  const width   = (endCell - startCell) * cellWidth.value
  return { left: startPx + 'px', width: width + 'px' }
})

function toggleLoopRegion() {
  if (loopRegion.value) { clearLoopRegion(); return }
  const TICKS = totalSteps.value * 4
  setLoopRegion(displayCell.value * TICKS, (displayCell.value + 4) * TICKS)
}

// ── Ruler loop-region drag (Ctrl+drag to set loop region) ──────────────────
let loopDragStart = -1

// ── Pattern clip mouse interactions ──────────────────────────────────────────
const draggingClip  = ref(null)
const dragGhost     = ref(null)
const hoverGhost    = ref(null)    // { trackId, cell, width, color } — pre-placement ghost
const pickerDrag    = ref(null)    // { patId, color, floatW } — drag-from-picker state
const pickerDragPos = ref({ x: 0, y: 0 })   // current cursor viewport coords
let   isPainting    = false

// ── Picker-drag ghost (Section 1.3) ──────────────────────────────────────────
// Computes which track+cell the cursor is over during a picker drag and writes
// to hoverGhost so the regular snapped ghost renders there.
function updateHoverFromPickerDrag(e) {
  const tl = timelineRef.value
  if (!tl || !pickerDrag.value) { hoverGhost.value = null; return }
  const tlRect = tl.getBoundingClientRect()
  const inTimeline = e.clientX >= tlRect.left  && e.clientX <= tlRect.right &&
                     e.clientY >= tlRect.top   && e.clientY <= tlRect.bottom
  if (!inTimeline) { hoverGhost.value = null; return }

  const relY  = e.clientY - tlRect.top  + tl.scrollTop  - RULER_H
  const relX  = e.clientX - tlRect.left + tl.scrollLeft - HEADER_W
  const tIdx  = Math.max(0, Math.min(visibleTracks.value.length - 1, Math.floor(relY / trackHeight.value)))
  const track = visibleTracks.value[tIdx]
  if (!track || track.locked) { hoverGhost.value = null; return }

  const patId = pickerDrag.value.patId
  const w     = patternWidthCells(patId)
  const snappedCell = Math.max(0, Math.min(PLAYLIST_CELLS - w, Math.floor((relX / cellWidth.value) / w) * w))
  hoverGhost.value = { trackId: track.id, cell: snappedCell, width: w, color: patternColor(patId) }
}

function onPickerItemDown(e, pat) {
  pickerPatternId.value = pat.id   // select on mousedown
  if (e.button !== 0) return

  let dragStarted = false
  const startX = e.clientX, startY = e.clientY
  const floatW = Math.min(patternWidthCells(pat.id) * cellWidth.value, 300)

  const onMove = (me) => {
    pickerDragPos.value = { x: me.clientX, y: me.clientY }
    if (!dragStarted && (Math.abs(me.clientX - startX) > 4 || Math.abs(me.clientY - startY) > 4)) {
      dragStarted = true
      pickerDrag.value = { patId: pat.id, color: pat.color, floatW }
    }
    if (dragStarted) updateHoverFromPickerDrag(me)
  }

  const onUp = (ue) => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup',   onUp)
    if (dragStarted && hoverGhost.value) {
      // Commit placement at the snapped ghost position
      placeClip(hoverGhost.value.trackId, hoverGhost.value.cell, pat.id)
    }
    pickerDrag.value = null
    hoverGhost.value = null
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup',   onUp)
}

function clipAtCell(trackId, cell) {
  return playlistClips.find(c => c.trackId === trackId && cell >= c.cell && cell < c.cell + (c.width || 1))
}

function onCellsMouseDown(e, track) {
  if (e.button !== 0) return
  const rect    = e.currentTarget.getBoundingClientRect()
  const rawCell = cellFromX(e.clientX - rect.left)
  const cell    = Math.max(0, Math.min(PLAYLIST_CELLS - 1, Math.floor(rawCell)))
  const tool    = playlistTool.value

  // Select tool: start drag box on empty area
  if (tool === 'select') {
    selectedClipIds.value = new Set()
    selectStartX = e.clientX; selectStartY = e.clientY
    selectBox.value = { left: e.clientX, top: e.clientY, width: 0, height: 0 }
    window.addEventListener('mousemove', onSelectMove)
    window.addEventListener('mouseup',   onSelectEnd, { once: true })
    return
  }

  if (track.locked) return

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
    const clip = clipAtCell(track.id, cell)
    if (clip) removeClip(clip.id)
    return
  }
  if (tool === 'slice') {
    const clip = clipAtCell(track.id, cell)
    if (clip && cell > clip.cell) splitClip(clip.id, cell)
    return
  }
  if (tool === 'mute') {
    const clip = clipAtCell(track.id, cell)
    if (clip) clip.muted = !clip.muted
    return
  }
  if (tool === 'draw') {
    hoverGhost.value = null  // hide ghost on click
    const clip = clipAtCell(track.id, cell)
    if (clip) { removeClip(clip.id); return }
    // Place at the snapped cell for pattern-width alignment
    const w = patternWidthCells(pickerPatternId.value)
    const snappedCell = Math.max(0, Math.min(PLAYLIST_CELLS - w, Math.floor(rawCell / w) * w))
    placeClip(track.id, snappedCell, pickerPatternId.value)
    return
  }
  if (tool === 'paint') {
    isPainting = true
    hoverGhost.value = null
    // Snap first paint stroke to pattern-width grid (Step 15)
    const w = patternWidthCells(pickerPatternId.value)
    const snappedCell = Math.max(0, Math.min(PLAYLIST_CELLS - w, Math.floor(rawCell / w) * w))
    placeClip(track.id, snappedCell, pickerPatternId.value)
    window.addEventListener('mouseup', stopPainting, { once: true })
  }
}

// ── Select box drag ───────────────────────────────────────────────────────────
function onSelectMove(e) {
  const x = Math.min(e.clientX, selectStartX)
  const y = Math.min(e.clientY, selectStartY)
  selectBox.value = {
    left:   x,
    top:    y,
    width:  Math.abs(e.clientX - selectStartX),
    height: Math.abs(e.clientY - selectStartY),
  }
}

function onSelectEnd(e) {
  if (!selectBox.value || !timelineRef.value) { selectBox.value = null; return }
  const box = selectBox.value
  const tl  = timelineRef.value
  const tlRect = tl.getBoundingClientRect()
  const ids = new Set()
  visibleTracks.value.forEach((track, tIdx) => {
    const trackTop    = tlRect.top + 28 + tIdx * trackHeight.value - tl.scrollTop
    const trackBottom = trackTop + trackHeight.value
    if (trackBottom < box.top || trackTop > box.top + box.height) return
    patternClipsForTrack(track.id).forEach(clip => {
      const clipLeft  = tlRect.left + 140 + clip.cell * cellWidth.value - tl.scrollLeft
      const clipRight = clipLeft + (clip.width || 1) * cellWidth.value
      if (clipRight >= box.left && clipLeft <= box.left + box.width) ids.add(clip.id)
    })
  })
  selectedClipIds.value = ids
  selectBox.value = null
}

function onCellsMouseMove(e, track) {
  if (draggingClip.value) { onDragMove(e); return }

  const rect    = e.currentTarget.getBoundingClientRect()
  const rawCell = cellFromX(e.clientX - rect.left)
  const tool    = playlistTool.value

  // Hover ghost: show exact pattern footprint while hovering with draw tool (Step 3)
  if (tool === 'draw' && clipFocusMode.value === 'pattern' && !isPainting) {
    const w    = patternWidthCells(pickerPatternId.value)
    const cell = Math.max(0, Math.min(PLAYLIST_CELLS - w, Math.floor(rawCell)))
    hoverGhost.value = { trackId: track.id, cell, width: w, color: patternColor(pickerPatternId.value) }
  } else {
    hoverGhost.value = null
  }

  if (!isPainting || tool !== 'paint') return
  if (track.locked) return
  // Brush: snap to pattern-width multiples so clips chain without gaps (Step 15)
  const w         = patternWidthCells(pickerPatternId.value)
  const snappedCell = Math.max(0, Math.min(PLAYLIST_CELLS - w, Math.floor(rawCell / w) * w))
  placeClip(track.id, snappedCell, pickerPatternId.value)
}

function onCellsMouseUp() { isPainting = false }
function stopPainting()   { isPainting = false }

function onCellsRightClick(e, track) {
  if (clipFocusMode.value === 'automation') return
  const rect = e.currentTarget.getBoundingClientRect()
  const cell = Math.max(0, Math.min(PLAYLIST_CELLS - 1, Math.floor(cellFromX(e.clientX - rect.left))))
  const clip = playlistClips.find(c => c.trackId === track.id && cell >= c.cell && cell < c.cell + (c.width || 1))
  if (clip) removeClip(clip.id)
}

// ── Clip drag (move) ──────────────────────────────────────────────────────────
// ── Slice preview (Step 10) ───────────────────────────────────────────────────
// Tracks the snapped cut position while hovering over a clip with the Slice tool.
const slicePreview = ref(null)   // { clipId, x (px from clip left) }

function onClipSliceHover(e, clip) {
  if (playlistTool.value !== 'slice') { slicePreview.value = null; return }
  const rect  = e.currentTarget.getBoundingClientRect()
  const relX  = e.clientX - rect.left
  // Snap to nearest bar (cell) boundary within the clip
  const cellInClip  = Math.floor(relX / cellWidth.value)
  const snappedX    = cellInClip * cellWidth.value
  // Don't show at left edge (bar 0 would cut nothing off the front)
  if (cellInClip <= 0 || cellInClip >= (clip.width || 1)) { slicePreview.value = null; return }
  slicePreview.value = { clipId: clip.id, x: snappedX }
}

// ── Slip drag state ───────────────────────────────────────────────────────────
let slipDragClip     = null
let slipDragStartX   = 0
let slipDragOrigSlip = 0

function startSlipDrag(e, clip) {
  e.preventDefault(); e.stopPropagation()
  slipDragClip     = clip
  slipDragStartX   = e.clientX
  slipDragOrigSlip = clip.slipOffset ?? 0
  window.addEventListener('mousemove', onSlipMove)
  window.addEventListener('mouseup',   onSlipEnd, { once: true })
}

function onSlipMove(e) {
  if (!slipDragClip) return
  const dx       = e.clientX - slipDragStartX
  const stepDelta = -Math.round(dx / cellWidth.value * totalSteps.value)
  setSlipOffset(slipDragClip.id, slipDragOrigSlip + stepDelta)
}

function onSlipEnd() {
  slipDragClip = null
  window.removeEventListener('mousemove', onSlipMove)
}

function onClipMouseDown(e, clip, track) {
  const tool = playlistTool.value
  if (tool === 'erase') { removeClip(clip.id); return }
  if (tool === 'mute')  { clip.muted = !clip.muted; return }
  if (tool === 'slice') {
    const rect = e.currentTarget.getBoundingClientRect()
    const atCell = clip.cell + Math.floor((e.clientX - rect.left) / cellWidth.value)
    if (atCell > clip.cell && atCell < clip.cell + (clip.width || 1)) splitClip(clip.id, atCell)
    return
  }
  if (tool === 'select') {
    if (e.shiftKey) {
      const next = new Set(selectedClipIds.value)
      next.has(clip.id) ? next.delete(clip.id) : next.add(clip.id)
      selectedClipIds.value = next
    } else {
      selectedClipIds.value = new Set([clip.id])
    }
    return
  }
  // Slip tool (Step 12): dedicated tool or Shift+draw shortcut
  if (tool === 'slip' || (tool === 'draw' && e.shiftKey)) { startSlipDrag(e, clip); return }
  if (tool !== 'draw') return
  if (track.locked) return
  draggingClip.value = clip
  dragGhost.value = { trackId: track.id, cell: clip.cell, width: clip.width || 1, color: clipColor(clip) }
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
  dragGhost.value = { trackId: track.id, cell, width: draggingClip.value.width || 1, color: clipColor(draggingClip.value) }
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
// ── Right-edge resize ─────────────────────────────────────────────────────────
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

// ── Left-edge resize (Step 8 / Step 9 windowing) ─────────────────────────────
// Dragging the left handle adjusts the start cell, the slipOffset (so the
// remaining content stays aligned), and the width — all non-destructively.
let leftResizeClip     = null
let leftResizeStartX   = 0
let leftResizeOrigCell = 0
let leftResizeOrigSlip = 0
let leftResizeOrigW    = 0

function onLeftResizeStart(e, clip) {
  e.preventDefault(); e.stopPropagation()
  leftResizeClip     = clip
  leftResizeStartX   = e.clientX
  leftResizeOrigCell = clip.cell
  leftResizeOrigSlip = clip.slipOffset ?? 0
  leftResizeOrigW    = clip.width || 1
  window.addEventListener('mousemove', onLeftResizeMove)
  window.addEventListener('mouseup',   onLeftResizeEnd, { once: true })
}

function onLeftResizeMove(e) {
  if (!leftResizeClip) return
  const deltaCells = Math.round((e.clientX - leftResizeStartX) / cellWidth.value)
  const newCell    = Math.max(0, leftResizeOrigCell + deltaCells)
  const actualDelta = newCell - leftResizeOrigCell       // how many cells actually shifted
  const newWidth   = Math.max(1, leftResizeOrigW - actualDelta)
  const newSlip    = Math.max(0, leftResizeOrigSlip + actualDelta * totalSteps.value)
  leftResizeClip.cell        = newCell
  leftResizeClip.width       = newWidth
  leftResizeClip.slipOffset  = newSlip
  leftResizeClip._userWidth  = newWidth   // mark as manually resized
}

function onLeftResizeEnd() {
  leftResizeClip = null
  window.removeEventListener('mousemove', onLeftResizeMove)
}

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
function ctxConsolidate()         { consolidateTrack(trackMenu.value.track.id); trackMenu.value = null }
function ctxMergePatternClips()   { consolidateTrack(trackMenu.value.track.id); trackMenu.value = null }
function ctxRemoveTrack()         { removePlaylistTrack(trackMenu.value.track.id); trackMenu.value = null }
function ctxCloneTrack()          { clonePlaylistTrack(trackMenu.value.track.id); trackMenu.value = null }
function ctxMoveUp()              { movePlaylistTrackUp(trackMenu.value.track.id); trackMenu.value = null }
function ctxMoveDown()            { movePlaylistTrackDown(trackMenu.value.track.id); trackMenu.value = null }
function ctxAutoName()            { autoNameTrack(trackMenu.value.track.id); trackMenu.value = null }

const trackColorInput = ref(null)
let   _trackColorTarget = null
function ctxPickTrackColor() {
  _trackColorTarget = trackMenu.value?.track
  trackMenu.value = null
  nextTick(() => trackColorInput.value?.click())
}
function onTrackColorPicked(e) {
  if (_trackColorTarget) setTrackColor(_trackColorTarget.id, e.target.value)
  _trackColorTarget = null
}

// ── Clip context menu ─────────────────────────────────────────────────────────
const clipMenu = ref(null)
function openClipMenu(e, clip) { closeMenus(); clipMenu.value = { x: e.clientX, y: e.clientY, clip } }
function ctxDuplicateClip() {
  const c = clipMenu.value.clip
  placeClip(c.trackId, c.cell + (c.width || 1), c.patternId, c.width || 1)
  clipMenu.value = null
}
function ctxMakeUnique()   { makeUniqueClip(clipMenu.value.clip.id); clipMenu.value = null }
function ctxRemoveClip()   { removeClip(clipMenu.value.clip.id); clipMenu.value = null }
function ctxSelectSimilar() {
  const pid = clipMenu.value.clip.patternId
  selectedClipIds.value = new Set(playlistClips.filter(c => c.patternId === pid).map(c => c.id))
  clipMenu.value = null
}
function ctxBeatSlice(mode) {
  beatSliceClip(clipMenu.value.clip.id, mode)
  clipMenu.value = null
}

// ── Clip rename ───────────────────────────────────────────────────────────────
const clipRenameDialog = ref(false)
const clipRenameName   = ref('')
const clipRenameColor  = ref('#4ecdc4')
const clipRenameInput  = ref(null)
let   _clipRenameTarget = null
function ctxRenameClip() {
  _clipRenameTarget = clipMenu.value.clip
  clipRenameName.value  = _clipRenameTarget._label ?? patternName(_clipRenameTarget.patternId)
  clipRenameColor.value = _clipRenameTarget._color ?? patternColor(_clipRenameTarget.patternId)
  clipMenu.value        = null
  clipRenameDialog.value = true
  nextTick(() => clipRenameInput.value?.select())
}
function commitClipRename() {
  if (_clipRenameTarget) {
    _clipRenameTarget._label = clipRenameName.value.trim() || undefined
    _clipRenameTarget._color = clipRenameColor.value
  }
  clipRenameDialog.value = false
}

// ── Clip color picker ─────────────────────────────────────────────────────────
const clipColorInput  = ref(null)
let   _clipColorTarget = null
function ctxPickClipColor() {
  _clipColorTarget = clipMenu.value?.clip
  clipMenu.value = null
  nextTick(() => clipColorInput.value?.click())
}
function onClipColorPicked(e) {
  if (_clipColorTarget) _clipColorTarget._color = e.target.value
  _clipColorTarget = null
}

function closeMenus() { trackMenu.value = null; clipMenu.value = null; arrMenu.value = null }

// ── Arrangements menu ─────────────────────────────────────────────────────────
const arrMenu = ref(null)
function openArrMenu(e) {
  closeMenus()
  const btn = e.currentTarget.getBoundingClientRect()
  arrMenu.value = { x: btn.left, y: btn.bottom + 4 }
}
function ctxCloneArr()  { clonePlaylist(); arrMenu.value = null }
function ctxAddArr()    { addPlaylist();   arrMenu.value = null }
function ctxDeleteArr() { deletePlaylist(currentPlaylistId.value); arrMenu.value = null }

const arrRenameDialog = ref(false)
const arrRenameName   = ref('')
const arrRenameInput  = ref(null)
function ctxRenameArr() {
  const pl = playlists.find(p => p.id === currentPlaylistId.value)
  arrRenameName.value = pl?.name ?? ''
  arrMenu.value = null
  arrRenameDialog.value = true
  nextTick(() => arrRenameInput.value?.select())
}
function commitArrRename() {
  renamePlaylist(currentPlaylistId.value, arrRenameName.value)
  arrRenameDialog.value = false
}

// ── Merge dialog ──────────────────────────────────────────────────────────────
const mergeDialog   = ref(false)
const mergeSourceId = ref('')
const mergePosition = ref('end')
const mergeMode     = ref('merge')
function openMergeDialog() {
  const other = playlists.find(p => p.id !== currentPlaylistId.value)
  mergeSourceId.value = other?.id ?? ''
  arrMenu.value   = null
  mergeDialog.value = true
}
function commitMerge() {
  if (mergeSourceId.value) mergePlaylist(mergeSourceId.value, mergePosition.value, mergeMode.value)
  mergeDialog.value = false
}

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

// ── Playhead canvas engine (Audio-time source of truth → 60fps canvas) ───────
const playheadCanvas = ref(null)
let   rafId = null

const PICKER_W = 160   // .pl-picker width (matches CSS)
const HEADER_W = 140   // track header / ruler-corner width (matches CSS)
const RULER_H  = 28    // ruler row height (matches CSS)

function renderPlayheadLoop() {
  rafId = requestAnimationFrame(renderPlayheadLoop)

  const canvas = playheadCanvas.value
  const tl     = timelineRef.value
  if (!canvas || !tl) return

  const dpr = window.devicePixelRatio || 1
  const w   = canvas.clientWidth
  const h   = canvas.clientHeight
  if (w === 0 || h === 0) return

  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width  = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  // Compute exact absolute pixel position from audio clock (source of truth)
  const secPerCell = totalSteps.value * (60 / bpm.value) / 4
  const pxPerSec   = cellWidth.value / secPerCell
  const xAbsolute  = getPlayheadTimeSeconds() * pxPerSec

  // Page-flip auto-scroll: shift one screen when playhead hits 95% of track view
  if (isPlaying.value && autoScroll.value) {
    const trackViewW = tl.clientWidth - HEADER_W
    if (trackViewW > 0 && xAbsolute >= tl.scrollLeft + trackViewW * 0.95) {
      tl.scrollLeft += trackViewW
    }
  }

  // Translate absolute px → viewport canvas coordinate
  const xCanvas = PICKER_W + HEADER_W + xAbsolute - tl.scrollLeft

  // Cull: don't draw outside the track-cells viewport
  if (xCanvas < PICKER_W + HEADER_W || xCanvas > w) return

  const playing = isPlaying.value

  // Vertical line through track area (from ruler bottom to canvas bottom)
  ctx.beginPath()
  ctx.moveTo(xCanvas, RULER_H)
  ctx.lineTo(xCanvas, h)
  ctx.strokeStyle   = playing ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.35)'
  ctx.lineWidth     = playing ? 2 : 1.5
  ctx.shadowColor   = playing ? 'rgba(255,255,255,0.35)' : 'transparent'
  ctx.shadowBlur    = playing ? 6 : 0
  ctx.stroke()
  ctx.shadowBlur = 0

  // Ruler needle triangle (inside ruler row)
  ctx.beginPath()
  ctx.moveTo(xCanvas,     RULER_H - 1)
  ctx.lineTo(xCanvas - 5, 3)
  ctx.lineTo(xCanvas + 5, 3)
  ctx.closePath()
  ctx.fillStyle = playing ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)'
  ctx.fill()
}

// ── Ruler scrubbing ───────────────────────────────────────────────────────────
let isScrubbing = false

function onRulerMouseDown(e, cell) {
  if (e.button !== 0) return
  if (e.ctrlKey) {
    loopDragStart = cell
    const TICKS = totalSteps.value * 4
    setLoopRegion(cell * TICKS, (cell + 1) * TICKS)
    const onMove = (me) => {
      if (!timelineRef.value) return
      const tl  = timelineRef.value
      const relX = me.clientX - tl.getBoundingClientRect().left + tl.scrollLeft - HEADER_W
      const c2   = Math.max(0, Math.min(PLAYLIST_CELLS, Math.floor(relX / cellWidth.value)))
      const s = Math.min(loopDragStart, c2), end = Math.max(loopDragStart + 1, c2 + 1)
      setLoopRegion(s * TICKS, end * TICKS)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', onMove), { once: true })
    return
  }
  isScrubbing = true
  setPlayheadCell(cell)
  window.addEventListener('mousemove', onRulerScrubMove)
  window.addEventListener('mouseup',   onRulerScrubEnd, { once: true })
}

function setPlayheadCell(cell) {
  const c = Math.max(0, Math.min(PLAYLIST_CELLS - 1, cell))
  displayCell.value      = c
  playbackStartCell.value = c
}

function onRulerScrubMove(e) {
  if (!isScrubbing || !timelineRef.value) return
  const tl   = timelineRef.value
  const relX = e.clientX - tl.getBoundingClientRect().left + tl.scrollLeft - 140
  setPlayheadCell(Math.floor(relX / cellWidth.value))
}

function onRulerScrubEnd() {
  isScrubbing = false
  window.removeEventListener('mousemove', onRulerScrubMove)
}

function onRulerRightClick(e, cell) {
  if (markerAt(cell)) removeMarkerAt(cell)
  else { addMarkerAt(cell) }
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
const scrollTop   = ref(0)
const viewW       = ref(1200)   // visible clip-area width (minus header column)
const viewH       = ref(600)    // visible track-area height (minus ruler)

function onTimelineScroll() {
  const tl = timelineRef.value; if (!tl) return
  scrollLeft.value = tl.scrollLeft
  scrollTop.value  = tl.scrollTop
}
function measureViewport() {
  const tl = timelineRef.value; if (!tl) return
  viewW.value = Math.max(0, tl.clientWidth  - HEADER_W)
  viewH.value = Math.max(0, tl.clientHeight - RULER_H)
}

// ── Bounding-box culling (only paint instances intersecting the viewport) ─────
const CULL_X = 2, CULL_Y = 2     // cell / row overscan
const visMinCell = computed(() => scrollLeft.value / cellWidth.value - CULL_X)
const visMaxCell = computed(() => (scrollLeft.value + viewW.value) / cellWidth.value + CULL_X)
function inViewX(c) { return (c.cell + (c.width || 1)) > visMinCell.value && c.cell < visMaxCell.value }
function visibleClipsForTrack(trackId) { return playlistClips.filter(c => c.trackId === trackId && inViewX(c)) }
function visibleAutoForTrack(trackId)  { return automationClips.filter(a => a.trackId === trackId && inViewX(a)) }

// Vertical track culling with spacers to preserve scroll height & offsets.
const trackWindow = computed(() => {
  const all = visibleTracks.value
  const th  = trackHeight.value || 1
  const first = Math.max(0, Math.floor(scrollTop.value / th) - CULL_Y)
  const last  = Math.min(all.length, first + Math.ceil(viewH.value / th) + CULL_Y * 2)
  return { slice: all.slice(first, last), topPad: first * th, botPad: (all.length - last) * th }
})

// Culling telemetry (rendered / total).
const totalClipCount    = computed(() => playlistClips.length)
const renderedClipCount = computed(() => {
  let n = 0
  for (const t of trackWindow.value.slice) n += visibleClipsForTrack(t.id).length
  return n
})

const totalTimelineWidth = computed(() => PLAYLIST_CELLS * cellWidth.value)

function minimapClipStyle(clip) {
  const total = playlistTracks.length || 1
  const tIdx  = playlistTracks.findIndex(t => t.id === clip.trackId)
  return {
    left:       (clip.cell / PLAYLIST_CELLS * 100) + '%',
    width:      ((clip.width || 1) / PLAYLIST_CELLS * 100) + '%',
    top:        (tIdx / total * 100) + '%',
    height:     (1 / total * 100) + '%',
    background: clipColor(clip),
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

  // Tool shortcuts
  if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (e.key === 'd' || e.key === 'D') playlistTool.value = 'draw'
    if (e.key === 'p' || e.key === 'P') playlistTool.value = 'paint'
    if (e.key === 'x' || e.key === 'X') playlistTool.value = 'erase'
    if (e.key === 'e' || e.key === 'E') playlistTool.value = 'select'
    if (e.key === 'c' || e.key === 'C') playlistTool.value = 'slice'
    if (e.key === 't' || e.key === 'T') playlistTool.value = 'mute'
    if (e.key === 's' || e.key === 'S') playlistTool.value = 'slip'
  }

  if (e.key === 'Escape') { closeMenus(); selectedClipIds.value = new Set() }

  // Delete selected clips
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.value.size > 0) {
    selectedClipIds.value.forEach(id => removeClip(id))
    selectedClipIds.value = new Set()
    e.preventDefault()
  }

  // Ctrl+B — duplicate selection
  if (e.ctrlKey && (e.key === 'b' || e.key === 'B') && selectedClipIds.value.size > 0) {
    const newIds = duplicateClips(selectedClipIds.value)
    if (newIds?.size) selectedClipIds.value = newIds
    e.preventDefault()
  }

  // Shift+Up/Down — move selected clips to adjacent track
  if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedClipIds.value.size > 0) {
    const dir = e.key === 'ArrowUp' ? -1 : 1
    selectedClipIds.value.forEach(id => {
      const clip = playlistClips.find(c => c.id === id)
      if (!clip) return
      const vis   = visibleTracks.value
      const idx   = vis.findIndex(t => t.id === clip.trackId)
      const newT  = vis[idx + dir]
      if (newT) moveClip(id, newT.id, clip.cell)
    })
    e.preventDefault()
  }

  // Page Up / Down — vertical zoom
  if (e.key === 'PageUp')   { cellWidth.value = Math.min(200, cellWidth.value + 16); e.preventDefault() }
  if (e.key === 'PageDown') { cellWidth.value = Math.max(32,  cellWidth.value - 16); e.preventDefault() }

  // Shift+1-5 — quick zoom presets
  if (e.shiftKey) {
    if (e.key === '1') { cellWidth.value = 32;  e.preventDefault() }
    if (e.key === '2') { cellWidth.value = 64;  e.preventDefault() }
    if (e.key === '3') { cellWidth.value = 96;  e.preventDefault() }
    if (e.key === '4') { cellWidth.value = 140; e.preventDefault() }
    if (e.key === '5') { cellWidth.value = 200; e.preventDefault() }
  }
}
let _viewRO = null
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  rafId = requestAnimationFrame(renderPlayheadLoop)
  measureViewport()
  if (timelineRef.value) { _viewRO = new ResizeObserver(measureViewport); _viewRO.observe(timelineRef.value) }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  _viewRO?.disconnect()
})
</script>

<style scoped>
.pl-cull-spacer { width: 100%; flex-shrink: 0; pointer-events: none; }
.cull-stat {
  font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #50506e;
  padding: 0 8px; align-self: center; white-space: nowrap;
}
.playlist {
  display: flex; flex-direction: column; flex: 1; overflow: hidden;
  background: var(--bg-header); user-select: none;
}

/* ── Toolbar ─────────────────────────────────────────────────────────────────── */
.pl-toolbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 12px; background: var(--bg-deeper); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
}
.focus-group { display: flex; gap: 2px; }
.focus-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 38px; height: 32px; border-radius: 5px; border: 1px solid var(--border);
  background: transparent; cursor: pointer; transition: all 0.1s; color: #404060; gap: 1px;
}
.focus-btn:hover  { border-color: #4a4a6a; color: #8080b0; }
.focus-btn.active { border-color: #4ecdc4; background: #0a1a1a; color: #4ecdc4; }
.focus-icon { font-size: 13px; line-height: 1; }
.focus-lbl  { font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700; letter-spacing: 0.12em; }
.tool-group { display: flex; gap: 3px; }
.tool-btn {
  width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--border);
  background: transparent; cursor: pointer; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.1s; color: #50506a;
}
.tool-btn:hover  { border-color: #4a4a6a; color: #9090b8; }
.tool-btn.active { border-color: #e74c3c; background: #1a0808; color: #e74c3c; }
.divider { width: 1px; height: 22px; background: var(--border-subtle); flex-shrink: 0; }
.tb-label { font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700; letter-spacing: 0.15em; color: #404058; }
.tb-select {
  background: var(--bg-control); border: 1px solid var(--border); color: var(--text-muted);
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
  letter-spacing: 0.1em; padding: 4px 10px; border: 1px dashed var(--border);
  border-radius: 5px; background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.12s;
}
.tb-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }

/* ── Mini-map ─────────────────────────────────────────────────────────────────── */
.pl-minimap {
  height: 22px; flex-shrink: 0; background: var(--bg-deeper); border-bottom: 1px solid var(--border-subtle);
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
.pl-main { display: flex; flex: 1; overflow: hidden; position: relative; }

/* ── Playhead canvas overlay ─────────────────────────────────────────────────── */
.pl-playhead-canvas {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  z-index: 50;
  width: 100%; height: 100%;
}

/* ── Picker panel ────────────────────────────────────────────────────────────── */
.pl-picker {
  width: 160px; min-width: 160px; background: var(--bg-base);
  border-right: 1px solid var(--border-subtle); display: flex; flex-direction: column; overflow: hidden;
}
.picker-tabs { display: flex; border-bottom: 1px solid var(--border-subtle); }
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
  display: flex; flex-direction: column; gap: 3px;
  padding: 5px 8px 6px;
  cursor: grab; border-bottom: 1px solid var(--border-subtle); transition: background 0.08s;
}
.picker-item:active { cursor: grabbing; }
.picker-item:hover    { background: var(--bg-panel); }
.picker-item.selected { background: var(--bg-hover); }
.picker-item.current  { border-left: 2px solid #e74c3c; padding-left: 6px; }
.picker-item.unused   { opacity: 0.4; }

/* Compressed MIDI thumbnail canvas (Section 1.2) */
.picker-mini-canvas {
  display: block; width: 100%; height: 14px;
  background: var(--bg-base); border-radius: 2px;
  image-rendering: pixelated;
  opacity: 0.75; transition: opacity 0.1s;
}
.picker-item:hover .picker-mini-canvas { opacity: 1; }

/* Info row: dot + name + badges */
.picker-item-row { display: flex; align-items: center; gap: 5px; }
.picker-dot  { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.picker-name {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; color: #8080a0; flex: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.picker-item.selected .picker-name { color: #c0c0e0; }

/* Floating ghost that follows cursor when dragging from picker (Section 1.3) */
.picker-drag-float {
  position: fixed; z-index: 9999;
  height: 30px; max-width: 600px;
  border: 2px dashed color-mix(in srgb, var(--clip-color, #4ecdc4) 70%, transparent);
  background: color-mix(in srgb, var(--clip-color, #4ecdc4) 12%, transparent);
  border-radius: 3px;
  transform: translate(-50%, -50%);
  pointer-events: none; opacity: 0.6;
  transition: width 0.08s ease;
}
.picker-badge { font-family: 'Share Tech Mono', monospace; font-size: 8px; padding: 1px 4px; border-radius: 3px; flex-shrink: 0; }
.picker-badge.edit   { color: #e74c3c; background: #1a0808; border: 1px solid #e74c3c44; }
.picker-badge.unused { color: var(--text-muted); background: var(--bg-base); border: 1px solid var(--border); }
.picker-badge.bars   { color: #4ecdc4; background: #041614; border: 1px solid #4ecdc444; }
.picker-actions { padding: 6px 8px; border-top: 1px solid var(--border-subtle); }
.picker-action-btn {
  width: 100%; padding: 5px; background: transparent; border: 1px dashed var(--border);
  border-radius: 4px; font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.1em; color: #404058; cursor: pointer; transition: all 0.1s;
}
.picker-action-btn:hover { border-color: #f39c12; color: #f39c12; }
.picker-hint { padding: 6px 10px 8px; font-family: 'Share Tech Mono', monospace; font-size: 9px; color: var(--text-muted); line-height: 1.6; border-top: 1px solid var(--border-subtle); }

/* ── Timeline ────────────────────────────────────────────────────────────────── */
.pl-timeline { flex: 1; overflow: auto; position: relative; }

/* ── Ruler ───────────────────────────────────────────────────────────────────── */
.pl-ruler-row { display: flex; position: sticky; top: 0; z-index: 10; background: var(--bg-deeper); border-bottom: 1px solid var(--border-subtle); min-height: 28px; }
.ruler-corner {
  width: 140px; min-width: 140px; position: sticky; left: 0; z-index: 11;
  background: var(--bg-deeper); border-right: 1px solid var(--border-subtle);
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #252540; display: flex; align-items: center; padding-left: 10px;
}
.ruler-cell {
  border-right: 1px solid var(--bg-base); flex-shrink: 0; position: relative;
  display: flex; align-items: center; padding-left: 4px; cursor: pointer; transition: background 0.08s;
}
.ruler-cell:hover   { background: #0e0e20; }
.ruler-cell.beat4   { border-left: 2px solid var(--border-subtle); }
.ruler-cell.playing { background: rgba(255,255,255,0.06); }
.ruler-num { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #35355a; }
.time-marker {
  position: absolute; top: 0; left: 0; right: 0;
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; color: #e74c3c; background: #180808;
  border-bottom: 2px solid #e74c3c; padding: 0 4px; line-height: 26px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 1;
}

/* ── Track row ───────────────────────────────────────────────────────────────── */
.pl-track-row { display: flex; border-bottom: 1px solid var(--border-subtle); transition: opacity 0.1s; }
.pl-track-row.muted  { opacity: 0.35; }
.pl-track-row.grouped .pl-track-header { background: var(--bg-header); }
.pl-track-row.locked .pl-track-cells   { cursor: not-allowed; }

/* ── Track header ────────────────────────────────────────────────────────────── */
.pl-track-header {
  width: 140px; min-width: 140px; flex-shrink: 0;
  position: sticky; left: 0; z-index: 5;
  background: var(--bg-deeper); border-right: 1px solid var(--border-subtle);
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
  background: var(--border-subtle); border: 1px solid var(--border); cursor: pointer; transition: all 0.12s;
}
.track-led.active { background: #2ecc71; border-color: #2ecc71; box-shadow: 0 0 5px #2ecc7166; }
.track-led.solo   { background: #f39c12; border-color: #f39c12; box-shadow: 0 0 5px #f39c1266; }
.track-color-strip { width: 3px; align-self: stretch; flex-shrink: 0; border-radius: 1px; }
.track-name {
  flex: 1; font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; color: #8080a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text;
}
.track-lock   { font-size: 10px; color: #f39c12; opacity: 0.7; flex-shrink: 0; }
.track-remove { font-size: 13px; background: transparent; border: none; color: var(--border); cursor: pointer; padding: 1px 3px; border-radius: 3px; flex-shrink: 0; transition: color 0.1s; }
.track-remove:hover { color: #e74c3c; }

/* ── Ruler cells area ────────────────────────────────────────────────────────── */
.ruler-cells-area { position: relative; display: flex; flex: 1; }

/* ── Clip cells area ─────────────────────────────────────────────────────────── */
.pl-track-cells { position: relative; flex-shrink: 0; cursor: crosshair; overflow: visible; }
.pl-track-cells[data-tool="draw"]   { cursor: crosshair; }
.pl-track-cells[data-tool="paint"]  { cursor: cell; }
.pl-track-cells[data-tool="erase"]  { cursor: not-allowed; }
.pl-track-cells[data-tool="slice"]  { cursor: col-resize; }
.pl-track-cells[data-tool="mute"]   { cursor: pointer; }
.pl-track-cells[data-tool="select"] { cursor: default; }
.grid-lines { position: absolute; inset: 0; pointer-events: none; }
.grid-line  { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--bg-panel); pointer-events: none; }
.grid-line.beat4 { border-left-color: var(--border-subtle); }

/* ── Pattern clip ────────────────────────────────────────────────────────────── */
.pl-clip {
  position: absolute; top: 3px; bottom: 3px;
  border: 1px solid color-mix(in srgb, var(--clip-color) 50%, transparent);
  border-radius: 4px; overflow: hidden; cursor: grab; z-index: 2;
  display: flex; flex-direction: column; transition: filter 0.08s;
}
.pl-clip:hover    { filter: brightness(1.18); }
.pl-clip.ghost    { opacity: 0.2; pointer-events: none; }
.pl-clip.dragging { opacity: 0.3; pointer-events: none; }
.pl-clip.selected { outline: 2px solid #e74c3c; outline-offset: -1px; filter: brightness(1.3); }
.pl-clip.clip-muted { opacity: 0.3; filter: saturate(0.2); }
.pl-clip.clip-muted .name-muted { text-decoration: line-through; }

/* Title bar (solid theme-color strip) */
.clip-titlebar {
  height: 18px; min-height: 18px; flex-shrink: 0;
  display: flex; align-items: center; gap: 2px; padding: 0 4px 0 1px; overflow: hidden;
}
.clip-dropdown-btn {
  background: transparent; border: none; cursor: pointer;
  color: rgba(255,255,255,0.8); font-size: 6px; line-height: 1;
  width: 12px; height: 14px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 2px; padding: 0; transition: background 0.1s;
}
.clip-dropdown-btn:hover { background: rgba(0,0,0,0.25); }
.clip-titlebar-name {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.05em; color: rgba(255,255,255,0.93);
  text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
}

/* Body (translucent theme-color + canvas preview) */
.clip-body {
  flex: 1; position: relative; overflow: hidden; min-height: 0;
}
.clip-note-canvas {
  position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
}

/* Step 6: in-clip playhead — vertical bar that sweeps through the clip body during playback */
.clip-local-head {
  position: absolute; top: 0; bottom: 0; width: 1px;
  background: rgba(255,255,255,0.75); pointer-events: none; z-index: 6;
  box-shadow: 0 0 3px rgba(255,255,255,0.4);
}
/* Step 6: titlebar progress fill — darkens the played portion of the title band */
.clip-title-progress {
  position: absolute; left: 0; top: 0; bottom: 0;
  background: rgba(0,0,0,0.25); pointer-events: none;
  transition: width 0.05s linear;
}

/* Step 8: left-edge resize handle */
.clip-left-handle {
  position: absolute; left: 0; top: 0; bottom: 0; width: 7px;
  cursor: ew-resize; z-index: 4;
  background: linear-gradient(to right, rgba(255,255,255,0.08), transparent);
}
.clip-left-handle:hover { background: linear-gradient(to right, rgba(255,255,255,0.22), transparent); }

/* Right-edge resize handle */
.clip-resize-handle {
  position: absolute; right: 0; top: 0; bottom: 0; width: 7px; cursor: ew-resize; z-index: 3;
  background: linear-gradient(to left, rgba(255,255,255,0.08), transparent);
}
.clip-resize-handle:hover { background: linear-gradient(to left, rgba(255,255,255,0.2), transparent); }

/* Step 10: scissors cursor on clip body when Slice tool is active */
.pl-clip.tool-slice { cursor: crosshair; }
/* Step 12: slip cursor when Slip tool is active */
.pl-clip.tool-slip  { cursor: ew-resize; }

/* Step 10: snapped cut preview line */
.clip-slice-preview {
  position: absolute; top: 0; bottom: 0; width: 2px;
  background: rgba(255, 200, 60, 0.85);
  box-shadow: 0 0 5px rgba(255,200,60,0.6);
  pointer-events: none; z-index: 10;
}

/* Step 11: source-offset badge (shows which bar the fragment starts from) */
.clip-offset-badge {
  font-family: 'Share Tech Mono', monospace; font-size: 8px; font-weight: 700;
  letter-spacing: 0.08em; color: rgba(255,255,255,0.65);
  background: rgba(0,0,0,0.25); border-radius: 2px;
  padding: 0 3px; flex-shrink: 0; margin-right: 2px;
}

/* Step 9: truncated-edge indicator — hatched right border signals hidden content */
.clip-truncated-edge {
  position: absolute; right: 7px; top: 0; bottom: 0; width: 4px;
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 2px,
    rgba(255,255,255,0.12) 2px,
    rgba(255,255,255,0.12) 4px
  );
  pointer-events: none; z-index: 2;
}
.drag-ghost-clip  { pointer-events: none; z-index: 8; border-style: dashed; }
/* Pre-placement hover ghost (Step 3) */
.hover-ghost-clip {
  pointer-events: none; z-index: 7;
  opacity: 0.35;
  border: 2px dashed color-mix(in srgb, var(--clip-color, #4ecdc4) 80%, transparent);
  background: color-mix(in srgb, var(--clip-color, #4ecdc4) 12%, transparent);
}

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
.add-header { width: 140px; min-width: 140px; position: sticky; left: 0; background: var(--bg-deeper); border-right: 1px solid var(--border-subtle); }
.add-track-btn {
  width: 100%; height: 100%; background: transparent; border: none;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; color: #303048; cursor: pointer; transition: color 0.1s;
}
.add-track-btn:hover { color: #4ecdc4; }

/* ── Context menus ───────────────────────────────────────────────────────────── */
.ctx-menu {
  position: fixed; z-index: 3000; background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,0.7); min-width: 180px; padding: 4px 0;
}
.ctx-item {
  padding: 7px 16px; font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.08em; color: #9090b8; cursor: pointer; transition: background 0.08s;
}
.ctx-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.ctx-item.danger:hover { background: #1a0808; color: #e74c3c; }
.ctx-sep { height: 1px; background: var(--border-subtle); margin: 4px 0; }

/* ── Rename / marker overlay ─────────────────────────────────────────────────── */
.rename-overlay {
  position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.rename-box {
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 20px 24px; display: flex; flex-direction: column; gap: 10px;
  min-width: 280px; box-shadow: 0 12px 40px rgba(0,0,0,0.8);
}
.rename-label { font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0.1em; color: #606080; }
.rename-input {
  background: var(--bg-control); border: 1px solid var(--border); color: var(--text-primary);
  padding: 7px 10px; border-radius: 5px; font-family: 'Rajdhani', sans-serif;
  font-size: 16px; font-weight: 700; letter-spacing: 0.1em; outline: none;
}
.rename-input:focus { border-color: #4ecdc4; }
.rename-btns { display: flex; gap: 8px; justify-content: flex-end; }
.rename-ok {
  padding: 6px 18px; background: #4ecdc422; border: 1px solid #4ecdc4; color: #4ecdc4;
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 700; transition: all 0.1s;
}
.rename-ok:hover { background: #4ecdc4; color: #000; }
.rename-cancel {
  padding: 6px 14px; background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 13px;
}

/* ── Select box ──────────────────────────────────────────────────────────────── */
.select-box {
  position: fixed; pointer-events: none; z-index: 9999;
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.7);
  border-radius: 2px;
}

/* ── Arrangements group ──────────────────────────────────────────────────────── */
.arr-group { display: flex; align-items: center; gap: 2px; }
.arr-select {
  background: var(--bg-control); border: 1px solid var(--border); color: var(--text-muted);
  padding: 3px 6px; border-radius: 4px 0 0 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.07em; cursor: pointer; outline: none; max-width: 160px;
}
.arr-btn {
  height: 26px; padding: 0 6px; background: var(--bg-control); border: 1px solid var(--border);
  border-left: none; border-radius: 0 4px 4px 0; color: #606080; cursor: pointer;
  font-size: 11px; transition: color 0.1s;
}
.arr-btn:hover { color: #4ecdc4; }

/* ── Snap selector ───────────────────────────────────────────────────────────── */
.snap-select { width: 80px; font-size: 11px; }

/* ── Quick zoom buttons ──────────────────────────────────────────────────────── */
.zoom-quick-btns { display: flex; align-items: flex-end; gap: 2px; }
.zoom-q {
  background: transparent; border: none; color: #303050;
  cursor: pointer; padding: 0 2px; font-size: 10px; transition: color 0.1s;
  line-height: 1; display: flex; align-items: flex-end;
}
.zoom-q:nth-child(1) { font-size: 6px; }
.zoom-q:nth-child(2) { font-size: 8px; }
.zoom-q:nth-child(3) { font-size: 10px; }
.zoom-q:nth-child(4) { font-size: 12px; }
.zoom-q:nth-child(5) { font-size: 14px; }
.zoom-q:hover { color: #4ecdc4; }

/* ── Loop region button ──────────────────────────────────────────────────────── */
.loop-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em; padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 5px; background: transparent; color: #404058; cursor: pointer; transition: all 0.12s;
}
.loop-btn:hover  { border-color: #27ae60; color: #27ae60; }
.loop-btn.active { border-color: #27ae60; background: #0a1a0e; color: #27ae60; }

/* ── Loop region ruler band ──────────────────────────────────────────────────── */
.loop-region-band {
  position: absolute; top: 0; bottom: 0;
  background: rgba(39, 174, 96, 0.15);
  border-left:  2px solid rgba(39, 174, 96, 0.7);
  border-right: 2px solid rgba(39, 174, 96, 0.7);
  pointer-events: auto; cursor: pointer; z-index: 2;
}

/* ── Hidden color input ──────────────────────────────────────────────────────── */
.hidden-color { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.ctx-item { position: relative; }

/* ── Disabled ctx item ───────────────────────────────────────────────────────── */
.ctx-item.disabled { opacity: 0.35; pointer-events: none; }
</style>
