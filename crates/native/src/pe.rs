//! Reads a DLL's PE header to learn its CPU architecture. A process can only
//! load plugins of its own bitness, so the host uses this to route 32-bit
//! plugins to the bridge process.

use std::io::{Read, Seek, SeekFrom};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Arch {
    X86,
    X64,
    Arm64,
    Unknown,
}

pub fn detect(path: &str) -> Arch {
    fn read(path: &str) -> std::io::Result<u16> {
        let mut f = std::fs::File::open(path)?;
        let mut b4 = [0u8; 4];
        f.seek(SeekFrom::Start(0x3C))?;
        f.read_exact(&mut b4)?;
        f.seek(SeekFrom::Start(u32::from_le_bytes(b4) as u64))?;
        f.read_exact(&mut b4)?;
        if &b4 != b"PE\0\0" {
            return Ok(0);
        }
        let mut m = [0u8; 2];
        f.read_exact(&mut m)?;
        Ok(u16::from_le_bytes(m))
    }
    match read(path) {
        Ok(0x8664) => Arch::X64,
        Ok(0x014c) => Arch::X86,
        Ok(0xAA64) => Arch::Arm64,
        _ => Arch::Unknown,
    }
}

pub fn arch(path: &str) -> &'static str {
    match detect(path) {
        Arch::X86 => "x86",
        Arch::X64 => "x64",
        Arch::Arm64 => "arm64",
        Arch::Unknown => "unknown",
    }
}

/// Names exported by a DLL (reads only the headers and the export table).
pub fn exports(path: &std::path::Path) -> Vec<String> {
    fn run(path: &std::path::Path) -> std::io::Result<Vec<String>> {
        let mut f = std::fs::File::open(path)?;
        let mut at = |off: u64, n: usize| -> std::io::Result<Vec<u8>> {
            let mut b = vec![0u8; n];
            f.seek(SeekFrom::Start(off))?;
            f.read_exact(&mut b)?;
            Ok(b)
        };
        let u16_ = |b: &[u8], o: usize| u16::from_le_bytes([b[o], b[o + 1]]);
        let u32_ = |b: &[u8], o: usize| u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
        let pe = u32_(&at(0x3C, 4)?, 0) as u64;
        let coff = at(pe, 24)?;
        if &coff[..4] != b"PE\0\0" {
            return Ok(Vec::new());
        }
        let n_sections = u16_(&coff, 6) as usize;
        let opt_size = u16_(&coff, 20) as usize;
        let opt = at(pe + 24, opt_size)?;
        let dir_off = match u16_(&opt, 0) {
            0x10b => 96,
            0x20b => 112,
            _ => return Ok(Vec::new()),
        };
        if opt.len() < dir_off + 8 {
            return Ok(Vec::new());
        }
        let export_rva = u32_(&opt, dir_off);
        if export_rva == 0 {
            return Ok(Vec::new());
        }
        let sections = at(pe + 24 + opt_size as u64, n_sections * 40)?;
        let to_file = |rva: u32| -> Option<u64> {
            (0..n_sections).find_map(|i| {
                let s = &sections[i * 40..i * 40 + 40];
                let (vsize, va, raw) = (u32_(s, 8).max(u32_(s, 16)), u32_(s, 12), u32_(s, 20));
                (rva >= va && rva < va + vsize).then(|| (rva - va + raw) as u64)
            })
        };
        let Some(dir) = to_file(export_rva) else { return Ok(Vec::new()) };
        let ed = at(dir, 40)?;
        let n_names = (u32_(&ed, 24) as usize).min(4096);
        let Some(names_at) = to_file(u32_(&ed, 32)) else { return Ok(Vec::new()) };
        let rvas = at(names_at, n_names * 4)?;
        let mut out = Vec::with_capacity(n_names);
        for i in 0..n_names {
            if let Some(off) = to_file(u32_(&rvas, i * 4)) {
                let raw = at(off, 64).or_else(|_| at(off, 16))?;
                let end = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
                out.push(String::from_utf8_lossy(&raw[..end]).into_owned());
            }
        }
        Ok(out)
    }
    run(path).unwrap_or_default()
}

/// Whether a DLL exposes a VST2 entry point (so it's safe to try hosting).
pub fn is_vst2(path: &std::path::Path) -> bool {
    exports(path).iter().any(|n| n == "VSTPluginMain" || n == "main" || n == "main_plugin")
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_exports_of_a_system_dll() {
        let sys = std::path::Path::new("C:/Windows/System32/kernel32.dll");
        if sys.exists() {
            let names = super::exports(sys);
            assert!(names.iter().any(|n| n == "LoadLibraryW"), "got {} names", names.len());
            assert!(!super::is_vst2(sys));
        }
    }
}
