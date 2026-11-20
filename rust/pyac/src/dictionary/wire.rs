use crate::WORDS_PER_CODELET;

const NAME_TYPE: u16 = 0x225e;
const SU: u16 = 0x24de;
pub(super) const OB: u16 = 0x245e;
pub(super) const AS: u16 = 0x414f;
pub(super) const FROM: u16 = 0x313e;
pub(super) const TO: u16 = 0x243e;
pub(super) const BY: u16 = 0x287e;
pub(super) const WITH: u16 = 0x490f;
pub(super) const AT: u16 = 0x615f;
const NUMBER_QUOTE: u16 = 0x881d;
const TEXT_QUOTE: u16 = 0x0e1d;
const TEXT_VERB: u16 = 0x8a28;
const REALIS: u16 = 0x217e;
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
    Uint16Vector(&'a [u16]),
    Name(&'a [u16]),
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

fn vector_quote_word(count: usize) -> Result<(u16, bool), DictionaryWireError> {
    let (thickness, explicit) = match count {
        2 => (1u16, false),
        4 => (2, false),
        8 => (3, false),
        16 => (4, false),
        3 => (7, false),
        1..=65_535 => (6, true),
        _ => return Err(DictionaryWireError::VectorTooLong),
    };
    Ok((0x8000 | (thickness << 8) | 0x0800 | 0x001d, explicit))
}

fn encode_value(
    value: &Value<'_>,
    words: &mut Vec<u16>,
    raw: &mut Vec<RawText>,
) -> Result<(), DictionaryWireError> {
    match value {
        Value::Text(text) => {
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
        }
        Value::Uint16(value) => words.extend([NUMBER_QUOTE, *value]),
        Value::Uint16Vector(values) => {
            let (header, explicit) = vector_quote_word(values.len())?;
            words.push(header);
            if explicit {
                words.push(values.len() as u16);
            }
            words.extend(values.iter().copied());
        }
        Value::Name(name) => {
            if name.is_empty() {
                return Err(DictionaryWireError::EmptySubject);
            }
            words.push(NAME_TYPE);
            words.extend(name.iter().copied());
        }
    }
    Ok(())
}

pub fn encode_text_sentence(
    subject: &[u16],
    fields: &[Field<'_>],
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryWireError> {
    if subject.is_empty() {
        return Err(DictionaryWireError::EmptySubject);
    }
    let mut words = Vec::new();
    let mut boundaries = Vec::new();
    let mut raw = Vec::new();
    words.push(NAME_TYPE);
    words.extend(subject.iter().copied());
    words.push(SU);
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
    words.extend([TEXT_VERB, REALIS]);
    boundaries.push(words.len());
    pack_words(&words, &boundaries, &raw)
}

fn case_order(case: u16) -> Option<u8> {
    match case {
        OB => Some(1),
        AS => Some(2),
        FROM => Some(3),
        TO => Some(4),
        BY => Some(5),
        WITH => Some(6),
        AT => Some(7),
        _ => None,
    }
}

fn pack_words(
    words: &[u16],
    boundaries: &[usize],
    raw_text: &[RawText],
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryWireError> {
    if boundaries.len() > 16 {
        return Err(DictionaryWireError::TooManyCases);
    }
    let mut raw_regions = Vec::new();
    let mut raw_word_total = 0usize;
    for quote in raw_text {
        let indexed_offset = quote.start.saturating_sub(raw_word_total);
        let used = indexed_offset % CODELET_DATA_WORDS;
        let available = CODELET_DATA_WORDS - used;
        if quote.length > available {
            raw_regions.push(quote.clone());
            raw_word_total += quote.length;
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
            for chunk in piece.chunks(WORDS_PER_CODELET) {
                let mut codelet = [0; WORDS_PER_CODELET];
                codelet[..chunk.len()].copy_from_slice(chunk);
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
                grammatical_case: OB,
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
                grammatical_case: OB,
                value: Value::Text(text),
            }],
        )
        .expect("encode long text");
        assert!(sentence.len() > 1);
        assert_eq!(sentence[0][0] & 1, 0);
        assert_eq!(sentence[1][0], b'P' as u16);
    }
}
