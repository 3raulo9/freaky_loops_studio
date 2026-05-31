// Creates and manages the Serum AudioWorkletNode.

const loaded = new WeakSet()

export async function createSerumNode(ctx) {
  if (!loaded.has(ctx)) {
    await ctx.audioWorklet.addModule('/serum-worklet.js')
    loaded.add(ctx)
  }
  return new AudioWorkletNode(ctx, 'serum-synth', {
    numberOfInputs:  0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })
}

export function makeSerumPlayFn(getNode) {
  return function playSerumNote(ctx, time, { pitch = 60, velocity = 1, gate = null } = {}, _dest) {
    const node = getNode()
    if (!node) return
    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000)
    const send = (ms, msg) => {
      if (ms <= 4) node.port.postMessage(msg)
      else setTimeout(() => node.port.postMessage(msg), ms)
    }
    send(delayMs, { type: 'noteOn', pitch, velocity, time })
    if (gate !== null) send(delayMs + gate * 1000, { type: 'noteOff', pitch, time: time + gate })
  }
}
