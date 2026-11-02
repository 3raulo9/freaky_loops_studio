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

/** Startup handshake: ping the host and log the reply. */
export function pingHost() {
  if (!host) {
    console.info('[ipc] running in browser — no native host')
    return
  }
  onHostMessage((msg) => {
    if (msg.type === 'pong') {
      console.info('[ipc] host round-trip OK:', msg.payload)
    }
  })
  sendToHost('ping', { from: 'vue', time: Date.now() })
}

/** Ask the native engine to start/stop a diagnostic sine tone. */
export function testTone(on = true, freq = 440) {
  sendToHost('testTone', { on, freq })
}

// Every VST call carries the channel id so the native host can keep many plugin
// instances (mixed 32/64-bit) alive at once, one per Channel Rack VST channel.

/** Open the native file picker for channel `id`, then load the chosen .dll into it. */
export function pickVst(id) {
  sendToHost('pickVst', { id })
}

/** Load a VST2 .dll by absolute path into channel `id` (optionally restoring a saved state). */
export function loadVst(id, path, state = undefined) {
  sendToHost('loadVst', { id, path, state })
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
