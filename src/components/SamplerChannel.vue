<template>
  <div class="smp" :class="{ 'smp-drag-over': isDragOver }"
    :style="{ '--accent': ch?.color || '#ff9f43' }"
    @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">

    <!-- ── Top bar ──────────────────────────────────────────────────────────── -->
    <div class="smp-topbar smp-strip">
      <button class="smp-icon-btn smp-load-btn"
        v-hint="'Load an audio file into this sampler (WAV · MP3 · OGG · FLAC · AIFF). You can also drag a file onto this panel.'"
        @click="fileInput?.click()" title="Load audio file">📂 LOAD</button>
      <span class="smp-filename" :title="ch.sampleName">{{ ch.sampleName || 'Drop audio file here…' }}</span>
      <span v-if="buf" class="smp-duration">{{ durationLabel }}</span>

      <span v-if="ch.audioFileMissing" class="smp-missing-badge">⚠ MISSING</span>

      <!-- Channel select -->
      <div class="smp-group"
        v-hint="'Waveform display channel — view the Left (L) or Right (R) side of a stereo sample. Does not change playback.'">
        <span class="smp-lbl">CH</span>
        <select class="smp-sel" v-model="displayChannel" title="Display channel">
          <option :value="0">L</option>
          <option v-if="isStereo" :value="1">R</option>
        </select>
      </div>

      <!-- Reverse toggle -->
      <button class="smp-mode-btn" :class="{ active: p.reverse }"
        v-hint="'Reverse — play the sample backwards.'"
        @click="p.reverse = !p.reverse" title="Reverse playback">REV</button>

      <!-- Loop mode -->
      <div class="smp-group"
        v-hint="'Loop mode — OFF: one-shot · FWD: forward loop · PING: ping-pong (plays forward then backward).'">
        <span class="smp-lbl">LOOP</span>
        <div class="smp-seg">
          <button v-for="m in LOOP_MODES" :key="m.v"
            :class="{ active: (p.loopMode ?? 'off') === m.v }"
            @click="p.loopMode = m.v">{{ m.l }}</button>
        </div>
      </div>

      <!-- Normalize -->
      <button class="smp-icon-btn" @click="onNormalize"
        v-hint="'Normalize — raise the whole sample so its loudest peak reaches 0 dBFS (maximum level without clipping).'"
        title="Normalize to 0 dBFS">NORM</button>

      <input ref="fileInput" type="file" accept=".wav,.mp3,.ogg,.flac,.aiff,.aif"
        style="display:none" @change="onFileInput" />
    </div>

    <!-- ── Warp bar (Ableton-style tempo follow) ──────────────────────────────── -->
    <div class="smp-warp-bar smp-strip">
      <button class="smp-mode-btn" :class="{ active: p.warpEnabled }"
        v-hint="'Warp — time-stretch the sample so it follows the project tempo. Pitch from the played note still applies.'"
        @click="setSamplerWarp(ch.id, { warpEnabled: !p.warpEnabled })"
        title="Stretch the sample to follow project tempo (pitch from the note still applies)">⟳ WARP</button>

      <div class="smp-group"
        v-hint="'Warp algorithm — Beats / Tones / Texture / Complex suit different material; Repitch changes speed and pitch together (no stretching).'">
        <span class="smp-lbl">MODE</span>
        <select class="smp-sel" :value="p.warpMode ?? 'complex'"
          @change="setSamplerWarp(ch.id, { warpMode: $event.target.value })" :disabled="!p.warpEnabled">
          <option v-for="m in WARP_MODES" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>

      <div class="smp-group"
        v-hint="'Original tempo of the sample in BPM — used to compute the stretch ratio. Press ⌕ to auto-detect.'">
        <span class="smp-lbl">BPM</span>
        <input type="number" class="smp-num" min="20" max="300" step="0.1"
          :value="p.sampleBpm ?? ''"
          @change="setSamplerWarp(ch.id, { sampleBpm: +$event.target.value || null })" />
        <button class="smp-icon-btn" title="Detect tempo from sample"
          v-hint="'Auto-detect the sample tempo by analysing its rhythmic onsets.'"
          @click="redetectSampleBpm(ch.id)">⌕</button>
      </div>

      <span v-if="p.warpEnabled && p.sampleBpm" class="smp-xfade-badge">
        ✓ {{ p.sampleBpm }} → {{ Math.round(projectBpm) }}
      </span>

      <template v-if="p.warpEnabled">
        <span class="smp-warp-hint" v-hint="'Warp markers — double-click the waveform to pin a point to a beat; drag to move; double-click a marker to delete. With 2+ markers each region stretches independently.'">
          dbl-click wave = marker
        </span>
        <button v-if="(p.warpMarkers ?? []).length" class="smp-icon-btn"
          @click="clearSampleWarpMarkers(ch.id)" title="Clear all warp markers">CLR {{ (p.warpMarkers ?? []).length }}</button>
      </template>
    </div>

    <!-- ── Waveform ─────────────────────────────────────────────────────────── -->
    <div class="smp-wave-wrap" ref="waveWrap"
      :class="{ 'smp-wave-warpedit': p.warpEnabled }"
      @dblclick="onWaveDblClick">
      <canvas ref="canvas" class="smp-canvas" />

      <!-- Warp markers (when warp is enabled): drag to pin a sample position to a beat -->
      <template v-if="p.warpEnabled">
        <div v-for="(wm, wi) in (p.warpMarkers ?? [])" :key="'wm' + wi"
          class="smp-warp-marker"
          :style="{ left: wm.pos * 100 + '%' }"
          :title="'Beat ' + wm.beat + ' — drag to move, double-click to remove'"
          @mousedown.stop.prevent="startMarkerDrag(wi, $event)"
          @dblclick.stop.prevent="removeSampleWarpMarker(ch.id, wi)">
          <span class="smp-warp-marker-lbl">{{ wm.beat }}</span>
        </div>
      </template>

      <!-- Start handle -->
      <div class="smp-handle smp-handle-start"
        :style="{ left: (p.startOffset ?? 0) * 100 + '%' }"
        v-hint="'Sample start — drag to set where playback begins.'"
        title="Start" @mousedown.stop.prevent="startDrag('startOffset', $event)" />

      <!-- End handle -->
      <div class="smp-handle smp-handle-end"
        :style="{ left: (p.endOffset ?? 1) * 100 + '%' }"
        v-hint="'Sample end — drag to set where playback stops.'"
        title="End" @mousedown.stop.prevent="startDrag('endOffset', $event)" />

      <!-- Loop region -->
      <template v-if="p.loopMode === 'fwd'">
        <div class="smp-loop-region"
          :style="{ left: (p.loopStart ?? 0) * 100 + '%', width: Math.max(0, ((p.loopEnd ?? 1) - (p.loopStart ?? 0))) * 100 + '%' }" />
        <div class="smp-handle smp-handle-loop-s"
          :style="{ left: (p.loopStart ?? 0) * 100 + '%' }"
          v-hint="'Loop start — drag to set the point the loop returns to.'"
          title="Loop start" @mousedown.stop.prevent="startDrag('loopStart', $event)" />
        <div class="smp-handle smp-handle-loop-e"
          :style="{ left: (p.loopEnd ?? 1) * 100 + '%' }"
          v-hint="'Loop end — drag to set where the loop wraps back to the loop start.'"
          title="Loop end" @mousedown.stop.prevent="startDrag('loopEnd', $event)" />
      </template>
    </div>

    <!-- ── Loop tools (FWD only) ────────────────────────────────────────────── -->
    <div v-if="p.loopMode === 'fwd'" class="smp-loop-tools smp-strip">
      <span class="smp-lbl">XFADE</span>
      <input type="range" class="smp-slider" min="0" max="0.5" step="0.001"
        v-hint="'Loop crossfade — overlap the loop end with its start to remove the click at the loop seam. Press BUILD to apply.'"
        :value="p.loopXfade ?? 0" @input="p.loopXfade = +$event.target.value" />
      <span class="smp-val">{{ Math.round((p.loopXfade ?? 0) * 100) }}%</span>
      <button class="smp-icon-btn smp-build-btn"
        v-hint="'Pre-compute the crossfaded loop buffer for seamless, click-free looping.'"
        @click="doBuildXfade" title="Pre-compute seamless crossfade for loop">BUILD</button>
      <span class="smp-loop-snap-lbl">SNAP:</span>
      <button class="smp-icon-btn"
        v-hint="'Snap the loop start to the nearest zero crossing (removes clicks).'"
        title="Snap loop start to nearest zero crossing" @click="doSnap('loopStart')">⊢ LS</button>
      <button class="smp-icon-btn"
        v-hint="'Snap the loop end to the nearest zero crossing (removes clicks).'"
        title="Snap loop end to nearest zero crossing" @click="doSnap('loopEnd')">LE ⊣</button>
      <button class="smp-icon-btn"
        v-hint="'Snap the sample start to the nearest zero crossing.'"
        title="Snap sample start to nearest zero crossing" @click="doSnap('startOffset')">⊢ S</button>
      <button class="smp-icon-btn"
        v-hint="'Snap the sample end to the nearest zero crossing.'"
        title="Snap sample end to nearest zero crossing" @click="doSnap('endOffset')">E ⊣</button>
      <span v-if="hasXfade" class="smp-xfade-badge">✓ XFADE READY</span>
    </div>

    <!-- ── Audition keyboard (click a key to hear the sample with current settings) ── -->
    <div class="smp-kbd-bar">
      <div class="smp-kbd-side">
        <span class="smp-lbl">PLAY</span>
        <button class="smp-icon-btn smp-oct-btn" @click="shiftOct(-1)" :disabled="kbOctave <= 0"
          v-hint="'Shift the preview keyboard down one octave.'" title="Octave down">◀</button>
        <span class="smp-kbd-oct">C{{ kbOctave }}</span>
        <button class="smp-icon-btn smp-oct-btn" @click="shiftOct(1)" :disabled="kbOctave >= 7"
          v-hint="'Shift the preview keyboard up one octave.'" title="Octave up">▶</button>
        <button class="smp-mode-btn" :class="{ active: kbHold }" @click="toggleHold"
          v-hint="'HOLD — clicked keys keep sounding so you can drag the sliders and hear the change live. Click a lit key (or turn HOLD off) to stop it.'"
          title="Latch notes so you can tweak while they sound">HOLD</button>
      </div>
      <div class="smp-kbd" ref="kbdEl" @mouseleave="onKbdLeave"
        v-hint="'Click a key to audition the sample at that pitch with your current settings. Drag across keys to glide; enable HOLD to keep notes sounding while you tweak.'">
        <div class="smp-kbd-whites">
          <div v-for="k in whiteKeys" :key="k.midi" class="smp-key smp-key-w"
            :class="{ active: isKeyOn(k.midi), root: k.midi === (p.rootNote ?? 60) }"
            @mousedown.prevent="keyDown(k.midi)" @mouseenter="keyEnter(k.midi)" @mouseup="keyUp(k.midi)">
            <span v-if="k.label" class="smp-key-lbl">{{ k.label }}</span>
          </div>
        </div>
        <div class="smp-kbd-blacks">
          <div v-for="k in blackKeys" :key="k.midi" class="smp-key smp-key-b"
            :class="{ active: isKeyOn(k.midi) }"
            :style="{ left: k.leftPct + '%', width: k.widthPct + '%' }"
            @mousedown.prevent.stop="keyDown(k.midi)" @mouseenter="keyEnter(k.midi)" @mouseup.stop="keyUp(k.midi)" />
        </div>
      </div>
    </div>

    <!-- ── Main controls ────────────────────────────────────────────────────── -->
    <div class="smp-controls">

      <!-- COL 1: Tuning + velocity ──────────────────────────────────────── -->
      <div class="smp-col">
        <div class="smp-col-header">TUNING</div>

        <div class="smp-row"
          v-hint="'Root note — the MIDI note at which the sample plays back at its original, un-transposed pitch.'">
          <span class="smp-lbl">ROOT</span>
          <input type="number" class="smp-num" v-model.number="p.rootNote"
            min="0" max="127" @change="clampRoot" />
          <span class="smp-note-name">{{ noteLabel(p.rootNote ?? 60) }}</span>
        </div>

        <div class="smp-row"
          v-hint="'Fine tune — pitch offset in cents (±100 cents = one semitone).'">
          <span class="smp-lbl">FINE</span>
          <input type="range" class="smp-slider" min="-100" max="100" step="1"
            :value="p.fineTune ?? 0" @input="p.fineTune = +$event.target.value" />
          <span class="smp-val">{{ fineTuneLabel }}</span>
        </div>

        <div class="smp-row"
          v-hint="'Key tracking — how much the played note transposes the sample. 100% = fully chromatic, 0% = fixed pitch regardless of note.'">
          <span class="smp-lbl">TRACK</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.keyTrack ?? 1" @input="p.keyTrack = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.keyTrack ?? 1) * 100) }}%</span>
        </div>

        <div class="smp-row"
          v-hint="'Velocity sensitivity — how strongly note velocity controls the sample volume. 0% = velocity ignored.'">
          <span class="smp-lbl">VEL</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.velSens ?? 1" @input="p.velSens = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.velSens ?? 1) * 100) }}%</span>
        </div>
      </div>

      <!-- COL 2: Amplitude ADSR ─────────────────────────────────────────── -->
      <div class="smp-col">
        <div class="smp-col-header">AMPLITUDE</div>

        <div class="smp-adsr-vis">
          <svg :viewBox="`0 0 ${ADSR_W} ${ADSR_H}`" preserveAspectRatio="none">
            <polyline :points="adsrPoints" fill="none"
              :stroke="ch.color ?? '#ff9f43'" stroke-width="1.5" stroke-linejoin="round" />
            <polyline :points="adsrPoints"
              :fill="(ch.color ?? '#ff9f43') + '28'" stroke="none" />
          </svg>
        </div>

        <div class="smp-row"
          v-hint="'Delay — wait this long after the note starts before the amplitude envelope begins.'">
          <span class="smp-lbl">DEL</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.001"
            :value="p.envDelay ?? 0" @input="p.envDelay = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.envDelay ?? 0) }}</span>
        </div>

        <div class="smp-row"
          v-hint="'Attack — time for the volume to fade in from silence up to full level.'">
          <span class="smp-lbl">ATK</span>
          <input type="range" class="smp-slider" min="0.001" max="2" step="0.001"
            :value="p.envAttack ?? 0.005" @input="p.envAttack = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.envAttack ?? 0.005) }}</span>
        </div>

        <div class="smp-row smp-row-curve"
          v-hint="'Attack curve — bends the attack ramp from exponential (slow start) to logarithmic (fast start).'">
          <span class="smp-lbl">┗ CRV</span>
          <input type="range" class="smp-slider" min="-1" max="1" step="0.01"
            :value="p.envAttackCurve ?? 0" @input="p.envAttackCurve = +$event.target.value" />
          <span class="smp-val smp-crv-val">{{ curveLabel(p.envAttackCurve ?? 0) }}</span>
        </div>

        <div class="smp-row"
          v-hint="'Decay — time for the volume to fall from the attack peak down to the sustain level.'">
          <span class="smp-lbl">DCY</span>
          <input type="range" class="smp-slider" min="0.001" max="3" step="0.001"
            :value="p.envDecay ?? 0.1" @input="p.envDecay = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.envDecay ?? 0.1) }}</span>
        </div>

        <div class="smp-row smp-row-curve"
          v-hint="'Decay curve — bends the decay ramp from exponential to logarithmic.'">
          <span class="smp-lbl">┗ CRV</span>
          <input type="range" class="smp-slider" min="-1" max="1" step="0.01"
            :value="p.envDecayCurve ?? -0.5" @input="p.envDecayCurve = +$event.target.value" />
          <span class="smp-val smp-crv-val">{{ curveLabel(p.envDecayCurve ?? -0.5) }}</span>
        </div>

        <div class="smp-row"
          v-hint="'Sustain — the held volume level after decay, for as long as the note stays on.'">
          <span class="smp-lbl">SUS</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.envSustain ?? 0.8" @input="p.envSustain = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.envSustain ?? 0.8) * 100) }}%</span>
        </div>

        <div class="smp-row"
          v-hint="'Release — time for the volume to fade out to silence after the note is released.'">
          <span class="smp-lbl">REL</span>
          <input type="range" class="smp-slider" min="0.001" max="5" step="0.001"
            :value="p.envRelease ?? 0.2" @input="p.envRelease = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.envRelease ?? 0.2) }}</span>
        </div>

        <div class="smp-row smp-row-curve"
          v-hint="'Release curve — bends the release ramp from exponential to logarithmic.'">
          <span class="smp-lbl">┗ CRV</span>
          <input type="range" class="smp-slider" min="-1" max="1" step="0.01"
            :value="p.envReleaseCurve ?? -0.5" @input="p.envReleaseCurve = +$event.target.value" />
          <span class="smp-val smp-crv-val">{{ curveLabel(p.envReleaseCurve ?? -0.5) }}</span>
        </div>
      </div>

      <!-- COL 3: Filter ─────────────────────────────────────────────────── -->
      <div class="smp-col">
        <div class="smp-col-header">FILTER</div>

        <div class="smp-row"
          v-hint="'Filter type — Off · LP (low-pass) · HP (high-pass) · BP (band-pass) · NT (notch).'">
          <span class="smp-lbl">TYPE</span>
          <div class="smp-seg smp-seg-sm">
            <button v-for="ft in FILTER_TYPES" :key="ft.v"
              :class="{ active: (p.filterType ?? 'off') === ft.v }"
              @click="p.filterType = ft.v">{{ ft.l }}</button>
          </div>
        </div>

        <div class="smp-row"
          v-hint="'Cutoff — the corner frequency of the filter.'">
          <span class="smp-lbl">FREQ</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.001"
            :value="p.filterCutoff ?? 1" @input="p.filterCutoff = +$event.target.value" />
          <span class="smp-val">{{ freqLabel(p.filterCutoff ?? 1) }}</span>
        </div>

        <div class="smp-row"
          v-hint="'Resonance — emphasis (peak) at the cutoff frequency. High values can self-oscillate.'">
          <span class="smp-lbl">RESO</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.filterReso ?? 0" @input="p.filterReso = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.filterReso ?? 0) * 100) }}%</span>
        </div>

        <div class="smp-col-header smp-col-header-sub">FILTER ENV</div>

        <div class="smp-row"
          v-hint="'Filter envelope amount — how far the envelope sweeps the cutoff. Negative values invert the sweep.'">
          <span class="smp-lbl">AMT</span>
          <input type="range" class="smp-slider" min="-1" max="1" step="0.01"
            :value="p.fEnvAmount ?? 0" @input="p.fEnvAmount = +$event.target.value" />
          <span class="smp-val">{{ fenvAmtLabel }}</span>
        </div>

        <div class="smp-row"
          v-hint="'Filter envelope attack — time for the cutoff sweep to reach its peak.'">
          <span class="smp-lbl">ATK</span>
          <input type="range" class="smp-slider" min="0.001" max="2" step="0.001"
            :value="p.fEnvAttack ?? 0.01" @input="p.fEnvAttack = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.fEnvAttack ?? 0.01) }}</span>
        </div>

        <div class="smp-row"
          v-hint="'Filter envelope decay — time for the cutoff to fall from peak to its sustain level.'">
          <span class="smp-lbl">DCY</span>
          <input type="range" class="smp-slider" min="0.001" max="3" step="0.001"
            :value="p.fEnvDecay ?? 0.2" @input="p.fEnvDecay = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.fEnvDecay ?? 0.2) }}</span>
        </div>

        <div class="smp-row"
          v-hint="'Filter envelope sustain — the held cutoff offset while the note is on.'">
          <span class="smp-lbl">SUS</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.fEnvSustain ?? 0" @input="p.fEnvSustain = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.fEnvSustain ?? 0) * 100) }}%</span>
        </div>
      </div>

      <!-- COL 4: Modulation (engine + pitch env + LFOs) ─────────────────── -->
      <div class="smp-col">
        <div class="smp-col-header">ENGINE</div>
        <div class="smp-row"
          v-hint="'Playback engine — Classic plays the sample normally; Granular plays a cloud of overlapping grains for pads/textures (pitch and time independent).'">
          <span class="smp-lbl">MODE</span>
          <select class="smp-sel" :value="p.playMode ?? 'classic'" @change="p.playMode = $event.target.value">
            <option value="classic">Classic</option>
            <option value="granular">Granular</option>
          </select>
        </div>
        <template v-if="(p.playMode ?? 'classic') === 'granular'">
          <div class="smp-row"
            v-hint="'Grain size — length of each grain. Smaller = grainier/buzzier, larger = smoother.'">
            <span class="smp-lbl">GRAIN</span>
            <input type="range" class="smp-slider" min="0.01" max="0.5" step="0.005"
              :value="p.grainSize ?? 0.08" @input="p.grainSize = +$event.target.value" />
            <span class="smp-val">{{ msLabel(p.grainSize ?? 0.08) }}</span>
          </div>
          <div class="smp-row"
            v-hint="'Scan — position in the sample the grain cloud is drawn from (0 = start, 100% = end).'">
            <span class="smp-lbl">SCAN</span>
            <input type="range" class="smp-slider" min="0" max="1" step="0.01"
              :value="p.grainScan ?? 0.5" @input="p.grainScan = +$event.target.value" />
            <span class="smp-val">{{ Math.round((p.grainScan ?? 0.5) * 100) }}%</span>
          </div>
        </template>

        <div class="smp-col-header smp-col-header-sub">PITCH ENV</div>
        <div class="smp-row"
          v-hint="'Pitch envelope amount — initial pitch offset in semitones (±24) that sweeps back to the note pitch.'">
          <span class="smp-lbl">AMT</span>
          <input type="range" class="smp-slider" min="-24" max="24" step="1"
            :value="p.pEnvAmount ?? 0" @input="p.pEnvAmount = +$event.target.value" />
          <span class="smp-val">{{ (p.pEnvAmount ?? 0) > 0 ? '+' : '' }}{{ p.pEnvAmount ?? 0 }}st</span>
        </div>
        <div class="smp-row"
          v-hint="'Pitch envelope attack — time for the pitch to ramp toward its starting offset.'">
          <span class="smp-lbl">ATK</span>
          <input type="range" class="smp-slider" min="0.001" max="1" step="0.001"
            :value="p.pEnvAttack ?? 0.002" @input="p.pEnvAttack = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.pEnvAttack ?? 0.002) }}</span>
        </div>
        <div class="smp-row"
          v-hint="'Pitch envelope decay — time for the pitch to settle back to the played note.'">
          <span class="smp-lbl">DCY</span>
          <input type="range" class="smp-slider" min="0.001" max="3" step="0.001"
            :value="p.pEnvDecay ?? 0.15" @input="p.pEnvDecay = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.pEnvDecay ?? 0.15) }}</span>
        </div>

        <div class="smp-col-header smp-col-header-sub">LFO</div>
        <div class="smp-row"
          v-hint="'LFO destination — which parameter the LFO modulates: Pitch, Filter cutoff, Volume or Pan.'">
          <span class="smp-lbl">DEST</span>
          <select class="smp-sel" :value="p.lfoDest ?? 'off'" @change="p.lfoDest = $event.target.value">
            <option value="off">Off</option>
            <option value="pitch">Pitch</option>
            <option value="filter">Filter</option>
            <option value="volume">Volume</option>
            <option value="pan">Pan</option>
          </select>
        </div>
        <div class="smp-row"
          v-hint="'LFO rate — speed of the modulation oscillator in Hz.'">
          <span class="smp-lbl">RATE</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.lfoRate ?? 0.3" @input="p.lfoRate = +$event.target.value" />
          <span class="smp-val">{{ lfoRateLabel }}</span>
        </div>
        <div class="smp-row"
          v-hint="'LFO depth — how much the LFO modulates the chosen destination. 0% = no modulation.'">
          <span class="smp-lbl">DEPTH</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.lfoDepth ?? 0" @input="p.lfoDepth = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.lfoDepth ?? 0) * 100) }}%</span>
        </div>
        <div class="smp-row"
          v-hint="'LFO shape — the modulation waveform: Sine, Triangle, Square or Saw.'">
          <span class="smp-lbl">SHAPE</span>
          <select class="smp-sel" :value="p.lfoShape ?? 'sine'" @change="p.lfoShape = $event.target.value">
            <option value="sine">Sine</option>
            <option value="triangle">Tri</option>
            <option value="square">Square</option>
            <option value="sawtooth">Saw</option>
          </select>
        </div>

        <div class="smp-col-header smp-col-header-sub">LFO 2</div>
        <div class="smp-row"
          v-hint="'LFO 2 destination — a second independent modulator (Pitch, Filter, Volume or Pan).'">
          <span class="smp-lbl">DEST</span>
          <select class="smp-sel" :value="p.lfo2Dest ?? 'off'" @change="p.lfo2Dest = $event.target.value">
            <option value="off">Off</option>
            <option value="pitch">Pitch</option>
            <option value="filter">Filter</option>
            <option value="volume">Volume</option>
            <option value="pan">Pan</option>
          </select>
        </div>
        <div class="smp-row" v-hint="'LFO 2 rate in Hz.'">
          <span class="smp-lbl">RATE</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.lfo2Rate ?? 0.2" @input="p.lfo2Rate = +$event.target.value" />
          <span class="smp-val">{{ (0.05 + (p.lfo2Rate ?? 0.2) * 14).toFixed(1) }}Hz</span>
        </div>
        <div class="smp-row" v-hint="'LFO 2 depth — 0% = no modulation.'">
          <span class="smp-lbl">DEPTH</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.lfo2Depth ?? 0" @input="p.lfo2Depth = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.lfo2Depth ?? 0) * 100) }}%</span>
        </div>
        <div class="smp-row" v-hint="'LFO 2 shape.'">
          <span class="smp-lbl">SHAPE</span>
          <select class="smp-sel" :value="p.lfo2Shape ?? 'triangle'" @change="p.lfo2Shape = $event.target.value">
            <option value="sine">Sine</option>
            <option value="triangle">Tri</option>
            <option value="square">Square</option>
            <option value="sawtooth">Saw</option>
          </select>
        </div>
      </div>

    </div>

    <!-- ── Multisample zones (velocity layers / key zones / round-robin) ──────── -->
    <div class="smp-zones">
      <div class="smp-zones-head">
        <span class="smp-col-header">ZONES <span v-if="zones.length" class="smp-zone-count">{{ zones.length }}</span></span>
        <button class="smp-icon-btn" @click="zoneFileInput?.click()"
          v-hint="'Add a sample mapped to its own key & velocity range (multisampling). Zones with equal ranges round-robin between hits.'"
          title="Add a sample as a new zone">+ ADD ZONE</button>
        <span class="smp-zone-hint">Map files to key + velocity ranges; equal matches round-robin.</span>
        <input ref="zoneFileInput" type="file" accept=".wav,.mp3,.ogg,.flac,.aiff,.aif"
          style="display:none" @change="onZoneFileInput" />
      </div>

      <div v-if="zones.length" class="smp-zone-table">
        <div class="smp-zone-row smp-zone-row-head">
          <span class="smp-zc-name">NAME</span>
          <span class="smp-zc" v-hint="'Root note of this zone — where it plays at its original pitch.'">ROOT</span>
          <span class="smp-zc" v-hint="'Lowest MIDI key that triggers this zone.'">LO KEY</span>
          <span class="smp-zc" v-hint="'Highest MIDI key that triggers this zone.'">HI KEY</span>
          <span class="smp-zc" v-hint="'Lowest velocity (0–127) that triggers this zone.'">LO VEL</span>
          <span class="smp-zc" v-hint="'Highest velocity (0–127) that triggers this zone.'">HI VEL</span>
          <span class="smp-zc-x"></span>
        </div>
        <div v-for="z in zones" :key="z.id" class="smp-zone-row">
          <span class="smp-zc-name" :title="z.name">{{ z.name }}</span>
          <input class="smp-zc-num" type="number" min="0" max="127" :value="z.rootNote"
            @change="updateSamplerZone(ch.id, z.id, { rootNote: clampMidi($event.target.value) })" />
          <input class="smp-zc-num" type="number" min="0" max="127" :value="z.loKey"
            @change="updateSamplerZone(ch.id, z.id, { loKey: clampMidi($event.target.value) })" />
          <input class="smp-zc-num" type="number" min="0" max="127" :value="z.hiKey"
            @change="updateSamplerZone(ch.id, z.id, { hiKey: clampMidi($event.target.value) })" />
          <input class="smp-zc-num" type="number" min="0" max="127" :value="z.loVel"
            @change="updateSamplerZone(ch.id, z.id, { loVel: clampMidi($event.target.value) })" />
          <input class="smp-zc-num" type="number" min="0" max="127" :value="z.hiVel"
            @change="updateSamplerZone(ch.id, z.id, { hiVel: clampMidi($event.target.value) })" />
          <button class="smp-zc-del" @click="removeSamplerZone(ch.id, z.id)" title="Remove zone">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useStudio } from '../store/studio.js'

