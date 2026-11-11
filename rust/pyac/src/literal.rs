//! The literal families of the Pyash VLIW codelet format.
//!
//! A literal codelet is laid out as
//!
//! ```text
//! head | name words | nominative | region | region | ... | accusative | realis
//! ```
//!
//! The name phrase and its nominative case are present only when the sentence
//! names the value. The head word is the legacy index: bit 0 says whether the
//! vector completes the codelet, and the remaining bits mark the
//! phrase-closing case word and the codelet-ending mood word.
//!
//! Each region is a quote with its payload. A vector of fixed-width values
//! uses a single region whose vector thickness states the count, and a vector
//! of texts uses one region per element, because the legacy quote sorts hold
//! fixed-width elements and a text element is a string.

use crate::WORDS_PER_CODELET;
use crate::semantic::SemanticError;

pub const ACCUSATIVE_CASE: u16 = 0x245e;
pub const NOMINATIVE_CASE: u16 = 0x24de;
pub const REALIS_MOOD: u16 = 0x217e;

/// A uint quote with the 64-bit scalar thickness: four payload words.
pub const DATE_QUOTE: u16 = 0x981d;
/// The legacy quote sorts and thicknesses.
pub const LETTER_SORT_DENOTE: u16 = 0;
pub const UINT_SORT_DENOTE: u16 = 4;
pub const INT_SORT_DENOTE: u16 = 5;
pub const VECTOR_THICK_LONG: u8 = 6;
pub const QUOTE_DENOTE_MASK: u16 = 0x001f;
pub const QUOTE_DENOTE: u16 = 0x001d;
pub const SCALAR_THICK_MASK: u16 = 0x1800;
pub const VECTOR_THICK_MASK: u16 = 0x0700;
pub const SORT_DENOTE_MASK: u16 = 0xe000;

const MILLISECONDS_PER_DAY: u64 = 86_400_000;

