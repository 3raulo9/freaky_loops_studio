<template>
  <nav class="mb" @mouseleave="hoverArmed = false">
    <button
      v-for="m in MENUS"
      :key="m.id"
      class="mb-title"
      :class="{ open: openId === m.id }"
      v-hint="m.hint"
      @mousedown.stop="toggle(m.id, $event)"
      @mouseenter="hoverSwitch(m.id, $event)"
    >{{ m.label }}</button>

    <input ref="projectInput" type="file" accept=".freak,.json,.flp,.zip" style="display:none" @change="onProjectFile" />
    <input ref="folderInput" type="file" webkitdirectory style="display:none" @change="onProjectFolder" />
    <input ref="midiInput" type="file" accept=".mid,.midi" style="display:none" @change="onMidiFile" />

    <Teleport to="body">
      <div
        v-if="openId"
        class="mb-drop"
        :style="{ left: dropX + 'px', top: dropY + 'px' }"
        @mousedown.stop
      >
        <template v-for="(item, i) in currentItems" :key="i">
          <div v-if="item.sep" class="mb-sep" />
          <div v-else-if="item.heading" class="mb-heading">{{ item.heading }}</div>
          <div
            v-else
            class="mb-item"
            :class="{ disabled: item.disabled?.() }"
            @click="run(item)"
          >
            <span class="mb-check">{{ item.checked?.() ? '✓' : '' }}</span>
            <span class="mb-label">{{ item.label }}</span>
            <span v-if="item.key" class="mb-key">{{ item.key }}</span>
          </div>
        </template>
      </div>

      <!-- Help → keyboard shortcuts -->
      <div v-if="shortcutsOpen" class="mb-modal-back" @mousedown.self="shortcutsOpen = false">
        <div class="mb-modal">
          <div class="mb-modal-hdr">
            <span>KEYBOARD SHORTCUTS</span>
            <button class="mb-modal-x" @click="shortcutsOpen = false">×</button>
          </div>
          <div class="mb-modal-body">
            <section v-for="g in SHORTCUTS" :key="g.title" class="mb-sc-group">
              <h4>{{ g.title }}</h4>
              <div v-for="[k, d] in g.items" :key="k" class="mb-sc-row">
                <kbd>{{ k }}</kbd><span>{{ d }}</span>
              </div>
            </section>
          </div>
        </div>
      </div>

      <!-- Options → audio settings (desktop) -->
      <AudioSettings v-if="audio.open" @close="audio.open = false" />

      <!-- Help → about -->
      <div v-if="aboutOpen" class="mb-modal-back" @mousedown.self="aboutOpen = false">
        <div class="mb-modal mb-modal--about">
          <div class="mb-modal-hdr">
            <span>ABOUT</span>
            <button class="mb-modal-x" @click="aboutOpen = false">×</button>
          </div>
          <div class="mb-about">
            <div class="mb-about-logo">⬡ FREAKY<em>LOOPS</em> STUDIO</div>
            <div>Pattern-based music workstation — synthesis, sampling, arrangement and mixing.</div>
            <div class="mb-about-meta">{{ isDesktop ? 'Desktop app · native Rust audio engine + VST2/VST3 host' : 'Web app · Web Audio engine' }}</div>
          </div>
        </div>
      </div>
    </Teleport>
  </nav>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'
import { isDesktop, sendToHost, recentFilesNative } from '../../desktop/ipc.js'
import AudioSettings from '../AudioSettings.vue'

const S = useStudio()
const {
  canUndo, canRedo, undoAction, redoAction, panicAll, clearAll,
  saveProject, loadProjectFile, newProject, autosaveInfo, recoverAutosave, exportMidi, importMidiFile,
  savePatternProject, flpSourceName,
  addChannel, addCustomSynthChannel, addSubterraChannel, addWasmChannel, addForgeChannel, addVstPlugin,
  addPattern, duplicatePattern, removePattern, splitByChannel, findNextEmptyPattern, currentPatternId, patterns,
  addPlaylistTrack, activateWindow, renderModalOpen, themeModalOpen, midiRouterOpen,
  metronomeOn, recordCountIn, keyboardInputMode, autoScroll, usePlaylist, dumpScoreLog, projectName,
  openProjectNative, importProjectFiles,
} = S

