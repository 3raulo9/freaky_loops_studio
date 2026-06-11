<template>
  <div
    ref="rackEl"
    class="channel-rack"
    :class="{ 'rack-drop': dropActive, 'rack-drop-midi': midiDropActive }"
    @click="closeAllMenus"
    @dragenter.prevent="onRackDragEnter"
    @dragover.prevent="onRackDragOver"
    @dragleave="onRackDragLeave"
    @drop.prevent="onRackDrop"
  >
    <!-- Drop overlays -->
    <div v-if="midiDropActive" class="rack-drop-hint rack-drop-hint--midi">
      ♩ Drop MIDI file — imports as editable tracks
    </div>
    <div v-else-if="dropActive" class="rack-drop-hint">＋ Drop to add a channel · drop on a channel to replace it</div>

    <!-- ── Pattern navigator ─────────────────────────────────────────── -->
    <div class="pattern-nav">
      <button class="pat-nav-btn" :disabled="patternIndex === 0"
        @click="currentPatternId = patterns[patternIndex - 1].id" title="Previous pattern">‹</button>

      <div class="pat-name-wrap" @contextmenu.prevent="showPatCtx($event)">
        <span class="pat-dot" :style="{ background: currentPattern.color }" />
        <span class="pat-name">{{ currentPattern.name }}</span>
      </div>

      <button class="pat-nav-btn" :disabled="patternIndex === patterns.length - 1"
        @click="currentPatternId = patterns[patternIndex + 1].id" title="Next pattern">›</button>

      <button class="pat-add-btn" @click="addPattern" title="New pattern">+ PAT</button>
    </div>

    <!-- Pattern context menu -->
    <div v-if="patCtx.open" class="ctx-menu"
      :style="{ top: patCtx.y+'px', left: patCtx.x+'px' }" @mouseleave="patCtx.open=false">
      <div class="ctx-item" @click="startPatRename">Rename</div>
      <div class="ctx-item" @click="duplicatePattern(currentPatternId); patCtx.open=false">Duplicate</div>
      <div class="ctx-item" @click="splitByChannel(currentPatternId); patCtx.open=false">Split by channel</div>
      <div class="ctx-sep" />
      <div class="ctx-item danger" @click="removePattern(currentPatternId); patCtx.open=false">Delete Pattern</div>
    </div>

    <!-- Rename pattern overlay -->
    <div v-if="patRenaming" class="rename-overlay" @click.self="patRenaming=false">
      <div class="rename-box">
        <span class="rename-label">Rename pattern</span>
        <input ref="patRenameInput" v-model="patRenameName" class="rename-input"
          @keydown.enter="commitPatRename" @keydown.esc="patRenaming=false" maxlength="24" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitPatRename">OK</button>
          <button class="rename-cancel" @click="patRenaming=false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── Options panel (floating) ─────────────────────────────────── -->
    <div v-if="optionsOpen" class="options-panel" @click.stop
      :style="{ top: optionsPos.top + 'px', left: optionsPos.left + 'px' }">

      <!-- Add section -->
      <div class="op-section">Add one</div>
      <div class="op-item" @click="addChannel(); closeAllMenus()">
        <span class="op-dot" style="background:#4ecdc4"/>SYNTH (SAW)
      </div>
      <div class="op-sub-trigger" @mouseenter="activeSub='fm'" @mouseleave="activeSub=null">
        FM Synths ▶
        <div v-if="activeSub==='fm'" class="op-submenu">
          <div v-for="(preset, key) in FM_PRESETS" :key="key" class="op-item"
            @click="addFMChannel(key); closeAllMenus()">
            <span class="op-dot" :style="{ background: preset.color }"/>{{ preset.name }}
          </div>
        </div>
      </div>
      <div class="op-item" @click="addCustomSynthChannel(); closeAllMenus()">
        <span class="op-dot" style="background:#00d4ff"/>◈ Custom Synth
      </div>
      <div class="op-item" @click="addSubterraChannel(); closeAllMenus()">
        <span class="op-dot" style="background:#ff5a3c"/>▼ SUBTERRA Bass
      </div>
      <div class="op-item" @click="addWasmChannel(); closeAllMenus()">
        <span class="op-dot" style="background:#7b2fff"/>⬡ WASM Plugin
      </div>

      <div class="op-sep"/>

      <!-- Channel operations -->
      <div class="op-item" @click="selectUnused(); closeAllMenus()">Select unused channels</div>
      <div class="op-item" @click="cloneSelectedOp(); closeAllMenus()">Clone selected <span class="op-kb">Alt+C</span></div>
      <div class="op-item danger" @click="deleteSelectedOp(); closeAllMenus()">Delete selected <span class="op-kb">Alt+Del</span></div>

      <div class="op-sep"/>

      <div class="op-item" @click="moveSelectedOp(-1); closeAllMenus()">Move selected up <span class="op-kb">Alt+↑</span></div>
      <div class="op-item" @click="moveSelectedOp(1); closeAllMenus()">Move selected down <span class="op-kb">Alt+↓</span></div>

      <div class="op-sep"/>

      <!-- Sort submenu -->
      <div class="op-sub-trigger" @mouseenter="activeSub='sort'" @mouseleave="activeSub=null">
        Sort by ▶
        <div v-if="activeSub==='sort'" class="op-submenu">
          <div class="op-item" @click="sortChannelsBy('color'); closeAllMenus()">Color</div>
          <div class="op-item" @click="sortChannelsBy('name'); closeAllMenus()">Name</div>
          <div class="op-item" @click="sortChannelsBy('track'); closeAllMenus()">Track number</div>
        </div>
      </div>

      <div class="op-sep"/>

      <div class="op-item" @click="startGroupSelected(); closeAllMenus()">Group selected <span class="op-kb">Alt+G</span></div>

      <div class="op-sep"/>

      <!-- Color submenu -->
      <div class="op-sub-trigger" @mouseenter="activeSub='color'" @mouseleave="activeSub=null">
        Color selected ▶
        <div v-if="activeSub==='color'" class="op-submenu">
          <div class="op-item" @click="doColorRandom(); closeAllMenus()">Random</div>
          <div class="op-item" @click="showGradientDialog = true; closeAllMenus()">Gradient...</div>
        </div>
      </div>

      <div class="op-sep"/>

      <div class="op-item" @click="muteSelectedOp(true); closeAllMenus()">Mute selected</div>
      <div class="op-item" @click="muteSelectedOp(false); closeAllMenus()">Unmute selected</div>

      <div class="op-sep"/>

      <!-- Fill steps -->
      <div class="op-item" @click="doFillSteps(2); closeAllMenus()">Fill each 2 steps</div>
      <div class="op-item" @click="doFillSteps(4); closeAllMenus()">Fill each 4 steps</div>
      <div class="op-item" @click="doFillSteps(8); closeAllMenus()">Fill each 8 steps</div>

      <div class="op-sep"/>

      <div class="op-item" @click="zipSelectedOp(); closeAllMenus()">Zip selected <span class="op-kb">Alt+Z</span></div>
      <div class="op-item" @click="unzipAll(); closeAllMenus()">Unzip all <span class="op-kb">Alt+U</span></div>

      <div class="op-sep"/>

      <!-- Transpose -->
      <div class="op-item" @click="openTransposeDialog(); closeAllMenus()">Transpose selected…</div>

      <!-- Set swing mix for selected -->
      <div class="op-sub-trigger" @mouseenter="activeSub='swing-sel'" @mouseleave="activeSub=null">
        Set swing mix for selected ▶
        <div v-if="activeSub==='swing-sel'" class="op-submenu">
          <div class="op-item" @click="setSwingMixForSelected(0); closeAllMenus()">0%</div>
          <div class="op-item" @click="setSwingMixForSelected(0.25); closeAllMenus()">25%</div>
          <div class="op-item" @click="setSwingMixForSelected(0.5); closeAllMenus()">50%</div>
          <div class="op-item" @click="setSwingMixForSelected(0.75); closeAllMenus()">75%</div>
          <div class="op-item" @click="setSwingMixForSelected(1); closeAllMenus()">100%</div>
        </div>
      </div>

      <!-- Assign to free mixer tracks -->
      <div class="op-item" @click="doAssignFreeTrack(); closeAllMenus()">
        Assign selected to free mixer track(s) <span class="op-kb">Ctrl+L</span>
      </div>

      <div class="op-sep"/>

      <!-- Mute removed steps toggle -->
      <div class="op-item" :class="{ 'ctx-active': muteRemovedSteps }"
        @click="muteRemovedSteps = !muteRemovedSteps">
        <span class="ctx-check-mark">{{ muteRemovedSteps ? '✓' : ' ' }}</span>
        Mute removed steps
      </div>

      <!-- Set truncate swing notes for selected -->
      <div class="op-sub-trigger" @mouseenter="activeSub='truncate-sel'" @mouseleave="activeSub=null">
        Set truncate swing notes for selected ▶
        <div v-if="activeSub==='truncate-sel'" class="op-submenu">
          <div class="op-item" @click="setTruncateSwingForSelected(true); closeAllMenus()">On</div>
          <div class="op-item" @click="setTruncateSwingForSelected(false); closeAllMenus()">Off</div>
        </div>
      </div>
    </div>

    <!-- ── Rack toolbar ──────────────────────────────────────────────── -->
    <div class="rack-toolbar">
      <!-- Options menu trigger -->
      <button class="options-btn" @click.stop="toggleOptions" title="Channel Rack options">≡</button>
      <span class="rack-title">CHANNEL RACK</span>

      <!-- Display filter -->
      <div class="df-wrap" ref="dfRef">
        <button class="df-btn" @click.stop="dfOpen = !dfOpen">
          {{ filterLabel }} ▾
        </button>
        <div v-if="dfOpen" class="df-dropdown" @click.stop>
          <div class="df-item" :class="{ active: activeFilter === 'all' }" @click="setFilter('all')">All Channels</div>
          <div class="df-item" :class="{ active: activeFilter === 'unsorted' }" @click="setFilter('unsorted')">Unsorted</div>
          <template v-if="channelGroups.length">
            <div class="df-sep"/>
            <div v-for="g in channelGroups" :key="g.id"
              class="df-item df-group"
              :class="{ active: activeFilter === g.id }"
              @click="setFilter(g.id)"
              @contextmenu.prevent="showGroupCtx($event, g)"
            >{{ g.name }}</div>
          </template>
          <div class="df-sep"/>
          <div class="df-item df-add" @click="startAddGroup">+ Add Group</div>
        </div>
      </div>

      <!-- Graph editor toggle -->
      <button class="ge-toggle-btn" :class="{ active: graphEditorOpen }"
        @click="graphEditorOpen = !graphEditorOpen" title="Graph Editor (Ctrl+K)">GE</button>

      <div class="rack-right">
        <span class="kb-badge">⌨ Z–/ · {{ kbOctave }}</span>

        <!-- MIDI import status toast -->
        <span v-if="midiImportMsg" class="midi-import-msg">{{ midiImportMsg }}</span>

        <!-- Hidden file input for the browse button inside synth picker -->
        <input ref="midiFileInput" type="file" accept=".mid,.midi" style="display:none"
          @change="onMidiFileInput" />

        <div class="add-synth-wrap" ref="synthPickerRef">
          <button class="add-ch-btn" @click.stop="showSynthPicker = !showSynthPicker" title="Add synth channel">
            + SYNTH ▾
          </button>
          <div v-if="showSynthPicker" class="synth-picker">
            <div class="synth-pick-hint synth-pick-hint--drag">↳ click to add · drag onto a channel to replace it</div>
            <div class="synth-pick-section">BASIC</div>
            <div class="synth-pick-item"
              @mousedown="startPickDrag({ t: 'synth' }, 'SYNTH (SAW)', '#4ecdc4', $event)">
              <span class="synth-pick-dot" style="background:#4ecdc4"/>SYNTH (SAW)
            </div>
            <div class="synth-pick-section">FM SYNTHS</div>
            <div v-for="(preset, key) in FM_PRESETS" :key="key" class="synth-pick-item"
              @mousedown="startPickDrag({ t: 'fm', key }, preset.name, preset.color, $event)">
              <span class="synth-pick-dot" :style="{ background: preset.color }"/>{{ preset.name }}
            </div>
            <div class="synth-pick-section">GM INSTRUMENTS</div>
            <div v-for="(cat, ci) in GM_CATEGORIES" :key="cat.name">
              <div class="synth-pick-item synth-pick-cat"
                @click.stop="toggleGMCat(cat.name)">
                <span class="synth-pick-dot" :style="{ background: GM_CAT_COLORS[ci] }"/>
                {{ cat.name }}
                <span class="synth-pick-arrow">{{ expandedGMCat === cat.name ? '▾' : '▸' }}</span>
              </div>
              <div v-if="expandedGMCat === cat.name" class="synth-pick-gm-items">
                <div v-for="prog in getProgsForCat(cat)" :key="prog"
                  class="synth-pick-item synth-pick-item--gm"
                  @mousedown="startPickDrag({ t: 'gm', program: prog }, GM_INSTRUMENTS[prog], GM_CAT_COLORS[ci], $event)">
                  {{ GM_INSTRUMENTS[prog] }}
                </div>
              </div>
            </div>
            <div class="synth-pick-section">PLUGINS</div>
            <div class="synth-pick-item"
              @mousedown="startPickDrag({ t: 'custom' }, 'Custom Synth', '#00d4ff', $event)">
              <span class="synth-pick-dot" style="background:#00d4ff"/>◈ Custom Synth
            </div>
            <div class="synth-pick-item"
              @mousedown="startPickDrag({ t: 'subterra' }, 'SUBTERRA Bass', '#ff5a3c', $event)">
              <span class="synth-pick-dot" style="background:#ff5a3c"/>▼ SUBTERRA Bass
            </div>
            <div class="synth-pick-item"
              @mousedown="startPickDrag({ t: 'wasm' }, 'WASM Plugin', '#7b2fff', $event)">
              <span class="synth-pick-dot" style="background:#7b2fff"/>⬡ WASM Plugin
            </div>
            <div class="synth-pick-section synth-pick-section--midi">MIDI IMPORT</div>
            <div class="synth-pick-item synth-pick-item--midi"
              @click="midiFileInput?.click(); showSynthPicker = false"
              title="Import a .mid file — each instrument track becomes an editable channel">
              <span class="synth-pick-dot" style="background:#e91e63"/>♩ Browse MIDI file…
            </div>
            <div class="synth-pick-hint">or drag a .mid file anywhere onto the rack</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Group display filter context menu ────────────────────────── -->
    <div v-if="groupCtx.open" class="ctx-menu"
      :style="{ top: groupCtx.y+'px', left: groupCtx.x+'px' }" @mouseleave="groupCtx.open=false">
      <div class="ctx-item" @click="startRenameGroup(groupCtx.group)">Rename group</div>
      <div class="ctx-item danger" @click="removeGroup(groupCtx.group.id); groupCtx.open=false">Delete group</div>
    </div>

    <!-- ── Column header labels ──────────────────────────────────────── -->
    <div class="col-headers">
      <div class="col-led" title="Mute (L-click) / Solo (R-click)">●</div>
      <div class="col-pan" title="Pan">PAN</div>
      <div class="col-vol" title="Volume">VOL</div>
      <div class="col-mix" title="Mixer track">MX</div>
      <div class="col-name">INSTRUMENT</div>
      <div class="col-seq">PATTERN — <span class="steps-label">{{ totalSteps }} steps</span></div>
    </div>

    <!-- ── Channel rows ──────────────────────────────────────────────── -->
    <div class="channel-list">
      <div
        v-for="ch in visibleChannels"
        :key="ch.id"
        :data-chid="ch.id"
        class="channel-row"
        :class="{
          selected:       ch.id === selectedChannelId,
          'multi-sel':    selectedIds.has(ch.id),
          muted:          ch.muted,
          soloed:         ch._soloed,
          zipped:         ch.zipped,
          'drop-replace': dragOverChannelId === ch.id || instrumentDrag.overChannelId === ch.id,
          'ge-expanded':  graphEditorOpen && ch.id === selectedChannelId && !ch.zipped && ch.mode === 'steps',
        }"
        :style="{ '--accent': ch.color }"
        @click.exact="selectChannel(ch)"
        @click.ctrl.exact.stop="toggleMultiSelect(ch)"
        @dragover="onRowDragOver($event, ch)"
        @dragleave="onRowDragLeave($event, ch)"
        @drop="onRowDrop($event, ch)"
      >
        <!-- ── Mute LED ──────────────────────────────────────────── -->
        <div class="led" :class="{ active: !ch.muted, solo: ch._soloed, firing: isChannelFiring(ch) }"
          @click.stop="ch.muted = !ch.muted"
          @contextmenu.prevent="soloChannel(ch.id)"
          title="L-click: mute / R-click: solo" />

        <!-- ── ZIPPED compact view ───────────────────────────────── -->
        <template v-if="ch.zipped">
          <div class="zip-name" style="grid-column: 2 / -1">
            <button class="ch-name-btn zip-ch-btn"
              :style="{ background: ch.color }"
              @click.stop="openOrSelectChannel(ch)"
              @contextmenu.prevent="showContextMenu($event, ch)"
            >{{ ch.name }}</button>
            <button class="unzip-btn" @click.stop="ch.zipped = false" title="Unzip (Right-click channel for options)">▲</button>
          </div>
        </template>

        <!-- ── Normal view ───────────────────────────────────────── -->
        <template v-else>
          <!-- Pan knob -->
          <div class="rack-knob-wrap" :title="`Pan: ${Math.round(ch.pan * 100)}%`">
            <Knob v-model="ch.pan" :min="-1" :max="1" :decimals="2"
              label="" :color="ch.color" :size="24" />
          </div>

          <!-- Vol knob -->
          <div class="rack-knob-wrap" :title="`Volume: ${Math.round(ch.volume * 100)}%`">
            <Knob v-model="ch.volume" :min="0" :max="1.25" :decimals="2"
              label="" :color="ch.color" :size="24" />
          </div>

          <!-- Mixer track assignment -->
          <div class="mix-num" @click.stop
            :style="{ borderColor: ch.mixerTrack > 0 ? mixerTracks[ch.mixerTrack]?.color : 'transparent' }"
            :title="`Mixer: ${ch.mixerTrack === 0 ? 'Master' : mixerTracks[ch.mixerTrack]?.name ?? 'MIX ' + ch.mixerTrack}`">
            <input type="number" v-model.number="ch.mixerTrack"
              min="0" :max="mixerTracks.length - 1" class="mix-input"
              @change="assignChannelToMixerTrack(ch.id, ch.mixerTrack)" />
          </div>

          <!-- Channel name button -->
          <button class="ch-name-btn"
            :class="{ 'piano-active': ch.mode === 'piano' && pianoRollOpen && selectedChannelId === ch.id }"
            :style="{ background: ch.color }"
            @click.stop="openOrSelectChannel(ch)"
            @contextmenu.prevent="showContextMenu($event, ch)"
            :title="ch.mode === 'piano' ? 'Open Piano Roll' : 'Click to select · Right-click for options'">
            <span class="ch-mode-pill">{{ ch.mode === 'piano' ? '♩' : '▦' }}</span>
            {{ ch.name }}
          </button>

          <!-- ── Sequencer area ──────────────────────────────────── -->
          <div class="ch-seq" @click.stop>
            <!-- Step buttons -->
            <template v-if="ch.mode === 'steps'">
              <div class="inline-steps" :class="{ compact: compactSteps }" :style="{ '--cols': stepCols }">
                <button v-for="s in totalSteps" :key="s-1" class="istep"
                  :class="{
                    lit:     stepLit(ch, s-1),
                    ghost:   stepGhost(ch, s-1),
                    playing: isPlaying && displayStep === s-1,
                    beat:    (s-1) % 4 === 0,
                  }"
                  @click="onStepClick(ch, s-1)"
                  @contextmenu.prevent="onStepRightClick(ch, s-1)"
                />
              </div>
            </template>

            <!-- Mini piano-roll preview -->
            <template v-else>

              <!-- ─ Single-bar: column-per-step grid ─
                   Notes draw for every channel; the centred hint sits faintly
                   behind them as a label / empty-state. -->
              <div v-if="!isMultiBarChannel(ch)"
                class="mini-pr" :style="{ '--cols': totalSteps }"
                @click="openOrSelectChannel(ch)" title="Click to open Piano Roll">
                <div v-for="s in totalSteps" :key="s-1" class="mini-pr-col"
                  :class="{
                    playing: isPlaying && displayStep === s-1,
                    beat:    (s-1) % 4 === 0,
                  }">
                  <div v-for="note in notesAtStep(ch, s-1)"
                    :key="`${note.startTick ?? note.step}-${note.pitch}`"
                    class="mini-note" :style="{ bottom: noteBottom(note.pitch) + '%' }" />
                </div>
                <span class="mini-pr-hint">{{ miniSummary(ch) }}</span>
              </div>

              <!-- ─ Multi-bar: absolute-positioned panoramic view ─
                   Shows the visible 4-bar window of the melody for every channel;
                   the window pages with playback (see miniWindowStartBar). -->
              <div v-else
                class="mini-pr mini-pr-wide"
                @click="openOrSelectChannel(ch)" title="Click to open Piano Roll">
                <!-- Playhead lives outside v-memo so it updates every tick without re-rendering notes.
                     Positioned relative to the visible 4-bar window so it tracks the audible part. -->
                <div v-if="isPlaying && displayStep >= 0"
                  class="mini-wide-head"
                  :style="{ left: miniHeadLeft(ch) + '%' }" />
                <!-- Static content: bar lines + notes for the current window. v-memo skips this
                     subtree when only the playhead moves; it re-renders on note/bar count change,
                     (un)focus, or when playback pages to the next 4-bar window. -->
                <template v-memo="[ch.id, channelPatternBars(ch), getPianoNotes(ch.id).length, ch.id === selectedChannelId, miniWindowStartBar(ch)]">
                  <div v-for="bi in (miniVisibleBars(ch) - 1)" :key="'bl' + bi"
                    class="mini-bar-line"
                    :style="{ left: (bi / miniVisibleBars(ch)) * 100 + '%' }" />
                  <div v-for="note in getMiniWindowNotes(ch)"
                    :key="`${note.startTick}-${note.pitch}`"
                    class="mini-note-wide"
                    :style="{
                      left:   miniNoteLeft(ch, note) + '%',
                      width:  miniNoteWidth(ch, note) + '%',
                      bottom: noteBottom(note.pitch) + '%',
                    }" />
                  <span class="mini-pr-bars-label">{{ miniBarLabel(ch) }}</span>
                </template>
              </div>

            </template>

            <!-- Loop toggle (overlaid on seq area) -->
            <button class="loop-btn"
              :class="{ active: ch.loopEnabled, colorful: colorfulLoopControls }"
              :style="colorfulLoopControls ? { '--ch-color': ch.color } : {}"
              @click.stop="ch.loopEnabled = !ch.loopEnabled"
              @contextmenu.prevent.stop="showLoopCtx($event, ch)"
              :title="ch.loopEnabled ? 'Loop ON — right-click for options' : 'Loop OFF — right-click for options'">∞</button>
          </div>

          <!-- ── Graph Editor strip ──────────────────────────────── -->
          <div v-if="graphEditorOpen && ch.id === selectedChannelId && ch.mode === 'steps'"
            class="ge-strip" @click.stop
            :style="{ '--cols': totalSteps, '--accent': ch.color }">

            <!-- Tabs -->
            <div class="ge-tabs">
              <button v-for="tab in GE_TABS" :key="tab.key"
                class="ge-tab" :class="{ active: graphParam === tab.key }"
                @click.stop="graphParam = tab.key">{{ tab.label }}</button>
              <div class="ge-tabs-right">
                <span class="ge-hint">drag to paint · alt+click reset · ctrl+drag scale</span>
              </div>
            </div>

            <!-- Bar chart -->
            <div class="ge-chart"
              @mousedown.prevent="startGeDrag($event, ch)"
              @contextmenu.prevent="startGeRamp($event, ch)">
              <div v-for="s in totalSteps" :key="s-1" class="ge-col"
                :class="{
                  beat:    (s-1) % 4 === 0,
                  lit:     getSteps(ch.id)[s-1],
                  playing: isPlaying && displayStep === s-1,
                }">
                <div class="ge-bar-bg"/>
                <!-- Center line for bipolar params -->
                <div v-if="graphParam === 'pan' || graphParam === 'pitch' || graphParam === 'shift'" class="ge-center-line"/>
                <div class="ge-bar"
                  :style="{
                    height: getGeBarHeight(ch.id, s-1) + '%',
                    bottom: getGeBarBottom(ch.id, s-1) + '%',
                  }" />
              </div>
            </div>

          </div>
        </template>

      </div>

      <!-- Empty state -->
      <div v-if="visibleChannels.length === 0" class="empty-state">
        No channels match this filter.
      </div>
    </div>

    <!-- ── Context menu ──────────────────────────────────────────────── -->
    <div v-if="ctxMenu.open" class="ctx-menu"
      :style="{ top: ctxMenu.y+'px', left: ctxMenu.x+'px' }"
      @mouseleave="ctxMenu.open=false">
      <div class="ctx-item" @click="ctxAction('to-piano')">
        {{ ctxMenu.channel?.mode === 'piano' ? 'Open Piano Roll' : 'Switch to Piano Roll' }}
      </div>
      <div class="ctx-item" v-if="ctxMenu.channel?.mode === 'piano'"
        @click="ctxAction('to-steps')">Switch to Steps</div>
      <div class="ctx-item" @click="ctxAction('graph-editor')">Graph editor</div>
      <div class="ctx-sep"/>
      <div class="ctx-item" @click="ctxAction('rename-color')">Rename, color and icon…</div>
      <div class="ctx-item" @click="ctxAction('rename')">Rename</div>
      <div class="ctx-item" @click="ctxAction('clone')">Clone</div>
      <div class="ctx-item" @click="ctxAction('clear')">Clear Pattern</div>
      <template v-if="ctxMenu.channel?.mode === 'steps'">
        <div class="ctx-sep"/>
        <div class="ctx-item" @click="ctxAction('shift-left')">Rotate left <span class="op-kb">Shift+◄</span></div>
        <div class="ctx-item" @click="ctxAction('shift-right')">Rotate right <span class="op-kb">Shift+►</span></div>
        <div class="ctx-item" @click="ctxAction('invert')">Invert steps</div>
      </template>
      <div class="ctx-sep"/>
      <!-- Fill steps submenu -->
      <div class="ctx-sub-trigger"
        @mouseenter="ctxSubOpen = 'fill'"
        @mouseleave="ctxSubOpen = null">
        Fill steps ▶
        <div v-if="ctxSubOpen === 'fill'" class="ctx-submenu">
          <div class="ctx-item" @click="ctxFill(2)">Every 2 steps</div>
          <div class="ctx-item" @click="ctxFill(4)">Every 4 steps</div>
          <div class="ctx-item" @click="ctxFill(8)">Every 8 steps</div>
        </div>
      </div>
      <!-- Loop length submenu -->
      <div class="ctx-sub-trigger"
        @mouseenter="ctxSubOpen = 'loop-len'"
        @mouseleave="ctxSubOpen = null">
        Loop length ({{ ctxMenu.channel?.loopEnabled && ctxMenu.channel?.loopLength < totalSteps ? ctxMenu.channel.loopLength : totalSteps }}) ▶
        <div v-if="ctxSubOpen === 'loop-len'" class="ctx-submenu">
          <div class="ctx-item" @click="ctxSetLoopLen(totalSteps)">Full ({{ totalSteps }})</div>
          <div class="ctx-item" v-if="totalSteps >= 32" @click="ctxSetLoopLen(32)">32 steps</div>
          <div class="ctx-item" v-if="totalSteps >= 16" @click="ctxSetLoopLen(16)">16 steps</div>
          <div class="ctx-item" v-if="totalSteps >= 8"  @click="ctxSetLoopLen(8)">8 steps</div>
          <div class="ctx-item" @click="ctxSetLoopLen(4)">4 steps</div>
        </div>
      </div>
      <!-- Swing mix submenu -->
      <div class="ctx-sub-trigger"
        @mouseenter="ctxSubOpen = 'swing-mix'"
        @mouseleave="ctxSubOpen = null">
        Swing mix ({{ Math.round((ctxMenu.channel?.swingMix ?? 1) * 100) }}%) ▶
        <div v-if="ctxSubOpen === 'swing-mix'" class="ctx-submenu">
          <div class="ctx-item" @click="ctxSetSwingMix(0)">0% — no swing</div>
          <div class="ctx-item" @click="ctxSetSwingMix(0.25)">25%</div>
          <div class="ctx-item" @click="ctxSetSwingMix(0.5)">50%</div>
          <div class="ctx-item" @click="ctxSetSwingMix(0.75)">75%</div>
          <div class="ctx-item" @click="ctxSetSwingMix(1)">100% — full swing</div>
        </div>
      </div>
      <div class="ctx-sep"/>
      <!-- Cut itself toggle -->
      <div class="ctx-item" :class="{ 'ctx-active': ctxMenu.channel?.cutSelf }"
        @click="ctxAction('cut-self')">
        <span class="ctx-check-mark">{{ ctxMenu.channel?.cutSelf ? '✓' : ' ' }}</span>
        Cut itself
      </div>
      <!-- MIDI channel through toggle -->
      <div class="ctx-item" :class="{ 'ctx-active': ctxMenu.channel?.midiChannelThrough }"
        @click="ctxAction('midi-thru')">
        <span class="ctx-check-mark">{{ ctxMenu.channel?.midiChannelThrough ? '✓' : ' ' }}</span>
        MIDI channel through
      </div>
      <!-- Receive notes from placeholder -->
      <div class="ctx-sub-trigger"
        @mouseenter="ctxSubOpen = 'recv-notes'"
        @mouseleave="ctxSubOpen = null">
        Receive notes from ▶
        <div v-if="ctxSubOpen === 'recv-notes'" class="ctx-submenu">
          <div class="ctx-item" style="color:#606080;pointer-events:none">— No MIDI sources —</div>
        </div>
      </div>
      <!-- Truncate swing notes toggle -->
      <div class="ctx-item" :class="{ 'ctx-active': ctxMenu.channel?.truncateSwingNotes !== false }"
        @click="ctxAction('truncate-swing')">
        <span class="ctx-check-mark">{{ ctxMenu.channel?.truncateSwingNotes !== false ? '✓' : ' ' }}</span>
        Truncate swing notes
      </div>
      <div class="ctx-sep"/>
      <div class="ctx-item" @click="ctxAction('zip')">
        {{ ctxMenu.channel?.zipped ? 'Unzip' : 'Zip' }}
      </div>
      <div class="ctx-item" @click="ctxAction('color-random')">Random color</div>
      <div class="ctx-sep"/>
      <div class="ctx-item" @click="ctxAction('move-up')">Move Up</div>
      <div class="ctx-item" @click="ctxAction('move-down')">Move Down</div>
      <div class="ctx-sep"/>
      <div class="ctx-item danger" @click="ctxAction('delete')">Delete</div>
    </div>

    <!-- ── Loop right-click context menu ────────────────────────────── -->
    <div v-if="loopCtx.open" class="ctx-menu"
      :style="{ top: loopCtx.y+'px', left: loopCtx.x+'px' }"
      @mouseleave="loopCtx.open=false">
      <div class="ctx-section-label">Loop type</div>
      <div class="ctx-item" :class="{ 'ctx-active': globalLoopMode==='step' }"
        @click="globalLoopMode='step'; loopCtx.open=false">
        <span class="ctx-check-mark">{{ globalLoopMode==='step' ? '✓' : ' ' }}</span>
        Loop step channels
      </div>
      <div class="ctx-item" :class="{ 'ctx-active': globalLoopMode==='all' }"
        @click="globalLoopMode='all'; loopCtx.open=false">
        <span class="ctx-check-mark">{{ globalLoopMode==='all' ? '✓' : ' ' }}</span>
        Loop all channels
      </div>
      <div class="ctx-item" :class="{ 'ctx-active': globalLoopMode==='advanced' }"
        @click="globalLoopMode='advanced'; loopCtx.open=false">
        <span class="ctx-check-mark">{{ globalLoopMode==='advanced' ? '✓' : ' ' }}</span>
        Advanced looping
      </div>
      <div class="ctx-sep"/>
      <div class="ctx-section-label">Burn to pattern</div>
      <div class="ctx-item" @click="loopCtxBurnToPattern()">Burn loop to new pattern</div>
      <div class="ctx-sep"/>
      <div class="ctx-section-label">Options</div>
      <div class="ctx-item" :class="{ 'ctx-active': colorfulLoopControls }"
        @click="colorfulLoopControls = !colorfulLoopControls">
        <span class="ctx-check-mark">{{ colorfulLoopControls ? '✓' : ' ' }}</span>
        Colorful loop controls
      </div>
      <div class="ctx-item" :class="{ 'ctx-active': alwaysShowAdvancedLoopControls }"
        @click="alwaysShowAdvancedLoopControls = !alwaysShowAdvancedLoopControls">
        <span class="ctx-check-mark">{{ alwaysShowAdvancedLoopControls ? '✓' : ' ' }}</span>
        Always show advanced controls
      </div>
    </div>

    <!-- ── Rename inline prompt ──────────────────────────────────────── -->
    <div v-if="renaming" class="rename-overlay" @click.self="renaming=false">
      <div class="rename-box">
        <span class="rename-label">Rename "{{ renameTarget?.name }}"</span>
        <input ref="renameInput" v-model="renameName" class="rename-input"
          @keydown.enter="commitRename" @keydown.esc="renaming=false" maxlength="16" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitRename">OK</button>
          <button class="rename-cancel" @click="renaming=false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── Group name prompt ─────────────────────────────────────────── -->
    <div v-if="groupPrompt.open" class="rename-overlay" @click.self="groupPrompt.open=false">
      <div class="rename-box">
        <span class="rename-label">{{ groupPrompt.label }}</span>
        <input ref="groupNameInput" v-model="groupPrompt.name" class="rename-input"
          @keydown.enter="commitGroupPrompt" @keydown.esc="groupPrompt.open=false" maxlength="24" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitGroupPrompt">OK</button>
          <button class="rename-cancel" @click="groupPrompt.open=false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── Rename + Color + Icon dialog ─────────────────────────────── -->
    <div v-if="colorRenaming" class="rename-overlay" @click.self="colorRenaming=false">
      <div class="rename-box color-rename-box">
        <span class="rename-label">Rename, color and icon</span>
        <input ref="colorRenameInput" v-model="colorRenameName" class="rename-input"
          @keydown.enter="commitRenameColor" @keydown.esc="colorRenaming=false" maxlength="20"
          placeholder="Channel name" />
        <div class="color-rename-row">
          <label class="grad-label">Color</label>
          <input type="color" v-model="colorRenameColor" class="grad-color-input" />
        </div>
        <div class="color-rename-swatches">
          <div v-for="sw in COLOR_SWATCHES" :key="sw"
            class="color-swatch"
            :class="{ selected: colorRenameColor === sw }"
            :style="{ background: sw }"
            @click="colorRenameColor = sw" />
        </div>
        <div class="rename-btns">
          <button class="rename-ok" @click="commitRenameColor">OK</button>
          <button class="rename-cancel" @click="colorRenaming=false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── Transpose dialog ──────────────────────────────────────────── -->
    <div v-if="transposeDialog.open" class="rename-overlay" @click.self="transposeDialog.open=false">
      <div class="rename-box">
        <span class="rename-label">Transpose selected channels</span>
        <div class="transpose-row">
          <button class="transpose-step" @click="transposeDialog.semitones -= 12">-12</button>
          <button class="transpose-step" @click="transposeDialog.semitones -= 1">-1</button>
          <div class="transpose-val">{{ transposeDialog.semitones > 0 ? '+' : '' }}{{ transposeDialog.semitones }}</div>
          <button class="transpose-step" @click="transposeDialog.semitones += 1">+1</button>
          <button class="transpose-step" @click="transposeDialog.semitones += 12">+12</button>
        </div>
        <div class="rename-btns">
          <button class="rename-ok" @click="commitTranspose">Apply</button>
          <button class="rename-cancel" @click="transposeDialog.open=false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── Gradient color dialog ─────────────────────────────────────── -->
    <div v-if="showGradientDialog" class="rename-overlay" @click.self="showGradientDialog=false">
      <div class="rename-box gradient-box">
        <span class="rename-label">Gradient color selected channels</span>
        <div class="gradient-row">
          <label class="grad-label">From</label>
          <input type="color" v-model="gradFrom" class="grad-color-input" />
          <label class="grad-label">To</label>
          <input type="color" v-model="gradTo" class="grad-color-input" />
        </div>
        <div class="rename-btns">
          <button class="rename-ok" @click="applyGradient">Apply</button>
          <button class="rename-cancel" @click="showGradientDialog=false">Cancel</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useStudio, FM_PRESETS, TICKS_PER_STEP } from '../store/studio.js'
