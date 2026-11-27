use super::*;

#[derive(Clone, Copy, Debug)]
pub struct PyacPackView<'a> {
    version: u16,
    word_bits: u16,
    words_per_codelet: u16,
    codelet_bytes: u32,
    codelet_count: usize,
    payload: &'a [u8],
}

impl<'a> PyacPackView<'a> {
    pub fn version(&self) -> u16 {
        self.version
    }

    pub fn word_bits(&self) -> u16 {
        self.word_bits
    }

    pub fn words_per_codelet(&self) -> u16 {
        self.words_per_codelet
    }

    pub fn codelet_bytes(&self) -> u32 {
        self.codelet_bytes
    }

    pub fn codelet_count(&self) -> usize {
        self.codelet_count
    }

    /// Borrow the original little-endian codelet payload without decoding or copying it.
    pub fn payload_bytes(&self) -> &'a [u8] {
        self.payload
    }

    pub fn codelet(&self, index: usize) -> Option<[u16; WORDS_PER_CODELET]> {
        if index >= self.codelet_count {
            return None;
        }
        let start = index * CODELET_BYTES;
        Some(std::array::from_fn(|word| {
            read_u16(self.payload, start + word * 2)
        }))
    }
}

pub fn decode_pack_view(bytes: &[u8]) -> Result<PyacPackView<'_>, PyacError> {
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
    let codelet_count = read_u32(bytes, 16) as usize;
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
            .checked_add(codelet_count.checked_mul(CODELET_BYTES).ok_or(
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

    Ok(PyacPackView {
        version,
        word_bits,
        words_per_codelet,
        codelet_bytes,
        codelet_count,
        payload: &bytes[HEADER_BYTES..],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn borrowed_view_exposes_original_payload_and_decodes_words() {
        let codelets = [[0x1234u16; WORDS_PER_CODELET], [0x5678; WORDS_PER_CODELET]];
        let bytes = encode_pack(&codelets).expect("pack encodes");
        let view = decode_pack_view(&bytes).expect("pack view validates");

        assert_eq!(view.codelet_count(), codelets.len());
        assert_eq!(view.payload_bytes(), &bytes[HEADER_BYTES..]);
        assert_eq!(view.codelet(0), Some(codelets[0]));
        assert_eq!(view.codelet(1), Some(codelets[1]));
        assert_eq!(view.codelet(2), None);
    }
}