const props = defineProps({ channel: Object })

const { loadAudioFileForChannel, getAudioFileBuf, audioFileVersions, normalizeAudioFile, buildLoopXfade, snapToZero,
        setSamplerWarp, redetectSampleBpm, WARP_MODES, bpm,
        addSampleWarpMarker, updateSampleWarpMarker, removeSampleWarpMarker, clearSampleWarpMarkers,
        getSamplerZones, addSamplerZone, removeSamplerZone, updateSamplerZone,
        auditionNoteOn, auditionNoteOff } = useStudio()

const projectBpm = computed(() => bpm.value)
const zoneFileInput = ref(null)
const zones = computed(() => { void audioFileVersions[ch.value?.id]; return getSamplerZones(ch.value?.id) })

const lfoRateLabel = computed(() => {
  const hz = 0.05 + (p.value.lfoRate ?? 0.3) * 14
  return hz.toFixed(1) + 'Hz'
})

function clampMidi(v) { return Math.max(0, Math.min(127, Math.round(+v || 0))) }

async function onZoneFileInput(e) {
  const file = e.target.files?.[0]; e.target.value = ''
  if (file && ch.value) await addSamplerZone(ch.value.id, file)
}

// ── Constants ──────────────────────────────────────────────────────────────────
const LOOP_MODES   = [{ v: 'off', l: 'OFF' }, { v: 'fwd', l: 'FWD' }, { v: 'pingpong', l: 'PING' }]
const FILTER_TYPES = [{ v: 'off', l: 'OFF' }, { v: 'lowpass', l: 'LP' }, { v: 'highpass', l: 'HP' }, { v: 'bandpass', l: 'BP' }, { v: 'notch', l: 'NT' }]
const NOTE_NAMES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const ADSR_W = 120, ADSR_H = 36

