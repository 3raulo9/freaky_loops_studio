<template>
  <div
    ref="rackEl"
    class="channel-rack"
    :class="{ 'rack-drop': dropActive }"
    @click="closeAllMenus"
    @dragenter.prevent="onSampleDragEnter"
    @dragover.prevent="onSampleDragOver"
    @dragleave="onSampleDragLeave"
    @drop.prevent="onSampleDrop"
  >
    <!-- Sample drop overlay -->
    <div v-if="dropActive" class="rack-drop-hint">＋ Drop sample to add a channel</div>

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
        <span class="kb-badge">⌨ Z–M · {{ kbOctave }}</span>
        <div class="add-synth-wrap" ref="synthPickerRef">
          <button class="add-ch-btn" @click.stop="showSynthPicker = !showSynthPicker" title="Add synth channel">
            + SYNTH ▾
          </button>
          <div v-if="showSynthPicker" class="synth-picker">
            <div class="synth-pick-section">BASIC</div>
            <div class="synth-pick-item" @click="addChannel(); showSynthPicker = false">
              <span class="synth-pick-dot" style="background:#4ecdc4"/>SYNTH (SAW)
            </div>
            <div class="synth-pick-section">FM SYNTHS</div>
            <div v-for="(preset, key) in FM_PRESETS" :key="key" class="synth-pick-item"
              @click="addFMChannel(key); showSynthPicker = false">
              <span class="synth-pick-dot" :style="{ background: preset.color }"/>{{ preset.name }}
            </div>
            <div class="synth-pick-section">PLUGINS</div>
            <div class="synth-pick-item" @click="addCustomSynthChannel(); showSynthPicker = false">
              <span class="synth-pick-dot" style="background:#00d4ff"/>◈ Custom Synth
            </div>
            <div class="synth-pick-item" @click="addSubterraChannel(); showSynthPicker = false">
              <span class="synth-pick-dot" style="background:#ff5a3c"/>▼ SUBTERRA Bass
            </div>
            <div class="synth-pick-item" @click="addWasmChannel(); showSynthPicker = false">
              <span class="synth-pick-dot" style="background:#7b2fff"/>⬡ WASM Plugin
            </div>
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
        class="channel-row"
        :class="{
          selected:       ch.id === selectedChannelId,
          'multi-sel':    selectedIds.has(ch.id),
          muted:          ch.muted,
          soloed:         ch._soloed,
          zipped:         ch.zipped,
          'ge-expanded':  graphEditorOpen && ch.id === selectedChannelId && !ch.zipped && ch.mode === 'steps',
        }"
        :style="{ '--accent': ch.color }"
        @click.exact="selectChannel(ch)"
        @click.ctrl.exact.stop="toggleMultiSelect(ch)"
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
              <div class="mini-pr" :style="{ '--cols': totalSteps }"
                @click="openOrSelectChannel(ch)" title="Click to open Piano Roll">
                <div v-for="s in totalSteps" :key="s-1" class="mini-pr-col"
                  :class="{
                    has:     channelHasNotesAtStep(ch, s-1),
                    playing: isPlaying && displayStep === s-1,
                    beat:    (s-1) % 4 === 0,
                  }">
                  <div v-for="note in notesAtStep(ch, s-1)" :key="`${note.step}-${note.pitch}`"
                    class="mini-note" :style="{ bottom: noteBottom(note.pitch) + '%' }" />
                </div>
                <span class="mini-pr-hint">PIANO ROLL</span>
              </div>
            </template>

            <!-- Loop toggle (overlaid on seq area) -->
            <button class="loop-btn" :class="{ active: ch.loopEnabled }"
              @click.stop="ch.loopEnabled = !ch.loopEnabled"
              :title="ch.loopEnabled ? 'Loop ON — click to disable' : 'Loop OFF — click to enable'">∞</button>
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
            <div class="ge-chart" @mousedown.prevent="startGeDrag($event, ch)">
              <div v-for="s in totalSteps" :key="s-1" class="ge-col"
                :class="{
                  beat:    (s-1) % 4 === 0,
                  lit:     getSteps(ch.id)[s-1],
                  playing: isPlaying && displayStep === s-1,
                }">
                <div class="ge-bar-bg"/>
                <!-- Center line for pan and pitch -->
                <div v-if="graphParam === 'pan' || graphParam === 'pitch'" class="ge-center-line"/>
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
      <div class="ctx-item" @click="ctxAction('rename')">Rename</div>
      <div class="ctx-item" @click="ctxAction('clone')">Clone</div>
      <div class="ctx-item" @click="ctxAction('clear')">Clear Pattern</div>
      <template v-if="ctxMenu.channel?.mode === 'steps'">
        <div class="ctx-sep"/>
        <div class="ctx-item" @click="ctxAction('shift-left')">Shift steps ◄</div>
        <div class="ctx-item" @click="ctxAction('shift-right')">Shift steps ►</div>
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
import { useStudio, FM_PRESETS } from '../store/studio.js'
import { getAsset } from '../browserLibrary.js'
import Knob from './Knob.vue'

