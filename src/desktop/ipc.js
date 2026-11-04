// Bridge between the Vue UI and the native Rust host (crates/host).
// CONTROL MESSAGES ONLY — audio lives in the native engine and never crosses here.
//
// The host injects `window.__flsHost` before the page loads. In a plain browser
// it's undefined and every call is a safe no-op, so the web build keeps running
// unchanged.

const host = typeof window !== 'undefined' ? window.__flsHost : undefined

/** True when running inside the native desktop app. */
export const isDesktop = !!host

const handlers = new Set()

if (host) {
  host.on((msg) => {
    if (!msg || typeof msg !== 'object') return
    for (const h of handlers) h(msg)
  })
}

/** Send a typed control message to the host. No-op in the browser. */
export function sendToHost(type, payload = null) {
  if (!host) return
  host.post({ type, payload })
}

/** Subscribe to messages from the host. Returns an unsubscribe fn. */
export function onHostMessage(handler) {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

/**
 * Startup handshake: ping the host and log the reply. `fresh` (page load)
 * tells the host this is a new UI, so plugins a previous page left loaded
 * are released.
 */
export function pingHost({ fresh = false } = {}) {
  if (!host) {
    console.info('[ipc] running in browser — no native host')
    return
  }
  onHostMessage((msg) => {
    if (msg.type === 'pong') {
      console.info('[ipc] host round-trip OK:', msg.payload)
    }
  })
  sendToHost('ping', { from: 'vue', time: Date.now(), fresh })
}

/** Ask the native engine to start/stop a diagnostic sine tone. */
export function testTone(on = true, freq = 440) {
  sendToHost('testTone', { on, freq })
}

// Every VST call carries the channel id so the native host can keep many plugin
// instances (mixed 32/64-bit) alive at once, one per Channel Rack VST channel.

/** Open the native file picker for channel `id`, then load the chosen plugin into it. */
export function pickVst(id) {
  sendToHost('pickVst', { id })
}

/** Load a VST2 .dll or VST3 by absolute path into channel `id` (optionally restoring a saved state;
 *  `classId` picks the class inside a multi-plugin VST3). */
export function loadVst(id, path, state = undefined, classId = undefined) {
  sendToHost('loadVst', { id, path, state, classId })
}

/** Play / release a note on channel `id`'s plugin instance. */
export function vstNoteOn(id, pitch = 60, velocity = 100) {
  sendToHost('vstNoteOn', { id, pitch, velocity })
}
export function vstNoteOff(id, pitch = 60) {
  sendToHost('vstNoteOff', { id, pitch })
}

/** Release every sounding note on one plugin (or on all of them when `id` is omitted). */
export function vstAllNotesOff(id = undefined) {
  sendToHost('vstAllNotesOff', { id })
}

/** Unload channel `id`'s plugin instance (frees the in-process plugin or bridge). */
export function unloadVst(id) {
  sendToHost('vstUnload', { id })
}

/** Toggle channel `id`'s plugin editor window. */
export function openVstEditor(id) {
  sendToHost('openVstEditor', { id })
}

/** Tell plugins the song tempo / meter / play state (for tempo-synced effects). */
export function sendTransport(bpm, playing, num = 4, den = 4) {
  sendToHost('transport', { bpm, playing, num, den })
}

// Request/response helpers keyed by reqId.
const pending = new Map()
let reqSeq = 0
if (host) {
  onHostMessage((msg) => {
    const p = msg.payload?.reqId && pending.get(msg.payload.reqId)
    if (p && msg.type === p.reply) {
      pending.delete(msg.payload.reqId)
      clearTimeout(p.timer)
      p.resolve(msg.payload)
    }
  })
}
function request(type, reply, payload, timeoutMs = 10000) {
  if (!host) return Promise.resolve(null)
  const reqId = type + '-' + (++reqSeq)
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(reqId); resolve(null) }, timeoutMs)
    pending.set(reqId, { resolve, reply, timer })
    sendToHost(type, { ...payload, reqId })
  })
}

// ── Native files (desktop) ───────────────────────────────────────────────────
// Dialogs block until the user answers, so these wait for as long as it takes.
const DIALOG_MS = 60 * 60 * 1000

