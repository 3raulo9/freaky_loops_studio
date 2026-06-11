<template>
  <div class="browser">
    <div class="browser-head">
      <span class="browser-title">BROWSER</span>
      <span class="browser-count">{{ browserAssetCount }} instruments</span>
      <button class="browser-close" title="Close browser (Alt+F8)" @click="browserOpen = false">✕</button>
    </div>

    <!-- Search bar — prefix index lookup, not a live disk scan -->
    <div class="browser-search">
      <span class="browser-search-ico">⌕</span>
      <input
        v-model="query"
        class="browser-search-input"
        placeholder="Search instruments…"
        spellcheck="false"
      />
      <button v-if="query" class="browser-search-clear" @click="query = ''">✕</button>
    </div>
    <div v-if="query.trim()" class="browser-results">{{ rows.length }} result{{ rows.length === 1 ? '' : 's' }}</div>

    <!-- Virtualized tree-grid: only the visible slice is instantiated -->
    <div ref="scrollEl" class="browser-scroll" @scroll="onScroll">
      <div class="browser-virt" :style="{ height: rows.length * ROW_H + 'px' }">
        <div class="browser-rows" :style="{ transform: `translateY(${start * ROW_H}px)` }">
          <div
            v-for="row in visible"
            :key="row.key"
            class="browser-row"
            :class="{ on: row.active, folder: row.kind === 'folder', draggable: row.kind === 'asset' }"
            :style="{ height: ROW_H + 'px', paddingLeft: (7 + row.depth * 13) + 'px' }"
            @click="onRowClick(row)"
            @mousedown="row.kind === 'asset' && startAssetDrag(row.asset, $event)"
          >
            <template v-if="row.kind === 'folder'">
              <span class="browser-caret">{{ expanded.has(row.id) ? '▾' : '▸' }}</span>
              <span class="browser-name">{{ row.name }}</span>
              <span class="browser-fcount">{{ row.count }}</span>
            </template>

            <template v-else-if="row.kind === 'pattern' || row.kind === 'channel'">
              <span class="browser-swatch" :style="{ background: row.color }" />
              <span class="browser-name">{{ row.name }}</span>
              <span class="browser-type">{{ row.kind }}</span>
            </template>

            <template v-else>
              <span class="browser-aico" :class="'cat-' + row.asset.cat">♪</span>
              <span class="browser-name">{{ row.asset.name }}</span>
              <svg v-if="previewingId === row.asset.id" class="browser-wave" viewBox="0 0 46 14" preserveAspectRatio="none">
                <path :d="wavePath(row.asset.wave)" />
              </svg>
              <span v-else class="browser-type">{{ row.asset.type }}</span>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'
import { browserFolders, assetAt, getAsset, searchAssets, browserAssetCount } from '../browserLibrary.js'

const { patterns, currentPatternId, channels, selectedChannelId, mainView, previewingId, previewAsset, browserOpen, startInstrumentDrag } = useStudio()

const ROW_H = 22
const query = ref('')
const expanded = reactive(new Set())

// ── Flat row model (tree → flattened, or search results) ──────────────────────
const topNodes = computed(() => ([
  { id: 'prj-patterns', name: 'Patterns', dyn: 'patterns', count: patterns.length },
  { id: 'prj-channels', name: 'Channels', dyn: 'channels', count: channels.length },
  ...browserFolders.map(f => ({ id: f.id, name: f.name, count: f.count, folderRef: f })),
]))

const rows = computed(() => {
  const q = query.value.trim()
  if (q) {
    return searchAssets(q).map(i => {
      const a = assetAt(i)
      return { key: a.id, kind: 'asset', depth: 0, asset: a, active: previewingId.value === a.id }
    })
  }
  const out = []
  for (const node of topNodes.value) {
    out.push({ key: node.id, kind: 'folder', depth: 0, id: node.id, name: node.name, count: node.count, node })
    if (!expanded.has(node.id)) continue
    if (node.dyn === 'patterns') {
      patterns.forEach((p, i) => out.push({ key: 'p' + p.id, kind: 'pattern', depth: 1, name: (i + 1) + '. ' + p.name, color: p.color, item: p, active: p.id === currentPatternId.value }))
    } else if (node.dyn === 'channels') {
      channels.forEach(ch => out.push({ key: 'c' + ch.id, kind: 'channel', depth: 1, name: ch.name, color: ch.color, item: ch, active: ch.id === selectedChannelId.value }))
    } else {
      node.folderRef.childIdx.forEach(ci => {
        const a = assetAt(ci)
        out.push({ key: a.id, kind: 'asset', depth: 1, asset: a, active: previewingId.value === a.id })
      })
    }
  }
  return out
})