const {
  channels, selectedChannelId, totalSteps, isPlaying, displayStep,
  pianoRollOpen, kbOctave,
  patterns, currentPatternId, getSteps, getPianoNotes,
  addPattern, removePattern, duplicatePattern,
  toggleStep, soloChannel, clearChannel, addChannel, addFMChannel, addWasmChannel, addCustomSynthChannel, addSubterraChannel, removeChannel, moveChannel,
  channelGroups, addGroup, removeGroup, renameGroup, assignChannelsToGroup,
  graphEditorOpen, graphParam,
  getStepVelocities, setStepVelocity, getStepPans, setStepPan, getStepPitches, setStepPitch,
  fillSteps, cloneChannel, sortChannelsBy, colorChannelsRandom, colorChannelsGradient,
  assignChannelToMixerTrack, mixerTracks,
  setCutSelf, splitByChannel, addSampleChannel,
  rotateSteps, invertSteps,
} = useStudio()

// ── Step-length layout reflow (stack into 2 rows when steps get too narrow) ────
const rackEl = ref(null)
const rackWidth = ref(1000)
const CONTROLS_W = 280            // name + mute + pan/vol + mixer columns (+ gaps)
const STEP_MIN_PX = 12            // legibility threshold per step button
const stepPx = computed(() => Math.max(2, (rackWidth.value - CONTROLS_W) / Math.max(1, totalSteps.value)))
const compactSteps = computed(() => stepPx.value < STEP_MIN_PX)
const stepCols = computed(() => compactSteps.value ? Math.ceil(totalSteps.value / 2) : totalSteps.value)
let _rackRO = null

// ── Sample drag-and-drop from the Browser ─────────────────────────────────────
const dropActive = ref(false)
let _dragDepth = 0
function _hasAsset(e) { return [...(e.dataTransfer?.types ?? [])].includes('application/x-fls-asset') }
function onSampleDragEnter(e) { if (!_hasAsset(e)) return; _dragDepth++; dropActive.value = true }
function onSampleDragOver(e)  { if (_hasAsset(e)) e.dataTransfer.dropEffect = 'copy' }
function onSampleDragLeave()  { if (--_dragDepth <= 0) { _dragDepth = 0; dropActive.value = false } }
function onSampleDrop(e) {
  _dragDepth = 0; dropActive.value = false
  const id = e.dataTransfer.getData('application/x-fls-asset')
  const asset = id && getAsset(id)
  if (asset) addSampleChannel(asset)
}

