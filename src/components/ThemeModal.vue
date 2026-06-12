<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">

      <div class="modal-header">
        <span class="modal-hex">⬡</span>
        <span class="modal-title">THEME</span>
        <button class="modal-close" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div class="sect-label">SELECT THEME</div>

        <div class="theme-grid">
          <button
            v-for="theme in THEMES"
            :key="theme.id"
            class="theme-card"
            :class="{ active: currentTheme === theme.id, light: isLight(theme) }"
            @click="selectTheme(theme.id)"
          >
            <div v-if="theme.id === 'white'" class="theme-badge">DEFAULT</div>
            <div class="theme-swatch" :style="{ background: swatchGradient(theme) }">
              <div class="swatch-bars">
                <div class="swatch-bar" :style="{ background: theme.vars['--bg-panel'] }" />
                <div class="swatch-bar" :style="{ background: theme.vars['--bg-track'] }" />
                <div class="swatch-bar" :style="{ background: theme.vars['--border'] }" />
              </div>
              <div class="swatch-text" :style="{ color: theme.vars['--text-primary'] }">Aa</div>
            </div>
            <div class="theme-info">
              <span class="theme-name">{{ theme.name }}</span>
              <span class="theme-desc">{{ theme.desc }}</span>
            </div>
            <span v-if="currentTheme === theme.id" class="theme-check">✓</span>
          </button>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-close" @click="$emit('close')">CLOSE</button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { watch } from 'vue'
import { useStudio } from '../store/studio.js'
import { THEMES, applyTheme } from '../themes.js'

defineEmits(['close'])

const { currentTheme } = useStudio()

const LIGHT_THEMES = new Set(['white', 'arctic'])

function isLight(theme) {
  return LIGHT_THEMES.has(theme.id)
}

function swatchGradient(theme) {
  return `linear-gradient(135deg, ${theme.vars['--bg-base']} 0%, ${theme.vars['--bg-track']} 100%)`
}

function selectTheme(id) {
  currentTheme.value = id
}

watch(currentTheme, (id) => {
  applyTheme(id)
  localStorage.setItem('fls-theme', id)
}, { immediate: true })
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0,0,0,0.72);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(3px);
}
.modal {
  width: 560px; max-width: 96vw; max-height: 90vh;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(128,128,160,0.08);
  display: flex; flex-direction: column; overflow: hidden;
}

.modal-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px 12px;
  background: var(--bg-header); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
}
.modal-hex   { font-size: 20px; color: #9b59b6; filter: drop-shadow(0 0 5px #9b59b666); }
.modal-title { font-family:'Rajdhani',sans-serif; font-size:16px; font-weight:700; letter-spacing:.18em; color:var(--text-primary); }
.modal-close { margin-left:auto; background:transparent; border:none; color:var(--text-muted); font-size:15px; cursor:pointer; padding:4px 7px; border-radius:4px; transition:color .1s; }
.modal-close:hover { color:#e74c3c; }

.modal-body { flex:1; overflow-y:auto; padding:18px; }

.sect-label {
  font-family:'Rajdhani',sans-serif; font-size:9px; font-weight:700;
  letter-spacing:.22em; color:var(--text-muted); text-transform:uppercase; margin-bottom:14px;
}

.theme-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;
}

.theme-card {
  position: relative;
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg-control);
  cursor: pointer; transition: all .15s; text-align: left;
  outline: none;
}
.theme-card:hover { border-color: var(--text-muted); }
.theme-card.active {
  border-color: #9b59b6;
  background: var(--bg-deeper);
  box-shadow: 0 0 12px #9b59b633;
}
.theme-card.light.active {
  border-color: #7b3fb6;
  box-shadow: 0 0 12px #9b59b622;
}

.theme-badge {
  position: absolute; top: 7px; left: 7px;
  font-family:'Rajdhani',sans-serif; font-size:7px; font-weight:700; letter-spacing:.15em;
  background: #9b59b6; color: #fff; border-radius: 3px;
  padding: 1px 5px; z-index: 1;
}

.theme-swatch {
  height: 60px; border-radius: 5px; overflow: hidden;
  position: relative; display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(128,128,128,0.15);
}
.swatch-bars {
  position: absolute; bottom: 0; left: 0; right: 0;
  display: flex; height: 12px;
}
.swatch-bar { flex: 1; }
.swatch-text {
  font-family:'Rajdhani',sans-serif; font-size:20px; font-weight:700;
  letter-spacing:.1em; opacity:.7; z-index:1;
}

.theme-info { display: flex; flex-direction: column; gap: 2px; }
.theme-name {
  font-family:'Rajdhani',sans-serif; font-size:12px; font-weight:700;
  letter-spacing:.1em; color:var(--text-primary);
}
.theme-desc {
  font-family:'Share Tech Mono',monospace; font-size:8px; color:var(--text-muted);
}
.theme-card.active .theme-name { color: #9b59b6; }
.theme-card.light.active .theme-name { color: #6a2aa6; }

.theme-check {
  position: absolute; top: 8px; right: 8px;
  font-size: 12px; color: #9b59b6;
  filter: drop-shadow(0 0 4px #9b59b6);
}
.theme-card.light .theme-check {
  filter: none;
  color: #7b3fb6;
}

.modal-footer {
  display: flex; justify-content: flex-end;
  padding: 12px 18px 14px;
  background: var(--bg-header); border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.btn-close {
  font-family:'Rajdhani',sans-serif; font-size:13px; font-weight:700; letter-spacing:.1em;
  padding: 8px 22px; border: 1px solid #9b59b6; border-radius: 6px;
  background: transparent; color: #9b59b6; cursor: pointer; transition: all .12s;
}
.btn-close:hover { background: #9b59b6; color: #fff; box-shadow: 0 0 14px #9b59b655; }
</style>