import { getAsset } from '../browserLibrary.js'
import Knob from './Knob.vue'

const {
  channels, selectedChannelId, totalSteps, isPlaying, displayStep,
  pianoRollOpen, kbOctave,
  patterns, currentPatternId, getSteps, getPianoNotes,
  addPattern, removePattern, duplicatePattern,
  toggleStep, soloChannel, clearChannel, addChannel, addFMChannel, addGMChannel, addWasmChannel, addCustomSynthChannel, addSubterraChannel, removeChannel, moveChannel, setChannelMode,
  GM_CATEGORIES, GM_CAT_COLORS, GM_INSTRUMENTS,
  channelGroups, addGroup, removeGroup, renameGroup, assignChannelsToGroup,
  graphEditorOpen, graphParam,
  getStepVelocities, setStepVelocity, getStepPans, setStepPan, getStepPitches, setStepPitch,
  getStepModX, setStepModX, getStepModY, setStepModY, getStepShift, setStepShift, getStepRep, setStepRep,
  fillSteps, cloneChannel, sortChannelsBy, colorChannelsRandom, colorChannelsGradient,
  assignChannelToMixerTrack, mixerTracks,
  setCutSelf, splitByChannel,
  assignToFreeMixerTracks, transposeChannelNotes,
  globalLoopMode, colorfulLoopControls, alwaysShowAdvancedLoopControls, muteRemovedSteps,
  rotateSteps, invertSteps,
  getPatternLengthTicks,
  importMidiFile,
  replaceChannelInstrument, addInstrumentChannel,
  instrumentDrag, startInstrumentDrag,
  pushUndo,
} = useStudio()

