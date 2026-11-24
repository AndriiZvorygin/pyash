use super::*;

const INVALID_CODELET_WORD: u32 = u32::MAX;

pub(super) fn word(words: &[impl VliwWord], codelet: usize, slot: usize) -> u32 {
    if slot >= CODELET_WORDS || codelet >= words.len() / CODELET_WORDS {
        return INVALID_CODELET_WORD;
    }
    let index = codelet * CODELET_WORDS + slot;
    // SAFETY: the guards prove this index is within a complete codelet in `words`.
    unsafe { input_word_unchecked(words, index) }
}

pub(super) fn zero_tail(words: &[impl VliwWord], codelet: usize, from: usize) -> bool {
    let mut slot = from;
    while slot < CODELET_WORDS {
        if word(words, codelet, slot) != 0 {
            return false;
        }
        slot += 1;
    }
    true
}

pub(super) fn number_operator(operator: u32, left: u32, right: u32) -> Result<u32, u32> {
    if left > MAX_U16 || right > MAX_U16 {
        return Err(ERROR_MALFORMED);
    }
    match operator {
        PLUS => Ok((left + right).min(MAX_U16)),
        SUBTRACT => Ok(if left >= right { left - right } else { 0 }),
        MULTIPLY => Ok(left * right),
        DIVIDE if right == 0 => Err(ERROR_DIVISION_BY_ZERO),
        DIVIDE => left.checked_div(right).ok_or(ERROR_DIVISION_BY_ZERO),
        XOR => Ok(left ^ right),
        EXPONENTIAL => {
            let mut result = 1u32;
            let mut factor = left;
            let mut exponent = right;
            while exponent > 0 {
                if exponent & 1 != 0 {
                    result = (result * factor).min(MAX_U16);
                }
                exponent >>= 1;
                if exponent > 0 {
                    factor = (factor * factor).min(MAX_U16);
                }
            }
            Ok(result)
        }
        REMAINS if right == 0 => Err(ERROR_DIVISION_BY_ZERO),
        REMAINS => left.checked_rem(right).ok_or(ERROR_DIVISION_BY_ZERO),
        _ => Err(ERROR_UNSUPPORTED),
    }
}

pub fn apply_number_operator(operator: u32, left: u32, right: u32) -> Result<u32, u32> {
    number_operator(operator, left, right)
}

pub(super) fn arithmetic(words: &[impl VliwWord], codelet: usize) -> Option<CoreResult> {
    if word(words, codelet, 1) != NUMBER_QUOTE
        || word(words, codelet, 3) != ACCUSATIVE
        || word(words, codelet, 4) != NUMBER_QUOTE
        || word(words, codelet, 8) != DEONTIC
    {
        return None;
    }
    let op = word(words, codelet, 7);
    if !matches!(
        op,
        PLUS | SUBTRACT | MULTIPLY | DIVIDE | XOR | EXPONENTIAL | REMAINS
    ) {
        return Some(CoreResult::failure(ERROR_UNSUPPORTED, 1));
    }
    if word(words, codelet, 0) != 0x0149 || !zero_tail(words, codelet, 9) {
        return Some(CoreResult::failure(ERROR_MALFORMED, 1));
    }
    let left = word(words, codelet, 2);
    let right = word(words, codelet, 5);
    if left > MAX_U16 || right > MAX_U16 {
        return Some(CoreResult::failure(ERROR_MALFORMED, 1));
    }
    match number_operator(op, left, right) {
        Ok(value) => Some(CoreResult::scalar(VALUE_UNSIGNED, value, 0, 1)),
        Err(error) => Some(CoreResult::failure(error, 1)),
    }
}

pub(super) fn invert(words: &[impl VliwWord], codelet: usize) -> Option<CoreResult> {
    if word(words, codelet, 7) != INVERT && word(words, codelet, 6) != DATIVE {
        return None;
    }
    let value = word(words, codelet, 2);
    if word(words, codelet, 0) != 0x0149
        || word(words, codelet, 1) != NUMBER_QUOTE
        || word(words, codelet, 3) != ACCUSATIVE
        || word(words, codelet, 4) != NUMBER_QUOTE
        || word(words, codelet, 6) != DATIVE
        || word(words, codelet, 8) != DEONTIC
        || value > u32::from(u16::MAX)
        || word(words, codelet, 5) != 0
        || !zero_tail(words, codelet, 9)
    {
        return Some(CoreResult::failure(ERROR_MALFORMED, 1));
    }
    let signed = (-(value as i32)) as u32;
    Some(CoreResult::scalar(
        VALUE_SIGNED,
        signed,
        if signed & 0x8000_0000 != 0 {
            u32::MAX
        } else {
            0
        },
        1,
    ))
}

