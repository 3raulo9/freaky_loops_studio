<template>
  <div class="tb-tools">
    <button
      class="tb-tool"
      :class="{ active: keyboardInputMode }"
      v-hint="'tools.kb'"
      @click="keyboardInputMode = !keyboardInputMode"
    >⌨</button>
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
  keyboardInputMode,
  canUndo, canRedo, undoAction, redoAction,
  saveProject, loadProjectFile,
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