// Local MIDI-tick constant (matches store's TICKS_PER_STEP = 120)
const CR_TICKS_PER_BAR = TICKS_PER_STEP * 16  // 1920 — one 4/4 bar at 1/16 resolution

// ── Step-length layout reflow (stack into 2 rows when steps get too narrow) ────
const rackEl = ref(null)
const rackWidth = ref(1000)
const CONTROLS_W = 280            // name + mute + pan/vol + mixer columns (+ gaps)
const STEP_MIN_PX = 12            // legibility threshold per step button
const stepPx = computed(() => Math.max(2, (rackWidth.value - CONTROLS_W) / Math.max(1, totalSteps.value)))
const compactSteps = computed(() => stepPx.value < STEP_MIN_PX)
const stepCols = computed(() => compactSteps.value ? Math.ceil(totalSteps.value / 2) : totalSteps.value)
let _rackRO = null

// ── MIDI file import ──────────────────────────────────────────────────────────
const midiFileInput = ref(null)
const midiImportMsg = ref('')
let   _midiMsgTimer = null

async function _importMidiFileObj(file) {
  try {
    const buffer = await file.arrayBuffer()
    const { channelCount } = importMidiFile(buffer, file.name)
    midiImportMsg.value = channelCount > 0
      ? `✓ Imported "${file.name.replace(/\.(mid|midi)$/i, '')}" — ${channelCount} track${channelCount > 1 ? 's' : ''}`
      : 'No note data found in this MIDI file'
  } catch (err) {
    midiImportMsg.value = '✕ Could not parse: ' + err.message
  }
  clearTimeout(_midiMsgTimer)
  _midiMsgTimer = setTimeout(() => { midiImportMsg.value = '' }, 4000)
}

