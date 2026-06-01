<template>
  <div class="tb-windows">
    <button
      class="tb-win"
      :class="{ active: mainView === 'sequencer' }"
      v-hint="'win.rack'"
      @click="mainView = 'sequencer'"
    >
      <span class="tb-win-icon">▦</span>
      <span class="tb-win-lbl">RACK</span>
    </button>
    <button
      class="tb-win"
      :class="{ active: pianoRollOpen && mainView === 'sequencer' }"
      v-hint="'win.piano'"
      @click="togglePianoRoll"
    >
      <span class="tb-win-icon">𝅘𝅥𝅮</span>
      <span class="tb-win-lbl">PIANO</span>
    </button>
    <button
      class="tb-win"
      :class="{ active: mainView === 'playlist' }"
      v-hint="'win.playlist'"
      @click="setSONG"
    >
      <span class="tb-win-icon">▤</span>
      <span class="tb-win-lbl">PLAYLIST</span>
    </button>
    <button
      class="tb-win tb-win-mixer"
      :class="{ active: mainView === 'mixer' }"
      v-hint="'win.mixer'"
      @click="mainView = 'mixer'"
    >
      <span class="tb-win-icon">⊟</span>
      <span class="tb-win-lbl">MIXER</span>
    </button>
    <button
      class="tb-win tb-win-render"
      v-hint="'win.render'"
      @click="renderModalOpen = true"
    >
      <span class="tb-win-icon">⬡</span>
      <span class="tb-win-lbl">RENDER</span>
    </button>
    <button
      class="tb-win tb-win-theme"
      v-hint="'win.theme'"
      @click="themeModalOpen = true"
    >
      <span class="tb-win-icon">◑</span>
      <span class="tb-win-lbl">THEME</span>
    </button>
  </div>
</template>

<script setup>
import { useStudio } from '../../store/studio.js'

const {
  mainView, pianoRollOpen, renderModalOpen, themeModalOpen, usePlaylist,
} = useStudio()

function setSONG() {
  usePlaylist.value = true
  mainView.value = 'playlist'
}
function togglePianoRoll() {
  if (mainView.value !== 'sequencer') mainView.value = 'sequencer'
  pianoRollOpen.value = !pianoRollOpen.value
}
</script>
