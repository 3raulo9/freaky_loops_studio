// Manages AudioWorkletNode instances for WASM/JS synthesizer plugins.
// Each plugin channel gets its own persistent AudioWorkletNode.

const WORKLET_URL = '/wasm-synth-worklet.js'
const loadedContexts = new WeakSet()

async function ensureWorkletModule(ctx) {
  if (!loadedContexts.has(ctx)) {
    await ctx.audioWorklet.addModule(WORKLET_URL)
    loadedContexts.add(ctx)
  }
}

// Create a new plugin AudioWorkletNode.
// content: ArrayBuffer (WASM binary) or string (JS plugin source)
export async function createPluginNode(ctx, content) {
  await ensureWorkletModule(ctx)

  const node = new AudioWorkletNode(ctx, 'wasm-synth', {
    numberOfInputs:  0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Plugin timed out during init (>10s)'))
    }, 10000)

    node.port.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        clearTimeout(timer)
        resolve(node)
      } else if (data.type === 'error') {
        clearTimeout(timer)
        reject(new Error(data.message || 'Plugin load failed'))
      }
    }

    if (typeof content === 'string') {
      // JS plugin: send source code
      node.port.postMessage({ type: 'loadjs', code: content })
    } else {
      // WASM plugin: transfer ArrayBuffer (zero-copy)
      node.port.postMessage({ type: 'load', buffer: content }, [content])
    }
  })
}

// Returns the channel play-function for a plugin channel.
// getNode() is a thunk so the reference stays live if the node is replaced.
// Audio routing is handled externally (node → trackGain) so _dest is ignored.
export function makeWasmPlayFn(getNode) {
  return function playPluginNote(ctx, time, { pitch = 60, velocity = 1, gate = null } = {}, _dest) {
    const node = getNode()
    if (!node) return

    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000)

    const send = (offsetMs, msg) => {
      const d = delayMs + offsetMs
      if (d <= 4) node.port.postMessage(msg)
      else setTimeout(() => node.port.postMessage(msg), d)
    }

    send(0, { type: 'noteOn', pitch, velocity, time })
    if (gate !== null) {
      send(gate * 1000, { type: 'noteOff', pitch, time: time + gate })
    }
  }
}
