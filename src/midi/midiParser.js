// Pure binary Standard MIDI File (.mid) parser.
// No dependencies — works on any ArrayBuffer from FileReader or fetch.
//
// Bank Select awareness: tracks CC#0 (Bank MSB) and CC#32 (Bank LSB) per channel
// so the engine can apply GM fallback patches for non-standard instrument banks.

/** Read a MIDI variable-length quantity from a DataView at `offset`. */
function readVLQ(view, offset) {
  let value = 0, bytesRead = 0, byte
  do {
    if (offset + bytesRead >= view.byteLength) break
    byte = view.getUint8(offset + bytesRead)
    value = (value << 7) | (byte & 0x7F)
    bytesRead++
  } while (byte & 0x80)
  return { value, bytesRead }
}

/** Read an ASCII string of `len` bytes from a DataView. */
function readStr(view, offset, len) {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

/**
 * Parse a Standard MIDI File binary buffer.
 *
 * Returns:
 * ```
 * {
 *   format: 0|1|2,
 *   ticksPerBeat: number,
 *   tempoMap:  Array<{ tick, us }>,         // us = µs per quarter note
 *   timeSig:   Array<{ tick, num, den }>,
 *   trackNames: string[],
 *   channels:  Array<{                      // indices 0-15
 *     index, program, bankMSB, bankLSB,
 *     isNonStandardBank,                    // true when bankMSB != 0
 *     volume, pan,
 *     events: MidiEvent[]
 *   }>,
 *   activeChannels: Set<number>,
 * }
 * ```
 *
 * MidiEvent shapes:
 *   { type: 'noteOn',        tick, note, velocity }
 *   { type: 'noteOff',       tick, note, velocity }
 *   { type: 'controlChange', tick, cc, value }
 *   { type: 'programChange', tick, program, bankMSB, bankLSB }
 */
export function parseMidi(buffer) {
  const view = new DataView(buffer)
  let pos = 0

  // ── Header chunk ────────────────────────────────────────────────────────────
  const headerTag = readStr(view, pos, 4); pos += 4
  if (headerTag !== 'MThd') throw new Error('Not a valid MIDI file (missing MThd header)')

  const headerLen = view.getUint32(pos); pos += 4
  const format    = view.getUint16(pos); pos += 2
  const numTracks = view.getUint16(pos); pos += 2
  const division  = view.getUint16(pos); pos += 2
  pos = 8 + headerLen  // skip any non-standard header extension bytes

  // division bit 15 = 0 → ticks per quarter note; bit 15 = 1 → SMPTE (default 480)
  const ticksPerBeat = (division & 0x8000) === 0 ? division : 480

  // ── Per-channel accumulators ─────────────────────────────────────────────────
  const channels = Array.from({ length: 16 }, (_, i) => ({
    index:              i,
    program:            0,      // defaults to Acoustic Grand Piano
    bankMSB:            0,      // CC#0  — 0 = standard GM bank
    bankLSB:            0,      // CC#32 — sub-bank selector
    isNonStandardBank:  false,  // set true when bankMSB != 0
    volume:             100,
    pan:                64,
    _hadExplicitProgram: false,
    events:             [],
  }))

  const tempoMap   = [{ tick: 0, us: 500_000 }]  // 120 BPM default
  const timeSig    = [{ tick: 0, num: 4, den: 4 }]
  const trackNames = []

  // ── Track chunks ────────────────────────────────────────────────────────────
  for (let t = 0; t < numTracks; t++) {
    if (pos + 8 > buffer.byteLength) break

    const tTag = readStr(view, pos, 4); pos += 4
    if (tTag !== 'MTrk') {
      const skipLen = view.getUint32(pos); pos += 4 + skipLen
      continue
    }

    const tLen = view.getUint32(pos); pos += 4
    const tEnd = pos + tLen

    let absoluteTick = 0
    let runningStatus = 0

    while (pos < tEnd) {
      // Delta time (VLQ)
      const { value: dt, bytesRead: dtb } = readVLQ(view, pos)
      pos += dtb
      absoluteTick += dt

      // Status byte or running-status continuation
      const peek = view.getUint8(pos)
      let statusByte
      if (peek & 0x80) {
        statusByte = peek
        pos++
        if (statusByte !== 0xF0 && statusByte !== 0xF7 && statusByte !== 0xFF) {
          runningStatus = statusByte
        }
      } else {
        statusByte = runningStatus
      }

      const msgType = statusByte & 0xF0
      const ch      = statusByte & 0x0F

      // ── Meta event ──────────────────────────────────────────────────────────
      if (statusByte === 0xFF) {
        const metaType = view.getUint8(pos++)
        const { value: mLen, bytesRead: mlb } = readVLQ(view, pos); pos += mlb

        switch (metaType) {
          case 0x51: { // Tempo
            if (mLen >= 3) {
              const us = (view.getUint8(pos) << 16) | (view.getUint8(pos + 1) << 8) | view.getUint8(pos + 2)
              tempoMap.push({ tick: absoluteTick, us })
            }
            break
          }
          case 0x58: { // Time signature
            if (mLen >= 2) {
              timeSig.push({
                tick: absoluteTick,
                num:  view.getUint8(pos),
                den:  1 << view.getUint8(pos + 1),
              })
            }
            break
          }
          case 0x03: { // Track name
            let name = ''
            for (let i = 0; i < mLen; i++) name += String.fromCharCode(view.getUint8(pos + i))
            trackNames.push(name)
            break
          }
        }
        pos += mLen
        continue
      }

      // ── SysEx ───────────────────────────────────────────────────────────────
      if (statusByte === 0xF0 || statusByte === 0xF7) {
        const { value: sLen, bytesRead: slb } = readVLQ(view, pos); pos += slb + sLen
        continue
      }

      // ── Channel messages ─────────────────────────────────────────────────────
      switch (msgType) {
        case 0x80: { // Note Off
          const note = view.getUint8(pos++), vel = view.getUint8(pos++)
          channels[ch].events.push({ type: 'noteOff', tick: absoluteTick, note, velocity: vel })
          break
        }
        case 0x90: { // Note On (vel 0 = note off per spec)
          const note = view.getUint8(pos++), vel = view.getUint8(pos++)
          channels[ch].events.push({
            type: vel === 0 ? 'noteOff' : 'noteOn',
            tick: absoluteTick, note, velocity: vel,
          })
          break
        }
        case 0xA0: pos += 2; break // Polyphonic Aftertouch — ignored

        case 0xB0: { // Control Change
          const cc  = view.getUint8(pos++), val = view.getUint8(pos++)
          channels[ch].events.push({ type: 'controlChange', tick: absoluteTick, cc, value: val })

          // Snapshot common CCs for initial slot configuration
          if (cc === 7)  channels[ch].volume  = val
          if (cc === 10) channels[ch].pan     = val

          // Bank Select — accumulate MSB/LSB before the next Program Change
          if (cc === 0)  channels[ch].bankMSB = val
          if (cc === 32) channels[ch].bankLSB = val
          break
        }
        case 0xC0: { // Program Change
          const prog = view.getUint8(pos++)

          // Snapshot the bank at the time of the Program Change
          const bankMSB = channels[ch].bankMSB
          const bankLSB = channels[ch].bankLSB

          // Mark non-standard bank so the engine knows to apply GM fallback
          if (bankMSB !== 0) channels[ch].isNonStandardBank = true

          // First explicit program change sets the initial slot patch display
          if (!channels[ch]._hadExplicitProgram) {
            channels[ch].program              = prog
            channels[ch]._hadExplicitProgram  = true
          }

          channels[ch].events.push({
            type: 'programChange',
            tick: absoluteTick,
            program: prog,
            bankMSB,
            bankLSB,
          })
          break
        }
        case 0xD0: pos++;    break // Channel Pressure — ignored
        case 0xE0: pos += 2; break // Pitch Bend — ignored
        default:   pos++;          // unknown, advance to avoid infinite loop
      }
    }

    pos = tEnd
  }

  tempoMap.sort((a, b) => a.tick - b.tick)

  const activeChannels = new Set(
    channels.filter(c => c.events.length > 0).map(c => c.index)
  )

  return { format, ticksPerBeat, tempoMap, timeSig, trackNames, channels, activeChannels }
}

/**
 * Convert an absolute MIDI tick to seconds, accounting for all tempo changes.
 */
export function tickToSeconds(tick, ticksPerBeat, tempoMap) {
  let seconds  = 0
  let lastTick = 0
  let lastUs   = tempoMap[0]?.us ?? 500_000

  for (const entry of tempoMap) {
    if (entry.tick >= tick) break
    seconds  += ((entry.tick - lastTick) / ticksPerBeat) * (lastUs / 1_000_000)
    lastTick  = entry.tick
    lastUs    = entry.us
  }
  seconds += ((tick - lastTick) / ticksPerBeat) * (lastUs / 1_000_000)
  return seconds
}

/**
 * Build a flat, time-sorted event timeline.
 * Each event gains `channel` (0-15) and `time` (seconds from file start).
 * programChange events also carry `bankMSB` and `bankLSB` from the parser.
 */
export function buildTimeline(parsed) {
  const { channels, ticksPerBeat, tempoMap } = parsed
  const events = []

  for (let ch = 0; ch < 16; ch++) {
    for (const ev of channels[ch].events) {
      events.push({
        ...ev,
        channel: ch,
        time: tickToSeconds(ev.tick, ticksPerBeat, tempoMap),
      })
    }
  }

  // Sort by time; within same timestamp put noteOff before noteOn to avoid voice conflicts
  return events.sort((a, b) =>
    a.time - b.time ||
    (a.type === 'noteOff' ? -1 : 0) - (b.type === 'noteOff' ? -1 : 0)
  )
}

/** Return the total file duration in seconds. */
export function getMidiDuration(parsed) {
  const tl = buildTimeline(parsed)
  return tl.length > 0 ? tl[tl.length - 1].time : 0
}