async function onMidiFileInput(e) {
  const file = e.target.files?.[0]
  if (!file) return
  e.target.value = ''
  await _importMidiFileObj(file)
}

// ── Unified drag-and-drop: +SYNTH instruments + Browser samples + MIDI files ──
//   Drag sources carry one of:
//     application/x-fls-instrument  → JSON spec from the +SYNTH picker
//     application/x-fls-asset       → browser sample asset id
//     Files                         → desktop .mid/.midi import
//   Dropping on empty rack area adds a new channel; dropping on a channel row
//   hot-swaps that channel's instrument (keeping its steps/notes/routing).
const dropActive         = ref(false)  // instrument / sample drag over the rack
const midiDropActive     = ref(false)  // desktop MIDI file drag
const dragOverChannelId  = ref(null)   // channel row currently targeted for replace
let _dragDepth = 0

function _hasInstrument(e) { return [...(e.dataTransfer?.types ?? [])].includes('application/x-fls-instrument') }
function _hasAsset(e)      { return [...(e.dataTransfer?.types ?? [])].includes('application/x-fls-asset') }
function _hasFiles(e)      { return [...(e.dataTransfer?.types ?? [])].includes('Files') }
function _hasDropPayload(e) { return _hasInstrument(e) || _hasAsset(e) }

// Resolve the dropped drag payload into an instrument spec (available on drop).
function _readInstrumentSpec(e) {
  const json = e.dataTransfer.getData('application/x-fls-instrument')
  if (json) { try { return JSON.parse(json) } catch (_) { return null } }
  const id    = e.dataTransfer.getData('application/x-fls-asset')
  const asset = id && getAsset(id)
  if (asset) return { t: 'sample', asset }
  return null
}

// ── +SYNTH picker drag source ─────────────────────────────────────────────────
// Delegates to the shared store drag controller (visible ghost + drop-to-replace).
// On a plain click (no movement) it adds a new channel; on drag it replaces the
// channel under the cursor, or adds one over empty rack space.
function startPickDrag(spec, label, color, e) {
  startInstrumentDrag(spec, label, color, e, {
    onDragStart: () => { showSynthPicker.value = false },
    onClick:     () => { addInstrumentChannel(spec); showSynthPicker.value = false },
  })
}

// ── Rack-level (empty area → add new channel) ─────────────────────────────────
function onRackDragEnter(e) {
  const drag  = _hasDropPayload(e)
  const files = _hasFiles(e)
  if (!drag && !files) return
  _dragDepth++
  if (drag) dropActive.value = true
  else      midiDropActive.value = true
}
function onRackDragOver(e) {
  if (_hasDropPayload(e) || _hasFiles(e)) e.dataTransfer.dropEffect = 'copy'
}
function onRackDragLeave() {
  if (--_dragDepth <= 0) {
    _dragDepth = 0
    dropActive.value     = false
    midiDropActive.value = false
  }
}
async function onRackDrop(e) {
  _dragDepth = 0
  dropActive.value     = false
  midiDropActive.value = false
  dragOverChannelId.value = null

  // Desktop MIDI file takes priority
  const files    = [...(e.dataTransfer?.files ?? [])]
  const midiFile = files.find(f => /\.(mid|midi)$/i.test(f.name))
  if (midiFile) {
    await _importMidiFileObj(midiFile)
    return
  }

  // Instrument from the +SYNTH picker, or a browser sample → add a new channel.
  const spec = _readInstrumentSpec(e)
  if (spec) addInstrumentChannel(spec)
}

// ── Channel-row drop target (replace this channel's instrument) ───────────────
function onRowDragOver(e, ch) {
  if (!_hasDropPayload(e)) return            // let MIDI files bubble up to the rack
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'copy'
  dragOverChannelId.value = ch.id
}
function onRowDragLeave(e, ch) {
  if (dragOverChannelId.value === ch.id) dragOverChannelId.value = null
}
function onRowDrop(e, ch) {
  if (!_hasDropPayload(e)) return            // not an instrument/sample → let it bubble
  e.preventDefault()
  e.stopPropagation()
  dragOverChannelId.value = null
  dropActive.value = false
  _dragDepth = 0
  const spec = _readInstrumentSpec(e)
  if (spec) replaceChannelInstrument(ch.id, spec)
}

// ── Graph editor tabs ─────────────────────────────────────────────────────────
const GE_TABS = [
  { key: 'velocity', label: 'VEL' },
  { key: 'release',  label: 'REL' },
  { key: 'pan',      label: 'PAN' },
  { key: 'pitch',    label: 'PCH' },
  { key: 'modx',     label: 'MOD X' },
  { key: 'mody',     label: 'MOD Y' },
  { key: 'shift',    label: 'SHIFT' },
  { key: 'rep',      label: 'REP' },
]

// ── Multi-select ──────────────────────────────────────────────────────────────
const selectedIds = ref(new Set())

function selectChannel(ch) {
  selectedChannelId.value = ch.id
  selectedIds.value = new Set([ch.id])
}
function toggleMultiSelect(ch) {
  const s = new Set(selectedIds.value)
  if (s.has(ch.id)) s.delete(ch.id)
  else s.add(ch.id)
  selectedIds.value = s
  if (!s.has(selectedChannelId.value) && s.size > 0) {
    selectedChannelId.value = [...s][0]
  }
}
function getOpTargets() {
  if (selectedIds.value.size > 1) return [...selectedIds.value]
  return [selectedChannelId.value]
}

// ── Synth picker ──────────────────────────────────────────────────────────────
const showSynthPicker = ref(false)
const synthPickerRef  = ref(null)
const expandedGMCat   = ref(null)  // name of the currently-open GM category sub-list

function getProgsForCat(cat) {
  const result = []
  for (let p = cat.range[0]; p <= cat.range[1]; p++) result.push(p)
  return result
}
function toggleGMCat(name) {
  expandedGMCat.value = expandedGMCat.value === name ? null : name
}

function onDocClick(e) {
  // Keep the synth picker open while the user interacts inside it — expanding a
  // GM instrument category is a two-step action (open category → pick program),
  // and this capture-phase handler would otherwise close the picker on the very
  // first click, making the entire GM section unreachable. Leaf items still
  // close it explicitly after adding a channel.
  if (!e.target?.closest?.('.add-synth-wrap')) showSynthPicker.value = false
  optionsOpen.value = false
  dfOpen.value = false
}
function onRackKeydown(e) {
  if (e.ctrlKey && e.key === 'l') {
    e.preventDefault()
    doAssignFreeTrack()
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('keydown', onRackKeydown)
  if (rackEl.value) {
    rackWidth.value = rackEl.value.clientWidth
    _rackRO = new ResizeObserver(es => { rackWidth.value = es[0].contentRect.width })
    _rackRO.observe(rackEl.value)
  }
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onRackKeydown)
  _rackRO?.disconnect()
})

// ── Pattern navigator helpers ─────────────────────────────────────────────────
const patternIndex   = computed(() => patterns.findIndex(p => p.id === currentPatternId.value))
const currentPattern = computed(() => patterns.find(p => p.id === currentPatternId.value) ?? patterns[0])

// Pattern context + rename
const patCtx = reactive({ open: false, x: 0, y: 0 })
function showPatCtx(e) { patCtx.open = true; patCtx.x = e.clientX; patCtx.y = e.clientY }

const patRenaming    = ref(false)
const patRenameName  = ref('')
const patRenameInput = ref(null)

