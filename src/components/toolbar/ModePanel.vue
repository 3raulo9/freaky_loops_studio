<template>
  <div class="tb-group">
    <div class="tb-group-label">MODE</div>
    <div class="tb-row">
      <button
        class="tb-mode-btn"
        :class="{ active: !usePlaylist }"
        v-hint="'mode.pat'"
        @click="setPAT"
      >PAT</button>
      <button
        class="tb-mode-btn"
        :class="{ active: usePlaylist }"
        v-hint="'mode.song'"
        @click="setSONG"
      >SONG</button>
    </div>
  </div>
</template>

<script setup>
import { useStudio } from '../../store/studio.js'

const { usePlaylist, mainView } = useStudio()

function setPAT() {
  usePlaylist.value = false
  mainView.value = 'sequencer'
}
function setSONG() {
  usePlaylist.value = true
  mainView.value = 'playlist'
}
</script>