// Desktop: recent projects, refreshed whenever the File menu opens.
const recent = ref([])
async function refreshRecent() { if (isDesktop) recent.value = await recentFilesNative() }
const fileOf = p => p.replace(/^.*[\\/]/, '')

const openId = ref(null)
const hoverArmed = ref(false)
const dropX = ref(0)
const dropY = ref(0)
const projectInput = ref(null)
const midiInput = ref(null)
const folderInput = ref(null)
const shortcutsOpen = ref(false)
const aboutOpen = ref(false)

const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const MENUS = [
  {
    id: 'file', label: 'FILE', hint: 'Projects: new, open, save, recover, import and export',
    items: () => [
      { label: 'New project', key: 'Ctrl+N', action: newProject },
      { label: 'Open…', key: 'Ctrl+O', action: openProject },
      { label: 'Save', key: 'Ctrl+S', action: () => saveProject(projectName.value || 'project') },
      { label: 'Save as…', key: 'Ctrl+Shift+S', action: saveAs },
      ...(recent.value.length ? [{ heading: 'RECENT' }, ...recent.value.slice(0, 6).map(p => ({ label: fileOf(p), action: () => openProjectNative(p) }))] : []),
      { label: autosaveInfo.value ? `Recover autosave (${fmtTime(autosaveInfo.value.time)})` : 'Recover autosave',
        action: () => { if (!recoverAutosave()) alert('No autosave found.') }, disabled: () => !autosaveInfo.value },
      { sep: true },
      { heading: 'IMPORT' },
      { label: 'Pattern project (.flp / .zip)…', action: openProject },
      { label: 'Project folder (project + samples)…', action: () => folderInput.value?.click() },
      { label: 'MIDI file…', action: () => midiInput.value?.click() },
      { heading: 'EXPORT' },
      { label: 'Audio (WAV / MP3 / OGG)…', key: 'Ctrl+R', action: () => { renderModalOpen.value = true } },
      { label: 'MIDI file — song', action: () => exportMidi({ mode: 'song' }) },
      { label: 'MIDI file — current pattern', action: () => exportMidi({ mode: 'pattern' }) },
      { label: flpSourceName.value ? `Pattern project (.flp) — save back…` : 'Pattern project (.flp) — open one first',
        action: savePatternProject, disabled: () => !flpSourceName.value },
    ],
  },
  {
    id: 'edit', label: 'EDIT', hint: 'Undo history and global edits',
    items: () => [
      { label: 'Undo', key: 'Ctrl+Z', action: undoAction, disabled: () => !canUndo.value },
      { label: 'Redo', key: 'Ctrl+Y', action: redoAction, disabled: () => !canRedo.value },
      { sep: true },
      { label: 'Clear current pattern', action: clearAll },
      { sep: true },
      { label: 'Panic — all notes off', key: 'Ctrl+Shift+7', action: panicAll },
    ],
  },
  {
    id: 'add', label: 'ADD', hint: 'Add channels, patterns and playlist tracks',
    items: () => [
      { heading: 'CHANNEL' },
      { label: 'Synth (saw)', action: addChannel },
      { label: 'Custom synth', action: addCustomSynthChannel },
      { label: 'Subterra bass', action: addSubterraChannel },
      { label: 'Forge deep slicer', action: addForgeChannel },
      { label: 'WASM / JS plugin', action: addWasmChannel },
      ...(isDesktop ? [{ label: 'VST plugin (.dll / .vst3)…', action: addVstPlugin }] : []),
      { sep: true },
      { label: 'Pattern', key: 'F4', action: addPattern },
      { label: 'Playlist track', action: addPlaylistTrack },
    ],
  },
  {
    id: 'patterns', label: 'PATTERNS', hint: 'Create, clone, split and delete patterns',
    items: () => [
      { label: 'New pattern', key: 'F4', action: addPattern },
      { label: 'Clone current pattern', action: () => duplicatePattern(currentPatternId.value) },
      { label: 'Find next empty pattern', action: findNextEmptyPattern },
      { label: 'Split current by channel', action: () => splitByChannel(currentPatternId.value) },
      { sep: true },
      { label: 'Delete current pattern', action: () => removePattern(currentPatternId.value), disabled: () => patterns.length <= 1 },
    ],
  },
  {
    id: 'view', label: 'VIEW', hint: 'Show windows and switch layouts',
    items: () => [
      { label: 'Session (clip launcher)', key: 'F3', action: () => activateWindow('session') },
      { label: 'Playlist', key: 'F5', action: () => activateWindow('playlist') },
      { label: 'Channel rack', key: 'F6', action: () => activateWindow('rack') },
      { label: 'Piano roll', key: 'F7', action: () => activateWindow('piano') },
      { label: 'Browser', key: 'Alt+F8', action: () => activateWindow('browser') },
      { label: 'Mixer', key: 'F9', action: () => activateWindow('mixer') },
      { sep: true },
      { label: 'Theme…', action: () => { themeModalOpen.value = true } },
      { label: 'Full screen', key: 'F11', action: toggleFullscreen },
    ],
  },
  {
    id: 'options', label: 'OPTIONS', hint: 'Recording, metronome, keyboard and MIDI settings',
    items: () => [
      { label: 'Metronome', action: () => { metronomeOn.value = !metronomeOn.value }, checked: () => metronomeOn.value },
      { label: 'Count-in before recording', action: () => { recordCountIn.value = !recordCountIn.value }, checked: () => recordCountIn.value },
      { label: 'Typing keyboard to piano', action: () => { keyboardInputMode.value = !keyboardInputMode.value }, checked: () => !!keyboardInputMode.value },
      { label: 'Auto-scroll playlist', action: () => { autoScroll.value = !autoScroll.value }, checked: () => autoScroll.value },
      { label: 'Song mode (play arrangement)', action: () => { usePlaylist.value = !usePlaylist.value }, checked: () => usePlaylist.value },
      { sep: true },
      { label: 'MIDI settings…', action: () => { midiRouterOpen.value = true } },
      ...(isDesktop ? [{ label: 'Audio settings…', action: openAudioSettings }] : []),
    ],
  },
  {
    id: 'tools', label: 'TOOLS', hint: 'Score capture, rendering and diagnostics',
    items: () => [
      { label: 'Dump score log to pattern', action: dumpScoreLog },
      { label: 'Render to audio file…', action: () => { renderModalOpen.value = true } },
      ...(isDesktop ? [{ sep: true }, { label: 'Open native engine log', action: () => sendToHost('openLog') }] : []),
    ],
  },
  {
    id: 'help', label: 'HELP', hint: 'Shortcuts and info',
    items: () => [
      { label: 'Keyboard shortcuts', key: 'F1', action: () => { shortcutsOpen.value = true } },
      { label: 'About', action: () => { aboutOpen.value = true } },
    ],
  },
]

