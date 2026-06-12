<template>
  <div class="tb-tools">
    <button
      class="tb-tool"
      :class="{ active: keyboardInputMode }"
      v-hint="'tools.kb'"
      @click="keyboardInputMode = !keyboardInputMode"
    >⌨</button>
    <button
      class="tb-tool"
      :class="{ active: autoScroll }"
      v-hint="'tools.autoscroll'"
      title="Auto Scroll — follow playhead during playback (Scroll Lock)"
      @click="autoScroll = !autoScroll"
    >⇥</button>
    <div class="tb-tools-sep" />
    <button
      class="tb-tool"
      v-hint="'tools.undo'"
      @click="undoAction"
      :disabled="!canUndo"
    >↶</button>
    <button
      class="tb-tool"
      v-hint="'tools.redo'"
      @click="redoAction"
      :disabled="!canRedo"
    >↷</button>
    <div class="tb-tools-sep" />
    <!-- Dump score log: extract the last 30 min of MIDI input into the selected piano channel -->
    <button
      class="tb-tool tb-tool-scorelog"
      v-hint="'tools.scorelog'"
      @click="dumpScoreLog"
      title="Dump score log — extract last 30 min of played MIDI notes into selected piano channel"
    >♩</button>
    <div class="tb-tools-sep" />
    <button
      class="tb-tool tb-tool-save"
      v-hint="'tools.save'"
      @click="onSave"
    >↓</button>
    <button
      class="tb-tool tb-tool-open"
      v-hint="'tools.open'"
      @click="fileInput.click()"
    >↑</button>
    <input
      ref="fileInput"
      type="file"
      accept=".freak,.json"
      style="display:none"
      @change="onFileChange"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useStudio } from '../../store/studio.js'

const {
  keyboardInputMode, autoScroll,
  canUndo, canRedo, undoAction, redoAction,
  saveProject, loadProjectFile, dumpScoreLog,
} = useStudio()

const fileInput = ref(null)

function onSave() {
  saveProject('project')
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (file) loadProjectFile(file)
  e.target.value = ''
}
</script>