// ── Refs ───────────────────────────────────────────────────────────────────────
const canvas       = ref(null)
const waveWrap     = ref(null)
const fileInput    = ref(null)
const isDragOver   = ref(false)
const displayChannel = ref(0)

// ── Convenience accessors ──────────────────────────────────────────────────────
const ch = computed(() => props.channel)
const p  = computed(() => ch.value?.params ?? {})

const buf = computed(() => {
  const id = ch.value?.id
  if (!id) return null
  void audioFileVersions[id]
  return getAudioFileBuf(id)
})

const isStereo = computed(() => (buf.value?.numberOfChannels ?? 0) > 1)

// ── Audition keyboard ───────────────────────────────────────────────────────────
//  A clickable mini-piano that plays THIS sampler with its current settings, so
//  edits can be heard live. HOLD latches notes (great for looping samples) so the
//  sound keeps going while sliders are dragged.
const KB_WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11]
const kbdEl       = ref(null)
const kbOctave    = ref(3)            // base octave; two octaves are shown
const kbHold      = ref(false)
const activeNotes = ref([])           // midi notes currently sounding (for highlight)
let   kbMouseDown = false

const whiteKeys = computed(() => {
  const out = []
  for (let o = 0; o < 2; o++) {
    const oct = kbOctave.value + o
    for (const s of KB_WHITE_SEMIS) {
      const midi = 12 * (oct + 1) + s
      if (midi > 127) break
      out.push({ midi, label: midi % 12 === 0 ? noteLabel(midi) : '' })
    }
  }
  return out
})