const SHORTCUTS = [
  { title: 'Transport', items: [['Space', 'Play / stop'], ['L', 'Pattern / song mode'], ['R', 'Arm recording'], ['Ctrl+Shift+7', 'Panic (silence everything)']] },
  { title: 'Windows', items: [['F3', 'Session (clip launcher)'], ['F5', 'Playlist'], ['F6', 'Channel rack'], ['F7', 'Piano roll'], ['F8 / Alt+F8', 'Browser'], ['F9', 'Mixer'], ['F10', 'MIDI settings'], ['F11', 'Full screen'], ['F12', 'Close all windows'], ['F1', 'This list']] },
  { title: 'Project', items: [['Ctrl+N', 'New project'], ['Ctrl+O', 'Open'], ['Ctrl+S', 'Save'], ['Ctrl+Shift+S', 'Save as'], ['Ctrl+R', 'Render / export'], ['Ctrl+Z / Ctrl+Alt+Z', 'Undo'], ['Ctrl+Y / Ctrl+Shift+Z', 'Redo']] },
  { title: 'Patterns', items: [['F4', 'New pattern'], ['F2', 'Rename pattern'], ['Num + / Num −', 'Next / previous pattern']] },
  { title: 'Live keyboard', items: [['Z–M, Q–]', 'Play the selected channel (typing keyboard on)'], ['- / =', 'Octave down / up'], ['L, R, tool letters', 'Shortcuts when the typing keyboard is off']] },
  { title: 'Playlist tools', items: [['P', 'Draw'], ['B', 'Paint'], ['D', 'Delete'], ['T', 'Mute'], ['S', 'Slip'], ['C', 'Slice'], ['E', 'Select'], ['Y', 'Play from selection']] },
  { title: 'Piano roll', items: [['Ctrl+A', 'Select all'], ['Ctrl+C / Ctrl+V', 'Copy / paste'], ['Ctrl+B', 'Duplicate selection'], ['Ctrl+Q', 'Quantize'], ['Ctrl+L', 'Legato'], ['Ctrl+G', 'Glue'], ['Alt+V', 'Ghost notes']] },
  { title: 'Playlist', items: [['Ctrl+B', 'Duplicate selected clips'], ['Shift+↑ / ↓', 'Move clips between tracks'], ['Shift+1…5', 'Zoom presets'], ['Ctrl+drag ruler', 'Set loop region']] },
]

