// ─── Native output bus (desktop app) ───────────────────────────────────────────
//   The desktop host plays everything through one native audio engine (its
//   own driver, buffer size and clock). This app's Web Audio output joins it:
//
//     master → bus.input → [tap worklet] ⇄ MessagePort ⇄ [worker] → WebSocket → host
//
//   The tap posts each 128-frame render quantum (stamped with the context's
//   frame counter) straight to a worker — no main-thread hop — and the worker
//   forwards it to the host's local socket. Buffers travel back to the tap so
//   the audio thread doesn't allocate. While the socket is up the tap feeds
//   the device only silence. The context's clock: in shared mode it keeps its
//   default output (rendering then runs on the browser's real-time device
//   thread — far steadier than its timer); when the engine holds the device
//   exclusively (`sink: 'none'`) it renders with no device at all. If the
//   socket drops, the mix goes straight to the default output again.
//
//   Wire format: see crates/native/src/webbus.rs.

const TAP_SRC = `
class FlsBusTap extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.bus = (options && options.processorOptions && options.processorOptions.bus) || 0
    this.out = null
    this.free = []
    this.port.onmessage = e => {
      if (e.data && e.data.port) {
        this.out = e.data.port
        this.out.onmessage = m => { if (this.free.length < 64) this.free.push(m.data) }
      }
    }
  }
  process(inputs) {
    const out = this.out
    const inp = inputs[0]
    if (!out || !inp || !inp.length) return true
    const l = inp[0], r = inp[1] || inp[0], n = l.length
    let buf = this.free.pop()
    if (!buf || buf.byteLength !== 32 + n * 8) buf = new ArrayBuffer(32 + n * 8)
    const h = new Uint32Array(buf, 0, 8)
    const f = new Float32Array(buf, 32, n * 2)
    let silent = true
    for (let i = 0; i < n; i++) {
      const a = l[i], b = r[i]
      f[i * 2] = a; f[i * 2 + 1] = b
      if (a !== 0 || b !== 0) silent = false
    }
    const frame = currentFrame
    h[0] = 0x42534c46; h[1] = 1; h[2] = sampleRate; h[3] = n
    h[4] = frame % 4294967296; h[5] = Math.floor(frame / 4294967296)
    h[6] = silent ? 1 : 0; h[7] = this.bus
    out.postMessage(buf, [buf])
    return true
  }
}
registerProcessor('fls-bus-tap', FlsBusTap)
`

const WORKER_SRC = `
let ws = null, open = false, url = null
function connect() {
  ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => { open = true; postMessage({ type: 'open' }) }
  ws.onclose = () => { if (open) postMessage({ type: 'close' }); open = false; setTimeout(connect, 1000) }
  ws.onerror = () => {}
}
onmessage = e => {
  const d = e.data
  if (d.type === 'port') { listen(d.port); return }
  if (d.type !== 'init') return
  url = d.url
  listen(d.port)
  connect()
}
function listen(port) {
  port.onmessage = m => {
    const buf = m.data
    // A stalled socket must not pile up memory: drop audio past ~1 MB queued.
    if (open && ws.bufferedAmount < 1048576) {
      const silent = new Uint32Array(buf, 24, 1)[0] & 1
      ws.send(silent ? new Uint8Array(buf, 0, 32) : buf)
    }
    port.postMessage(buf, [buf])
  }
}
`

const blobUrl = src => URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))

/**
 * Route `ctx` into the host's engine.
 * @returns {{ input: AudioNode, isLive: () => boolean, onChange: (fn) => void }}
 *   Connect the app's final output to `input`.
 */
export function startNativeBus(ctx, { port, token, sink: initialSink = 'device' }) {
  let sink = initialSink
  const input = ctx.createGain()
  input.connect(ctx.destination)          // until the bus is up
  let live = false
  let tap = null
  const listeners = new Set()
  const setLive = async on => {
    if (on === live || !tap) return
    live = on
    try {
      if (on) {
        if (sink === 'none') await ctx.setSinkId?.({ type: 'none' })
        input.connect(tap)
        try { input.disconnect(ctx.destination) } catch (_) {}
      } else {
        input.connect(ctx.destination)
        try { input.disconnect(tap) } catch (_) {}
        if (sink === 'none') await ctx.setSinkId?.('')
      }
    } catch (e) {
      console.warn('[native bus] could not switch output', e)
    }
    for (const fn of listeners) { try { fn(live) } catch (_) {} }
  }

  let worker = null
  const ready = (async () => {
    try {
      await ctx.audioWorklet.addModule(blobUrl(TAP_SRC))
      tap = new AudioWorkletNode(ctx, 'fls-bus-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' })
      tap.connect(ctx.destination)          // keeps it pulled; it outputs silence
      worker = new Worker(blobUrl(WORKER_SRC))
      const ch = new MessageChannel()
      tap.port.postMessage({ port: ch.port1 }, [ch.port1])
      worker.postMessage({ type: 'init', url: `ws://127.0.0.1:${port}/${token}`, port: ch.port2 }, [ch.port2])
      worker.onmessage = e => {
        if (e.data?.type === 'open') setLive(true)
        else if (e.data?.type === 'close') setLive(false)
      }
    } catch (e) {
      console.warn('[native bus] unavailable — using the default output', e)
    }
  })()

  // The engine switched drivers: follow it ('none' while it holds the device).
  const setSink = async next => {
    if (next === sink) return
    sink = next
    if (!live) return
    try {
      await ctx.setSinkId?.(next === 'none' ? { type: 'none' } : '')
      if (ctx.state !== 'running') await ctx.resume()
    } catch (e) {
      console.warn('[native bus] could not change sink', e)
    }
  }

  // Extra buses: one mixer insert each, which the engine processes itself
  // (plugin effects). Same tap, stamped with the bus id.
  const taps = new Map()
  const tapFor = busId => {
    if (taps.has(busId)) return taps.get(busId).input
    const g = ctx.createGain()
    const entry = { input: g, node: null }
    taps.set(busId, entry)
    ready.then(() => {
      if (!worker || taps.get(busId) !== entry) return
      const node = new AudioWorkletNode(ctx, 'fls-bus-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: { bus: busId } })
      node.connect(ctx.destination)
      const ch = new MessageChannel()
      node.port.postMessage({ port: ch.port1 }, [ch.port1])
      worker.postMessage({ type: 'port', port: ch.port2 }, [ch.port2])
      g.connect(node)
      entry.node = node
    })
    return g
  }
  const releaseTap = busId => {
    const e = taps.get(busId)
    if (!e) return
    taps.delete(busId)
    try { e.input.disconnect() } catch (_) {}
    try { e.node?.disconnect() } catch (_) {}
  }

  return {
    input,
    setSink,
    tap: tapFor,
    releaseTap,
    isLive: () => live,
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn) },
  }
}
