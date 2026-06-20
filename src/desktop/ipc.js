// Bridge between the Vue UI and the native C# host (WebView2).
// CONTROL MESSAGES ONLY — audio lives in the native engine and never crosses here.
//
// In a plain browser (no WebView2) `host` is undefined and every call is a safe
// no-op, so the existing web build keeps running unchanged.

const host = typeof window !== 'undefined' ? window.chrome?.webview : undefined

/** True when running inside the native desktop shell. */
export const isDesktop = !!host

const handlers = new Set()

if (host) {
  host.addEventListener('message', (event) => {
    // C# uses PostWebMessageAsJson, so event.data is already a parsed object.
    const msg = event.data
    if (!msg || typeof msg !== 'object') return
    for (const h of handlers) h(msg)
  })
}

/** Send a typed control message to the host. No-op in the browser. */
export function sendToHost(type, payload = null) {
  if (!host) return
  host.postMessage({ type, payload })
}

/** Subscribe to messages from the host. Returns an unsubscribe fn. */
export function onHostMessage(handler) {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

/** Phase 0a handshake: ping the host on startup and log the reply. */
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

/** Phase 0b: ask the native engine to start/stop a sine tone. */
export function testTone(on = true, freq = 440) {
  sendToHost('testTone', { on, freq })
}

// Every VST call carries the channel id so the native host can keep many plugin
// instances (mixed 32/64-bit) alive at once, one per Channel Rack VST channel.

/** Open the native file picker for channel `id`, then load the chosen .dll into it. */
export function pickVst(id) {
  sendToHost('pickVst', { id })
}

/** Load a VST2 .dll by absolute path into the plugin instance for channel `id`. */
export function loadVst(id, path) {
  sendToHost('loadVst', { id, path })
}

/** Play / release a note on channel `id`'s plugin instance. */
export function vstNoteOn(id, pitch = 60, velocity = 100) {
  sendToHost('vstNoteOn', { id, pitch, velocity })
}
export function vstNoteOff(id, pitch = 60) {
  sendToHost('vstNoteOff', { id, pitch })
}

/** Unload channel `id`'s plugin instance (frees the in-process host or bridge). */
export function unloadVst(id) {
  sendToHost('vstUnload', { id })
}

/** Toggle channel `id`'s plugin editor window. */
export function openVstEditor(id) {
  sendToHost('openVstEditor', { id })
}

// Debug handle exposed only inside the desktop shell, so you can poke the bridge
// from the WebView DevTools console — e.g. __desktop.testTone(true), or
// __desktop.loadVst('C:\\path\\to\\synth.dll') then __desktop.vstNoteOn(60).
if (host) {
  onHostMessage((msg) => {
    if (msg.type === 'vstLoaded') console.info('[vst] loaded:', msg.payload?.id, msg.payload?.name, msg.payload)
    if (msg.type === 'vstError') console.error('[vst] error:', msg.payload?.id, msg.payload?.message)
    if (msg.type === 'vstPeak') console.info('[vst] level:', msg.payload?.id, msg.payload?.peak)
  })
  window.__desktop = {
    sendToHost, onHostMessage, isDesktop, ping: pingHost,
    testTone, pickVst, loadVst, vstNoteOn, vstNoteOff, unloadVst, openVstEditor,
  }
}
