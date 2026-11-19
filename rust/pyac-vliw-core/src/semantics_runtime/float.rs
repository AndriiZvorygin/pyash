use super::numeric::{expected_index, find_quote, quote_header, word, zero_tail};
use super::*;

pub(super) fn single_codelet(words: &[u32], codelet: usize) -> Option<CoreResult> {
    let offset = find_quote(words, codelet)?;
    let header_word = word(words, codelet, offset);
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 {
        return None;
    }

    if offset == 1 && word(words, codelet, 4) == ACCUSATIVE && word(words, codelet, 10) == DEONTIC {
        return Some(arithmetic(words, codelet));
    }

    let nominative = if offset == 1 {
        false
    } else if word(words, codelet, offset - 1) == NOMINATIVE {
        true
    } else {
        return Some(CoreResult::failure(ERROR_UNSUPPORTED, 1));
    };
    Some(literal(
        words,
        codelet,
        offset,
        nominative,
        header.scalar_bytes,
        header.fixed_length as usize,
        header.explicit != 0,
        ((header_word & 0x0700) >> 8) != 0,
    ))
}

fn quote_bits(words: &[u32], codelet: usize, offset: usize) -> Result<u32, u32> {
    if offset + 2 >= CODELET_WORDS {
        return Err(ERROR_MALFORMED);
    }
    let header_word = word(words, codelet, offset);
    let header = quote_header(header_word);
    if header.valid == 0
        || header.sort != 6
        || header.scalar_bytes != 4
        || header.fixed_length != 2
        || header.explicit != 0
        || ((header_word & 0x0700) >> 8) != 0
    {
        return Err(ERROR_MALFORMED);
    }
    let bits = (word(words, codelet, offset + 1) & 0xffff)
        | ((word(words, codelet, offset + 2) & 0xffff) << 16);
    if bits & 0x7f80_0000 == 0x7f80_0000 {
        return Err(ERROR_FLOAT_DOMAIN);
    }
    Ok(bits)
}

pub(super) fn arithmetic(words: &[u32], codelet: usize) -> CoreResult {
    let accusative = 4;
    let right_offset = 5;
    let role_case = 8;
    let operator_offset = 9;
    let mood = 10;
    let left_bits = match quote_bits(words, codelet, 1) {
        Ok(bits) => bits,
        Err(error) => return CoreResult::failure(error, 1),
    };
    let right_bits = match quote_bits(words, codelet, right_offset) {
        Ok(bits) => bits,
        Err(error) => return CoreResult::failure(error, 1),
    };
    let operator = word(words, codelet, operator_offset);
    if !matches!(operator, PLUS | SUBTRACT | MULTIPLY | DIVIDE) {
        return CoreResult::failure(ERROR_UNSUPPORTED, 1);
    }
    if word(words, codelet, accusative) != ACCUSATIVE
        || !matches!(
            word(words, codelet, role_case),
            SOURCE | DESTINATION | COMITATIVE | INSTRUMENTAL
        )
        || word(words, codelet, mood) != DEONTIC
        || word(words, codelet, 0) != (expected_index(None, accusative, role_case) | (1 << mood))
        || !zero_tail(words, codelet, mood + 1)
    {
        return CoreResult::failure(ERROR_MALFORMED, 1);
    }

    let left = f32::from_bits(left_bits);
    let right = f32::from_bits(right_bits);
    if operator == DIVIDE && right == 0.0 {
        return CoreResult::failure(ERROR_DIVISION_BY_ZERO, 1);
    }
    let value = match operator {
        PLUS => left + right,
        SUBTRACT => left - right,
        MULTIPLY => left * right,
        DIVIDE => left / right,
        _ => return CoreResult::failure(ERROR_UNSUPPORTED, 1),
    };
    if value.to_bits() & 0x7f80_0000 == 0x7f80_0000 {
        return CoreResult::failure(ERROR_FLOAT_DOMAIN, 1);
    }
    CoreResult::scalar(VALUE_FLOAT32, value.to_bits(), 0, 1)
}

