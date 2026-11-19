use super::{
    INT_SORT_DENOTE, LETTER_SORT_DENOTE, LiteralRegion, QuoteHeader, UINT_SORT_DENOTE,
    WORDS_PER_CODELET, decode_quote_header, read_regions,
};
use crate::semantic::SemanticError;

/// Typed vector values retain IEEE payload bits so equality and GPU transfer are exact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VectorElements {
    Numbers(Vec<u16>),
    Numbers32(Vec<u32>),
    Booleans(Vec<bool>),
    Texts(Vec<String>),
    Float32(Vec<u32>),
    Float64(Vec<u64>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VectorInstruction {
    pub elements: VectorElements,
}

fn is_vector_quote(word: u16, sort: u16, scalar_bytes: usize) -> bool {
    decode_quote_header(word).is_some_and(|header| {
        header.sort == sort && header.scalar_bytes == scalar_bytes && header.vector_thickness != 0
    })
}

fn is_float_vector_quote(word: u16) -> bool {
    is_vector_quote(word, 6, 4) || is_vector_quote(word, 6, 8)
}

fn is_letter_quote(word: u16) -> bool {
    decode_quote_header(word).is_some_and(|header| header.sort == LETTER_SORT_DENOTE)
}

fn region_text(words: &[u16; WORDS_PER_CODELET], region: &LiteralRegion) -> String {
    let units = words[region.payload_start..region.payload_start + region.payload_length].to_vec();
    String::from_utf16_lossy(&units)
}

fn finite_float32(bits: u32) -> bool {
    bits & 0x7f80_0000 != 0x7f80_0000
}

fn finite_float64(bits: u64) -> bool {
    bits & 0x7ff0_0000_0000_0000 != 0x7ff0_0000_0000_0000
}

fn float_vector(
    words: &[u16; WORDS_PER_CODELET],
    header: QuoteHeader,
    start: usize,
    length: usize,
) -> Result<VectorElements, SemanticError> {
    if header.scalar_bytes == 4 {
        let mut values = Vec::with_capacity(length / 2);
        for pair in words[start..start + length].chunks_exact(2) {
            let bits = u32::from(pair[0]) | (u32::from(pair[1]) << 16);
            if !finite_float32(bits) {
                return Err(SemanticError::NonFiniteFloat);
            }
            values.push(bits);
        }
        Ok(VectorElements::Float32(values))
    } else {
        let mut values = Vec::with_capacity(length / 4);
        for part in words[start..start + length].chunks_exact(4) {
            let bits = u64::from(part[0])
                | (u64::from(part[1]) << 16)
                | (u64::from(part[2]) << 32)
                | (u64::from(part[3]) << 48);
            if !finite_float64(bits) {
                return Err(SemanticError::NonFiniteFloat);
            }
            values.push(bits);
        }
        Ok(VectorElements::Float64(values))
    }
}

pub fn decode_vector(words: &[u16; WORDS_PER_CODELET]) -> Result<VectorInstruction, SemanticError> {
    let layout = read_regions(words, &|word| {
        is_vector_quote(word, UINT_SORT_DENOTE, 2)
            || is_vector_quote(word, INT_SORT_DENOTE, 2)
            || is_float_vector_quote(word)
            || is_letter_quote(word)
    })?;
    let first = &layout.regions[0];
    let elements = match first.header.sort {
        UINT_SORT_DENOTE => VectorElements::Numbers(
            words[first.payload_start..first.payload_start + first.payload_length].to_vec(),
        ),
        INT_SORT_DENOTE => VectorElements::Booleans(
            words[first.payload_start..first.payload_start + first.payload_length]
                .iter()
                .map(|word| *word as i16 != 0)
                .collect(),
        ),
        6 => float_vector(
            words,
            first.header,
            first.payload_start,
            first.payload_length,
        )?,
        LETTER_SORT_DENOTE => {
            let mut texts = Vec::new();
            for region in &layout.regions {
                if region.header.sort != LETTER_SORT_DENOTE {
                    return Err(SemanticError::InvalidShape {
                        index: region.payload_start,
                        expected: LETTER_SORT_DENOTE,
                        actual: region.header.sort,
                    });
                }
                texts.push(region_text(words, region));
            }
            VectorElements::Texts(texts)
        }
        other => {
            return Err(SemanticError::InvalidShape {
                index: first.payload_start,
                expected: UINT_SORT_DENOTE,
                actual: other,
            });
        }
    };
    Ok(VectorInstruction { elements })
}

pub fn execute_vector(instruction: &VectorInstruction) -> VectorElements {
    instruction.elements.clone()
}

pub fn execute_vector_codelet(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<VectorElements, SemanticError> {
    Ok(execute_vector(&decode_vector(words)?))
}