const blackKeys = computed(() => {
  const whites = whiteKeys.value
  const n = whites.length
  if (!n) return []
  const w = 100 / n
  const out = []
  whites.forEach((k, i) => {
    const semi = k.midi % 12
    // A black key follows C, D, F, G, A (not E or B).
    if (i < n - 1 && [0, 2, 5, 7, 9].includes(semi) && k.midi + 1 <= 127)
      out.push({ midi: k.midi + 1, leftPct: (i + 1) * w, widthPct: w * 0.62 })
  })
  return out
})

function isKeyOn(midi) { return activeNotes.value.includes(midi) }

function _on(midi) {
  if (!ch.value) return
  auditionNoteOn(ch.value.id, midi)
  if (!activeNotes.value.includes(midi)) activeNotes.value = [...activeNotes.value, midi]
}
function _off(midi) {
  if (ch.value) auditionNoteOff(ch.value.id, midi)
  activeNotes.value = activeNotes.value.filter(m => m !== midi)
}
function releaseAll() {
  if (ch.value) for (const m of activeNotes.value) auditionNoteOff(ch.value.id, m)
  activeNotes.value = []
  kbMouseDown = false
}
function keyDown(midi) {
  if (kbHold.value) { isKeyOn(midi) ? _off(midi) : _on(midi) }
  else              { kbMouseDown = true; _on(midi) }
}
function keyEnter(midi) {            // drag-glide across keys (momentary mode only)
  if (!kbMouseDown || kbHold.value) return
  if (ch.value) for (const m of activeNotes.value) if (m !== midi) auditionNoteOff(ch.value.id, m)
  activeNotes.value = []
  _on(midi)
}
function keyUp(midi)   { if (!kbHold.value) _off(midi) }
function onKbdLeave()  { if (kbMouseDown && !kbHold.value) releaseAll() }
function shiftOct(d)   { kbOctave.value = Math.max(0, Math.min(7, kbOctave.value + d)) }
function toggleHold()  { kbHold.value = !kbHold.value; if (!kbHold.value) releaseAll() }
function onWinMouseUp() { if (kbMouseDown) { kbMouseDown = false; if (!kbHold.value) releaseAll() } }

