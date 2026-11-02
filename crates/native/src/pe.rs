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