pub(super) fn literal(
    words: &[u32],
    codelet: usize,
    offset: usize,
    nominative: bool,
    scalar_bytes: u32,
    fixed_length: usize,
    explicit: bool,
    vector: bool,
) -> CoreResult {
    if vector {
        return vector_literal(
            words,
            codelet,
            offset,
            nominative,
            scalar_bytes,
            fixed_length,
            explicit,
        );
    }
    if scalar_bytes != 4 || fixed_length != 2 || explicit || offset + 4 >= CODELET_WORDS {
        return CoreResult::failure(ERROR_MALFORMED, 1);
    }
    let payload = offset + 1;
    let accusative = payload + 2;
    let realis = accusative + 1;
    let expected_head = expected_index(nominative.then_some(offset - 1), accusative, realis);
    let bits = (word(words, codelet, payload) & 0xffff)
        | ((word(words, codelet, payload + 1) & 0xffff) << 16);
    if word(words, codelet, accusative) != ACCUSATIVE
        || word(words, codelet, realis) != REALIS
        || word(words, codelet, 0) != expected_head
        || !zero_tail(words, codelet, realis + 1)
    {
        return CoreResult::failure(ERROR_MALFORMED, 1);
    }
    if bits & 0x7f80_0000 == 0x7f80_0000 {
        return CoreResult::failure(ERROR_FLOAT_DOMAIN, 1);
    }
    CoreResult::scalar(VALUE_FLOAT32, bits, 0, 1)
}

fn vector_literal(
    words: &[u32],
    codelet: usize,
    offset: usize,
    nominative: bool,
    scalar_bytes: u32,
    fixed_words: usize,
    explicit: bool,
) -> CoreResult {
    if !matches!(scalar_bytes, 4 | 8) {
        return CoreResult::failure(ERROR_MALFORMED, 1);
    }
    let words_per_value = (scalar_bytes / 2) as usize;
    if explicit && offset + 1 >= CODELET_WORDS {
        return CoreResult::failure(ERROR_MALFORMED, 1);
    }
    let length = if explicit {
        word(words, codelet, offset + 1) as usize
    } else {
        fixed_words / words_per_value
    };
    let payload_words = length * words_per_value;
    let result_words = length * scalar_bytes as usize / 4;
    if length == 0
        || length > MAX_VECTOR_LANES
        || result_words > RESULT_WORDS
        || (!explicit && payload_words != fixed_words)
    {
        return CoreResult::failure(ERROR_MALFORMED, 1);
    }
    let payload = offset + if explicit { 2 } else { 1 };
    let accusative = payload + payload_words;
    let realis = accusative + 1;
    if realis >= CODELET_WORDS
        || word(words, codelet, accusative) != ACCUSATIVE
        || word(words, codelet, realis) != REALIS
        || word(words, codelet, 0)
            != expected_index(nominative.then_some(offset - 1), accusative, realis)
        || !zero_tail(words, codelet, realis + 1)
    {
        return CoreResult::failure(ERROR_MALFORMED, 1);
    }

    let mut result = CoreResult::empty();
    result.value_kind = if scalar_bytes == 4 {
        VALUE_VECTOR_FLOAT32
    } else {
        VALUE_VECTOR_FLOAT64
    };
    result.length = length as u32;
    result.consumed_codelets = 1;
    let mut index = 0;
    while index < length {
        if scalar_bytes == 4 {
            let low = word(words, codelet, payload + index * 2) & 0xffff;
            let high = word(words, codelet, payload + index * 2 + 1) & 0xffff;
            let bits = low | (high << 16);
            if bits & 0x7f80_0000 == 0x7f80_0000 {
                return CoreResult::failure(ERROR_FLOAT_DOMAIN, 1);
            }
            array_put!(&mut result.values, index, bits);
        } else {
            let start = payload + index * 4;
            let low = (word(words, codelet, start) & 0xffff)
                | ((word(words, codelet, start + 1) & 0xffff) << 16);
            let high = (word(words, codelet, start + 2) & 0xffff)
                | ((word(words, codelet, start + 3) & 0xffff) << 16);
            if high & 0x7ff0_0000 == 0x7ff0_0000 {
                return CoreResult::failure(ERROR_FLOAT_DOMAIN, 1);
            }
            array_put!(&mut result.values, index * 2, low);
            array_put!(&mut result.values, index * 2 + 1, high);
        }
        index += 1;
    }
    result
}