// Switching channels: release the OUTGOING channel's notes (store voices are
// keyed by channel id, so we must use the previous id, not the new one).
watch(() => ch.value?.id, (_newId, oldId) => {
  if (oldId) for (const m of activeNotes.value) auditionNoteOff(oldId, m)
  activeNotes.value = []
  kbMouseDown = false
})

// ── Label helpers ──────────────────────────────────────────────────────────────
function noteLabel(midi) {
  const m = Math.max(0, Math.min(127, Math.round(midi)))
  return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1)
}

function msLabel(sec) {
  const ms = sec * 1000
  return ms < 1000 ? Math.round(ms) + 'ms' : sec.toFixed(2) + 's'
}

function freqLabel(norm) {
  const hz = 20 * Math.pow(2, Math.log2(20000 / 20) * Math.max(0, Math.min(1, norm)))
  return hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : Math.round(hz) + 'Hz'
}

const durationLabel = computed(() => {
  const d = buf.value?.duration
  if (d == null) return ''
  return d < 1 ? Math.round(d * 1000) + ' ms' : d.toFixed(2) + ' s'
})

const fineTuneLabel = computed(() => {
  const c = p.value.fineTune ?? 0
  return (c > 0 ? '+' : '') + c + 'ct'
})

const fenvAmtLabel = computed(() => {
  const a = p.value.fEnvAmount ?? 0
  const oct = (a * 4).toFixed(1)
  return (a > 0 ? '+' : '') + oct + 'o'
})

function curveLabel(v) {
  if (v < -0.6) return 'EXP'
  if (v > 0.6)  return 'LOG'
  if (Math.abs(v) < 0.12) return 'LIN'
  return v < 0 ? 'exp' : 'log'
}

// Whether a precomputed xfade buffer exists for the current channel
const hasXfade = computed(() => {
  const id = ch.value?.id
  if (!id) return false
  void audioFileVersions[id]  // reactive dependency
  // We can only know indirectly — if loopXfade > 0 and buf exists, treat as "ready after BUILD"
  return (p.value.loopXfade ?? 0) > 0.001 && !!buf.value
})

