<template>
  <div class="playlist">

    <div class="pl-toolbar">
      <label class="pl-toggle">
        <input type="checkbox" v-model="usePlaylist" />
        <span>USE PLAYLIST</span>
      </label>
      <span class="pl-hint">Click cells to place/remove a pattern block per bar.</span>
    </div>

    <div class="pl-scroll">
      <!-- Bar number header -->
      <div class="pl-header-row">
        <div class="pl-ch-label-spacer">CHANNEL</div>
        <div
          v-for="b in PLAYLIST_BARS"
          :key="b"
          class="pl-bar-hdr"
          :class="{
            beat:    (b - 1) % 4 === 0,
            playing: isPlaying && currentPlayBar === b - 1,
          }"
        >{{ b }}</div>
      </div>

      <!-- One row per channel -->
      <div
        v-for="ch in channels"
        :key="ch.id"
        class="pl-row"
        :style="{ '--accent': ch.color }"
      >
        <div class="pl-ch-label">
          <span class="pl-ch-dot" :style="{ background: ch.color }" />
          <span class="pl-ch-name">{{ ch.name }}</span>
        </div>
        <div
          v-for="b in PLAYLIST_BARS"
          :key="b"
          class="pl-cell"
          :class="{
            active:  playlist[b - 1]?.[ch.id],
            beat:    (b - 1) % 4 === 0,
            playing: isPlaying && currentPlayBar === b - 1,
          }"
          @click="togglePlaylistBlock(b - 1, ch.id)"
        >
          <div v-if="playlist[b - 1]?.[ch.id]" class="pl-block" />
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useStudio } from '../store/studio.js'

const { channels, isPlaying, displayStep, totalSteps,
        playlist, usePlaylist, PLAYLIST_BARS, togglePlaylistBlock } = useStudio()

// Which playlist bar the playhead is currently in
const currentPlayBar = computed(() => {
  if (!isPlaying.value || displayStep.value < 0) return -1
  // This is a rough approximation; the store tracks currentBar internally
  return -1
})
</script>

<style scoped>
.playlist {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  background: #0e0e1a;
}

.pl-toolbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 10px 16px;
  background: #0a0a12;
  border-bottom: 1px solid #1a1a28;
  flex-shrink: 0;
}
.pl-toggle {
  display: flex; align-items: center; gap: 7px; cursor: pointer;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 700;
  letter-spacing: 0.12em; color: #8080a0;
  user-select: none;
}
.pl-toggle input[type="checkbox"] { accent-color: #e74c3c; width: 14px; height: 14px; cursor: pointer; }
.pl-hint {
  font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #303048;
}

.pl-scroll { flex: 1; overflow: auto; }

.pl-header-row {
  display: flex; position: sticky; top: 0; z-index: 2;
  background: #0a0a12; border-bottom: 1px solid #1a1a28;
}
.pl-ch-label-spacer {
  width: 120px; min-width: 120px; padding: 5px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #303048; border-right: 1px solid #1a1a28;
  display: flex; align-items: center;
}
.pl-bar-hdr {
  width: 32px; min-width: 32px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #303048;
  border-right: 1px solid #0e0e1a; transition: background 0.06s;
}
.pl-bar-hdr.beat    { border-left: 1px solid #1e1e30; color: #44446a; }
.pl-bar-hdr.playing { background: rgba(255,255,255,0.1); color: #fff; }

.pl-row {
  display: flex;
  border-bottom: 1px solid #111118;
  transition: background 0.08s;
}
.pl-row:hover { background: #111120; }

.pl-ch-label {
  width: 120px; min-width: 120px; padding: 0 10px;
  display: flex; align-items: center; gap: 7px;
  border-right: 1px solid #1a1a28;
  background: #0c0c16;
}
.pl-ch-dot   { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.pl-ch-name  {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; color: #8080a0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.pl-cell {
  width: 32px; min-width: 32px; height: 36px;
  border-right: 1px solid #0e0e18; cursor: pointer;
  position: relative; transition: background 0.06s;
}
.pl-cell.beat    { border-left: 1px solid #1e1e30; }
.pl-cell.playing { background: rgba(255,255,255,0.04); }
.pl-cell:hover   { background: color-mix(in srgb, var(--accent) 12%, transparent); }

.pl-block {
  position: absolute; inset: 3px 2px;
  background: var(--accent);
  border-radius: 3px;
  opacity: 0.85;
  box-shadow: 0 0 5px color-mix(in srgb, var(--accent) 40%, transparent);
}
</style>