function startPatRename() {
  patCtx.open = false
  patRenameName.value = currentPattern.value.name
  patRenaming.value = true
  nextTick(() => patRenameInput.value?.select())
}
function commitPatRename() {
  if (patRenameName.value.trim()) currentPattern.value.name = patRenameName.value.trim()
  patRenaming.value = false
}

// ── Display filter ────────────────────────────────────────────────────────────
const activeFilter = ref('all')
const dfOpen = ref(false)
const dfRef  = ref(null)

const filterLabel = computed(() => {
  if (activeFilter.value === 'all') return 'ALL CHANNELS'
  if (activeFilter.value === 'unsorted') return 'UNSORTED'
  const g = channelGroups.find(g => g.id === activeFilter.value)
  return g ? g.name.toUpperCase() : 'ALL CHANNELS'
})

function setFilter(val) {
  activeFilter.value = val
  dfOpen.value = false
}

const visibleChannels = computed(() => {
  if (activeFilter.value === 'all') return channels
  if (activeFilter.value === 'unsorted') return channels.filter(c => !c.groupId)
  return channels.filter(c => c.groupId === activeFilter.value)
})

// Group context menu
const groupCtx = reactive({ open: false, x: 0, y: 0, group: null })
function showGroupCtx(e, g) {
  dfOpen.value = false
  groupCtx.open = true; groupCtx.x = e.clientX; groupCtx.y = e.clientY; groupCtx.group = g
}

// Group prompt (add or rename)
const groupPrompt = reactive({ open: false, label: '', name: '', mode: 'add', groupId: null })
const groupNameInput = ref(null)

function startAddGroup() {
  dfOpen.value = false
  groupPrompt.mode = 'add'
  groupPrompt.label = 'New group name'
  groupPrompt.name = ''
  groupPrompt.open = true
  nextTick(() => groupNameInput.value?.focus())
}

function startGroupSelected() {
  groupPrompt.mode = 'assign'
  groupPrompt.label = 'Group selected channels (enter name)'
  groupPrompt.name = ''
  groupPrompt.open = true
  nextTick(() => groupNameInput.value?.focus())
}

function startRenameGroup(g) {
  groupCtx.open = false
  groupPrompt.mode = 'rename'
  groupPrompt.label = `Rename group "${g.name}"`
  groupPrompt.name = g.name
  groupPrompt.groupId = g.id
  groupPrompt.open = true
  nextTick(() => groupNameInput.value?.select())
}

function commitGroupPrompt() {
  const name = groupPrompt.name.trim()
  if (!name) return
  if (groupPrompt.mode === 'add') {
    addGroup(name)
  } else if (groupPrompt.mode === 'rename') {
    renameGroup(groupPrompt.groupId, name)
  } else if (groupPrompt.mode === 'assign') {
    // Find or create group with this name
    let g = channelGroups.find(g => g.name.toLowerCase() === name.toLowerCase())
    const gid = g ? g.id : addGroup(name)
    assignChannelsToGroup(getOpTargets(), gid)
  }
  groupPrompt.open = false
}

// ── Options menu ──────────────────────────────────────────────────────────────
const optionsOpen = ref(false)
const optionsPos  = reactive({ top: 0, left: 0 })
const activeSub   = ref(null)

function toggleOptions(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  optionsPos.top  = rect.bottom + 4
  optionsPos.left = rect.left
  optionsOpen.value = !optionsOpen.value
}

function closeAllMenus() {
  optionsOpen.value   = false
  dfOpen.value        = false
  showSynthPicker.value = false
  ctxMenu.open        = false
  loopCtx.open        = false
  patCtx.open         = false
  groupCtx.open       = false
  ctxSubOpen.value    = null
  activeSub.value     = null
}

// ── Channel operations ────────────────────────────────────────────────────────
function cloneSelectedOp() {
  getOpTargets().forEach(id => cloneChannel(id))
}
function deleteSelectedOp() {
  getOpTargets().forEach(id => removeChannel(id))
}
function moveSelectedOp(dir) {
  getOpTargets().forEach(id => moveChannel(id, dir))
}
function muteSelectedOp(muted) {
  getOpTargets().forEach(id => {
    const ch = channels.find(c => c.id === id)
    if (ch) ch.muted = muted
  })
}
function zipSelectedOp() {
  getOpTargets().forEach(id => {
    const ch = channels.find(c => c.id === id)
    if (ch) ch.zipped = true
  })
}
function unzipAll() {
  channels.forEach(ch => { ch.zipped = false })
}
function selectUnused() {
  const usedIds = new Set()
  channels.forEach(ch => {
    patterns.forEach(p => {
      const steps = getSteps(ch.id, p.id)
      const notes = getPianoNotes(ch.id, p.id)
      if (steps.some(Boolean) || notes.length > 0) usedIds.add(ch.id)
    })
  })
  selectedIds.value = new Set(channels.filter(c => !usedIds.has(c.id)).map(c => c.id))
}
function doFillSteps(every) {
  getOpTargets().forEach(id => fillSteps(id, every))
}

// ── Gradient color ────────────────────────────────────────────────────────────
const showGradientDialog = ref(false)
const gradFrom = ref('#e74c3c')
const gradTo   = ref('#4ecdc4')

function doColorRandom() {
  colorChannelsRandom(getOpTargets())
}
function applyGradient() {
  colorChannelsGradient(getOpTargets(), gradFrom.value, gradTo.value)
  showGradientDialog.value = false
}

// ── Piano roll open/select ────────────────────────────────────────────────────
function openOrSelectChannel(ch) {
  selectedChannelId.value = ch.id
  if (ch.mode === 'piano') pianoRollOpen.value = true
}

// ── Mini piano-roll preview helpers ──────────────────────────────────────────
function noteStep(n) {
  // Migrate from old n.step to tick-based n.startTick
  return n.startTick !== undefined
    ? Math.floor(n.startTick / TICKS_PER_STEP)
    : (n.step ?? 0)
}
function notesAtStep(ch, step) {
  return getPianoNotes(ch.id).filter(n => noteStep(n) === step)
}
const MINI_NOTE_CAP = 200
function noteBottom(pitch) {
  // Map C2–C6 across the row height, clamped so notes outside that range pin to
  // the top/bottom edge and stay visible rather than clipping out of view.
  const pct = ((pitch - 36) / (84 - 36)) * 100
  return Math.max(0, Math.min(94, pct))
}

// ── Mini preview windowing ───────────────────────────────────────────────────
// The multi-bar preview never shows more than MINI_WINDOW_BARS bars at once.
// Once a channel runs longer, the visible window pages with the playhead in
// fixed 4-bar chunks: bars 1–4, then 5–8, … following the part being played.
const MINI_WINDOW_BARS = 4

// Bars actually rendered in the preview (capped at the window size).
function miniVisibleBars(ch) {
  return Math.min(MINI_WINDOW_BARS, channelPatternBars(ch))
}
// First bar of the visible window. Pinned to 0 until playback passes the window,
// then snapped to the 4-bar page containing the playhead (clamped to the last page).
function miniWindowStartBar(ch) {
  const total = channelPatternBars(ch)
  if (total <= MINI_WINDOW_BARS) return 0
  const playBar = isPlaying.value && displayStep.value >= 0
    ? Math.floor((displayStep.value * TICKS_PER_STEP) / CR_TICKS_PER_BAR)
    : 0
  const page     = Math.floor(playBar / MINI_WINDOW_BARS) * MINI_WINDOW_BARS
  const lastPage = Math.floor((total - 1) / MINI_WINDOW_BARS) * MINI_WINDOW_BARS
  return Math.min(page, lastPage)
}
// Window bounds in ticks.
function miniWindowStartTick(ch) { return miniWindowStartBar(ch) * CR_TICKS_PER_BAR }
function miniWindowTicks(ch)     { return miniVisibleBars(ch) * CR_TICKS_PER_BAR }

// Notes overlapping the current window (capped for performance).
function getMiniWindowNotes(ch) {
  const start = miniWindowStartTick(ch)
  const end   = start + miniWindowTicks(ch)
  const notes = getPianoNotes(ch.id).filter(n => {
    const s = n.startTick ?? 0
    return s < end && s + (n.durationTicks ?? TICKS_PER_STEP) > start
  })
  return notes.length > MINI_NOTE_CAP ? notes.slice(0, MINI_NOTE_CAP) : notes
}
// Note geometry relative to the window (overflow:hidden clips the off-window parts).
function miniNoteLeft(ch, note) {
  return (((note.startTick ?? 0) - miniWindowStartTick(ch)) / miniWindowTicks(ch)) * 100
}
function miniNoteWidth(ch, note) {
  return Math.max(0.5, ((note.durationTicks ?? TICKS_PER_STEP) / miniWindowTicks(ch)) * 100)
}
// Playhead position relative to the window.
function miniHeadLeft(ch) {
  return ((displayStep.value * TICKS_PER_STEP - miniWindowStartTick(ch)) / miniWindowTicks(ch)) * 100
}

// Lightweight previews for channels that aren't currently focused — a note count
// instead of the full melody, so only the selected instrument draws its notes.
function miniSummary(ch) {
  const n = getPianoNotes(ch.id).length
  return n ? `${n} ♪` : 'PIANO ROLL'
}
function miniBarLabel(ch) {
  const bars = channelPatternBars(ch)
  // Channels longer than the window show which bars are currently in view.
  const label = bars > MINI_WINDOW_BARS
    ? `BAR ${miniWindowStartBar(ch) + 1}–${miniWindowStartBar(ch) + miniVisibleBars(ch)}/${bars}`
    : `${bars} BAR`
  if (ch.id === selectedChannelId.value) return label
  const n = getPianoNotes(ch.id).length
  return n ? `${label} · ${n} ♪` : label
}

// ── Multi-bar detection ───────────────────────────────────────────────────────
// Returns the furthest note-end tick for a piano channel in the current pattern.
function channelPatternTicks(ch) {
  const notes = getPianoNotes(ch.id)
  if (!notes.length) return totalSteps.value * TICKS_PER_STEP
  return notes.reduce(
    (m, n) => Math.max(m, (n.startTick ?? 0) + (n.durationTicks ?? TICKS_PER_STEP)),
    totalSteps.value * TICKS_PER_STEP,
  )
}

// Number of whole bars the channel's notes span (minimum 1).
function channelPatternBars(ch) {
  return Math.max(1, Math.ceil(channelPatternTicks(ch) / CR_TICKS_PER_BAR))
}

// True when the channel has piano notes extending beyond 1 bar.
function isMultiBarChannel(ch) {
  return ch.mode === 'piano' && channelPatternBars(ch) > 1
}

// ── Graph Editor ──────────────────────────────────────────────────────────────
function getGeBarHeight(chId, step) {
  switch (graphParam.value) {
    case 'velocity': return (getStepVelocities(chId)[step] ?? 0.8) * 100
    case 'release':  return (getStepVelocities(chId)[step] ?? 0.8) * 100
    case 'pan':      return Math.abs(getStepPans(chId)[step] ?? 0) * 50
    case 'pitch':    return Math.abs(getStepPitches(chId)[step] ?? 0) / 12 * 50
    case 'modx':     return (getStepModX(chId)[step] ?? 0.5) * 100
    case 'mody':     return (getStepModY(chId)[step] ?? 0.5) * 100
    case 'shift':    return Math.abs(getStepShift(chId)[step] ?? 0) * 50
    case 'rep':      return (getStepRep(chId)[step] ?? 0) * 100
    default:         return (getStepVelocities(chId)[step] ?? 0.8) * 100
  }
}
function getGeBarBottom(chId, step) {
  if (graphParam.value === 'pan') {
    const v = getStepPans(chId)?.[step] ?? 0
    return v < 0 ? 0 : 50
  }
  if (graphParam.value === 'pitch') {
    const v = getStepPitches(chId)?.[step] ?? 0
    return v < 0 ? 0 : 50
  }
  if (graphParam.value === 'shift') {
    const v = getStepShift(chId)?.[step] ?? 0
    return v < 0 ? 0 : 50
  }
  return 0
}

