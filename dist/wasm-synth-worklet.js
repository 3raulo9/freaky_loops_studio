// AudioWorklet processor — handles both WASM and JavaScript plugins.
//
// ── WASM plugin required exports ─────────────────────────────────────────────
//   init(sampleRate: i32)
//   note_on(pitch: i32, vel: i32)   vel 0-127
//   note_off(pitch: i32)
//   process(blockSize: i32) -> i32  returns byte-ptr to float32 stereo output
//   memory: WebAssembly.Memory      [L0…Ln, R0…Rn]
//
// ── JS plugin required exports ────────────────────────────────────────────────
//   function init(sampleRate)
//   function note_on(pitch, velocity)   velocity 0-127
//   function note_off(pitch)
//   function process(L: Float32Array, R: Float32Array)

class SynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.wasmInstance = null
    this.jsPlugin     = null
    this.events = []  // { type, pitch, velocity, time } sorted by .time

    this.port.onmessage = ({ data }) => {
      switch (data.type) {
        case 'load':
          this._loadWasm(data.buffer)
          break
        case 'loadjs':
          this._loadJs(data.code)
          break
        case 'noteOn':
        case 'noteOff':
          this.events.push(data)
          this.events.sort((a, b) => a.time - b.time)
          break
      }
    }
  }

  _loadWasm(buffer) {
    WebAssembly.instantiate(buffer, {
      env: { abort: () => {}, memory: new WebAssembly.Memory({ initial: 256 }) },
    }).then(({ instance }) => {
      this.wasmInstance = instance
      this.jsPlugin = null
      if (instance.exports.init) instance.exports.init(sampleRate)
      this.port.postMessage({ type: 'ready' })
    }).catch(err => {
      this.port.postMessage({ type: 'error', message: err.message })
    })
  }

  _loadJs(code) {
    try {
      // Evaluate plugin code in a controlled scope and collect its exports
      // eslint-disable-next-line no-new-func
      const factory = new Function(code + '\nreturn { init, note_on, note_off, process };')
      const plugin  = factory()
      if (typeof plugin.process !== 'function') throw new Error('process() not found')
      if (typeof plugin.note_on !== 'function') throw new Error('note_on() not found')
      this.jsPlugin     = plugin
      this.wasmInstance = null
      if (typeof plugin.init === 'function') plugin.init(sampleRate)
      this.port.postMessage({ type: 'ready' })
    } catch (err) {
      this.port.postMessage({ type: 'error', message: err.message })
    }
  }

  process(_inputs, outputs) {
    // Dispatch timed note events
    const blockDur = 128 / sampleRate
    while (this.events.length && this.events[0].time <= currentTime + blockDur) {
      const ev = this.events.shift()
      try {
        if (ev.type === 'noteOn') {
          this.wasmInstance?.exports?.note_on?.(ev.pitch, Math.round(ev.velocity * 127))
          this.jsPlugin?.note_on?.(ev.pitch, Math.round(ev.velocity * 127))
        } else {
          this.wasmInstance?.exports?.note_off?.(ev.pitch)
          this.jsPlugin?.note_off?.(ev.pitch)
        }
      } catch (_) {}
    }

    const output = outputs[0]
    if (!output?.length) return true

    // ── WASM path ──────────────────────────────────────────────────────────────
    if (this.wasmInstance?.exports?.process) {
      try {
        const blockSize = output[0].length
        const ptr = this.wasmInstance.exports.process(blockSize)
        const mem = this.wasmInstance.exports.memory
        if (ptr !== undefined && ptr !== null && mem) {
          const heap = new Float32Array(mem.buffer)
          const off  = ptr >> 2  // byte offset → float32 index
          if (output[0]) output[0].set(heap.subarray(off,             off + blockSize))
          if (output[1]) output[1].set(heap.subarray(off + blockSize, off + blockSize * 2))
        }
      } catch (_) {}
      return true
    }

    // ── JS path ────────────────────────────────────────────────────────────────
    if (this.jsPlugin?.process) {
      const L = output[0] || new Float32Array(128)
      const R = output[1] || L
      try {
        this.jsPlugin.process(L, R)
      } catch (_) {}
    }

    return true
  }
}

registerProcessor('wasm-synth', SynthProcessor)
