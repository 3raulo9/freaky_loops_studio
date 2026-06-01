<template>
  <!-- Project Browser: a navigable tree of patterns + channels. Selecting an
       item routes focus through the window manager, like FL's file browser. -->
  <div class="browser">
    <div class="browser-head">BROWSER</div>

    <div class="browser-group">
      <div class="browser-group-title" @click="openPatterns = !openPatterns">
        <span class="browser-caret">{{ openPatterns ? '▾' : '▸' }}</span> PATTERNS
        <span class="browser-count">{{ patterns.length }}</span>
      </div>
      <div v-show="openPatterns" class="browser-list">
        <div
          v-for="(p, i) in patterns"
          :key="p.id"
          class="browser-item"
          :class="{ on: p.id === currentPatternId }"
          @click="currentPatternId = p.id"
        >
          <span class="browser-swatch" :style="{ background: p.color }" />
          <span class="browser-name">{{ i + 1 }}. {{ p.name }}</span>
        </div>
      </div>
    </div>

    <div class="browser-group">
      <div class="browser-group-title" @click="openChannels = !openChannels">
        <span class="browser-caret">{{ openChannels ? '▾' : '▸' }}</span> CHANNELS
        <span class="browser-count">{{ channels.length }}</span>
      </div>
      <div v-show="openChannels" class="browser-list">
        <div
          v-for="ch in channels"
          :key="ch.id"
          class="browser-item"
          :class="{ on: ch.id === selectedChannelId }"
          @click="selectChannel(ch.id)"
        >
          <span class="browser-swatch" :style="{ background: ch.color }" />
          <span class="browser-name">{{ ch.name }}</span>
          <span class="browser-type">{{ ch.type }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useStudio } from '../store/studio.js'

const { patterns, currentPatternId, channels, selectedChannelId, mainView } = useStudio()

const openPatterns = ref(true)
const openChannels = ref(true)

function selectChannel(id) {
  selectedChannelId.value = id
  mainView.value = 'sequencer'
}
</script>

<style scoped>
.browser {
  display: flex; flex-direction: column;
  height: 100%; background: var(--bg-header);
  overflow-y: auto; user-select: none;
}
.browser-head {
  padding: 7px 10px; flex-shrink: 0;
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.2em; color: #f1c40f;
  border-bottom: 1px solid var(--border-subtle);
}
.browser-group { border-bottom: 1px solid var(--border-subtle); }
.browser-group-title {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 10px; cursor: pointer;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.14em; color: #50506e;
}
.browser-group-title:hover { color: #8080b0; }
.browser-caret { width: 10px; }
.browser-count { margin-left: auto; color: #34344a; }
.browser-list { padding-bottom: 4px; }
.browser-item {
  display: flex; align-items: center; gap: 7px;
  padding: 4px 10px 4px 22px; cursor: pointer;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; color: #9090b0;
}
.browser-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.browser-item.on { background: var(--bg-control); color: #fff; }
.browser-swatch { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.browser-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.browser-type {
  margin-left: auto; font-family: 'Share Tech Mono', monospace; font-size: 8px;
  color: #34344a; text-transform: uppercase;
}
</style>