// ── Graph Editor helpers ──────────────────────────────────────────────────────
function _geStep(rect, clientX) {
  return Math.max(0, Math.min(totalSteps.value - 1,
    Math.floor(((clientX - rect.left) / rect.width) * totalSteps.value)
  ))
}
function _geValue(relY) {
  switch (graphParam.value) {
    case 'velocity': case 'release': return Math.max(0, Math.min(1, 1 - relY))
    case 'pan':   return Math.max(-1, Math.min(1, (0.5 - relY) * 2))
    case 'pitch': return Math.round(Math.max(-12, Math.min(12, (0.5 - relY) * 24)))
    case 'modx':  return Math.max(0, Math.min(1, 1 - relY))
    case 'mody':  return Math.max(0, Math.min(1, 1 - relY))
    case 'shift': return Math.max(-1, Math.min(1, (0.5 - relY) * 2))
    case 'rep':   return Math.max(0, Math.min(1, 1 - relY))
    default:      return Math.max(0, Math.min(1, 1 - relY))
  }
}
function _geDefault() {
  switch (graphParam.value) {
    case 'velocity': case 'release': return 0.8
    case 'pan':    return 0
    case 'pitch':  return 0
    case 'modx':   return 0.5
    case 'mody':   return 0.5
    case 'shift':  return 0
    case 'rep':    return 0
    default:       return 0.8
  }
}
function _geSet(chId, step, val) {
  switch (graphParam.value) {
    case 'velocity': case 'release': setStepVelocity(chId, step, val); break
    case 'pan':    setStepPan(chId, step, val);   break
    case 'pitch':  setStepPitch(chId, step, val); break
    case 'modx':   setStepModX(chId, step, val);  break
    case 'mody':   setStepModY(chId, step, val);  break
    case 'shift':  setStepShift(chId, step, val); break
    case 'rep':    setStepRep(chId, step, val);   break
  }
}
function _geGet(chId, step) {
  switch (graphParam.value) {
    case 'velocity': case 'release': return getStepVelocities(chId)[step] ?? 0.8
    case 'pan':    return getStepPans(chId)[step]    ?? 0
    case 'pitch':  return getStepPitches(chId)[step] ?? 0
    case 'modx':   return getStepModX(chId)[step]    ?? 0.5
    case 'mody':   return getStepModY(chId)[step]    ?? 0.5
    case 'shift':  return getStepShift(chId)[step]   ?? 0
    case 'rep':    return getStepRep(chId)[step]     ?? 0
    default:       return 0.8
  }
}

