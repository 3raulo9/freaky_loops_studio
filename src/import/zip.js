// Minimal ZIP reader for project packages (a project file plus its samples).
// Reads the central directory, then inflates only the entries asked for, with
// the browser's native DecompressionStream — no library, nothing loaded twice.

const SIG_EOCD = 0x06054b50
const SIG_CEN = 0x02014b50
const SIG_LOC = 0x04034b50

/** @returns {Promise<{ path: string, name: string, size: number, blob: () => Promise<Blob> }[]>} */
export async function readZip(blob) {
  const tailLen = Math.min(blob.size, 65557)
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer())
  let eocd = -1
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === SIG_EOCD) { eocd = i; break }
  if (eocd < 0) throw new Error('Not a ZIP archive.')
  const count = tail.getUint16(eocd + 10, true)
  const cdSize = tail.getUint32(eocd + 12, true)
  const cdOff = tail.getUint32(eocd + 16, true)
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer())
  const utf8 = new TextDecoder('utf-8'), latin = new TextDecoder('latin1')
  const entries = []
  for (let i = 0, o = 0; i < count && o + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(o, true) !== SIG_CEN) break
    const flags = cd.getUint16(o + 8, true)
    const method = cd.getUint16(o + 10, true)
    const csize = cd.getUint32(o + 20, true)
    const usize = cd.getUint32(o + 24, true)
    const nlen = cd.getUint16(o + 28, true), xlen = cd.getUint16(o + 30, true), clen = cd.getUint16(o + 32, true)
    const local = cd.getUint32(o + 42, true)
    const raw = new Uint8Array(cd.buffer, cd.byteOffset + o + 46, nlen)
    const path = ((flags & 0x800) ? utf8 : latin).decode(raw).replace(/\\/g, '/')
    o += 46 + nlen + xlen + clen
    if (path.endsWith('/')) continue
    entries.push({
      path, name: path.replace(/^.*\//, ''), size: usize,
      blob: async () => {
        const lh = new DataView(await blob.slice(local, local + 30).arrayBuffer())
        if (lh.getUint32(0, true) !== SIG_LOC) throw new Error('Damaged ZIP entry: ' + path)
        const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true)
        const data = blob.slice(start, start + csize)
        if (method === 0) return data
        if (method !== 8) throw new Error(`Unsupported compression in ${path}`)
        return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()
      },
    })
  }
  return entries
}
