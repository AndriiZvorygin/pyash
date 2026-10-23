#![forbid(unsafe_code)]

use std::fmt::{Display, Formatter};

pub const MAGIC: &[u8; 8] = b"PYACVLIW";
pub const FORMAT_VERSION: u16 = 1;
pub const WORD_BITS: u16 = 16;
pub const WORDS_PER_CODELET: usize = 16;
pub const HEADER_BYTES: usize = 32;
pub const CODELET_BYTES: usize = WORDS_PER_CODELET * 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PyacPack {
    pub version: u16,
    pub word_bits: u16,
    pub words_per_codelet: u16,
    pub codelet_bytes: u32,
    pub codelets: Vec<[u16; WORDS_PER_CODELET]>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PyacError {
    TooManyCodelets,
    TruncatedPack,
    InvalidMagic,
    UnsupportedVersion(u16),
    UnsupportedWordLayout {
        word_bits: u16,
        words_per_codelet: u16,
    },
    InvalidHeader {
        header_bytes: u16,
        codelet_bytes: u32,
        reserved: u32,
    },
    LengthMismatch {
        expected: usize,
        declared: u32,
        actual: usize,
    },
}

impl PyacError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::TooManyCodelets => "too-many-codelets",
            Self::TruncatedPack => "truncated-pack",
            Self::InvalidMagic => "invalid-magic",
            Self::UnsupportedVersion(_) => "unsupported-version",
            Self::UnsupportedWordLayout { .. } => "unsupported-word-layout",
            Self::InvalidHeader { .. } => "invalid-header",
            Self::LengthMismatch { .. } => "truncated-pack",
        }
    }
}

impl Display for PyacError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooManyCodelets => {
                formatter.write_str("PyAC codelet count exceeds the 32-bit header field")
            }
            Self::TruncatedPack => {
                formatter.write_str("PyAC pack is shorter than its declared header")
            }
            Self::InvalidMagic => formatter.write_str("PyAC pack has an invalid magic value"),
            Self::UnsupportedVersion(version) => {
                write!(formatter, "PyAC pack version {version} is unsupported")
            }
            Self::UnsupportedWordLayout {
                word_bits,
                words_per_codelet,
            } => write!(
                formatter,
                "PyAC word layout is unsupported: {word_bits} bits, {words_per_codelet} words"
            ),
            Self::InvalidHeader {
                header_bytes,
                codelet_bytes,
                reserved,
            } => write!(
                formatter,
                "PyAC header is invalid: {header_bytes} header bytes, {codelet_bytes} codelet bytes, reserved {reserved}"
            ),
            Self::LengthMismatch {
                expected,
                declared,
                actual,
            } => write!(
                formatter,
                "PyAC length mismatch: expected {expected}, declared {declared}, actual {actual}"
            ),
        }
    }
}

impl std::error::Error for PyacError {}

fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

pub fn encode_pack(codelets: &[[u16; WORDS_PER_CODELET]]) -> Result<Vec<u8>, PyacError> {
    let count = u32::try_from(codelets.len()).map_err(|_| PyacError::TooManyCodelets)?;
    let payload_bytes = codelets
        .len()
        .checked_mul(CODELET_BYTES)
        .ok_or(PyacError::TooManyCodelets)?;
    let total_bytes = HEADER_BYTES
        .checked_add(payload_bytes)
        .ok_or(PyacError::TooManyCodelets)?;
    let total_bytes_u32 = u32::try_from(total_bytes).map_err(|_| PyacError::TooManyCodelets)?;
    let mut bytes = vec![0; total_bytes];

    bytes[..MAGIC.len()].copy_from_slice(MAGIC);
    write_u16(&mut bytes, 8, FORMAT_VERSION);
    write_u16(&mut bytes, 10, WORD_BITS);
    write_u16(&mut bytes, 12, WORDS_PER_CODELET as u16);
    write_u16(&mut bytes, 14, HEADER_BYTES as u16);
    write_u32(&mut bytes, 16, count);
    write_u32(&mut bytes, 20, CODELET_BYTES as u32);
    write_u32(&mut bytes, 24, total_bytes_u32);
    write_u32(&mut bytes, 28, 0);

    for (codelet_index, codelet) in codelets.iter().enumerate() {
        let start = HEADER_BYTES + codelet_index * CODELET_BYTES;
        for (word_index, word) in codelet.iter().enumerate() {
            write_u16(&mut bytes, start + word_index * 2, *word);
        }
    }
    Ok(bytes)
}