// Left-click drag: paint values. Ctrl+drag: scale all proportionally.
function startGeDrag(e, ch) {
  if (e.altKey) { _geResetAll(ch); return }
  const chart = e.currentTarget
  const isCtrl = e.ctrlKey
  // snapshot initial values for proportional scaling
  const initVals = isCtrl
    ? Array.from({ length: totalSteps.value }, (_, i) => _geGet(ch.id, i))
    : null
  pushUndo()
  const doUpdate = (me) => {
    const rect  = chart.getBoundingClientRect()
    const step  = _geStep(rect, me.clientX)
    const relY  = (me.clientY - rect.top) / rect.height
    const newVal = _geValue(relY)
    if (me.ctrlKey && initVals) {
      // Proportional scale: ratio between new and original for the dragged column
      const orig = initVals[step]
      if (Math.abs(orig) < 0.001) return
      const ratio = newVal / orig
      for (let i = 0; i < totalSteps.value; i++) {
        _geSet(ch.id, i, initVals[i] * ratio)
      }
    } else {
      _geSet(ch.id, step, newVal)
    }
  }
  doUpdate(e)
  const onMove = (me) => doUpdate(me)
  const onUp   = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// Right-click drag: ramp-interpolate between start and end steps.
function startGeRamp(e, ch) {
  const chart = e.currentTarget
  const rect  = chart.getBoundingClientRect()
  const startStep = _geStep(rect, e.clientX)
  const startRelY = (e.clientY - rect.top) / rect.height
  const startVal  = _geValue(startRelY)
  pushUndo()
  const onMove = (me) => {
    const endStep = _geStep(rect, me.clientX)
    const endRelY = (me.clientY - rect.top) / rect.height
    const endVal  = _geValue(endRelY)
    const lo = Math.min(startStep, endStep)
    const hi = Math.max(startStep, endStep)
    const span = hi - lo
    for (let i = lo; i <= hi; i++) {
      const t = span === 0 ? 0 : (i - lo) / span
      const v = startStep <= endStep
        ? startVal + (endVal - startVal) * t
        : endVal   + (startVal - endVal) * (1 - t)
      _geSet(ch.id, i, v)
    }
  }
  const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// Alt+click on the chart: reset all bars to default.
function _geResetAll(ch) {
  pushUndo()
  const def = _geDefault()
  for (let i = 0; i < totalSteps.value; i++) _geSet(ch.id, i, def)
}

// ── Activity LED ──────────────────────────────────────────────────────────────
// Per-channel computed Set of active step indices — built once from pianoNotes,
// invalidated automatically when pianoNotes changes (reactive dependency).
// Replaces the O(N) .some() scan on every tick with an O(1) Set.has() lookup.
const _activeStepSets = new Map()
function getActiveStepsSet(chId) {
  if (!_activeStepSets.has(chId)) {
    _activeStepSets.set(chId, computed(() => {
      const set = new Set()
      for (const n of getPianoNotes(chId)) set.add(noteStep(n))
      return set
    }))
  }
  return _activeStepSets.get(chId).value
}

function isChannelFiring(ch) {
  if (!isPlaying.value || displayStep.value < 0 || ch.muted) return false
  if (ch.mode === 'steps') return !!getSteps(ch.id)[displayStep.value]
  return getActiveStepsSet(ch.id).has(displayStep.value)
}

// ── Ghost-step helpers ────────────────────────────────────────────────────────
function getLoopLen(ch) {
  if (!ch.loopEnabled || !ch.loopLength || ch.loopLength >= totalSteps.value) return null
  return ch.loopLength
}

function stepLit(ch, s) {
  const ll = getLoopLen(ch)
  if (ll !== null && s >= ll) return false
  return !!getSteps(ch.id)[s]
}

function stepGhost(ch, s) {
  const ll = getLoopLen(ch)
  if (ll === null || s < ll) return false
  return !!getSteps(ch.id)[s % ll]
}

function onStepClick(ch, s) {
  const ll = getLoopLen(ch)
  if (ll !== null && s >= ll) return  // ghost area is read-only
  toggleStep(ch.id, s)
}

function onStepRightClick(ch, s) {
  const ll = getLoopLen(ch)
  if (ll !== null && s >= ll) return
  getSteps(ch.id)[s] = false
}

// ── Context menu ──────────────────────────────────────────────────────────────
const ctxMenu = reactive({ open: false, x: 0, y: 0, channel: null })
const ctxSubOpen = ref(null)

function showContextMenu(e, ch) {
  selectedChannelId.value = ch.id
  ctxMenu.open = true
  ctxMenu.x    = e.clientX
  ctxMenu.y    = e.clientY
  ctxMenu.channel = ch
}
function ctxAction(action) {
  const ch = ctxMenu.channel
  ctxMenu.open = false
  ctxSubOpen.value = null
  if (!ch) return
  if (action === 'to-piano')  { setChannelMode(ch.id, 'piano'); openOrSelectChannel(ch) }
  if (action === 'to-steps')  { setChannelMode(ch.id, 'steps') }
  if (action === 'piano-roll')   openOrSelectChannel(ch)
  if (action === 'graph-editor') { graphEditorOpen.value = true }
  if (action === 'rename')       startRename(ch)
  if (action === 'rename-color') startRenameColor(ch)
  if (action === 'clone')        cloneChannel(ch.id)
  if (action === 'clear')        clearChannel(ch.id)
  if (action === 'move-up')      moveChannel(ch.id, -1)
  if (action === 'move-down')    moveChannel(ch.id, +1)
  if (action === 'delete')       removeChannel(ch.id)
  if (action === 'zip')          ch.zipped = !ch.zipped
  if (action === 'color-random') colorChannelsRandom([ch.id])
  if (action === 'cut-self')     setCutSelf(ch.id, !ch.cutSelf)
  if (action === 'midi-thru')    ch.midiChannelThrough = !ch.midiChannelThrough
  if (action === 'truncate-swing') ch.truncateSwingNotes = ch.truncateSwingNotes === false ? true : false
  if (action === 'shift-left')   rotateSteps(ch.id, -1)
  if (action === 'shift-right')  rotateSteps(ch.id, +1)
  if (action === 'invert')       invertSteps(ch.id)
}
function ctxFill(every) {
  ctxSubOpen.value = null
  ctxMenu.open = false
  if (ctxMenu.channel) fillSteps(ctxMenu.channel.id, every)
}
function ctxSetLoopLen(len) {
  const ch = ctxMenu.channel
  ctxMenu.open = false
  ctxSubOpen.value = null
  if (!ch) return
  ch.loopLength = len
  if (len < totalSteps.value) ch.loopEnabled = true
}
function ctxSetSwingMix(val) {
  const ch = ctxMenu.channel
  ctxMenu.open = false
  ctxSubOpen.value = null
  if (!ch) return
  ch.swingMix = val
}

// ── Loop right-click context ──────────────────────────────────────────────────
const loopCtx = reactive({ open: false, x: 0, y: 0, channel: null })
function showLoopCtx(e, ch) {
  loopCtx.channel = ch
  loopCtx.x = e.clientX
  loopCtx.y = e.clientY
  loopCtx.open = true
}
function loopCtxBurnToPattern() {
  loopCtx.open = false
  const ch = loopCtx.channel
  if (!ch) return
  pushUndo()
  const newId = 'p' + Date.now()
  // Placeholder: a real burn would copy looped steps into new pattern
  console.log('[FreakyLoops] Burn loop to pattern — channel', ch.name)
}

// ── Rename + Color + Icon dialog ──────────────────────────────────────────────
const COLOR_SWATCHES = [
  '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c','#4ecdc4',
  '#3498db','#9b59b6','#e91e63','#ff5722','#8bc34a','#00bcd4',
  '#607d8b','#9e9e9e','#ffffff','#795548',
]
const colorRenaming     = ref(false)
const colorRenameTarget = ref(null)
const colorRenameName   = ref('')
const colorRenameColor  = ref('#4ecdc4')
const colorRenameInput  = ref(null)
function startRenameColor(ch) {
  colorRenameTarget.value = ch
  colorRenameName.value   = ch.name
  colorRenameColor.value  = ch.color
  colorRenaming.value     = true
  nextTick(() => colorRenameInput.value?.select())
}
function commitRenameColor() {
  const ch = colorRenameTarget.value
  if (ch) {
    if (colorRenameName.value.trim()) ch.name = colorRenameName.value.trim().toUpperCase()
    ch.color = colorRenameColor.value
  }
  colorRenaming.value = false
}

// ── Transpose dialog ──────────────────────────────────────────────────────────
const transposeDialog = reactive({ open: false, semitones: 0 })
function openTransposeDialog() {
  transposeDialog.semitones = 0
  transposeDialog.open = true
}
function commitTranspose() {
  transposeChannelNotes(getOpTargets(), transposeDialog.semitones)
  transposeDialog.open = false
}
function setSwingMixForSelected(val) {
  getOpTargets().forEach(id => {
    const ch = channels.find(c => c.id === id)
    if (ch) ch.swingMix = val
  })
}
function setTruncateSwingForSelected(val) {
  getOpTargets().forEach(id => {
    const ch = channels.find(c => c.id === id)
    if (ch) ch.truncateSwingNotes = val
  })
}
function doAssignFreeTrack() {
  assignToFreeMixerTracks(getOpTargets())
}

// ── Rename ────────────────────────────────────────────────────────────────────
const renaming     = ref(false)
const renameTarget = ref(null)
const renameName   = ref('')
const renameInput  = ref(null)

function startRename(ch) {
  renameTarget.value = ch
  renameName.value   = ch.name
  renaming.value     = true
  nextTick(() => renameInput.value?.select())
}
function commitRename() {
  if (renameTarget.value && renameName.value.trim()) {
    renameTarget.value.name = renameName.value.trim().toUpperCase()
  }
  renaming.value = false
}

</script>

<style scoped>
/* ── Pattern navigator ───────────────────────────────────────────── */
.pattern-nav {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  background: var(--bg-deeper); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
}
.pat-nav-btn {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border);
  background: transparent; color: #60608a; font-size: 16px; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.1s; padding: 0;
}
.pat-nav-btn:hover:not(:disabled) { border-color: #4a4a6a; color: #a0a0c0; }
.pat-nav-btn:disabled { opacity: 0.25; cursor: default; }
.pat-name-wrap {
  flex: 1; display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; border: 1px solid var(--border-subtle); border-radius: 4px;
  cursor: pointer; transition: border-color 0.1s;
}
.pat-name-wrap:hover { border-color: #3a3a5a; }
.pat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.pat-name {
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 700;
  letter-spacing: 0.1em; color: #b0b0d0; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.pat-add-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; padding: 3px 8px; border: 1px dashed var(--border);
  border-radius: 4px; background: transparent; color: var(--text-muted); cursor: pointer;
  white-space: nowrap; transition: all 0.12s;
}
.pat-add-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }

/* ── Rack root ───────────────────────────────────────────────────── */
.channel-rack {
  display: flex; flex-direction: column; flex: 1;
  overflow: hidden; background: var(--bg-base); position: relative;
}
.channel-rack.rack-drop      { box-shadow: inset 0 0 0 2px #f1c40f; }
.channel-rack.rack-drop-midi { box-shadow: inset 0 0 0 2px #e91e63; }
.rack-drop-hint {
  position: absolute; inset: 0; z-index: 2500;
  display: flex; align-items: center; justify-content: center;
  background: rgba(20, 16, 4, 0.55); backdrop-filter: blur(1px);
  font-family: 'Rajdhani', sans-serif; font-size: 18px; font-weight: 700;
  letter-spacing: 0.1em; color: #f1c40f; pointer-events: none;
  text-shadow: 0 0 14px #f1c40f66;
}

/* ── Options panel ───────────────────────────────────────────────── */
.options-panel {
  position: fixed; z-index: 3000;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 7px;
  padding: 4px 0; min-width: 210px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.8);
  max-height: 80vh; overflow-y: auto;
}
.op-section {
  padding: 6px 14px 3px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #303050; text-transform: uppercase;
}
.op-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 16px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.07em; color: #9090b8; cursor: pointer;
  transition: background 0.07s, color 0.07s;
  position: relative;
}
.op-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.op-item.danger { color: #7a3030; }
.op-item.danger:hover { color: #e74c3c; background: #1a0a0a; }
.op-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.op-kb {
  margin-left: auto; font-family: 'Share Tech Mono', monospace;
  font-size: 9px; color: #353548; letter-spacing: 0;
}
.op-sep { height: 1px; background: var(--border-subtle); margin: 3px 0; }

.op-sub-trigger {
  display: flex; align-items: center;
  padding: 6px 16px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.07em; color: #9090b8; cursor: pointer;
  transition: background 0.07s, color 0.07s;
  position: relative;
}
.op-sub-trigger:hover { background: var(--bg-hover); color: var(--text-primary); }
.op-submenu {
  position: absolute; left: 100%; top: 0; z-index: 3100;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  min-width: 150px; padding: 4px 0;
  box-shadow: 0 8px 28px rgba(0,0,0,0.75);
}

/* ── Rack toolbar ────────────────────────────────────────────────── */
.rack-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: var(--bg-deeper); border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.options-btn {
  width: 24px; height: 22px; border-radius: 4px;
  border: 1px solid var(--border); background: transparent; color: var(--text-muted);
  font-size: 15px; cursor: pointer; display: flex; align-items: center;
  justify-content: center; transition: all 0.1s; flex-shrink: 0;
}
.options-btn:hover { border-color: #4a4a6a; color: #b0b0d0; }
.rack-title {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.18em; color: #40405a; text-transform: uppercase;
  flex-shrink: 0;
}

/* ── Display filter ──────────────────────────────────────────────── */
.df-wrap { position: relative; }
.df-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em; padding: 3px 8px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-control); color: var(--text-muted); cursor: pointer; white-space: nowrap;
  transition: all 0.1s;
}
.df-btn:hover { border-color: #4a4a6a; color: #a0a0c0; }
.df-dropdown {
  position: absolute; top: calc(100% + 3px); left: 0; z-index: 2500;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 4px 0; min-width: 160px;
  box-shadow: 0 10px 32px rgba(0,0,0,0.75);
}
.df-item {
  padding: 6px 14px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.07em; color: #7070a0; cursor: pointer;
  transition: background 0.07s, color 0.07s;
}
.df-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.df-item.active { color: #c0c0ee; }
.df-item.df-group { padding-left: 20px; color: #5a5a80; }
.df-item.df-group:hover { color: #d0d0ee; }
.df-item.df-group.active { color: #4ecdc4; }
.df-item.df-add { color: #3a3a5a; }
.df-item.df-add:hover { color: #4ecdc4; }
.df-sep { height: 1px; background: var(--border-subtle); margin: 2px 0; }

/* ── Graph editor toggle ─────────────────────────────────────────── */
.ge-toggle-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.12em; padding: 3px 8px;
  border: 1px solid var(--border); border-radius: 4px;
  background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.12s;
}
.ge-toggle-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }
.ge-toggle-btn.active { border-color: #4ecdc4; color: #4ecdc4; background: #041614; }

.rack-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.kb-badge {
  font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #30304a;
}
.add-synth-wrap { position: relative; }
.add-ch-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; padding: 4px 10px; border: 1px dashed var(--border);
  border-radius: 5px; background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.15s;
}
.add-ch-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }
.midi-import-msg {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 600;
  letter-spacing: 0.06em; color: #4ecdc4; white-space: nowrap;
  animation: mpr-fadein 0.2s ease;
}
@keyframes mpr-fadein { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }

/* MIDI drop overlay */
.rack-drop-hint--midi {
  background: linear-gradient(135deg, #e91e6322, #9b59b611);
  border: 1px dashed #e91e6366;
  color: #e91e63cc;
}

/* GM instruments section */
.synth-pick-cat {
  display: flex; align-items: center; gap: 6px;
  cursor: pointer;
}
.synth-pick-arrow { margin-left: auto; font-size: 9px; opacity: 0.6; }
.synth-pick-gm-items {
  padding-left: 22px;
  border-left: 1px solid #ffffff12;
  margin: 2px 0 4px;
}
.synth-pick-item--gm {
  font-size: 9.5px;
  padding: 3px 8px;
  opacity: 0.85;
}
.synth-pick-item--gm:hover { opacity: 1; background: #ffffff0f; }

/* MIDI section inside synth picker */
.synth-pick-section--midi { color: #e91e6399; border-top: 1px solid #e91e6322; margin-top: 4px; padding-top: 6px; }
.synth-pick-item--midi:hover .synth-pick-dot { box-shadow: 0 0 6px #e91e63; }
.synth-pick-hint {
  padding: 3px 10px 6px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 500;
  letter-spacing: 0.06em; color: #44445a; line-height: 1.4;
}
.synth-picker {
  position: absolute; right: 0; top: calc(100% + 5px); z-index: 2000;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 7px;
  padding: 5px 0; min-width: 170px;
  box-shadow: 0 10px 36px rgba(0,0,0,0.75);
  max-height: 480px; overflow-y: auto;
}
.synth-pick-section {
  padding: 5px 14px 3px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #303048; text-transform: uppercase;
}
.synth-pick-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 14px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.08em; color: #8080a8; cursor: pointer;
  transition: background 0.08s, color 0.08s;
}
.synth-pick-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.synth-pick-item { cursor: grab; user-select: none; }
.synth-pick-item:active { cursor: grabbing; }
.synth-pick-cat, .synth-pick-item--midi { cursor: pointer; }
.synth-pick-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.synth-pick-hint--drag {
  color: #4ecdc4aa; border-bottom: 1px solid #4ecdc422; margin-bottom: 2px; padding-top: 6px;
}

/* ── Column headers ──────────────────────────────────────────────── */
.col-headers {
  display: grid;
  grid-template-columns: 20px 34px 34px 38px 130px 1fr;
  padding: 4px 0 4px 4px;
  background: var(--bg-deeper); border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.col-headers > div {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #252540; text-transform: uppercase;
  display: flex; align-items: center; justify-content: center;
}
.col-name { justify-content: flex-start; padding-left: 6px; }
.col-seq  { justify-content: flex-start; padding-left: 8px; }
.steps-label { color: #303050; font-weight: 400; margin-left: 4px; }

/* ── Channel list ────────────────────────────────────────────────── */
.channel-list { flex: 1; overflow-y: auto; }

.channel-row {
  display: grid;
  grid-template-columns: 20px 34px 34px 38px 130px 1fr;
  align-items: center;
  min-height: 40px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-base);
  cursor: pointer;
  transition: background 0.08s;
  padding-left: 4px;
  position: relative;
}
.channel-row:hover    { background: var(--bg-panel); }
.channel-row.selected { background: var(--bg-hover); }
.channel-row.multi-sel { background: var(--bg-hover); }
.channel-row.muted    { opacity: 0.45; }
.channel-row.selected::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px; background: var(--accent);
}
.channel-row.multi-sel:not(.selected)::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 2px; background: color-mix(in srgb, var(--accent) 50%, transparent);
}

/* Drag-to-replace target highlight */
.channel-row.drop-replace {
  box-shadow: inset 0 0 0 2px #f1c40f;
  background: #1a1604;
}
.channel-row.drop-replace::after {
  content: '↺ REPLACE';
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  z-index: 20; pointer-events: none;
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.14em; color: #f1c40f; text-shadow: 0 0 10px #f1c40f88;
}

/* ── Zipped row ──────────────────────────────────────────────────── */
.channel-row.zipped {
  min-height: 22px;
  grid-template-columns: 20px 1fr;
}
.zip-name {
  display: flex; align-items: center; gap: 4px; padding: 2px 4px;
}
.zip-ch-btn {
  flex: 1; height: 18px; font-size: 10px; letter-spacing: 0.1em;
  font-family: 'Rajdhani', sans-serif; font-weight: 700; color: #fff;
  border: none; border-radius: 3px; cursor: pointer;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 6px;
  transition: filter 0.1s;
}
.zip-ch-btn:hover { filter: brightness(1.12); }
.unzip-btn {
  width: 16px; height: 16px; border-radius: 3px; border: 1px solid var(--border);
  background: transparent; color: #404058; font-size: 8px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: all 0.1s;
}
.unzip-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }

/* ── LED ─────────────────────────────────────────────────────────── */
.led {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--border-subtle); border: 1px solid var(--border);
  cursor: pointer; transition: all 0.12s; justify-self: center;
}
.led.active {
  background: #2ecc71; border-color: #2ecc71;
  box-shadow: 0 0 6px #2ecc7188;
}
.led.solo {
  background: #f39c12; border-color: #f39c12;
  box-shadow: 0 0 6px #f39c1288;
}
.led.firing {
  background: var(--accent) !important;
  border-color: var(--accent) !important;
  box-shadow: 0 0 10px var(--accent), 0 0 18px color-mix(in srgb, var(--accent) 40%, transparent) !important;
  transition: all 0s;
}
.led:hover { filter: brightness(1.3); }

/* ── Knobs ───────────────────────────────────────────────────────── */
.rack-knob-wrap {
  display: flex; align-items: center; justify-content: center;
  height: 28px; overflow: hidden; cursor: pointer;
}
.rack-knob-wrap :deep(.knob-label-area) { display: none; }
.rack-knob-wrap :deep(.knob-svg) { cursor: ns-resize; }

/* ── Mixer track number ──────────────────────────────────────────── */
.mix-num { display: flex; align-items: center; justify-content: center; height: 100%; }
.mix-input {
  width: 28px; background: var(--bg-control); border: 1px solid var(--border);
  color: var(--text-muted); font-family: 'Share Tech Mono', monospace; font-size: 10px;
  text-align: center; border-radius: 3px; outline: none; padding: 2px 0;
  -moz-appearance: textfield;
}
.mix-input::-webkit-inner-spin-button, .mix-input::-webkit-outer-spin-button { -webkit-appearance: none; }
.mix-input:focus { border-color: #4a4a6a; color: #b0b0d0; }

/* ── Channel name button ─────────────────────────────────────────── */
.ch-name-btn {
  height: 28px; margin: 0 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 700;
  letter-spacing: 0.12em; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  border: none; border-radius: 4px; cursor: pointer;
  transition: filter 0.1s, box-shadow 0.1s;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding: 0 8px 0 4px;
  display: flex; align-items: center; gap: 3px;
}
.ch-name-btn:hover     { filter: brightness(1.12); }
.ch-name-btn.piano-active { box-shadow: 0 0 0 2px #fff4, 0 0 10px var(--accent); }
.ch-mode-pill {
  font-size: 9px; opacity: 0.7; flex-shrink: 0;
  line-height: 1; margin-top: 1px;
}

/* ── Sequencer area ──────────────────────────────────────────────── */
.ch-seq { padding: 0 4px; position: relative; }

.inline-steps {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 2px;
}
/* Reflow: when steps get too narrow they stack onto a second row (grid auto-wrap
   fills the first half on row 1, the rest on row 2). */
.inline-steps.compact { gap: 2px; }
.inline-steps.compact .istep { height: 13px; border-radius: 2px; }
.istep {
  height: 24px; border: 1px solid var(--border-subtle);
  border-radius: 3px; background: var(--bg-base);
  cursor: pointer; transition: background 0.07s, box-shadow 0.07s; padding: 0;
}
.istep.beat    { background: var(--bg-panel); border-color: var(--border-subtle); }
.istep.lit     {
  background: var(--accent); border-color: var(--accent);
  box-shadow: 0 0 5px color-mix(in srgb, var(--accent) 50%, transparent);
}
.istep.ghost {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-base));
  border-color: color-mix(in srgb, var(--accent) 25%, var(--border-subtle));
}
.istep.playing { border-color: #fff !important; box-shadow: 0 0 8px #ffffffaa !important; }
.istep:hover:not(.lit):not(.ghost) {
  background: color-mix(in srgb, var(--accent) 20%, #1a1a32);
}
.istep.ghost:hover { opacity: 0.8; cursor: not-allowed; }

/* ── Loop button ─────────────────────────────────────────────────── */
.loop-btn {
  position: absolute; right: 3px; top: 50%; transform: translateY(-50%);
  width: 18px; height: 18px; border-radius: 3px;
  border: 1px solid var(--border-subtle); background: var(--bg-deeper); color: var(--text-muted);
  font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.1s; z-index: 5; flex-shrink: 0;
}
.loop-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }
.loop-btn.active {
  border-color: #4ecdc4; color: #4ecdc4; background: #041614;
  box-shadow: 0 0 5px #4ecdc455;
}

/* ── Mini piano-roll preview ─────────────────────────────────────── */
.mini-pr {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 2px; height: 28px;
  background: var(--bg-deeper); border: 1px solid var(--border-subtle);
  border-radius: 3px; cursor: pointer; position: relative;
  overflow: hidden; transition: border-color 0.1s;
}
.mini-pr:hover { border-color: #3a3a5a; }
.mini-pr-col {
  height: 100%; position: relative;
  border-right: 1px solid var(--bg-base); transition: background 0.05s;
}
.mini-pr-col.beat    { border-left: 1px solid var(--border-subtle); }
.mini-pr-col.playing { background: rgba(255,255,255,0.08); }
.mini-note {
  position: absolute; left: 1px; right: 1px; height: 3px;
  background: var(--accent); border-radius: 1px;
  box-shadow: 0 0 3px color-mix(in srgb, var(--accent) 60%, transparent);
}
.mini-pr-hint {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #252540; pointer-events: none;
}
.mini-pr:hover .mini-pr-hint { color: #4a4a6a; }

/* ── Multi-bar panoramic mini-pr ─────────────────────────────── */
.mini-pr-wide {
  flex: 1; height: 28px; position: relative;
  background: var(--bg-deeper); border: 1px solid var(--border-subtle);
  border-radius: 3px; cursor: pointer; overflow: hidden;
  transition: border-color 0.1s;
}
.mini-pr-wide:hover { border-color: #3a3a5a; }
/* Internal bar-boundary dividers */
.mini-bar-line {
  position: absolute; top: 0; bottom: 0; width: 1px;
  background: var(--border-subtle); pointer-events: none;
}
/* Playhead position indicator */
.mini-wide-head {
  position: absolute; top: 0; bottom: 0; width: 1px;
  background: rgba(255,255,255,0.55); pointer-events: none; z-index: 4;
}
/* Absolutely-placed note blocks */
.mini-note-wide {
  position: absolute; height: 3px;
  background: var(--accent); border-radius: 1px;
  box-shadow: 0 0 3px color-mix(in srgb, var(--accent) 60%, transparent);
  pointer-events: none;
}
/* Bar-count label (e.g. "4 BAR") */
.mini-pr-bars-label {
  position: absolute; top: 50%; right: 5px;
  transform: translateY(-50%);
  font-family: 'Share Tech Mono', monospace; font-size: 7px;
  font-weight: 700; letter-spacing: 0.14em; white-space: nowrap;
  color: #4ecdc488; pointer-events: none;
}

/* ── Graph Editor strip ──────────────────────────────────────────── */
.ge-strip {
  grid-column: 1 / -1;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-deeper);
}
.ge-tabs {
  display: flex; align-items: center; gap: 2px;
  padding: 3px 6px; background: var(--bg-deeper);
  border-bottom: 1px solid var(--border-subtle);
}
.ge-tab {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.12em; padding: 2px 7px;
  border: 1px solid var(--border-subtle); border-radius: 3px;
  background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.1s;
}
.ge-tab:hover { border-color: #3a3a5a; color: #7070a0; }
.ge-tab.active { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.ge-tabs-right { margin-left: auto; }
.ge-hint {
  font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #252540; letter-spacing: 0;
}

.ge-chart {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 1px; height: 52px;
  padding: 3px 4px; cursor: crosshair; user-select: none;
  background: var(--bg-deeper);
}
.ge-col {
  position: relative; display: flex; align-items: flex-end;
  border-right: 1px solid var(--bg-base); transition: background 0.05s;
}
.ge-col.beat { border-left: 1px solid var(--border-subtle); }
.ge-col.playing { background: rgba(255,255,255,0.05); }
.ge-col.lit .ge-bar { opacity: 1; }
.ge-col:not(.lit) .ge-bar { opacity: 0.45; }

.ge-bar-bg {
  position: absolute; inset: 0;
  background: var(--bg-control);
}
.ge-center-line {
  position: absolute; left: 0; right: 0; top: 50%;
  height: 1px; background: var(--border-subtle); z-index: 1;
}
.ge-bar {
  position: absolute; left: 1px; right: 1px;
  background: var(--accent);
  border-radius: 2px 2px 0 0;
  transition: height 0.05s, bottom 0.05s;
  z-index: 2;
  box-shadow: 0 0 4px color-mix(in srgb, var(--accent) 40%, transparent);
  min-height: 2px;
}

/* ── Empty state ─────────────────────────────────────────────────── */
.empty-state {
  padding: 20px; text-align: center;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; color: #303048;
}

/* ── Context menu ────────────────────────────────────────────────── */
.ctx-menu {
  position: fixed; z-index: 1000;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 4px 0; min-width: 170px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.7);
}
.ctx-item {
  padding: 7px 16px;
  font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 600;
  letter-spacing: 0.08em; color: #a0a0c0; cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.ctx-item:hover  { background: var(--bg-hover); color: var(--text-primary); }
.ctx-item.danger { color: #e74c3c44; }
.ctx-item.danger:hover { color: #e74c3c; background: #1a0a0a; }
.ctx-item.ctx-active { color: #4ecdc4; }
.ctx-check-mark {
  display: inline-block; width: 14px; font-size: 11px; color: #4ecdc4;
}
.ctx-sep { height: 1px; background: var(--border-subtle); margin: 3px 0; }

.ctx-sub-trigger {
  padding: 7px 16px;
  font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 600;
  letter-spacing: 0.08em; color: #a0a0c0; cursor: pointer;
  transition: background 0.1s, color 0.1s;
  position: relative;
}
.ctx-sub-trigger:hover { background: var(--bg-hover); color: var(--text-primary); }
.ctx-submenu {
  position: absolute; left: 100%; top: 0; z-index: 1100;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  min-width: 150px; padding: 4px 0;
  box-shadow: 0 8px 28px rgba(0,0,0,0.75);
}

/* ── Rename overlay ──────────────────────────────────────────────── */
.rename-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
}
.rename-box {
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 20px 24px; display: flex; flex-direction: column; gap: 10px;
  min-width: 280px; box-shadow: 0 12px 40px rgba(0,0,0,0.8);
}
.rename-label {
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.1em; color: #606080; text-transform: uppercase;
}
.rename-input {
  background: var(--bg-control); border: 1px solid var(--border); color: var(--text-primary);
  padding: 7px 10px; border-radius: 5px; font-family: 'Rajdhani', sans-serif;
  font-size: 16px; font-weight: 700; letter-spacing: 0.1em; outline: none;
}
.rename-input:focus { border-color: #4ecdc4; }
.rename-btns { display: flex; gap: 8px; justify-content: flex-end; }
.rename-ok {
  padding: 6px 18px; background: #4ecdc422; border: 1px solid #4ecdc4; color: #4ecdc4;
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif;
  font-size: 13px; font-weight: 700; transition: all 0.1s;
}
.rename-ok:hover { background: #4ecdc4; color: #000; }
.rename-cancel {
  padding: 6px 14px; background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 13px;
}
.rename-cancel:hover { border-color: #4a4a6a; color: #a0a0c0; }

/* ── Gradient dialog extra ───────────────────────────────────────── */
.gradient-box { min-width: 300px; }
.gradient-row {
  display: flex; align-items: center; gap: 12px;
}
.grad-label {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 600;
  letter-spacing: 0.1em; color: #606080; text-transform: uppercase;
}
.grad-color-input {
  width: 40px; height: 28px; border: 1px solid #3a3a5a;
  border-radius: 4px; background: transparent; cursor: pointer; padding: 1px;
}

/* ── Context menu section label ─────────────────────────────────── */
.ctx-section-label {
  padding: 4px 14px 2px;
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.14em; color: #555575; text-transform: uppercase;
  pointer-events: none;
}

/* ── Loop button colorful mode ──────────────────────────────────── */
.loop-btn.colorful { border-color: var(--ch-color, #4ecdc4); color: var(--ch-color, #4ecdc4); }

/* ── Rename+Color dialog ────────────────────────────────────────── */
.color-rename-box { min-width: 320px; }
.color-rename-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.color-rename-swatches {
  display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px;
}
.color-swatch {
  width: 20px; height: 20px; border-radius: 4px; cursor: pointer;
  border: 2px solid transparent; transition: border-color 0.1s, transform 0.1s;
  flex-shrink: 0;
}
.color-swatch:hover { transform: scale(1.2); }
.color-swatch.selected { border-color: #fff; }

/* ── Transpose dialog ───────────────────────────────────────────── */
.transpose-row {
  display: flex; align-items: center; gap: 8px;
}
.transpose-step {
  padding: 4px 12px; background: #2a2a3a; border: 1px solid var(--border);
  border-radius: 4px; color: var(--text-primary); cursor: pointer;
  font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 700;
  transition: background 0.1s;
}
.transpose-step:hover { background: #3a3a55; }
.transpose-val {
  flex: 1; text-align: center;
  font-family: 'Rajdhani', sans-serif; font-size: 22px; font-weight: 800;
  color: #4ecdc4; letter-spacing: 0.05em; min-width: 50px;
}
</style>
