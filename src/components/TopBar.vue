<template>
  <header class="topbar">

    <div class="logo">
      <span class="logo-hex">⬡</span>
      <span class="logo-text">FREAKY<em>LOOPS</em> STUDIO</span>
    </div>

    <div class="transport">
      <div class="ctrl-group">
        <span class="ctrl-label">BPM</span>
        <div class="bpm-display">{{ bpm }}</div>
        <input type="range" v-model.number="bpm" min="40" max="220" step="1" class="slider" />
      </div>

      <div class="ctrl-group">
        <span class="ctrl-label">SWING</span>
        <div class="bpm-display" style="font-size:15px">{{ Math.round(swing * 100) }}%</div>
        <input type="range" v-model.number="swing" min="0" max="0.25" step="0.01" class="slider" />
      </div>

      <div class="ctrl-group">
        <span class="ctrl-label">STEPS</span>
        <select v-model.number="totalSteps" class="steps-select">
          <option :value="8">8</option>
          <option :value="16">16</option>
          <option :value="32">32</option>
        </select>
      </div>

      <button class="btn btn-play" :class="{ active: isPlaying }" @click="togglePlay">
        <span v-if="isPlaying">⏹ STOP</span>
        <span v-else>▶ PLAY</span>
      </button>

      <button class="btn btn-clear" @click="clearAll" title="Clear all patterns">CLR</button>

      <div class="divider" />

      <button class="btn btn-render" @click="renderModalOpen = true">
        ⬡ RENDER
      </button>
    </div>

    <div class="view-tabs">
      <button class="tab-btn" :class="{ active: mainView === 'sequencer' }" @click="mainView = 'sequencer'">SEQUENCER</button>
      <button class="tab-btn" :class="{ active: mainView === 'playlist' }"  @click="mainView = 'playlist'">PLAYLIST</button>
    </div>

  </header>
</template>

<script setup>
import { useStudio } from '../store/studio.js'

const { bpm, swing, totalSteps, isPlaying, mainView, renderModalOpen,
        togglePlay, clearAll } = useStudio()
</script>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 18px;
  background: #0c0c14;
  border-bottom: 1px solid #1c1c2c;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.logo { display: flex; align-items: center; gap: 8px; }
.logo-hex { font-size: 22px; color: #e74c3c; filter: drop-shadow(0 0 5px #e74c3c88); }
.logo-text {
  font-family: 'Rajdhani', sans-serif;
  font-size: 18px; font-weight: 700; letter-spacing: 0.13em; color: #d0d0e8;
}
.logo-text em { font-style: normal; color: #e74c3c; }

.transport { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; flex: 1; }

.ctrl-group { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.ctrl-label {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 600;
  letter-spacing: 0.15em; text-transform: uppercase; color: #50506a;
}
.bpm-display {
  font-family: 'Share Tech Mono', monospace; font-size: 19px;
  color: #e74c3c; min-width: 48px; text-align: center; line-height: 1;
  filter: drop-shadow(0 0 3px #e74c3c55);
}
.slider { width: 80px; accent-color: #e74c3c; height: 3px; cursor: pointer; }
.steps-select {
  background: #181828; border: 1px solid #303048; color: #b0b0c8;
  padding: 4px 8px; border-radius: 5px;
  font-family: 'Share Tech Mono', monospace; font-size: 13px; cursor: pointer; outline: none;
}
.steps-select:focus { border-color: #e74c3c; }

.btn {
  font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 13px;
  letter-spacing: 0.1em; padding: 7px 16px; border: 1px solid;
  border-radius: 6px; cursor: pointer; transition: all 0.1s; outline: none;
}
.btn-play  { background: #0e2a1a; border-color: #2ecc71; color: #2ecc71; }
.btn-play.active { background: #2ecc71; color: #061206; box-shadow: 0 0 12px #2ecc7170; }
.btn-play:hover  { filter: brightness(1.15); }
.btn-clear { background: #1a0e28; border-color: #4a3060; color: #8060a0; padding: 7px 12px; }
.btn-clear:hover { border-color: #9b59b6; color: #c084e0; }
.btn-render {
  background: #1a0808; border-color: #e74c3c; color: #e74c3c; letter-spacing: 0.12em;
}
.btn-render:hover { background: #e74c3c; color: #fff; box-shadow: 0 0 14px #e74c3c44; }

.divider { width: 1px; height: 30px; background: #252535; }

.view-tabs { display: flex; gap: 3px; margin-left: auto; }
.tab-btn {
  font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 12px;
  letter-spacing: 0.12em; padding: 6px 14px; border: 1px solid #2a2a3a;
  border-radius: 5px; cursor: pointer; background: transparent; color: #50506a;
  transition: all 0.15s;
}
.tab-btn:hover  { border-color: #4a4a6a; color: #8080a0; }
.tab-btn.active { border-color: #e74c3c; color: #e74c3c; background: #1a0a0a; }
</style>