pub fn decode_pack(bytes: &[u8]) -> Result<PyacPack, PyacError> {
    if bytes.len() < HEADER_BYTES {
        return Err(PyacError::TruncatedPack);
    }
    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(PyacError::InvalidMagic);
    }

    let version = read_u16(bytes, 8);
    let word_bits = read_u16(bytes, 10);
    let words_per_codelet = read_u16(bytes, 12);
    let header_bytes = read_u16(bytes, 14);
    let record_count = read_u32(bytes, 16) as usize;
    let codelet_bytes = read_u32(bytes, 20);
    let declared_bytes = read_u32(bytes, 24);
    let reserved = read_u32(bytes, 28);

    if version != FORMAT_VERSION {
        return Err(PyacError::UnsupportedVersion(version));
    }
    if word_bits != WORD_BITS || words_per_codelet != WORDS_PER_CODELET as u16 {
        return Err(PyacError::UnsupportedWordLayout {
            word_bits,
            words_per_codelet,
        });
    }
    if header_bytes as usize != HEADER_BYTES
        || codelet_bytes as usize != CODELET_BYTES
        || reserved != 0
    {
        return Err(PyacError::InvalidHeader {
            header_bytes,
            codelet_bytes,
            reserved,
        });
    }

    let expected_bytes =
        HEADER_BYTES
            .checked_add(record_count.checked_mul(CODELET_BYTES).ok_or(
                PyacError::LengthMismatch {
                    expected: usize::MAX,
                    declared: declared_bytes,
                    actual: bytes.len(),
                },
            )?)
            .ok_or(PyacError::LengthMismatch {
                expected: usize::MAX,
                declared: declared_bytes,
                actual: bytes.len(),
            })?;
    if declared_bytes as usize != expected_bytes || bytes.len() != expected_bytes {
        return Err(PyacError::LengthMismatch {
            expected: expected_bytes,
            declared: declared_bytes,
            actual: bytes.len(),
        });
    }

    let mut codelets = Vec::with_capacity(record_count);
    for codelet_index in 0..record_count {
        let start = HEADER_BYTES + codelet_index * CODELET_BYTES;
        let mut codelet = [0u16; WORDS_PER_CODELET];
        for (word_index, word) in codelet.iter_mut().enumerate() {
            *word = read_u16(bytes, start + word_index * 2);
        }
        codelets.push(codelet);
    }
    Ok(PyacPack {
        version,
        word_bits,
        words_per_codelet,
        codelet_bytes,
        codelets,
        bytes: bytes.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_PLUS: [u16; WORDS_PER_CODELET] = [
        0x0149, 0x881d, 0x0001, 0x287e, 0x881d, 0x0001, 0x245e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ];

    #[test]
    fn encodes_the_shared_one_plus_one_fixture() {
        let bytes = encode_pack(&[ONE_PLUS]).expect("fixture fits");
        assert_eq!(&bytes[..8], b"PYACVLIW");
        assert_eq!(read_u16(&bytes, 8), 1);
        assert_eq!(read_u16(&bytes, 10), 16);
        assert_eq!(read_u16(&bytes, 12), 16);
        assert_eq!(read_u16(&bytes, 14), 32);
        assert_eq!(read_u32(&bytes, 16), 1);
        assert_eq!(read_u32(&bytes, 20), 32);
        assert_eq!(read_u32(&bytes, 24), 64);
        assert_eq!(read_u32(&bytes, 28), 0);
        assert_eq!(&bytes[32..34], &[0x49, 0x01]);
        assert_eq!(&bytes[46..48], &[0x64, 0x8a]);
        assert_eq!(&bytes[48..50], &[0x5e, 0x29]);
    }

    #[test]
    fn decodes_little_endian_codelets_and_round_trips() {
        let bytes = encode_pack(&[ONE_PLUS, [0; WORDS_PER_CODELET]]).expect("fixtures fit");
        let decoded = decode_pack(&bytes).expect("valid pack");
        assert_eq!(decoded.codelets, vec![ONE_PLUS, [0; WORDS_PER_CODELET]]);
        assert_eq!(decoded.bytes, bytes);
        assert_eq!(encode_pack(&decoded.codelets).expect("round trip"), bytes);
    }

    #[test]
    fn rejects_invalid_headers_with_stable_codes() {
        let bytes = encode_pack(&[ONE_PLUS]).expect("fixture fits");

        let mut bad_magic = bytes.clone();
        bad_magic[0] = b'X';
        assert_eq!(decode_pack(&bad_magic).unwrap_err().code(), "invalid-magic");

        let mut bad_version = bytes.clone();
        write_u16(&mut bad_version, 8, 2);
        assert_eq!(
            decode_pack(&bad_version).unwrap_err().code(),
            "unsupported-version"
        );

        let mut bad_layout = bytes.clone();
        write_u16(&mut bad_layout, 10, 8);
        assert_eq!(
            decode_pack(&bad_layout).unwrap_err().code(),
            "unsupported-word-layout"
        );

        let mut bad_reserved = bytes.clone();
        write_u32(&mut bad_reserved, 28, 1);
        assert_eq!(
            decode_pack(&bad_reserved).unwrap_err().code(),
            "invalid-header"
        );
    }

    #[test]
    fn rejects_truncation_and_declared_length_mismatch() {
        let bytes = encode_pack(&[ONE_PLUS]).expect("fixture fits");
        assert_eq!(
            decode_pack(&bytes[..31]).unwrap_err().code(),
            "truncated-pack"
        );

        let mut bad_length = bytes.clone();
        write_u32(&mut bad_length, 24, 32);
        assert_eq!(
            decode_pack(&bad_length).unwrap_err().code(),
            "truncated-pack"
        );
    }
}