/// The legacy index word: the completion bit plus one bit per boundary slot.
pub fn index_word(boundary_slots: &[usize]) -> u16 {
    let mut word: u16 = 0x0001;
    for slot in boundary_slots {
        word |= 1 << slot;
    }
    word
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DateInstruction {
    /// Milliseconds since the Unix epoch.
    pub epoch_ms: u64,
}

/// The elements of a vector literal, in the order the codelet holds them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VectorElements {
    /// The unsigned integer sort: each element is a 16-bit number.
    Numbers(Vec<u16>),
    /// The signed integer sort: each element is a truth or a lie.
    Booleans(Vec<bool>),
    /// The letter sort: one region per element, each holding a text.
    Texts(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VectorInstruction {
    pub elements: VectorElements,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuoteHeader {
    pub sort: u16,
    pub scalar_bytes: usize,
    pub vector_thickness: u8,
    pub vector_words: Option<usize>,
    pub explicit_vector_length: bool,
}

pub fn decode_quote_header(word: u16) -> Option<QuoteHeader> {
    if word & QUOTE_DENOTE_MASK != QUOTE_DENOTE {
        return None;
    }
    let scalar_thick = ((word & SCALAR_THICK_MASK) >> 11) as usize;
    let vector_thickness = ((word & VECTOR_THICK_MASK) >> 8) as u8;
    let sort = (word & SORT_DENOTE_MASK) >> 13;
    let scalar_bytes = match scalar_thick {
        0 => 1,
        1 => 2,
        2 => 4,
        3 => 8,
        _ => return None,
    };
    let vector_words = match vector_thickness {
        0 => Some(1),
        1 => Some(2),
        2 => Some(4),
        3 => Some(8),
        4 => Some(16),
        7 => Some(3),
        _ => None,
    };
    Some(QuoteHeader {
        sort,
        scalar_bytes,
        vector_thickness,
        vector_words,
        explicit_vector_length: vector_thickness == VECTOR_THICK_LONG,
    })
}

fn is_uint_vector_quote(word: u16) -> bool {
    match decode_quote_header(word) {
        Some(header) => {
            header.sort == UINT_SORT_DENOTE
                && header.scalar_bytes == 2
                && header.vector_thickness != 0
        }
        None => false,
    }
}

fn is_int_vector_quote(word: u16) -> bool {
    match decode_quote_header(word) {
        Some(header) => {
            header.sort == INT_SORT_DENOTE
                && header.scalar_bytes == 2
                && header.vector_thickness != 0
        }
        None => false,
    }
}

fn is_letter_quote(word: u16) -> bool {
    match decode_quote_header(word) {
        Some(header) => header.sort == LETTER_SORT_DENOTE,
        None => false,
    }
}

/// One quote region of a literal codelet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiteralRegion {
    pub header: QuoteHeader,
    pub payload_start: usize,
    pub payload_length: usize,
    pub next_offset: usize,
}

/// The layout of a decoded literal codelet.
struct LiteralLayout {
    regions: Vec<LiteralRegion>,
}

/// The payload span of a quote region: the words the quote owns after its
/// header, and the explicit-length word when the quote states its own count.
fn quote_payload_span(
    header: &QuoteHeader,
    words: &[u16; WORDS_PER_CODELET],
    offset: usize,
) -> Result<(usize, usize), SemanticError> {
    let scalar_words = header.scalar_bytes / 2;
    if header.explicit_vector_length {
        let length = *words.get(offset + 1).ok_or(SemanticError::InvalidShape {
            index: offset + 1,
            expected: 0,
            actual: 0,
        })? as usize;
        if length < 1 {
            return Err(SemanticError::InvalidShape {
                index: offset + 1,
                expected: 1,
                actual: 0,
            });
        }
        Ok((offset + 2, length * scalar_words))
    } else {
        let count = header.vector_words.unwrap_or(1);
        Ok((offset + 1, count * scalar_words))
    }
}

fn read_regions(
    words: &[u16; WORDS_PER_CODELET],
    accepts_quote: &dyn Fn(u16) -> bool,
) -> Result<LiteralLayout, SemanticError> {
    // The quote header is the first word with the quote denote, so a payload
    // word that looks like a quote cannot move the boundary.
    let quote_offset = words[1..]
        .iter()
        .position(|word| word & QUOTE_DENOTE_MASK == QUOTE_DENOTE)
        .map(|offset| offset + 1)
        .ok_or(SemanticError::InvalidShape {
            index: 0,
            expected: 0,
            actual: 0,
        })?;
    let nominative_slot = if quote_offset > 1 && words[quote_offset - 1] == NOMINATIVE_CASE {
        Some(quote_offset - 1)
    } else if quote_offset == 1 {
        None
    } else {
        return Err(SemanticError::InvalidShape {
            index: quote_offset,
            expected: NOMINATIVE_CASE,
            actual: words[quote_offset],
        });
    };
    if quote_offset >= WORDS_PER_CODELET || !accepts_quote(words[quote_offset]) {
        return Err(SemanticError::InvalidShape {
            index: quote_offset,
            expected: 0,
            actual: words.get(quote_offset).copied().unwrap_or(0),
        });
    }

    // The regions follow one another. The quote header owns the words that
    // follow it, and the explicit-length form spends one of them on the length.
    let mut regions: Vec<LiteralRegion> = Vec::new();
    let mut offset = quote_offset;
    while offset < WORDS_PER_CODELET && words[offset] & QUOTE_DENOTE_MASK == QUOTE_DENOTE {
        let header = decode_quote_header(words[offset]).ok_or(SemanticError::InvalidShape {
            index: offset,
            expected: 0,
            actual: words[offset],
        })?;
        let (payload_start, payload_length) = quote_payload_span(&header, words, offset)?;
        let next_offset = payload_start + payload_length;
        if next_offset >= WORDS_PER_CODELET {
            return Err(SemanticError::InvalidShape {
                index: next_offset,
                expected: 0,
                actual: 0,
            });
        }
        regions.push(LiteralRegion {
            header,
            payload_start,
            payload_length,
            next_offset,
        });
        offset = next_offset;
    }
    let last_region = regions.last().ok_or(SemanticError::InvalidShape {
        index: quote_offset,
        expected: 0,
        actual: 0,
    })?;

    let accusative_offset = last_region.next_offset;
    let realis_offset = accusative_offset + 1;
    if realis_offset >= WORDS_PER_CODELET {
        return Err(SemanticError::InvalidShape {
            index: realis_offset,
            expected: 0,
            actual: 0,
        });
    }
    if words[accusative_offset] != ACCUSATIVE_CASE {
        return Err(SemanticError::InvalidShape {
            index: accusative_offset,
            expected: ACCUSATIVE_CASE,
            actual: words[accusative_offset],
        });
    }
    if words[realis_offset] != REALIS_MOOD {
        return Err(SemanticError::InvalidShape {
            index: realis_offset,
            expected: REALIS_MOOD,
            actual: words[realis_offset],
        });
    }

    let mut boundary_slots = Vec::new();
    if let Some(offset) = nominative_slot {
        boundary_slots.push(offset);
    }
    boundary_slots.push(accusative_offset);
    boundary_slots.push(realis_offset);
    let expected_head = index_word(&boundary_slots);
    if words[0] != expected_head {
        return Err(SemanticError::InvalidShape {
            index: 0,
            expected: expected_head,
            actual: words[0],
        });
    }

    let used_words = realis_offset + 1;
    for (index, actual) in words.iter().enumerate().skip(used_words) {
        if *actual != 0 {
            return Err(SemanticError::NonzeroTail {
                index,
                actual: *actual,
            });
        }
    }

    Ok(LiteralLayout { regions })
}

pub fn decode_date(words: &[u16; WORDS_PER_CODELET]) -> Result<DateInstruction, SemanticError> {
    let layout = read_regions(words, &|word: u16| word == DATE_QUOTE)?;
    let region = &layout.regions[0];
    let mut epoch: u64 = 0;
    for index in (region.payload_start..region.payload_start + region.payload_length).rev() {
        epoch = (epoch << 16) | u64::from(words[index]);
    }
    Ok(DateInstruction { epoch_ms: epoch })
}

pub fn execute_date(instruction: &DateInstruction) -> u64 {
    instruction.epoch_ms
}

pub fn execute_date_codelet(words: &[u16; WORDS_PER_CODELET]) -> Result<u64, SemanticError> {
    let instruction = decode_date(words)?;
    Ok(execute_date(&instruction))
}

/// The text of a letter region: each payload word is one character.
fn region_text(words: &[u16; WORDS_PER_CODELET], region: &LiteralRegion) -> String {
    let units: Vec<u16> =
        words[region.payload_start..region.payload_start + region.payload_length].to_vec();
    String::from_utf16_lossy(&units)
}

pub fn decode_vector(words: &[u16; WORDS_PER_CODELET]) -> Result<VectorInstruction, SemanticError> {
    let layout = read_regions(words, &|word: u16| {
        is_uint_vector_quote(word) || is_int_vector_quote(word) || is_letter_quote(word)
    })?;
    let first = &layout.regions[0];
    let elements = match first.header.sort {
        UINT_SORT_DENOTE => {
            let values =
                words[first.payload_start..first.payload_start + first.payload_length].to_vec();
            VectorElements::Numbers(values)
        }
        INT_SORT_DENOTE => {
            let values = words[first.payload_start..first.payload_start + first.payload_length]
                .iter()
                .map(|word| *word as i16 != 0)
                .collect();
            VectorElements::Booleans(values)
        }
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
    let instruction = decode_vector(words)?;
    Ok(execute_vector(&instruction))
}

/// The canonical Pyash rendering of a date: a plain day when the value is
/// midnight UTC, and the full ISO form otherwise.
pub fn format_date(epoch_ms: u64) -> String {
    let days = (epoch_ms / MILLISECONDS_PER_DAY) as i64;
    let millis_of_day = epoch_ms % MILLISECONDS_PER_DAY;
    let (year, month, day) = civil_from_days(days);
    if millis_of_day == 0 {
        return format!("{year:04}-{month:02}-{day:02}");
    }
    let hours = millis_of_day / 3_600_000;
    let minutes = (millis_of_day % 3_600_000) / 60_000;
    let seconds = (millis_of_day % 60_000) / 1_000;
    let millis = millis_of_day % 1_000;
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{millis:03}Z")
}

/// The civil date of a day count since the Unix epoch.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    } as u32;
    let year = if month <= 2 { year + 1 } else { year };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DATE_CODELET: [u16; WORDS_PER_CODELET] = [
        0x00c1, 0x981d, 0x9c00, 0x8924, 0x0196, 0x0000, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0,
    ];

    const VECTOR_CODELET: [u16; WORDS_PER_CODELET] = [
        0x0061, 0x8f1d, 0x0001, 0x0002, 0x0003, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];

    const BOOLEAN_VECTOR_CODELET: [u16; WORDS_PER_CODELET] = [
        0x0061, 0xaf1d, 0x0001, 0x0000, 0x0001, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];

    const TEXT_VECTOR_CODELET: [u16; WORDS_PER_CODELET] = [
        0x3001, 0x0e1d, 0x0004, 0x004e, 0x0061, 0x006d, 0x0065, 0x0e1d, 0x0003, 0x0041, 0x0067,
        0x0065, 0x245e, 0x217e, 0, 0,
    ];

    #[test]
    fn decodes_and_executes_the_date_literal() {
        assert_eq!(execute_date_codelet(&DATE_CODELET), Ok(1_746_057_600_000));
        assert_eq!(format_date(1_746_057_600_000), "2025-05-01");
    }

    #[test]
    fn decodes_and_executes_the_vector_literal() {
        assert_eq!(
            execute_vector_codelet(&VECTOR_CODELET),
            Ok(VectorElements::Numbers(vec![1, 2, 3]))
        );
    }

    #[test]
    fn decodes_and_executes_the_boolean_vector_literal() {
        assert_eq!(
            execute_vector_codelet(&BOOLEAN_VECTOR_CODELET),
            Ok(VectorElements::Booleans(vec![true, false, true]))
        );
    }

    #[test]
    fn decodes_and_executes_the_text_vector_literal() {
        assert_eq!(
            execute_vector_codelet(&TEXT_VECTOR_CODELET),
            Ok(VectorElements::Texts(vec![
                "Name".to_string(),
                "Age".to_string()
            ]))
        );
    }

    #[test]
    fn decodes_the_explicit_length_vector_literal() {
        let explicit: [u16; WORDS_PER_CODELET] = [
            0x0301, 0x8e1d, 0x0005, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x245e, 0x217e, 0, 0,
            0, 0, 0, 0,
        ];
        assert_eq!(
            execute_vector_codelet(&explicit),
            Ok(VectorElements::Numbers(vec![1, 2, 3, 4, 5]))
        );
    }

    #[test]
    fn decodes_a_vector_whose_element_looks_like_a_case_word() {
        let tricky: [u16; WORDS_PER_CODELET] = [
            0x0061, 0x8f1d, 0x24de, 0x245e, 0x217e, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert_eq!(
            execute_vector_codelet(&tricky),
            Ok(VectorElements::Numbers(vec![0x24de, 0x245e, 0x217e]))
        );
    }

    #[test]
    fn rejects_a_date_codelet_with_a_broken_head() {
        let mut broken = DATE_CODELET;
        broken[0] = 0x0019;
        let error = decode_date(&broken).expect_err("the head must match the layout");
        assert_eq!(error.code(), "malformed-codelet");
    }

    #[test]
    fn rejects_a_literal_with_a_noisy_tail() {
        let mut noisy = VECTOR_CODELET;
        noisy[7] = 1;
        let error = decode_vector(&noisy).expect_err("the tail must be zero");
        assert_eq!(error.code(), "nonzero-tail");
    }
}