// ── ADSR visualizer (includes DEL stage) ──────────────────────────────────────
const adsrPoints = computed(() => {
  const del = Math.max(0,     p.value.envDelay   ?? 0)
  const atk = Math.max(0.001, p.value.envAttack  ?? 0.005)
  const dec = Math.max(0.001, p.value.envDecay   ?? 0.1)
  const sus = Math.max(0,     p.value.envSustain ?? 0.8)
  const rel = Math.max(0.001, p.value.envRelease ?? 0.2)
  const sus_hold = Math.max(0.1, (atk + dec) * 0.5)
  const total = del + atk + dec + sus_hold + rel
  const W = ADSR_W, H = ADSR_H
  const t = v => (v / total) * (W - 4) + 2
  const a = v => H - 2 - v * (H - 4)
  const pts = [
    `${t(0)},${a(0)}`,
    `${t(del)},${a(0)}`,           // delay hold at 0
    `${t(del + atk)},${a(1)}`,    // attack peak
    `${t(del + atk + dec)},${a(sus)}`,   // decay to sustain
    `${t(del + atk + dec + sus_hold)},${a(sus)}`,  // sustain hold
    `${t(total)},${a(0)}`,         // release to 0
    `${t(0)},${a(0)}`,             // close for fill
  ]
  return pts.join(' ')
})

// ── Waveform drawing ───────────────────────────────────────────────────────────
function drawWaveform() {
  const cvs = canvas.value
  if (!cvs) return
  const wrap = waveWrap.value
  cvs.width  = wrap?.clientWidth  || 600
  cvs.height = wrap?.clientHeight || 96
  const ctx2d = cvs.getContext('2d')
  const W = cvs.width, H = cvs.height
  ctx2d.clearRect(0, 0, W, H)
  ctx2d.fillStyle = 'rgba(8,8,16,0.92)'   // dark "scope" display — consistent on light & dark themes
  ctx2d.fillRect(0, 0, W, H)

  const color = ch.value?.color ?? '#ff9f43'

  if (!buf.value) {
    ctx2d.fillStyle = 'rgba(255,255,255,0.32)'
    ctx2d.font = '11px monospace'
    ctx2d.textAlign = 'center'
    ctx2d.textBaseline = 'middle'
    ctx2d.fillText('Drop audio file here or click 📂', W / 2, H / 2)
    return
  }

  const chIdx = Math.min(displayChannel.value, buf.value.numberOfChannels - 1)
  const data  = buf.value.getChannelData(chIdx)
  const N     = data.length
  const mid   = H / 2

  ctx2d.strokeStyle = color
  ctx2d.lineWidth = 1
  ctx2d.globalAlpha = 0.75
  ctx2d.beginPath()
  for (let x = 0; x < W; x++) {
    const s0 = Math.floor((x / W) * N)
    const s1 = Math.max(s0 + 1, Math.floor(((x + 1) / W) * N))
    let mn = 1, mx = -1
    for (let s = s0; s < s1 && s < N; s++) {
      if (data[s] < mn) mn = data[s]
      if (data[s] > mx) mx = data[s]
    }
    ctx2d.moveTo(x + 0.5, mid + mn * mid * 0.88)
    ctx2d.lineTo(x + 0.5, mid + mx * mid * 0.88)
  }
  ctx2d.stroke()
  ctx2d.globalAlpha = 1

  // Dim before start
  const sx = (p.value.startOffset ?? 0) * W
  if (sx > 1) {
    ctx2d.fillStyle = 'rgba(0,0,0,0.5)'
    ctx2d.fillRect(0, 0, sx, H)
  }
  // Dim after end
  const ex = (p.value.endOffset ?? 1) * W
  if (ex < W - 1) {
    ctx2d.fillStyle = 'rgba(0,0,0,0.5)'
    ctx2d.fillRect(ex, 0, W - ex, H)
  }

  // Centre line
  ctx2d.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx2d.lineWidth = 1
  ctx2d.beginPath(); ctx2d.moveTo(0, mid); ctx2d.lineTo(W, mid); ctx2d.stroke()
}

watch([buf, () => ch.value?.id, () => ch.value?.color, displayChannel], () => nextTick(drawWaveform))
watch(() => [p.value.startOffset, p.value.endOffset, p.value.loopStart, p.value.loopEnd],
  () => nextTick(drawWaveform))

onMounted(() => {
  drawWaveform()
  window.addEventListener('resize', drawWaveform)
  window.addEventListener('mouseup', onWinMouseUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', drawWaveform)
  window.removeEventListener('mouseup', onWinMouseUp)
  stopDrag()
  releaseAll()
})

// ── Marker dragging ────────────────────────────────────────────────────────────
let _dragParam = null

function startDrag(param, e) {
  _dragParam = param
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragUp)
}

function fracFromEvent(e) {
  const rect = waveWrap.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return 0
  return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
}

function onDragMove(e) {
  if (!_dragParam || !ch.value) return
  const f = fracFromEvent(e)
  const q = p.value
  if (_dragParam === 'startOffset')  q.startOffset = Math.min(f, (q.endOffset ?? 1) - 0.002)
  if (_dragParam === 'endOffset')    q.endOffset   = Math.max(f, (q.startOffset ?? 0) + 0.002)
  if (_dragParam === 'loopStart')    q.loopStart   = Math.min(f, (q.loopEnd ?? 1) - 0.002)
  if (_dragParam === 'loopEnd')      q.loopEnd     = Math.max(f, (q.loopStart ?? 0) + 0.002)
  nextTick(drawWaveform)
}

function onDragUp() { stopDrag() }
function stopDrag() {
  _dragParam = null
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)
}

// ── Warp marker dragging ─────────────────────────────────────────────────────
let _markerIdx = null
function startMarkerDrag(idx, e) {
  _markerIdx = idx
  window.addEventListener('mousemove', onMarkerMove)
  window.addEventListener('mouseup', onMarkerUp)
}
function onMarkerMove(e) {
  if (_markerIdx === null || !ch.value) return
  updateSampleWarpMarker(ch.value.id, _markerIdx, { pos: fracFromEvent(e) })
}
function onMarkerUp() {
  _markerIdx = null
  window.removeEventListener('mousemove', onMarkerMove)
  window.removeEventListener('mouseup', onMarkerUp)
}
// Double-click the waveform (warp mode) to drop a new marker.
function onWaveDblClick(e) {
  if (!ch.value || !p.value.warpEnabled) return
  addSampleWarpMarker(ch.value.id, fracFromEvent(e))
}

// ── Root note clamp ────────────────────────────────────────────────────────────
function clampRoot() {
  if (!ch.value) return
  p.value.rootNote = Math.max(0, Math.min(127, Math.round(p.value.rootNote ?? 60)))
}

// ── File loading ───────────────────────────────────────────────────────────────
const AUDIO_EXT = /\.(wav|mp3|ogg|flac|aiff?)$/i

function onDragOver(e) {
  if ([...(e.dataTransfer?.items ?? [])].some(i => i.kind === 'file')) isDragOver.value = true
}
function onDragLeave() { isDragOver.value = false }

async function onDrop(e) {
  isDragOver.value = false
  const file = [...(e.dataTransfer?.files ?? [])].find(f => AUDIO_EXT.test(f.name))
  if (file && ch.value) { await loadAudioFileForChannel(ch.value.id, file); nextTick(drawWaveform) }
}

async function onFileInput(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (file && ch.value) { await loadAudioFileForChannel(ch.value.id, file); nextTick(drawWaveform) }
}

function onNormalize() {
  if (ch.value) { normalizeAudioFile(ch.value.id); nextTick(drawWaveform) }
}

function doBuildXfade() {
  if (ch.value) { buildLoopXfade(ch.value.id) }
}

function doSnap(paramName) {
  if (ch.value) { snapToZero(ch.value.id, paramName); nextTick(drawWaveform) }
}
</script>

