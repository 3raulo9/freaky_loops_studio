//! Strings, file paths buried in plugin state, base64 and a tiny JSON writer
//! (no dependencies, so the WebAssembly build stays small).

/// Windows-1252 code points for 0x80..0x9F (the rest maps 1:1 to Latin-1).
const CP1252_HI: [u16; 32] = [
    0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
    0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
];

pub fn ansi(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    b[..end]
        .iter()
        .map(|&c| match c {
            0x80..=0x9f => char::from_u32(CP1252_HI[(c - 0x80) as usize] as u32).unwrap_or('?'),
            _ => c as char,
        })
        .collect()
}

pub fn utf16(b: &[u8]) -> String {
    let units: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0).collect();
    String::from_utf16_lossy(&units)
}

/// Decode a text event. Newer files store UTF-16LE; older ones ANSI. A few
/// events stay ANSI forever, and some files mix — so sniff when unsure.
pub fn decode(b: &[u8], unicode: bool) -> String {
    if unicode && b.len() >= 2 && (b.len() % 2 == 0 || b[b.len() - 1] == 0) {
        utf16(b)
    } else if !unicode && b.len() >= 4 && b[1] == 0 && b[3] == 0 && b[0] != 0 {
        utf16(b)
    } else {
        ansi(b)
    }
}