pub(super) fn boolean_literal(words: &[impl VliwWord], codelet: usize) -> Option<CoreResult> {
    let value = word(words, codelet, 1);
    if !matches!(value, TRUTH | LIE)
        || word(words, codelet, 2) != ACCUSATIVE
        || !matches!(word(words, codelet, 3), NUMBER_VERB | BOOLEAN_VERB)
        || word(words, codelet, 4) != REALIS
    {
        return None;
    }
    if word(words, codelet, 0) != 0x15 || !zero_tail(words, codelet, 5) {
        return Some(CoreResult::failure(ERROR_MALFORMED, 1));
    }
    Some(CoreResult::scalar(
        VALUE_BOOLEAN,
        u32::from(value == TRUTH),
        0,
        1,
    ))
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(super) struct QuoteHeader {
    pub(super) valid: u32,
    pub(super) sort: u32,
    pub(super) scalar_bytes: u32,
    pub(super) fixed_length: u32,
    pub(super) explicit: u32,
}

impl QuoteHeader {
    const fn invalid() -> Self {
        Self {
            valid: 0,
            sort: 0,
            scalar_bytes: 0,
            fixed_length: 0,
            explicit: 0,
        }
    }
}

pub(super) fn quote_header(header: u32) -> QuoteHeader {
    if header & 0x1f != QUOTE_DENOTE {
        return QuoteHeader::invalid();
    };
    let scalar_bytes = match (header & 0x1800) >> 11 {
        0 => 1,
        1 => 2,
        2 => 4,
        3 => 8,
        _ => return QuoteHeader::invalid(),
    };
    let thickness = ((header & 0x0700) >> 8) as usize;
    let count = match thickness {
        0 => 1,
        1 => 2,
        2 => 4,
        3 => 8,
        4 => 16,
        6 => 0,
        7 => 3,
        _ => return QuoteHeader::invalid(),
    };
    let sort = (header & 0xe000) >> 13;
    QuoteHeader {
        valid: 1,
        sort,
        scalar_bytes,
        fixed_length: (count * scalar_bytes as usize / 2) as u32,
        explicit: u32::from(thickness == 6),
    }
}

pub(super) fn find_quote(words: &[impl VliwWord], codelet: usize) -> Option<usize> {
    let mut slot = 1;
    while slot < CODELET_WORDS {
        if word(words, codelet, slot) & 0x1f == QUOTE_DENOTE {
            return Some(slot);
        }
        slot += 1;
    }
    None
}

pub(super) fn literal(words: &[impl VliwWord], codelet: usize) -> Option<CoreResult> {
    let offset = find_quote(words, codelet)?;
    let header = word(words, codelet, offset);
    let header_info = quote_header(header);
    if header_info.valid == 0 {
        return None;
    }
    let sort = header_info.sort;
    let scalar_bytes = header_info.scalar_bytes;
    let _fixed_length = header_info.fixed_length as usize;
    let explicit = header_info.explicit != 0;
    let nominative = if offset == 1 {
        false
    } else if word(words, codelet, offset - 1) == NOMINATIVE {
        true
    } else {
        return Some(CoreResult::failure(ERROR_UNSUPPORTED, 1));
    };

    if header == DATE_QUOTE {
        let payload = offset + 1;
        if scalar_bytes != 8 || explicit || payload + 4 >= CODELET_WORDS {
            return Some(CoreResult::failure(ERROR_MALFORMED, 1));
        }
        // Four little-endian 16-bit quote words are retained as two 32-bit
        // halves so the shader core does not require SPIR-V Int64.
        let accusative = payload + 4;
        let realis = accusative + 1;
        let expected_head = expected_index(nominative.then_some(offset - 1), accusative, realis);
        if word(words, codelet, accusative) != ACCUSATIVE
            || word(words, codelet, realis) != REALIS
            || word(words, codelet, 0) != expected_head
            || !zero_tail(words, codelet, realis + 1)
        {
            return Some(CoreResult::failure(ERROR_MALFORMED, 1));
        }
        let low = word(words, codelet, payload) | (word(words, codelet, payload + 1) << 16);
        let high = word(words, codelet, payload + 2) | (word(words, codelet, payload + 3) << 16);
        return Some(CoreResult::scalar(VALUE_DATE, low, high, 1));
    }

    if !matches!(sort, 4 | 5) || scalar_bytes != 2 {
        return None;
    }
    let payload = offset + if explicit { 2 } else { 1 };
    let length = if explicit {
        word(words, codelet, offset + 1) as usize
    } else {
        _fixed_length
    };
    if length == 0 || length > MAX_VECTOR_LANES || payload + length + 1 >= CODELET_WORDS {
        return Some(CoreResult::failure(ERROR_MALFORMED, 1));
    }
    let accusative = payload + length;
    let realis = accusative + 1;
    let expected_head = expected_index(nominative.then_some(offset - 1), accusative, realis);
    if word(words, codelet, accusative) != ACCUSATIVE
        || word(words, codelet, realis) != REALIS
        || word(words, codelet, 0) != expected_head
        || !zero_tail(words, codelet, realis + 1)
    {
        return Some(CoreResult::failure(ERROR_MALFORMED, 1));
    }
    let mut result = CoreResult::empty();
    result.value_kind = if sort == 4 {
        VALUE_VECTOR_U16
    } else {
        VALUE_VECTOR_BOOL
    };
    result.length = length as u32;
    result.consumed_codelets = 1;
    let mut i = 0;
    while i < length {
        let value = word(words, codelet, payload + i) & 0xffff;
        array_put!(
            &mut result.values,
            i,
            if sort == 4 {
                value
            } else {
                u32::from(value != 0)
            }
        );
        i += 1;
    }
    Some(result)
}

pub(super) fn expected_index(nominative: Option<usize>, accusative: usize, mood: usize) -> u32 {
    let mut result = 1u32;
    if let Some(slot) = nominative {
        result |= 1 << slot;
    }
    result | (1 << accusative) | (1 << mood)
}

pub(super) fn vector_arithmetic(words: &[impl VliwWord], codelet: usize) -> Option<CoreResult> {
    let left_header = word(words, codelet, 1);
    let left_info = quote_header(left_header);
    if left_info.valid == 0 {
        return None;
    }
    let sort = left_info.sort;
    let scalar_bytes = left_info.scalar_bytes;
    let fixed_count = left_info.fixed_length as usize;
    let explicit = left_info.explicit != 0;
    if sort != 4 || scalar_bytes != 2 || ((left_header & 0x0700) >> 8) == 0 {
        return None;
    }
    let count = if explicit {
        word(words, codelet, 2) as usize
    } else {
        fixed_count
    };
    if count < 2 || count > 8 {
        return Some(CoreResult::failure(ERROR_VECTOR_WIDTH, 1));
    }
    let left_start = if explicit { 3 } else { 2 };
    let left_end = left_start + count;
    let accusative = left_end;
    let right_offset = accusative + 1;
    if right_offset >= CODELET_WORDS || word(words, codelet, accusative) != ACCUSATIVE {
        return Some(CoreResult::failure(ERROR_MALFORMED, 1));
    }

    let right_header = word(words, codelet, right_offset);
    let right_is_scalar = right_header == NUMBER_QUOTE;
    let (right_start, right_count, case_offset, right_vector) = if right_is_scalar {
        (right_offset + 1, 1, right_offset + 2, false)
    } else {
        let right_info = quote_header(right_header);
        if right_info.valid == 0 {
            return None;
        }
        let right_sort = right_info.sort;
        let right_scalar_bytes = right_info.scalar_bytes;
        let fixed_right = right_info.fixed_length as usize;
        let right_explicit = right_info.explicit != 0;
        let right_count = if right_explicit {
            word(words, codelet, right_offset + 1) as usize
        } else {
            fixed_right
        };
        if right_sort != 4 || right_scalar_bytes != 2 || right_count != count {
            return Some(CoreResult::failure(ERROR_VECTOR_WIDTH, 1));
        }
        if right_count < 2 || right_count > 4 {
            return Some(CoreResult::failure(ERROR_VECTOR_WIDTH, 1));
        }
        let start = right_offset + if right_explicit { 2 } else { 1 };
        (start, right_count, start + right_count, true)
    };
    let op_offset = case_offset + 1;
    let mood_offset = op_offset + 1;
    if mood_offset >= CODELET_WORDS {
        return Some(CoreResult::failure(ERROR_VECTOR_WIDTH, 1));
    }
    let case_word = word(words, codelet, case_offset);
    if !matches!(case_word, SOURCE | DESTINATION | COMITATIVE | INSTRUMENTAL)
        || word(words, codelet, mood_offset) != DEONTIC
        || word(words, codelet, 0)
            != (expected_index(None, accusative, case_offset) | (1 << mood_offset))
        || !zero_tail(words, codelet, mood_offset + 1)
    {
        return Some(CoreResult::failure(ERROR_MALFORMED, 1));
    }
    let operator = word(words, codelet, op_offset);
    let mut result = CoreResult::empty();
    result.value_kind = if operator == MULTIPLY {
        VALUE_VECTOR_U32
    } else {
        VALUE_VECTOR_U16
    };
    result.length = count as u32;
    result.consumed_codelets = 1;
    let mut i = 0;
    while i < count {
        let left = word(words, codelet, left_start + i);
        let right = if right_vector {
            word(words, codelet, right_start + i)
        } else {
            word(words, codelet, right_start)
        };
        if left > MAX_U16 || right > MAX_U16 {
            return Some(CoreResult::failure(ERROR_MALFORMED, 1));
        }
        match number_operator(operator, left, right) {
            Ok(value) => array_put!(&mut result.values, i, value),
            Err(error) => return Some(CoreResult::failure(error, 1)),
        }
        i += 1;
    }
    let _ = right_count;
    Some(result)
}