<style scoped>
.smp {
  --accent: #ff9f43;
  /* Theme-adaptive palette — derived from the global theme variables so the
     panel stays legible on light themes (white / arctic) as well as dark ones.
     Text uses the theme's own ink colour; surfaces use its panel colours. */
  --smp-text:    var(--text-primary);
  --smp-muted:   var(--text-muted);
  --smp-read:    color-mix(in srgb, var(--text-primary) 68%, transparent);
  --smp-faint:   color-mix(in srgb, var(--text-muted) 70%, transparent);
  --smp-card:    var(--bg-panel);
  --smp-strip:   var(--bg-deeper);
  --smp-input:   var(--bg-control);
  --smp-border:  var(--border-subtle);
  --smp-line:    color-mix(in srgb, var(--text-primary) 12%, transparent);
  --smp-track:   color-mix(in srgb, var(--text-primary) 18%, transparent);
  --smp-btn:     color-mix(in srgb, var(--text-primary) 6%, transparent);
  --smp-btn-h:   color-mix(in srgb, var(--text-primary) 14%, transparent);
  --smp-btn-bd:  color-mix(in srgb, var(--text-primary) 22%, transparent);
  --smp-rowhov:  color-mix(in srgb, var(--text-primary) 7%, transparent);
  --smp-scope:   #0d0d16;            /* dark visualizer "screen" on every theme */

  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-base);
  padding: 7px 9px 5px;
  gap: 6px;
  user-select: none;
}
.smp.smp-drag-over { outline: 2px dashed var(--accent); outline-offset: -3px; }

