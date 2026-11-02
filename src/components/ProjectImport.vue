<template>
  <!-- Drop target: shown while project files are dragged over the window -->
  <div v-if="dragging" class="pi-drop">
    <div class="pi-drop-box">
      <div class="pi-drop-title">DROP TO OPEN</div>
      <div class="pi-drop-sub">.flp project · .zip package · or a folder with the project and its samples</div>
    </div>
  </div>

  <!-- Progress -->
  <div v-if="importState.busy" class="pi-back">
    <div class="pi-busy">
      <div class="pi-spinner" />
      <span>{{ importState.stage || 'Opening…' }}</span>
    </div>
  </div>

  <!-- Report -->
  <div v-else-if="rep && open" class="pi-back" @mousedown.self="open = false">
    <div class="pi-modal">
      <div class="pi-hdr">
        <span>PROJECT OPENED</span>
        <button class="pi-x" @click="open = false">×</button>
      </div>
      <div class="pi-body">
        <div class="pi-title">{{ rep.name }}</div>
        <div class="pi-meta">
          Version {{ rep.version || '?' }} · {{ rep.tempo }} BPM · opened in {{ rep.ms }} ms (read in {{ rep.parseMs }} ms)
        </div>
        <div class="pi-stats">
          <div><b>{{ rep.channels }}</b> channels</div>
          <div><b>{{ rep.patterns }}</b> patterns</div>
          <div><b>{{ rep.clips }}</b> clips</div>
          <div><b>{{ rep.automationClips }}</b> automation</div>
          <div><b>{{ rep.inserts }}</b> mixer tracks</div>
          <div :class="{ warn: rep.samplesMissing.length }"><b>{{ rep.samplesFound }}/{{ rep.samplesTotal }}</b> samples</div>
        </div>

        <section v-if="rep.plugins.length">
          <h4>PLUGINS</h4>
          <div v-for="(p, i) in rep.plugins" :key="'p' + i" class="pi-row">
            <span class="pi-dot" :class="p.status.startsWith('loaded') ? 'ok' : 'miss'" />
            <span class="pi-name">{{ p.name }}</span>
            <span class="pi-note">{{ p.status }}</span>
          </div>
        </section>

        <section v-if="rep.substituted.length">
          <h4>STAND-IN INSTRUMENTS <small>(the original generator can't run here)</small></h4>
          <div v-for="(s, i) in rep.substituted" :key="'s' + i" class="pi-row">
            <span class="pi-dot sub" />
            <span class="pi-name">{{ s.name }}</span>
            <span class="pi-note">→ {{ s.as }}<template v-if="s.plugin"> · was {{ s.plugin }}</template></span>
          </div>
        </section>

        <section v-if="rep.samplesMissing.length">
          <h4>MISSING SAMPLES</h4>
          <p class="pi-hint">
            Drop the folder that holds them onto the window together with the project, or open the project's .zip package.
          </p>
          <div v-for="(m, i) in rep.samplesMissing.slice(0, 40)" :key="'m' + i" class="pi-row">
            <span class="pi-dot miss" />
            <span class="pi-path">{{ m }}</span>
          </div>
          <div v-if="rep.samplesMissing.length > 40" class="pi-note">…and {{ rep.samplesMissing.length - 40 }} more</div>
        </section>

        <section v-if="rep.effectsMapped || rep.effectsSkipped.length || rep.automationUnassigned || rep.notes.length">
          <h4>MIXER &amp; AUTOMATION</h4>
          <div class="pi-note">{{ rep.effectsMapped }} effects mapped to built-in ones<template v-if="rep.effectsSkipped.length">; skipped: {{ [...new Set(rep.effectsSkipped)].join(', ') }}</template>.</div>
          <div v-if="rep.automationUnassigned" class="pi-note">{{ rep.automationUnassigned }} automation clips move plugin settings that have no equivalent here — they're kept, unassigned.</div>
          <div v-for="(n, i) in rep.notes" :key="'n' + i" class="pi-note">{{ n }}</div>
        </section>
      </div>
      <div class="pi-foot">
        <button class="pi-btn" @click="open = false">OK</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'

const { importState, importProjectFiles } = useStudio()
const rep = ref(null)
const open = ref(false)
watch(() => importState.report, r => { rep.value = r; open.value = !!r })

const dragging = ref(false)
let leaveTimer = null

const isProjectName = n => /\.(flp|zip)$/i.test(n)

// Only take over drags that carry files; audio drops onto channels and the
// playlist keep working because we act only on project files and folders.
function onDragOver(e) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  const items = [...(e.dataTransfer.items ?? [])]
  const maybe = items.some(it => it.kind === 'file' && (it.type === '' || /zip/.test(it.type)))
  if (!maybe) return
  dragging.value = true
  clearTimeout(leaveTimer)
  leaveTimer = setTimeout(() => { dragging.value = false }, 250)
}

