use super::numeric::{QuoteHeader, quote_header};
use super::*;

pub(super) const VECTOR_VERB: u32 = 0x2b73;

fn vector_header(words: &[u32], codelet: usize) -> Option<(usize, QuoteHeader)> {
    let mut slot = 1;
    while slot < CODELET_WORDS {
        let raw = word(words, codelet, slot);
        let header = quote_header(raw);
        if header.valid != 0 && matches!(header.sort, 4 | 5 | 6) && ((raw & 0x0700) >> 8) != 0 {
            return Some((slot, header));
        }
        slot += 1;
    }
    None
}

pub(super) fn vector_name_span(words: &[u32], start: usize, group_len: usize) -> Option<NameSpan> {
    let token_capacity = group_len * (CODELET_WORDS - 1);
    let mut token_offset = 0usize;
    while token_offset < token_capacity {
        let codelet = start + token_offset / (CODELET_WORDS - 1);
        let slot = token_offset % (CODELET_WORDS - 1) + 1;
        let raw = word(words, codelet, slot);
        let header = quote_header(raw);
        let thickness = (raw & 0x0700) >> 8;
        if header.valid != 0 && matches!(header.sort, 4 | 5 | 6) && thickness != 0 {
            if token_offset >= 2
                && token_at(words, start, token_offset - 1, group_len) == Some(NOMINATIVE)
            {
                return Some(NameSpan {
                    start: 0,
                    length: token_offset - 1,
                });
            }
        }
        token_offset += 1;
    }
    None
}

fn token_at(words: &[u32], start: usize, offset: usize, group_len: usize) -> Option<u32> {
    if offset >= group_len * (CODELET_WORDS - 1) {
        return None;
    }
    let codelet = start + offset / (CODELET_WORDS - 1);
    let slot = offset % (CODELET_WORDS - 1) + 1;
    if codelet * CODELET_WORDS + slot < words.len() {
        Some(word(words, codelet, slot))
    } else {
        None
    }
}

fn vector_length(
    words: &[u32],
    codelet: usize,
    offset: usize,
    header: QuoteHeader,
) -> Option<(usize, usize)> {
    let scalar_words = header.scalar_bytes as usize / 2;
    let (length, payload_offset) = if header.explicit != 0 {
        if offset + 1 >= CODELET_WORDS {
            return None;
        }
        let length = word(words, codelet, offset + 1) as usize;
        (length, offset + 2)
    } else {
        (header.fixed_length as usize / scalar_words, offset + 1)
    };
    if length == 0 || length > MAX_VECTOR_LANES {
        return None;
    }
    Some((length, payload_offset))
}

fn next_indexed_word(words: &[u32], codelet: &mut usize, slot: &mut usize) -> Option<u32> {
    if *codelet * CODELET_WORDS + *slot >= words.len() {
        return None;
    }
    let value = word(words, *codelet, *slot);
    *slot += 1;
    if *slot == CODELET_WORDS {
        *codelet += 1;
        *slot = 1;
    }
    Some(value)
}

fn vector_literal(words: &[u32], start: usize, group_len: usize) -> Option<CoreResult> {
    let (offset, header) = vector_header(words, start)?;
    let (length, payload_offset) = match vector_length(words, start, offset, header) {
        Some(layout) => layout,
        None => return Some(CoreResult::failure(ERROR_VECTOR_WIDTH, group_len as u32)),
    };
    let mut result = CoreResult::empty();
    result.value_kind = match (header.sort, header.scalar_bytes) {
        (4, 2) => VALUE_VECTOR_U16,
        (5, 2) => VALUE_VECTOR_BOOL,
        (6, 4) => VALUE_VECTOR_FLOAT32,
        (6, 8) => VALUE_VECTOR_FLOAT64,
        _ => return Some(CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32)),
    };
    result.length = length as u32;
    result.consumed_codelets = group_len as u32;

    let (mut payload_codelet, mut payload_slot) = (start, payload_offset);
    let mut lane = 0;
    while lane < length {
        let words_per_value = header.scalar_bytes as usize / 2;
        let mut value_words = [0u32; 4];
        let mut word_index = 0;
        while word_index < words_per_value {
            let value = match next_indexed_word(words, &mut payload_codelet, &mut payload_slot) {
                Some(value) => value & 0xffff,
                None => return Some(CoreResult::failure(ERROR_MALFORMED, group_len as u32)),
            };
            value_words[word_index] = value;
            word_index += 1;
        }

        match result.value_kind {
            VALUE_VECTOR_U16 => array_put!(&mut result.values, lane, value_words[0]),
            VALUE_VECTOR_BOOL => {
                array_put!(&mut result.values, lane, u32::from(value_words[0] != 0))
            }
            VALUE_VECTOR_FLOAT32 => {
                let bits = value_words[0] | (value_words[1] << 16);
                if bits & 0x7f80_0000 == 0x7f80_0000 {
                    return Some(CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32));
                }
                array_put!(&mut result.values, lane, bits);
            }
            VALUE_VECTOR_FLOAT64 => {
                let low = value_words[0] | (value_words[1] << 16);
                let high = value_words[2] | (value_words[3] << 16);
                if high & 0x7ff0_0000 == 0x7ff0_0000 {
                    return Some(CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32));
                }
                array_put!(&mut result.values, lane * 2, low);
                array_put!(&mut result.values, lane * 2 + 1, high);
            }
            _ => return Some(CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32)),
        }
        lane += 1;
    }

    let accusative = next_indexed_word(words, &mut payload_codelet, &mut payload_slot);
    let next = next_indexed_word(words, &mut payload_codelet, &mut payload_slot);
    let valid_tail = accusative == Some(ACCUSATIVE)
        && (next == Some(REALIS)
            || (next == Some(VECTOR_VERB)
                && next_indexed_word(words, &mut payload_codelet, &mut payload_slot)
                    == Some(REALIS)));
    if !valid_tail {
        return Some(CoreResult::failure(ERROR_MALFORMED, group_len as u32));
    }
    let last_codelet = start + group_len - 1;
    let padding_is_zero = if payload_codelet == start + group_len && payload_slot == 1 {
        true
    } else if payload_codelet == last_codelet {
        let mut slot = payload_slot;
        let mut zero = true;
        while slot < CODELET_WORDS {
            zero &= word(words, last_codelet, slot) == 0;
            slot += 1;
        }
        zero
    } else {
        false
    };
    if !padding_is_zero {
        return Some(CoreResult::failure(ERROR_MALFORMED, group_len as u32));
    }

    Some(result)
}

pub(super) fn interpret_vector_group(
    words: &[u32],
    start: usize,
    group_len: usize,
) -> Option<CoreResult> {
    if group_len < 2 {
        return None;
    }
    vector_literal(words, start, group_len)
}
