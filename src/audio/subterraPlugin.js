// Creates and manages the SUBTERRA bass-synth AudioWorkletNode.
// Each SUBTERRA channel owns one persistent node (same pattern as the Custom Synth).

const loaded = new WeakSet()

export async function createSubterraNode(ctx) {
  if (!loaded.has(ctx)) {
    await ctx.audioWorklet.addModule('/subterra-worklet.js')
    loaded.add(ctx)
  }
  return new AudioWorkletNode(ctx, 'subterra', {
    numberOfInputs:     0,
    numberOfOutputs:    1,
    outputChannelCount: [2],
  })
}

export function makeSubterraPlayFn(getNode) {
  // Bass default: step-mode hits (no pitch) play a low E (MIDI 40).
  return function playSubterra(ctx, time, { pitch = 40, velocity = 1, gate = null } = {}, _dest) {
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