async function collect(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej))
    out.push({ path: prefix + file.name, name: file.name, file })
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const e of batch) await collect(e, prefix + entry.name + '/', out)
    }
  }
}

async function onDrop(e) {
  dragging.value = false
  const dt = e.dataTransfer
  if (!dt) return
  const items = [...(dt.items ?? [])]
  const entries = items.map(it => it.webkitGetAsEntry?.()).filter(Boolean)
  const hasProject = entries.some(en => en.isDirectory || isProjectName(en.name)) || [...(dt.files ?? [])].some(f => isProjectName(f.name))
  if (!hasProject) return
  e.preventDefault()
  e.stopPropagation()
  const out = []
  try {
    if (entries.length) for (const en of entries) await collect(en, '', out)
    else for (const f of dt.files) out.push({ path: f.name, name: f.name, file: f })
    if (!out.some(f => isProjectName(f.name))) return
    await importProjectFiles(out)
  } catch (err) {
    console.error('[import]', err)
    alert('Could not open the project: ' + err.message)
  }
}

onMounted(() => {
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop, true)
})
</script>

<style scoped>
.pi-drop {
  position: fixed; inset: 0; z-index: 10002; pointer-events: none;
  background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center;
}
.pi-drop-box {
  border: 2px dashed var(--text-muted); border-radius: 10px; padding: 28px 40px; text-align: center;
  background: var(--bg-panel); color: var(--text-primary); font-family: 'Rajdhani', sans-serif;
}
.pi-drop-title { font-size: 18px; font-weight: 700; letter-spacing: 0.25em; }
.pi-drop-sub { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
.pi-back {
  position: fixed; inset: 0; z-index: 10001; background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.pi-busy {
  display: flex; align-items: center; gap: 12px; padding: 16px 22px; border-radius: 8px;
  background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-primary);
  font-family: 'Rajdhani', sans-serif; font-size: 14px; letter-spacing: 0.05em;
}
.pi-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--text-primary); animation: pi-spin 0.8s linear infinite;
}
@keyframes pi-spin { to { transform: rotate(360deg); } }
.pi-modal {
  width: min(680px, 92vw); max-height: 84vh; display: flex; flex-direction: column;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); color: var(--text-primary); font-family: 'Rajdhani', sans-serif;
}
.pi-hdr {
  display: flex; align-items: center; justify-content: space-between; padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle); font-size: 11px; font-weight: 700; letter-spacing: 0.2em; color: var(--text-muted);
}
.pi-x { background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; }
.pi-body { padding: 12px 16px; overflow: auto; }
.pi-title { font-size: 18px; font-weight: 700; }
.pi-meta { font-size: 12px; color: var(--text-muted); margin: 2px 0 10px; }
.pi-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
.pi-stats > div { background: var(--bg-deeper); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 6px 8px; font-size: 12px; color: var(--text-muted); }
.pi-stats b { color: var(--text-primary); font-size: 15px; margin-right: 4px; }
.pi-stats .warn b { color: #f39c12; }
section { margin-top: 12px; }
h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.18em; color: var(--text-muted); }
h4 small { letter-spacing: 0; font-weight: 400; }
.pi-row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; padding: 2px 0; }
.pi-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; transform: translateY(-1px); }
.pi-dot.ok { background: #2ecc71; }
.pi-dot.miss { background: #e74c3c; }
.pi-dot.sub { background: #f39c12; }
.pi-name { font-weight: 600; white-space: nowrap; }
.pi-note { color: var(--text-muted); font-size: 12px; }
.pi-path { color: var(--text-muted); font-size: 11px; font-family: ui-monospace, monospace; word-break: break-all; }
.pi-hint { font-size: 12px; color: var(--text-muted); margin: 0 0 6px; }
.pi-foot { display: flex; justify-content: flex-end; padding: 8px 12px; border-top: 1px solid var(--border-subtle); }
.pi-btn {
  background: var(--bg-control); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px;
  padding: 4px 18px; font-family: inherit; font-weight: 700; letter-spacing: 0.1em; cursor: pointer;
}
.pi-btn:hover { background: var(--bg-hover); }
</style>