/** Save text (`data`) or binary (`base64`) to `path`, or via the Save dialog when no path. */
export function saveFileNative({ path = null, suggestedName, data, base64, filter }) {
  return request('fileSave', 'fileSaved', { path, suggestedName, data, base64, filter }, DIALOG_MS)
}

/** Read a text file: from `path`, or one picked in the Open dialog. */
export function openFileNative({ path = null, filter } = {}) {
  return request('fileOpen', 'fileOpened', { path, filter }, DIALOG_MS)
}

/**
 * Find an imported project's samples and plugins on this machine. Resolves to
 * `{ samples: { stored: path|null }, plugins: [{ path, arch, how }|null] }`.
 * The first run may walk the disks, so allow it time.
 */
export function resolveAssetsNative({ project = null, folders = [], samples = [], plugins = [] }) {
  return request('resolveAssets', 'assetsResolved', { project, folders, samples, plugins }, 5 * 60 * 1000)
}

/** Choose a folder in the native dialog → path, or null when cancelled. */
export async function pickFolderNative(title) {
  const r = await request('pickFolder', 'folderPicked', { title }, DIALOG_MS)
  return r && !r.cancelled ? r.path : null
}

/** URL the UI can fetch a host-approved local file from (opened or located). */
export function hostFileUrl(path) {
  return 'http://fls.localhost/__file/' + String(path).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
}

/** Recently opened / saved projects (most recent first). */
export async function recentFilesNative() {
  const res = await request('recentFiles', 'recentFiles', {})
  return res?.files ?? []
}

/** Output devices of the native engine: { devices, current, sampleRate }. */
export function listAudioDevices() {
  return request('audioDevices', 'audioDevices', {})
}

/** Move the native engine to another output device (null = system default). */
export function setAudioDevice(name) {
  return request('setAudioDevice', 'audioDevices', { name }, 20000)
}

/**
 * Drivers, their devices and what's running:
 * { drivers: [{ id, name, devices }], config, running: { driver, device, rate, buffer, latency, format, bufferSizes }, error }
 */
export function getAudioConfig() {
  return request('audioDevices', 'audioDevices', {})
}

/** Reopen the engine: { driver: 'shared'|'exclusive'|'asio', device, buffer, rate } (empty = default). */
export function setAudioConfig(cfg) {
  return request('setAudioConfig', 'audioDevices', cfg, 30000)
}

/**
 * A sound-font preset read by the host: { info: { name, bank, program, zones,
 * samples }, url } (samples as one f32 file), or { error }.
 */
export function loadSf2PresetNative(path, bank = 0, program = 0) {
  return request('sf2Preset', 'sf2Preset', { path, bank, program }, 120000)
}

/** The ASIO driver's own settings window. */
export function openAsioPanel() {
  sendToHost('asioPanel', {})
}

export function setWindowTitle(title) {
  sendToHost('setTitle', { title })
}

/** Uint8Array / ArrayBuffer → base64 (chunked, safe for large files). */
export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Snapshot channel `id`'s plugin state (base64), so a project can restore the sound. */
export async function getVstState(id) {
  const res = await request('vstGetState', 'vstState', { id })
  return res?.data ?? null
}

/** Restore a state snapshot taken with getVstState. */
export function setVstState(id, data) {
  if (data) sendToHost('vstSetState', { id, data })
}

// Debug handle exposed only inside the desktop app, so you can poke the bridge
// from the devtools console — e.g. __desktop.testTone(true), or
// __desktop.loadVst('ch1', 'C:\\path\\to\\synth.dll') then __desktop.vstNoteOn('ch1', 60).
if (host) {
  onHostMessage((msg) => {
    if (msg.type === 'vstLoaded') console.info('[vst] loaded:', msg.payload?.id, msg.payload?.name, msg.payload)
    if (msg.type === 'vstError') console.error('[vst] error:', msg.payload?.id, msg.payload?.message)
  })
  window.__desktop = {
    sendToHost, onHostMessage, isDesktop, ping: pingHost,
    testTone, pickVst, loadVst, vstNoteOn, vstNoteOff, vstAllNotesOff, unloadVst, openVstEditor,
    sendTransport, getVstState, setVstState,
    openLog: () => sendToHost('openLog'),
  }
}