/* Shared strip — the horizontal toolbars (top / warp / loop tools) */
.smp-strip {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  background: var(--smp-strip);
  border: 1px solid var(--smp-border);
  border-radius: 6px;
  padding: 4px 8px;
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */
.smp-topbar { flex-wrap: nowrap; }
.smp-icon-btn {
  background: var(--smp-btn);
  border: 1px solid var(--smp-border);
  border-radius: 4px;
  color: var(--smp-muted);
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  padding: 3px 7px;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.smp-icon-btn:hover {
  background: var(--smp-btn-h);
  border-color: var(--smp-btn-bd);
  color: var(--smp-text);
}
.smp-load-btn {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.smp-filename {
  flex: 1;
  font-size: 11px;
  color: var(--smp-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.smp-duration {
  font-size: 10px;
  color: var(--smp-faint);
  white-space: nowrap;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.smp-missing-badge {
  font-size: 10px;
  color: #f39c12;
  background: rgba(243,156,18,0.12);
  border: 1px solid rgba(243,156,18,0.3);
  border-radius: 3px;
  padding: 1px 5px;
  white-space: nowrap;
}

/* ── Waveform ────────────────────────────────────────────────────────────── */
.smp-wave-wrap {
  position: relative;
  height: 88px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: var(--smp-scope);
  border: 1px solid var(--smp-border);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.3), inset 0 8px 18px rgba(0,0,0,0.25);
  cursor: crosshair;
}
.smp-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* Handles */
.smp-handle {
  position: absolute;
  top: 0; bottom: 0;
  width: 2px;
  cursor: ew-resize;
  transform: translateX(-50%);
  z-index: 4;
  border-radius: 1px;
  transition: box-shadow 0.1s;
}
.smp-handle::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 9px; height: 9px;
  border-radius: 0 0 3px 3px;
  background: inherit;
}
.smp-handle::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0;
  left: -6px; right: -6px;
}
.smp-handle:hover { box-shadow: 0 0 7px currentColor; }
.smp-handle-start  { background: rgba(255,255,255,0.9);  color: rgba(255,255,255,0.9); }
.smp-handle-end    { background: var(--accent);          color: var(--accent); }
.smp-handle-loop-s { background: #2ecc71;                color: #2ecc71; }
.smp-handle-loop-e { background: #e74c3c;                color: #e74c3c; }

/* Loop region */
.smp-loop-region {
  position: absolute;
  top: 0; bottom: 0;
  background: rgba(46,204,113,0.12);
  border-left:  1px solid rgba(46,204,113,0.45);
  border-right: 1px solid rgba(231,76,60,0.45);
  pointer-events: none;
  z-index: 2;
}

/* ── Audition keyboard ───────────────────────────────────────────────────── */
.smp-kbd-bar {
  display: flex;
  align-items: stretch;
  gap: 8px;
  flex-shrink: 0;
}
.smp-kbd-side {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.smp-oct-btn { padding: 3px 5px; }
.smp-icon-btn:disabled { opacity: 0.35; cursor: default; }
.smp-kbd-oct {
  font-size: 10px;
  color: var(--smp-read);
  width: 26px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.smp-kbd {
  position: relative;
  flex: 1;
  height: 50px;
  min-width: 0;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid var(--smp-border);
  background: var(--smp-scope);
  box-shadow: inset 0 2px 8px rgba(0,0,0,0.4);
}
.smp-kbd-whites { display: flex; height: 100%; }
.smp-key { cursor: pointer; }
.smp-key-w {
  flex: 1;
  height: 100%;
  background: linear-gradient(#f3f3fa, #d6d6e4);
  border-right: 1px solid rgba(0,0,0,0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 2px;
  transition: background 0.04s;
}
.smp-key-w:last-child { border-right: none; }
.smp-key-w:hover { background: linear-gradient(#ffffff, #e6e6f2); }
.smp-key-w.active { background: linear-gradient(color-mix(in srgb, var(--accent) 55%, #fff), var(--accent)); }
.smp-key-w.root  { box-shadow: inset 0 -4px 0 color-mix(in srgb, var(--accent) 65%, transparent); }
.smp-key-w.root.active { box-shadow: none; }
.smp-key-lbl {
  font-size: 7px;
  font-weight: 700;
  color: rgba(0,0,0,0.42);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
.smp-kbd-blacks { position: absolute; inset: 0; pointer-events: none; }
.smp-key-b {
  position: absolute;
  top: 0;
  height: 62%;
  transform: translateX(-50%);
  background: linear-gradient(#2c2c3a, #0b0b12);
  border: 1px solid #000;
  border-top: none;
  border-radius: 0 0 3px 3px;
  pointer-events: auto;
  z-index: 3;
  box-shadow: 0 2px 3px rgba(0,0,0,0.5);
  transition: background 0.04s;
}
.smp-key-b:hover  { background: linear-gradient(#3c3c4e, #16161f); }
.smp-key-b.active { background: linear-gradient(color-mix(in srgb, var(--accent) 65%, #000), var(--accent)); }

/* ── Controls (4 columns) ────────────────────────────────────────────────── */
.smp-controls {
  display: flex;
  gap: 8px;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
.smp-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  overflow: hidden;
  background: var(--smp-card);
  border: 1px solid var(--smp-border);
  border-radius: 6px;
  padding: 6px 8px 7px;
}
.smp-col-header {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--accent);
  margin-bottom: 3px;
  padding-bottom: 3px;
  border-bottom: 1px solid var(--smp-line);
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 5px;
}
.smp-col-header::before {
  content: '';
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 5px var(--accent);
  flex-shrink: 0;
}
.smp-col-header-sub {
  margin-top: 5px;
  color: var(--smp-muted);
  border-bottom-color: var(--smp-line);
}
.smp-col-header-sub::before {
  background: var(--smp-muted);
  box-shadow: none;
}

/* Row layout */
.smp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;
  border-radius: 3px;
  padding: 0 2px;
  transition: background 0.1s;
}
.smp-row:hover { background: var(--smp-rowhov); }
.smp-row:hover .smp-lbl { color: var(--accent); }
.smp-lbl {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--smp-muted);
  width: 34px;
  flex-shrink: 0;
  text-transform: uppercase;
  transition: color 0.1s;
}

/* Sliders — custom thumb + track */
.smp-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 4px;
  min-width: 0;
  border-radius: 3px;
  background: var(--smp-track);
  cursor: pointer;
  outline: none;
}
.smp-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid rgba(0,0,0,0.45);
  box-shadow: 0 1px 3px rgba(0,0,0,0.5);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}
.smp-slider:hover::-webkit-slider-thumb { transform: scale(1.18); box-shadow: 0 0 7px var(--accent); }
.smp-slider:active::-webkit-slider-thumb { transform: scale(1.05); }
.smp-slider::-moz-range-thumb {
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid rgba(0,0,0,0.45);
  box-shadow: 0 1px 3px rgba(0,0,0,0.5);
  cursor: pointer;
}
.smp-slider::-moz-range-track {
  height: 4px;
  border-radius: 3px;
  background: var(--smp-track);
}
.smp-val {
  font-size: 9px;
  color: var(--smp-read);
  width: 38px;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* Number inputs */
.smp-num {
  width: 38px;
  background: var(--smp-input);
  border: 1px solid var(--smp-border);
  border-radius: 4px;
  color: var(--smp-text);
  font-size: 10px;
  text-align: center;
  padding: 2px;
  transition: border-color 0.12s;
}
.smp-num:focus { outline: none; border-color: var(--accent); }
.smp-note-name {
  font-size: 10px;
  color: var(--accent);
  font-weight: 600;
  width: 26px;
}

/* Segmented buttons */
.smp-group {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.smp-seg {
  display: flex;
}
.smp-seg button {
  background: var(--smp-btn);
  border: 1px solid var(--smp-border);
  border-radius: 0;
  color: var(--smp-muted);
  cursor: pointer;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  transition: background 0.1s, color 0.1s;
}
.smp-seg button:first-child { border-radius: 4px 0 0 4px; }
.smp-seg button:last-child  { border-radius: 0 4px 4px 0; }
.smp-seg button + button    { border-left: none; }
.smp-seg button:hover       { background: var(--smp-btn-h); color: var(--smp-text); }
.smp-seg button.active {
  background: color-mix(in srgb, var(--accent) 26%, transparent);
  color: var(--accent);
  border-color: var(--accent);
}

.smp-seg-sm button { padding: 2px 4px; font-size: 8px; }

/* Mode button (REV / WARP) */
.smp-mode-btn {
  background: var(--smp-btn);
  border: 1px solid var(--smp-border);
  border-radius: 4px;
  color: var(--smp-muted);
  cursor: pointer;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 3px 8px;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  flex-shrink: 0;
}
.smp-mode-btn:hover  { background: var(--smp-btn-h); color: var(--smp-text); }
.smp-mode-btn.active {
  background: color-mix(in srgb, var(--accent) 26%, transparent);
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 40%, transparent);
}

/* ADSR mini visualizer */
.smp-adsr-vis {
  height: 38px;
  background: var(--smp-scope);
  border: 1px solid var(--smp-border);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  margin-bottom: 3px;
}
.smp-adsr-vis svg {
  width: 100%;
  height: 100%;
}

/* Curve sub-rows */
.smp-row-curve {
  opacity: 0.72;
  min-height: 14px !important;
}
.smp-row-curve:hover { opacity: 1; }
.smp-crv-val {
  font-size: 8px !important;
  color: var(--accent) !important;
}

/* Warp bar */
.smp-warp-bar { flex-wrap: wrap; }
.smp-warp-hint { font-size: 9px; color: rgba(255,255,255,0.3); font-style: italic; }

/* Warp markers on the waveform */
.smp-wave-warpedit { cursor: copy; }
.smp-warp-marker {
  position: absolute; top: 0; bottom: 0; width: 2px;
  background: #f1c40f; transform: translateX(-50%); z-index: 5; cursor: ew-resize;
  box-shadow: 0 0 4px rgba(241,196,15,0.6);
}
.smp-warp-marker::after { content: ''; position: absolute; top: 0; bottom: 0; left: -4px; right: -4px; }
.smp-warp-marker-lbl {
  position: absolute; top: 0; left: 3px; font-size: 8px; font-weight: 700;
  color: #f1c40f; background: rgba(0,0,0,0.55); padding: 0 2px; border-radius: 2px; pointer-events: none;
}
.smp-sel {
  background: var(--smp-input);
  border: 1px solid var(--smp-border);
  border-radius: 4px;
  color: var(--smp-text);
  font-size: 10px;
  padding: 2px 4px;
  text-transform: capitalize;
  cursor: pointer;
  transition: border-color 0.12s;
}
.smp-sel:hover { border-color: var(--smp-btn-bd); }
.smp-sel:focus { outline: none; border-color: var(--accent); }
.smp-sel:disabled { opacity: 0.4; cursor: default; }

/* Multisample zones */
.smp-zones {
  flex-shrink: 0;
  border-top: 1px solid var(--smp-border);
  padding-top: 5px;
  margin-top: 1px;
}
.smp-zones-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.smp-zones-head .smp-col-header { border-bottom: none; padding-bottom: 0; margin-bottom: 0; }
.smp-zone-count {
  background: color-mix(in srgb, var(--accent) 26%, transparent); color: var(--accent); border-radius: 8px;
  padding: 0 6px; font-size: 9px; font-weight: 700;
}
.smp-zone-hint { font-size: 9px; color: var(--smp-muted); }
.smp-zone-table { margin-top: 5px; display: flex; flex-direction: column; gap: 2px; max-height: 120px; overflow-y: auto; }
.smp-zone-row { display: flex; align-items: center; gap: 4px; padding: 1px 2px; border-radius: 3px; }
.smp-zone-row:not(.smp-zone-row-head):hover { background: var(--smp-rowhov); }
.smp-zone-row-head .smp-zc, .smp-zone-row-head .smp-zc-name {
  font-size: 8px; font-weight: 700; color: var(--smp-muted); letter-spacing: 0.04em;
}
.smp-zc-name { flex: 1; min-width: 0; font-size: 10px; color: var(--smp-read);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.smp-zc { width: 42px; text-align: center; flex-shrink: 0; }
.smp-zc-num {
  width: 42px; flex-shrink: 0; background: var(--smp-input); color: var(--smp-text);
  border: 1px solid var(--smp-border); border-radius: 4px; font-size: 10px; text-align: center; padding: 2px;
  transition: border-color 0.12s;
}
.smp-zc-num:focus { outline: none; border-color: var(--accent); }
.smp-zc-x { width: 18px; flex-shrink: 0; }
.smp-zc-del {
  width: 18px; flex-shrink: 0; background: none; border: none; color: var(--smp-muted);
  cursor: pointer; font-size: 11px;
}
.smp-zc-del:hover { color: #e74c3c; }

/* Loop tools bar */
.smp-loop-tools { flex-wrap: wrap; }
.smp-loop-tools .smp-slider { max-width: 120px; flex: 0 1 120px; }
.smp-loop-snap-lbl {
  font-size: 9px;
  font-weight: 700;
  color: var(--smp-muted);
  margin-left: 6px;
  letter-spacing: 0.06em;
}
.smp-build-btn {
  color: #27ae60 !important;
  border-color: rgba(46,204,113,0.45) !important;
  background: rgba(46,204,113,0.12) !important;
}
.smp-build-btn:hover { background: rgba(46,204,113,0.22) !important; }
.smp-xfade-badge {
  font-size: 8px;
  color: #27ae60;
  background: rgba(46,204,113,0.12);
  border: 1px solid rgba(46,204,113,0.3);
  border-radius: 3px;
  padding: 1px 5px;
  white-space: nowrap;
}
</style>
