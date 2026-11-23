use super::numeric::{expected_index, find_quote, quote_header, word, zero_tail};
use super::*;

const FIXED16_QUOTE: u32 = 0xc81d;
const FIXED16_SCALE: u32 = 46_656;

pub(super) fn single_codelet(words: &[u32], codelet: usize) -> Option<CoreResult> {
    let offset = find_quote(words, codelet)?;
    let header = quote_header(word(words, codelet, offset));
    if header.valid == 0
        || header.sort != 6
        || header.scalar_bytes != 2
        || header.fixed_length != 1
        || header.explicit != 0
        || offset != 1
        || word(words, codelet, offset) != FIXED16_QUOTE
    {
        return None;
    }

    if word(words, codelet, 3) == ACCUSATIVE && word(words, codelet, 8) == DEONTIC {
        return Some(arithmetic(words, codelet));
    }
    if word(words, codelet, 3) == ACCUSATIVE && word(words, codelet, 4) == REALIS {
        let expected_head = expected_index(None, 3, 4);
        if word(words, codelet, 0) != expected_head || !zero_tail(words, codelet, 5) {
            return Some(CoreResult::failure(ERROR_MALFORMED, 1));
        }
        return Some(CoreResult::scalar(
            VALUE_FIXED16,
            word(words, codelet, 2) & 0xffff,
            0,
            1,
        ));
    }
    Some(CoreResult::failure(ERROR_UNSUPPORTED, 1))
}

fn arithmetic(words: &[u32], codelet: usize) -> CoreResult {
    let operator = word(words, codelet, 7);
    if !matches!(operator, PLUS | SUBTRACT | MULTIPLY | DIVIDE) {
        return CoreResult::failure(ERROR_UNSUPPORTED, 1);
    }
    if word(words, codelet, 0) != (expected_index(None, 3, 6) | (1 << 8))
        || word(words, codelet, 3) != ACCUSATIVE
        || word(words, codelet, 4) != FIXED16_QUOTE
        || !matches!(
            word(words, codelet, 6),
            SOURCE | DESTINATION | COMITATIVE | INSTRUMENTAL
        )
        || word(words, codelet, 8) != DEONTIC
        || !zero_tail(words, codelet, 9)
    {
        return CoreResult::failure(ERROR_MALFORMED, 1);
    }

    let left = word(words, codelet, 2) & 0xffff;
    let right = word(words, codelet, 5) & 0xffff;
    let value = match operator {
        PLUS => checked_fixed16(left + right),
        SUBTRACT if left < right => Err(ERROR_FIXED16_DOMAIN),
        SUBTRACT => Ok(left - right),
        MULTIPLY => rounded_fixed16(left * right, FIXED16_SCALE),
        DIVIDE if right == 0 => return CoreResult::failure(ERROR_DIVISION_BY_ZERO, 1),
        DIVIDE => rounded_fixed16(left * FIXED16_SCALE, right),
        _ => Err(ERROR_UNSUPPORTED),
    };
    match value {
        Ok(value) => CoreResult::scalar(VALUE_FIXED16, value, 0, 1),
        Err(error) => CoreResult::failure(error, 1),
    }
}

fn rounded_fixed16(numerator: u32, denominator: u32) -> Result<u32, u32> {
    let quotient = numerator
        .checked_div(denominator)
        .ok_or(ERROR_DIVISION_BY_ZERO)?;
    let remainder = numerator
        .checked_rem(denominator)
        .ok_or(ERROR_DIVISION_BY_ZERO)?;
    let doubled_remainder = remainder * 2;
    let rounded = if doubled_remainder > denominator
        || (doubled_remainder == denominator && quotient & 1 != 0)
    {
        quotient + 1
    } else {
        quotient
    };
    checked_fixed16(rounded)
}

fn checked_fixed16(value: u32) -> Result<u32, u32> {
    if value > MAX_U16 {
        Err(ERROR_FIXED16_DOMAIN)
    } else {
        Ok(value)
    }
}