const AUDIO_EXT: [&str; 9] = [".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".sf2", ".wv", ".m4a"];

fn path_char(c: u16) -> bool {
    c >= 0x20 && c != 0x7f && !matches!(c, 0x22 | 0x2a | 0x3c | 0x3e | 0x3f | 0x7c)
}

/// Absolute or placeholder-rooted file paths (`C:\…`, `\\server\…`, `%Root%\…`)
/// ending in an audio extension, found anywhere in an opaque state blob — in
/// both one-byte and UTF-16 encodings. Lets samplers, slicers and drum pads
/// hand over their samples without knowing each plugin's format.
pub fn embedded_paths(b: &[u8]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: String| {
        let t = s.trim().to_string();
        let lower = t.to_ascii_lowercase();
        let rooted = t.len() > 4
            && ((t.as_bytes()[1] == b':' && (t.as_bytes()[2] == b'\\' || t.as_bytes()[2] == b'/')) || t.starts_with("\\\\") || t.starts_with('%') || t.starts_with('/'));
        if rooted && AUDIO_EXT.iter().any(|e| lower.ends_with(e)) && !out.contains(&t) {
            out.push(t);
        }
    };
    // One-byte strings: maximal runs of path characters.
    let mut start = None;
    for i in 0..=b.len() {
        let ok = i < b.len() && path_char(b[i] as u16) && b[i] < 0x80;
        match (ok, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                if i - s >= 6 {
                    scan_run(&ansi(&b[s..i]), &mut push);
                }
                start = None;
            }
            _ => {}
        }
    }
    // UTF-16 at both alignments.
    for align in 0..2 {
        let units: Vec<u16> = b[align..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        let mut start = None;
        for i in 0..=units.len() {
            let ok = i < units.len() && path_char(units[i]) && units[i] != 0;
            match (ok, start) {
                (true, None) => start = Some(i),
                (false, Some(s)) => {
                    if i - s >= 6 {
                        scan_run(&String::from_utf16_lossy(&units[s..i]), &mut push);
                    }
                    start = None;
                }
                _ => {}
            }
        }
    }
    out
}

/// A run can carry a length-prefix byte glued to the front ("9D:\…") or
/// several paths back to back; cut it at every drive/placeholder root.
fn scan_run(run: &str, push: &mut impl FnMut(String)) {
    let chars: Vec<char> = run.chars().collect();
    let mut roots: Vec<usize> = Vec::new();
    for i in 0..chars.len() {
        let drive = i + 2 < chars.len() && chars[i].is_ascii_alphabetic() && chars[i + 1] == ':' && (chars[i + 2] == '\\' || chars[i + 2] == '/');
        let unc = i + 1 < chars.len() && chars[i] == '\\' && chars[i + 1] == '\\' && (i == 0 || chars[i - 1] != '\\');
        let ph = chars[i] == '%' && chars[i + 1..].iter().take(40).position(|&c| c == '%').map_or(false, |p| p > 1);
        if drive || unc || ph {
            roots.push(i);
        }
    }
    for (k, &r) in roots.iter().enumerate() {
        let end = roots.get(k + 1).copied().unwrap_or(chars.len());
        let s: String = chars[r..end].iter().collect();
        // Trim anything after the extension.
        let lower = s.to_ascii_lowercase();
        if let Some(cut) = AUDIO_EXT.iter().filter_map(|e| lower.rfind(e).map(|p| p + e.len())).max() {
            push(s[..cut].to_string());
        }
    }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Minimal streaming JSON writer.
#[derive(Default)]
pub struct Json {
    pub s: String,
    first: Vec<bool>,
}

impl Json {
    fn sep(&mut self) {
        if let Some(f) = self.first.last_mut() {
            if *f {
                *f = false;
            } else {
                self.s.push(',');
            }
        }
    }
    /// Separator before a hand-written array element.
    pub fn sep_raw(&mut self) {
        self.sep();
    }
    fn key(&mut self, k: &str) {
        self.sep();
        self.str_raw(k);
        self.s.push(':');
    }
    fn str_raw(&mut self, v: &str) {
        self.s.push('"');
        for c in v.chars() {
            match c {
                '"' => self.s.push_str("\\\""),
                '\\' => self.s.push_str("\\\\"),
                '\n' => self.s.push_str("\\n"),
                '\r' => self.s.push_str("\\r"),
                '\t' => self.s.push_str("\\t"),
                c if (c as u32) < 0x20 => self.s.push_str(&format!("\\u{:04x}", c as u32)),
                c => self.s.push(c),
            }
        }
        self.s.push('"');
    }
    pub fn obj(&mut self) {
        self.sep();
        self.s.push('{');
        self.first.push(true);
    }
    pub fn obj_k(&mut self, k: &str) {
        self.key(k);
        self.s.push('{');
        self.first.push(true);
    }
    pub fn end_obj(&mut self) {
        self.first.pop();
        self.s.push('}');
    }
    pub fn arr_k(&mut self, k: &str) {
        self.key(k);
        self.s.push('[');
        self.first.push(true);
    }
    pub fn end_arr(&mut self) {
        self.first.pop();
        self.s.push(']');
    }
    pub fn str(&mut self, k: &str, v: &str) {
        self.key(k);
        self.str_raw(v);
    }
    pub fn str_item(&mut self, v: &str) {
        self.sep();
        self.str_raw(v);
    }
    pub fn num(&mut self, k: &str, v: f64) {
        self.key(k);
        self.num_raw(v);
    }
    pub fn num_item(&mut self, v: f64) {
        self.sep();
        self.num_raw(v);
    }
    fn num_raw(&mut self, v: f64) {
        if !v.is_finite() {
            self.s.push_str("null");
        } else if v == v.trunc() && v.abs() < 1e15 {
            self.s.push_str(&format!("{}", v as i64));
        } else {
            self.s.push_str(&format!("{}", (v * 1e6).round() / 1e6));
        }
    }
    pub fn bool(&mut self, k: &str, v: bool) {
        self.key(k);
        self.s.push_str(if v { "true" } else { "false" });
    }
    pub fn null(&mut self, k: &str) {
        self.key(k);
        self.s.push_str("null");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_both_encodings() {
        assert_eq!(utf16(b"K\0i\0c\0k\0\0\0"), "Kick");
        assert_eq!(ansi(b"Caf\xe9 \x80\0junk"), "Café €");
        assert_eq!(decode(b"Lead\0", false), "Lead");
        assert_eq!(decode(b"L\0e\0a\0d\0\0\0", true), "Lead");
    }

    #[test]
    fn finds_paths_inside_state() {
        let mut blob = vec![6, 0, 0, 0, 0xff, 0xff];
        blob.push(b'9'); // a length prefix glued to the path
        blob.extend_from_slice(b"D:\\Fonts\\Strings.sf2");
        blob.extend_from_slice(&[0xff, 0, 1]);
        for u in "%Library%\\Drums\\Kick 01.wav".encode_utf16() {
            blob.extend_from_slice(&u.to_le_bytes());
        }
        blob.extend_from_slice(&[0, 0]);
        let p = embedded_paths(&blob);
        assert_eq!(p, vec!["D:\\Fonts\\Strings.sf2".to_string(), "%Library%\\Drums\\Kick 01.wav".to_string()]);
    }

    #[test]
    fn base64_matches_reference() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn json_escapes_and_nests() {
        let mut j = Json::default();
        j.obj();
        j.str("a", "q\"\\\n");
        j.arr_k("n");
        j.num_item(1.0);
        j.num_item(0.25);
        j.end_arr();
        j.bool("b", true);
        j.end_obj();
        assert_eq!(j.s, r#"{"a":"q\"\\\n","n":[1,0.25],"b":true}"#);
    }
}