const currentItems = computed(() => MENUS.find(m => m.id === openId.value)?.items() ?? [])

function place(e) {
  const r = e.currentTarget.getBoundingClientRect()
  dropX.value = Math.min(r.left, window.innerWidth - 260)
  dropY.value = r.bottom + 2
}
function toggle(id, e) {
  if (openId.value === id) { openId.value = null; hoverArmed.value = false; return }
  if (id === 'file') refreshRecent()
  place(e)
  openId.value = id
  hoverArmed.value = true
}
function hoverSwitch(id, e) {
  if (!openId.value || !hoverArmed.value || openId.value === id) return
  place(e)
  openId.value = id
}
function close() { openId.value = null; hoverArmed.value = false }
function run(item) {
  if (item.disabled?.()) return
  close()
  item.action?.()
}

function saveAs() {
  if (isDesktop) { saveProject(projectName.value || 'project', { saveAs: true }); return }
  const name = prompt('Save project as:', projectName.value || 'project')
  if (name) saveProject(name.trim() || 'project')
}
const audio = reactive({ open: false })
function openAudioSettings() { audio.open = true }

function openProject() {
  if (isDesktop) openProjectNative()
  else projectInput.value?.click()
}
function onProjectFile(e) {
  const f = e.target.files?.[0]
  e.target.value = ''
  if (!f) return
  if (/\.(flp|zip)$/i.test(f.name)) runImport([{ path: f.name, name: f.name, file: f }])
  else loadProjectFile(f)
}
function onProjectFolder(e) {
  const files = [...(e.target.files ?? [])]
  e.target.value = ''
  if (files.length) runImport(files.map(f => ({ path: f.webkitRelativePath || f.name, name: f.name, file: f })))
}
async function runImport(entries) {
  try { await importProjectFiles(entries) } catch (err) { alert('Could not open the project: ' + err.message) }
}
async function onMidiFile(e) {
  const f = e.target.files?.[0]
  e.target.value = ''
  if (!f) return
  try { importMidiFile(await f.arrayBuffer(), f.name) } catch (err) { alert('Could not import MIDI: ' + err.message) }
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.()
  else document.documentElement.requestFullscreen?.()
}