// ── Graph editor tabs ─────────────────────────────────────────────────────────
const GE_TABS = [
  { key: 'velocity', label: 'VEL' },
  { key: 'pan',      label: 'PAN' },
  { key: 'pitch',    label: 'PCH' },
  { key: 'release',  label: 'REL' },
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

function onDocClick() {
  showSynthPicker.value = false
  optionsOpen.value = false
  dfOpen.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  if (rackEl.value) {
    rackWidth.value = rackEl.value.clientWidth
    _rackRO = new ResizeObserver(es => { rackWidth.value = es[0].contentRect.width })
    _rackRO.observe(rackEl.value)
  }
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick, true)
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
function notesAtStep(ch, step) {
  return getPianoNotes(ch.id).filter(n => n.step === step)
}
function channelHasNotesAtStep(ch, step) {
  return getPianoNotes(ch.id).some(n => n.step === step)
}
function noteBottom(pitch) {
  return ((pitch - 36) / (84 - 36)) * 100
}

// ── Graph Editor ──────────────────────────────────────────────────────────────
function getGeBarHeight(chId, step) {
  switch (graphParam.value) {
    case 'velocity': return (getStepVelocities(chId)[step] ?? 0.8) * 100
    case 'release':  return (getStepVelocities(chId)[step] ?? 0.8) * 100
    case 'pan':      return Math.abs(getStepPans(chId)[step] ?? 0) * 50
    case 'pitch':    return Math.abs(getStepPitches(chId)[step] ?? 0) / 12 * 50
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
  return 0
}

function startGeDrag(e, ch) {
  const chart = e.currentTarget
  const doUpdate = (me) => {
    const rect = chart.getBoundingClientRect()
    const step = Math.max(0, Math.min(totalSteps.value - 1,
      Math.floor(((me.clientX - rect.left) / rect.width) * totalSteps.value)
    ))
    const relY = (me.clientY - rect.top) / rect.height
    switch (graphParam.value) {
      case 'velocity':
      case 'release':
        setStepVelocity(ch.id, step, Math.max(0, Math.min(1, 1 - relY)))
        break
      case 'pan':
        setStepPan(ch.id, step, Math.max(-1, Math.min(1, (0.5 - relY) * 2)))
        break
      case 'pitch':
        setStepPitch(ch.id, step, Math.round(Math.max(-12, Math.min(12, (0.5 - relY) * 24))))
        break
    }
  }
  doUpdate(e)
  const onMove = (me) => doUpdate(me)
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// ── Activity LED ──────────────────────────────────────────────────────────────
function isChannelFiring(ch) {
  if (!isPlaying.value || displayStep.value < 0 || ch.muted) return false
  if (ch.mode === 'steps') return !!getSteps(ch.id)[displayStep.value]
  return getPianoNotes(ch.id).some(n => n.step === displayStep.value)
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
  if (action === 'to-piano')  { ch.mode = 'piano'; openOrSelectChannel(ch) }
  if (action === 'to-steps')  { ch.mode = 'steps' }
  if (action === 'piano-roll')   openOrSelectChannel(ch)
  if (action === 'rename')       startRename(ch)
  if (action === 'clone')        cloneChannel(ch.id)
  if (action === 'clear')        clearChannel(ch.id)
  if (action === 'move-up')      moveChannel(ch.id, -1)
  if (action === 'move-down')    moveChannel(ch.id, +1)
  if (action === 'delete')       removeChannel(ch.id)
  if (action === 'zip')          ch.zipped = !ch.zipped
  if (action === 'color-random') colorChannelsRandom([ch.id])
  if (action === 'cut-self')     setCutSelf(ch.id, !ch.cutSelf)
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
.channel-rack.rack-drop { box-shadow: inset 0 0 0 2px #f1c40f; }
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
.synth-picker {
  position: absolute; right: 0; top: calc(100% + 5px); z-index: 2000;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 7px;
  padding: 5px 0; min-width: 170px;
  box-shadow: 0 10px 36px rgba(0,0,0,0.75);
  max-height: 340px; overflow-y: auto;
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
.synth-pick-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

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
</style>
