use crate::WORDS_PER_CODELET;

use super::words::{
    GI_NAME, HWUS_TEXT, KA_ACCUSATIVE, LI_REALIS, LWOH_LOCATIVE, MA_DESTINATION, MWAH_COMITATIVE,
    NA_NOMINATIVE, NUMBER_QUOTE, SO_SOURCE, SWIH_ESSIVE, TEXT_QUOTE, UINT32_QUOTE, YU_INSTRUMENTAL,
};
const CODELET_DATA_WORDS: usize = WORDS_PER_CODELET - 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DictionaryWireError {
    EmptyText,
    TextTooLong,
    EmptySubject,
    TooManyCases,
    InvalidCaseOrder,
    VectorTooLong,
}

impl std::fmt::Display for DictionaryWireError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for DictionaryWireError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Value<'a> {
    Text(&'a str),
    Uint16(u16),
    Uint32(u32),
    Uint16Vector(&'a [u16]),
    Uint32Vector(&'a [u32]),
    Name(&'a [u16]),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subject<'a> {
    Name(&'a [u16]),
    Text(&'a str),
    Uint16Vector(&'a [u16]),
}

#[derive(Debug, Clone, Copy)]
pub struct Field<'a> {
    pub grammatical_case: u16,
    pub value: Value<'a>,
}

#[derive(Debug, Clone)]
struct RawText {
    start: usize,
    length: usize,
}

fn vector_quote_word(
    count: usize,
    scalar_bytes: usize,
) -> Result<(u16, bool), DictionaryWireError> {
    let (thickness, explicit) = match count {
        2 => (1u16, false),
        4 => (2, false),
        8 => (3, false),
        16 => (4, false),
        3 => (7, false),
        1..=65_535 => (6, true),
        _ => return Err(DictionaryWireError::VectorTooLong),
    };
    let scalar_thickness = match scalar_bytes {
        2 => 1u16,
        4 => 2u16,
        _ => return Err(DictionaryWireError::VectorTooLong),
    };
    Ok((
        0x8000 | (scalar_thickness << 11) | (thickness << 8) | 0x001d,
        explicit,
    ))
}

fn encode_value(
    value: &Value<'_>,
    words: &mut Vec<u16>,
    raw: &mut Vec<RawText>,
) -> Result<(), DictionaryWireError> {
    match value {
        Value::Text(text) => {
            append_text(text, words, raw)?;
        }
        Value::Uint16(value) => words.extend([NUMBER_QUOTE, *value]),
        Value::Uint32(value) => words.extend([UINT32_QUOTE, *value as u16, (*value >> 16) as u16]),
        Value::Uint16Vector(values) => {
            let (header, explicit) = vector_quote_word(values.len(), 2)?;
            words.push(header);
            if explicit {
                words.push(values.len() as u16);
            }
            words.extend(values.iter().copied());
        }
        Value::Uint32Vector(values) => {
            let (header, explicit) = vector_quote_word(values.len(), 4)?;
            words.push(header);
            if explicit {
                words.push(values.len() as u16);
            }
            for value in *values {
                words.extend([*value as u16, (*value >> 16) as u16]);
            }
        }
        Value::Name(name) => {
            if name.is_empty() {
                return Err(DictionaryWireError::EmptySubject);
            }
            words.push(GI_NAME);
            words.extend(name.iter().copied());
        }
    }
    Ok(())
}

pub fn encode_text_sentence(
    subject: &[u16],
    fields: &[Field<'_>],
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryWireError> {
    encode_sentence(Subject::Name(subject), fields)
}

pub fn encode_sentence(
    subject: Subject<'_>,
    fields: &[Field<'_>],
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryWireError> {
    encode_sentence_with_quote_layout(subject, fields, false)
}

pub(super) fn encode_index_sentence_v4(
    subject: Subject<'_>,
    fields: &[Field<'_>],
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryWireError> {
    encode_sentence_with_quote_layout(subject, fields, true)
}

fn encode_sentence_with_quote_layout(
    subject: Subject<'_>,
    fields: &[Field<'_>],
    indexed_raw_quotes: bool,
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryWireError> {
    let mut words = Vec::new();
    let mut boundaries = Vec::new();
    let mut raw = Vec::new();
    match subject {
        Subject::Name(name) => {
            if name.is_empty() {
                return Err(DictionaryWireError::EmptySubject);
            }
            words.push(GI_NAME);
            words.extend(name.iter().copied());
        }
        Subject::Text(text) => {
            append_text(text, &mut words, &mut raw)?;
        }
        Subject::Uint16Vector(values) => {
            if values.is_empty() {
                return Err(DictionaryWireError::EmptySubject);
            }
            let (header, explicit) = vector_quote_word(values.len(), 2)?;
            words.push(header);
            if explicit {
                words.push(values.len() as u16);
            }
            words.extend(values.iter().copied());
        }
    }
    words.push(NA_NOMINATIVE);
    boundaries.push(words.len());
    let mut previous_case = 0;
    for field in fields {
        let order =
            case_order(field.grammatical_case).ok_or(DictionaryWireError::InvalidCaseOrder)?;
        if order <= previous_case {
            return Err(DictionaryWireError::InvalidCaseOrder);
        }
        previous_case = order;
        encode_value(&field.value, &mut words, &mut raw)?;
        words.push(field.grammatical_case);
        boundaries.push(words.len());
    }
    words.extend([HWUS_TEXT, LI_REALIS]);
    boundaries.push(words.len());
    pack_words(&words, &boundaries, &raw, indexed_raw_quotes)
}

fn append_text(
    text: &str,
    words: &mut Vec<u16>,
    raw: &mut Vec<RawText>,
) -> Result<(), DictionaryWireError> {
    let encoded: Vec<u16> = text.encode_utf16().collect();
    if encoded.is_empty() {
        return Err(DictionaryWireError::EmptyText);
    }
    if encoded.len() > u16::MAX as usize {
        return Err(DictionaryWireError::TextTooLong);
    }
    words.push(TEXT_QUOTE);
    words.push(encoded.len() as u16);
    let start = words.len();
    words.extend(encoded.iter().copied());
    if encoded.len() >= 15 {
        raw.push(RawText {
            start,
            length: encoded.len(),
        });
    }
    Ok(())
}

fn case_order(case: u16) -> Option<u8> {
    match case {
        KA_ACCUSATIVE => Some(1),
        SWIH_ESSIVE => Some(2),
        SO_SOURCE => Some(3),
        MA_DESTINATION => Some(4),
        YU_INSTRUMENTAL => Some(5),
        MWAH_COMITATIVE => Some(6),
        LWOH_LOCATIVE => Some(7),
        _ => None,
    }
}

fn pack_words(
    words: &[u16],
    boundaries: &[usize],
    raw_text: &[RawText],
    indexed_raw_quotes: bool,
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryWireError> {
    if boundaries.len() > 16 {
        return Err(DictionaryWireError::TooManyCases);
    }
    let mut raw_regions = Vec::new();
    for quote in raw_text {
        // The reader reserves every text quote longer than 14 UTF-16 words
        // for raw continuation codelets, even when 15 words would fit inline.
        if quote.length > 14 {
            raw_regions.push(quote.clone());
        }
    }
    let mut pieces = Vec::new();
    let mut cursor = 0usize;
    for quote in raw_regions {
        let end = quote.start + quote.length;
        if quote.start < cursor || end > words.len() {
            return Err(DictionaryWireError::TextTooLong);
        }
        pieces.push((false, cursor, &words[cursor..quote.start]));
        pieces.push((true, quote.start, &words[quote.start..end]));
        cursor = end;
    }
    pieces.push((false, cursor, &words[cursor..]));

    let indexed_count = pieces
        .iter()
        .filter(|(is_raw, _, _)| !is_raw)
        .map(|(_, _, piece)| piece.len().div_ceil(CODELET_DATA_WORDS))
        .sum::<usize>();
    let mut indexed_seen = 0usize;
    let mut output = Vec::new();
    for (is_raw, start, piece) in pieces {
        if is_raw {
            let payload_width = if indexed_raw_quotes {
                CODELET_DATA_WORDS
            } else {
                WORDS_PER_CODELET
            };
            for chunk in piece.chunks(payload_width) {
                let mut codelet = [0; WORDS_PER_CODELET];
                let payload_start = usize::from(indexed_raw_quotes);
                codelet[payload_start..payload_start + chunk.len()].copy_from_slice(chunk);
                output.push(codelet);
            }
            continue;
        }
        for (chunk_index, chunk) in piece.chunks(CODELET_DATA_WORDS).enumerate() {
            indexed_seen += 1;
            let complete = indexed_seen == indexed_count;
            let mut codelet = [0; WORDS_PER_CODELET];
            codelet[1..1 + chunk.len()].copy_from_slice(chunk);
            for slot in 1..=chunk.len() {
                let boundary = boundaries
                    .binary_search(&(start + chunk_index * CODELET_DATA_WORDS + slot))
                    .is_ok();
                if boundary == complete {
                    codelet[0] |= 1 << slot;
                }
            }
            if complete {
                codelet[0] |= 1;
            }
            output.push(codelet);
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DICTIONARY: [u16; 2] = [0x680b, 0x6c22];

    #[test]
    fn profile_sentence_matches_the_pyash_vliw_word_layout() {
        let sentence = encode_text_sentence(
            &DICTIONARY,
            &[Field {
                grammatical_case: KA_ACCUSATIVE,
                value: Value::Text("en Pyash"),
            }],
        )
        .expect("encode profile marker");
        assert_eq!(sentence.len(), 2);
        assert_eq!(
            sentence[0],
            [
                0x7fee, 0x225e, 0x680b, 0x6c22, 0x24de, 0x0e1d, 8, 101, 110, 32, 80, 121, 97, 115,
                104, 0x245e,
            ]
        );
        assert_eq!(sentence[1][..3], [5, 0x8a28, 0x217e]);
    }

    #[test]
    fn long_text_uses_standard_raw_quote_continuation() {
        let text = "Pyash multilingual dictionary profile v1";
        let sentence = encode_text_sentence(
            &DICTIONARY,
            &[Field {
                grammatical_case: KA_ACCUSATIVE,
                value: Value::Text(text),
            }],
        )
        .expect("encode long text");
        assert!(sentence.len() > 1);
        assert_eq!(sentence[0][0] & 1, 0);
        assert_eq!(sentence[1][0], b'P' as u16);
    }

    #[test]
    fn v4_index_quote_continuation_preserves_the_codelet_index_word() {
        let text = "Long dictionary index key with enough characters for continuation.";
        let sentence = encode_index_sentence_v4(
            Subject::Text(text),
            &[Field {
                grammatical_case: LWOH_LOCATIVE,
                value: Value::Uint32(123),
            }],
        )
        .expect("encode indexed quote");
        assert!(sentence.len() > 2);
        assert_eq!(sentence[1][0], 0);
        assert_eq!(sentence[1][1], b'L' as u16);
    }

    #[test]
    fn uint32_vector_uses_four_byte_elements_and_explicit_count() {
        let values = [0x1234_5678, 0x9abc_def0];
        let sentence = encode_text_sentence(
            &DICTIONARY,
            &[Field {
                grammatical_case: KA_ACCUSATIVE,
                value: Value::Uint32Vector(&values),
            }],
        )
        .expect("encode uint32 vector");
        let words = sentence
            .iter()
            .flat_map(|codelet| codelet[1..].iter().copied())
            .collect::<Vec<_>>();
        let quote = words
            .iter()
            .position(|word| *word == 0x911d)
            .expect("u32 vector quote");
        assert_eq!(
            &words[quote..quote + 5],
            &[0x911d, 0x5678, 0x1234, 0xdef0, 0x9abc]
        );
    }

    #[test]
    fn text_and_vector_subjects_are_encoded_without_a_name_wrapper() {
        let text = encode_sentence(
            Subject::Text("surface"),
            &[Field {
                grammatical_case: LWOH_LOCATIVE,
                value: Value::Uint32(123),
            }],
        )
        .expect("encode text subject");
        let words = text
            .iter()
            .flat_map(|codelet| codelet[1..].iter().copied())
            .collect::<Vec<_>>();
        assert_eq!(
            &words[..10],
            &[TEXT_QUOTE, 7, 115, 117, 114, 102, 97, 99, 101, NA_NOMINATIVE]
        );

        let key = [0x1111, 0x2222];
        let vector =
            encode_sentence(Subject::Uint16Vector(&key), &[]).expect("encode vector subject");
        let words = vector
            .iter()
            .flat_map(|codelet| codelet[1..].iter().copied())
            .collect::<Vec<_>>();
        assert!(words.starts_with(&[0x891d, 0x1111, 0x2222, NA_NOMINATIVE]));
    }
}