// ── Virtualization (viewport clamp + row recycle) ─────────────────────────────
const scrollEl = ref(null)
const scrollTop = ref(0)
const viewH = ref(420)
const OVER = 6
const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVER))
const visCount = computed(() => Math.ceil(viewH.value / ROW_H) + OVER * 2)
const visible = computed(() => rows.value.slice(start.value, start.value + visCount.value))

function onScroll() { scrollTop.value = scrollEl.value.scrollTop }
function measure() { if (scrollEl.value) viewH.value = scrollEl.value.clientHeight }

let ro = null
onMounted(() => {
  measure()
  ro = new ResizeObserver(measure)
  if (scrollEl.value) ro.observe(scrollEl.value)
})
onBeforeUnmount(() => { ro?.disconnect() })

// ── Interaction ───────────────────────────────────────────────────────────────
function onRowClick(row) {
  if (row.kind === 'folder') {
    expanded.has(row.id) ? expanded.delete(row.id) : expanded.add(row.id)
  } else if (row.kind === 'pattern') {
    currentPatternId.value = row.item.id
  } else if (row.kind === 'channel') {
    selectedChannelId.value = row.item.id
    mainView.value = 'sequencer'
  } else {
    previewAsset(row.asset)        // instant, mixer-bypass preview
  }
}

// Drag an asset toward the Channel Rack: a visible ghost follows the cursor and
// dropping on a channel replaces it (or adds a new sampler channel over empty
// rack space). A plain click without dragging still previews the sample.
function startAssetDrag(asset, e) {
  startInstrumentDrag({ t: 'sample', asset }, asset.name, asset.color || '#4ecdc4', e)
}

function wavePath(wave) {
  const W = 46, H = 14
  let d = ''
  for (let i = 0; i < wave.length; i++) {
    const x = (i / (wave.length - 1)) * W
    const y = H / 2 - wave[i] * (H / 2) * 0.9
    d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)
  }
  return d
}
</script>

<style scoped>
.browser { display: flex; flex-direction: column; height: 100%; background: var(--bg-header); user-select: none; }
.browser-head {
  display: flex; align-items: baseline; gap: 8px; padding: 7px 10px 5px; flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
}
.browser-title {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.2em; color: #f1c40f;
}
.browser-count { font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #34344a; margin-left: auto; }
.browser-close {
  background: none; border: none; color: #50506e; cursor: pointer;
  font-size: 11px; line-height: 1; padding: 0 2px;
}
.browser-close:hover { color: #e74c3c; }

.browser-search {
  display: flex; align-items: center; gap: 5px; margin: 6px 8px;
  padding: 0 7px; height: 24px; flex-shrink: 0;
  background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 5px;
}
.browser-search:focus-within { border-color: #f1c40f88; }
.browser-search-ico { color: #50506e; font-size: 12px; }
.browser-search-input {
  flex: 1; min-width: 0; background: transparent; border: none; outline: none;
  color: var(--text-primary); font-family: 'Rajdhani', sans-serif; font-size: 12px;
}
.browser-search-clear { background: none; border: none; color: #50506e; cursor: pointer; font-size: 11px; }
.browser-search-clear:hover { color: #e74c3c; }
.browser-results {
  padding: 0 12px 4px; flex-shrink: 0;
  font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #40405a;
}

.browser-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; position: relative; }
.browser-virt { position: relative; width: 100%; }
.browser-rows { position: absolute; top: 0; left: 0; right: 0; }

.browser-row {
  display: flex; align-items: center; gap: 6px; padding-right: 8px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; color: #8a8ab0;
  cursor: pointer; white-space: nowrap;
}
.browser-row:hover { background: var(--bg-hover); color: var(--text-primary); }
.browser-row.on { background: var(--bg-control); color: #fff; }
.browser-row.folder { color: #b0b0d0; font-weight: 600; }
.browser-row.draggable { cursor: grab; }
.browser-row.draggable:active { cursor: grabbing; }

.browser-caret { width: 10px; color: #50506e; flex-shrink: 0; }
.browser-fcount { margin-left: auto; font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #34344a; }
.browser-swatch { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.browser-aico { width: 11px; font-size: 10px; flex-shrink: 0; text-align: center; }
.cat-kick, .cat-bass { color: #e74c3c; }
.cat-snare { color: #f39c12; }
.cat-hat { color: #f1c40f; }
.cat-loop { color: #3498db; }
.cat-pad, .cat-pluck { color: #9b59b6; }
.cat-tone { color: #1abc9c; }
.cat-noise { color: #95a5a6; }
.browser-name { overflow: hidden; text-overflow: ellipsis; }
.browser-type {
  margin-left: auto; font-family: 'Share Tech Mono', monospace; font-size: 8px;
  color: #34344a; text-transform: uppercase; flex-shrink: 0;
}
.browser-wave { margin-left: auto; width: 46px; height: 14px; flex-shrink: 0; }
.browser-wave path { fill: none; stroke: #2ecc71; stroke-width: 1; vector-effect: non-scaling-stroke; }
</style>