function onDocDown() { close() }
function onKey(e) {
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (e.key === 'Escape') { close(); shortcutsOpen.value = false; aboutOpen.value = false; return }
  if (e.key === 'F1') { e.preventDefault(); shortcutsOpen.value = !shortcutsOpen.value; return }
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return }
  if (e.key === 'F10') { e.preventDefault(); midiRouterOpen.value = true; return }
  // Undo everywhere: Ctrl+Z (Ctrl+Alt+Z steps back too), Ctrl+Y / Ctrl+Shift+Z redo.
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { S.undoFromKey(e, e.shiftKey); return }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { S.undoFromKey(e, true); return }
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  const k = e.key.toLowerCase()
  if (k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else saveProject(projectName.value || 'project') }
  else if (k === 'o') { e.preventDefault(); openProject() }
  else if (k === 'n' && !e.shiftKey) { e.preventDefault(); newProject() }
  else if (k === 'r' && !e.shiftKey) { e.preventDefault(); renderModalOpen.value = true }
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.mb { display: flex; align-items: center; gap: 1px; flex-shrink: 0; }
.mb-title {
  background: none; border: 1px solid transparent; border-radius: 3px;
  color: var(--text-muted); cursor: pointer;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
  padding: 3px 7px; line-height: 1.2;
}
.mb-title:hover, .mb-title.open { color: var(--text-primary); background: var(--bg-hover); border-color: var(--border-subtle); }
</style>

<style>
/* Teleported to <body>, so these can't be scoped. */
.mb-drop {
  position: fixed; z-index: 10000; min-width: 230px; padding: 4px 0;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 4px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  font-family: 'Rajdhani', sans-serif; font-size: 13px; color: var(--text-primary);
}
.mb-item { display: flex; align-items: center; gap: 6px; padding: 4px 12px 4px 6px; cursor: pointer; white-space: nowrap; }
.mb-item:hover { background: var(--bg-hover); }
.mb-item.disabled { opacity: 0.38; cursor: default; }
.mb-item.disabled:hover { background: none; }
.mb-check { width: 14px; text-align: center; color: #f0a030; font-size: 11px; }
.mb-label { flex: 1; }
.mb-key { color: var(--text-muted); font-family: 'Share Tech Mono', monospace; font-size: 10px; padding-left: 18px; }
.mb-sep { height: 1px; margin: 4px 8px; background: var(--border-subtle); }
.mb-heading {
  padding: 5px 12px 2px 26px; color: var(--text-muted);
  font-size: 9px; font-weight: 700; letter-spacing: 0.18em;
}

.mb-modal-back {
  position: fixed; inset: 0; z-index: 10001; background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.mb-modal {
  width: min(860px, 92vw); max-height: 82vh; display: flex; flex-direction: column;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); color: var(--text-primary);
  font-family: 'Rajdhani', sans-serif;
}
.mb-modal--about { width: min(440px, 92vw); }
.mb-modal-hdr {
  display: flex; align-items: center; justify-content: space-between; padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 11px; font-weight: 700; letter-spacing: 0.2em; color: var(--text-muted);
}
.mb-modal-x { background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; }
.mb-modal-x:hover { color: var(--text-primary); }
.mb-modal-body { overflow: auto; padding: 12px 16px; columns: 2 280px; column-gap: 28px; }
.mb-sc-group { break-inside: avoid; margin-bottom: 14px; }
.mb-sc-group h4 { font-size: 10px; letter-spacing: 0.2em; color: #f0a030; margin-bottom: 5px; }
.mb-sc-row { display: flex; gap: 10px; align-items: baseline; padding: 2px 0; font-size: 13px; }
.mb-sc-row kbd {
  min-width: 120px; font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--text-primary);
}
.mb-about { padding: 18px; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
.mb-about-logo { font-size: 20px; font-weight: 700; letter-spacing: 0.1em; }
.mb-about-logo em { font-style: normal; color: #e74c3c; }
.mb-about-meta { color: var(--text-muted); font-size: 12px; }
</style>
