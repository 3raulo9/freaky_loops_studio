// Creates and manages the Custom Synth AudioWorkletNode.
// Each Custom Synth channel owns one persistent node.

const loaded = new WeakSet()

export async function createCustomSynthNode(ctx) {
  if (!loaded.has(ctx)) {
    await ctx.audioWorklet.addModule('/custom-synth-worklet.js')
    loaded.add(ctx)
  }
  return new AudioWorkletNode(ctx, 'custom-synth', {
    numberOfInputs:     0,
    numberOfOutputs:    1,
    outputChannelCount: [2],
  })
}

export function makeCustomSynthPlayFn(getNode) {
  return function playCustomSynth(ctx, time, { pitch = 60, velocity = 1, gate = null } = {}, _dest) {
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
