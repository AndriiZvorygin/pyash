//! The literal families of the Pyash VLIW codelet format.
//!
//! A literal codelet is laid out as
//!
//! ```text
//! head | name words | nominative | quote | payload | accusative | realis
//! ```
//!
//! The name phrase and its nominative case are present only when the sentence
//! names the value. The head word is the legacy index: bit 0 says whether the
//! vector completes the codelet, and the remaining bits mark the
//! phrase-closing case word and the codelet-ending mood word.

use crate::WORDS_PER_CODELET;
use crate::semantic::SemanticError;

pub const ACCUSATIVE_CASE: u16 = 0x245e;
pub const NOMINATIVE_CASE: u16 = 0x24de;
pub const REALIS_MOOD: u16 = 0x217e;

/// A uint quote with the 64-bit scalar thickness: four payload words.
pub const DATE_QUOTE: u16 = 0x981d;
/// The legacy quote sorts and thicknesses.
pub const UINT_SORT_DENOTE: u16 = 4;
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VectorInstruction {
    pub values: Vec<u16>,
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

/// The layout of a decoded literal codelet.
struct LiteralLayout {
    name_words: Vec<u16>,
    quote_offset: usize,
    payload_start: usize,
    payload_length: usize,
    accusative_offset: usize,
    realis_offset: usize,
    used_words: usize,
}

fn read_layout(
    words: &[u16; WORDS_PER_CODELET],
    accepts_quote: &dyn Fn(u16) -> bool,
    payload_word_count: &dyn Fn(&QuoteHeader, Option<usize>) -> usize,
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
    let (name_words, nominative_slot) =
        if quote_offset > 1 && words[quote_offset - 1] == NOMINATIVE_CASE {
            (words[1..quote_offset - 1].to_vec(), Some(quote_offset - 1))
        } else if quote_offset == 1 {
            (Vec::new(), None)
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
    let header = decode_quote_header(words[quote_offset]).ok_or(SemanticError::InvalidShape {
        index: quote_offset,
        expected: 0,
        actual: words[quote_offset],
    })?;
    let explicit_length = if header.explicit_vector_length {
        let length = *words
            .get(quote_offset + 1)
            .ok_or(SemanticError::InvalidShape {
                index: quote_offset + 1,
                expected: 0,
                actual: 0,
            })? as usize;
        Some(length)
    } else {
        None
    };
    let payload_length = payload_word_count(&header, explicit_length);
    let payload_start = quote_offset + 1 + usize::from(explicit_length.is_some());
    let accusative_offset = payload_start + payload_length;
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

    Ok(LiteralLayout {
        name_words,
        quote_offset,
        payload_start,
        payload_length,
        accusative_offset,
        realis_offset,
        used_words,
    })
}

pub fn decode_date(words: &[u16; WORDS_PER_CODELET]) -> Result<DateInstruction, SemanticError> {
    let layout = read_layout(
        words,
        &|word: u16| word == DATE_QUOTE,
        &|header: &QuoteHeader, _explicit: Option<usize>| {
            header.vector_words.unwrap_or(1) * (header.scalar_bytes / 2)
        },
    )?;
    let mut epoch: u64 = 0;
    for index in (layout.payload_start..layout.payload_start + layout.payload_length).rev() {
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

pub fn decode_vector(words: &[u16; WORDS_PER_CODELET]) -> Result<VectorInstruction, SemanticError> {
    let layout = read_layout(
        words,
        &|word: u16| is_uint_vector_quote(word),
        &|header: &QuoteHeader, explicit: Option<usize>| {
            explicit.unwrap_or_else(|| header.vector_words.unwrap_or(1))
        },
    )?;
    let values = words[layout.payload_start..layout.payload_start + layout.payload_length].to_vec();
    Ok(VectorInstruction { values })
}

pub fn execute_vector(instruction: &VectorInstruction) -> Vec<u16> {
    instruction.values.clone()
}

pub fn execute_vector_codelet(words: &[u16; WORDS_PER_CODELET]) -> Result<Vec<u16>, SemanticError> {
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

    #[test]
    fn decodes_and_executes_the_date_literal() {
        assert_eq!(execute_date_codelet(&DATE_CODELET), Ok(1_746_057_600_000));
        assert_eq!(format_date(1_746_057_600_000), "2025-05-01");
    }

    #[test]
    fn decodes_and_executes_the_vector_literal() {
        assert_eq!(execute_vector_codelet(&VECTOR_CODELET), Ok(vec![1, 2, 3]));
    }

    #[test]
    fn decodes_the_explicit_length_vector_literal() {
        let explicit: [u16; WORDS_PER_CODELET] = [
            0x0301, 0x8e1d, 0x0005, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x245e, 0x217e, 0, 0,
            0, 0, 0, 0,
        ];
        assert_eq!(execute_vector_codelet(&explicit), Ok(vec![1, 2, 3, 4, 5]));
    }

    #[test]
    fn decodes_a_vector_whose_element_looks_like_a_case_word() {
        let tricky: [u16; WORDS_PER_CODELET] = [
            0x0061, 0x8f1d, 0x24de, 0x245e, 0x217e, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert_eq!(
            execute_vector_codelet(&tricky),
            Ok(vec![0x24de, 0x245e, 0x217e])
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
