//! The container: a `FLhd` header chunk followed by an `FLdt` chunk holding a
//! flat stream of events. An event is a one-byte id whose range decides the
//! payload: 0–63 one byte, 64–127 two bytes, 128–191 four bytes, 192–255 a
//! varint length followed by that many bytes (text or a binary struct).

#[derive(Clone, Copy, Debug)]
pub enum Value<'a> {
    Int(u32),
    Data(&'a [u8]),
}

#[derive(Clone, Copy, Debug)]
pub struct Event<'a> {
    pub id: u8,
    pub value: Value<'a>,
}

impl<'a> Event<'a> {
    pub fn int(&self) -> u32 {
        match self.value {
            Value::Int(v) => v,
            Value::Data(d) => d.iter().take(4).rev().fold(0, |a, &b| (a << 8) | b as u32),
        }
    }
    pub fn data(&self) -> &'a [u8] {
        match self.value {
            Value::Data(d) => d,
            Value::Int(_) => &[],
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Header {
    pub format: i16,
    pub channels: u16,
    pub ppq: u16,
}

pub const BYTE: u8 = 0;
pub const WORD: u8 = 64;
pub const DWORD: u8 = 128;
pub const TEXT: u8 = 192;
pub const DATA: u8 = 208;

fn u16_at(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}
fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

/// Split the file into its header and the event bytes. Tolerates a wrong
/// data-chunk length (some writers leave it stale) by reading to end of file.
pub fn split(bytes: &[u8]) -> Result<(Header, &[u8]), String> {
    if bytes.len() < 22 || &bytes[..4] != b"FLhd" {
        return Err("Not a pattern-project file (missing FLhd header).".into());
    }
    let hlen = u32_at(bytes, 4).unwrap_or(6) as usize;
    let header = Header {
        format: u16_at(bytes, 8).unwrap_or(0) as i16,
        channels: u16_at(bytes, 10).unwrap_or(0),
        ppq: u16_at(bytes, 12).filter(|&p| p > 0).unwrap_or(96),
    };
    // Find the data chunk: normally right after the header, but skip any
    // unknown chunks in between.
    let mut off = 8 + hlen;
    while off + 8 <= bytes.len() {
        let tag = &bytes[off..off + 4];
        let len = u32_at(bytes, off + 4).unwrap_or(0) as usize;
        if tag == b"FLdt" {
            let start = off + 8;
            let end = start.saturating_add(len).min(bytes.len());
            return Ok((header, &bytes[start..end.max(start)]));
        }
        off = off + 8 + len;
    }
    Err("No FLdt data chunk found.".into())
}

/// Iterator over the event stream. Stops cleanly at a truncated tail.
pub struct Events<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Events<'a> {
    pub fn new(b: &'a [u8]) -> Self {
        Events { b, i: 0 }
    }
}

impl<'a> Iterator for Events<'a> {
    type Item = Event<'a>;

    fn next(&mut self) -> Option<Event<'a>> {
        let b = self.b;
        let id = *b.get(self.i)?;
        self.i += 1;
        let value = if id < WORD {
            let v = *b.get(self.i)? as u32;
            self.i += 1;
            Value::Int(v)
        } else if id < DWORD {
            let v = u16_at(b, self.i)? as u32;
            self.i += 2;
            Value::Int(v)
        } else if id < TEXT {
            let v = u32_at(b, self.i)?;
            self.i += 4;
            Value::Int(v)
        } else {
            let mut n: usize = 0;
            let mut shift = 0;
            loop {
                let c = *b.get(self.i)?;
                self.i += 1;
                n |= ((c & 0x7f) as usize) << shift;
                shift += 7;
                if c & 0x80 == 0 || shift > 28 {
                    break;
                }
            }
            let end = self.i.checked_add(n)?;
            let d = b.get(self.i..end)?;
            self.i = end;
            Value::Data(d)
        };
        Some(Event { id, value })
    }
}
