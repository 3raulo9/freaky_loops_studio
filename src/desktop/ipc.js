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

// Debug handle exposed only inside the desktop shell, so you can poke the bridge
// from the WebView DevTools console — e.g. __desktop.testTone(true) to hear it.
if (host) {
  window.__desktop = { sendToHost, onHostMessage, testTone, ping: pingHost, isDesktop }
}
