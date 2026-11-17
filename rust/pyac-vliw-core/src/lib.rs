#![no_std]

#[cfg(test)]
extern crate std;

pub const CODELET_WORDS: usize = 16;
pub const RESULT_WORDS: usize = 32;
const MAX_U16: u32 = 65_535;

pub const VALUE_UNSIGNED: u32 = 1;
pub const VALUE_SIGNED: u32 = 2;
pub const VALUE_DATE: u32 = 3;
pub const VALUE_VECTOR_U16: u32 = 4;
pub const VALUE_VECTOR_U32: u32 = 5;
pub const VALUE_VECTOR_BOOL: u32 = 6;
pub const VALUE_BOOLEAN: u32 = 7;

pub const ERROR_UNSUPPORTED: u32 = 1;
pub const ERROR_DIVISION_BY_ZERO: u32 = 2;
pub const ERROR_MALFORMED: u32 = 3;
pub const ERROR_VECTOR_WIDTH: u32 = 4;
pub const ERROR_BRANCH: u32 = 5;
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CoreResult {
    pub value_kind: u32,
    pub error: u32,
    pub length: u32,
    pub consumed_codelets: u32,
    pub values: [u32; RESULT_WORDS],
}

impl CoreResult {
    pub const fn empty() -> Self {
        Self {
            value_kind: 0,
            error: 0,
            length: 0,
            consumed_codelets: 0,
            values: [0; RESULT_WORDS],
        }
    }

    const fn failure(error: u32, consumed_codelets: u32) -> Self {
        Self {
            error,
            consumed_codelets,
            ..Self::empty()
        }
    }

    fn scalar(kind: u32, low: u32, high: u32, consumed_codelets: u32) -> Self {
        let mut result = Self::empty();
        result.value_kind = kind;
        result.length = 1;
        result.consumed_codelets = consumed_codelets;
        result.values[0] = low;
        result.values[1] = high;
        result
    }
}

const NUMBER_QUOTE: u32 = 0x881d;
const DATE_QUOTE: u32 = 0x981d;
const ACCUSATIVE: u32 = 0x245e;
const NOMINATIVE: u32 = 0x24de;
const SOURCE: u32 = 0x313e;
const DESTINATION: u32 = 0x243e;
const COMITATIVE: u32 = 0x490f;
const INSTRUMENTAL: u32 = 0x287e;
const DATIVE: u32 = 0x207e;
const DEONTIC: u32 = 0x295e;
const REALIS: u32 = 0x217e;
const CONDITIONAL: u32 = 0x29be;
const NUMBER_VERB: u32 = 0xea30;
const BOOLEAN_VERB: u32 = 0x7271;
const EQUALLY: u32 = 0x4809;
const TINY: u32 = 0x6c0d;
const GIANT: u32 = 0x69b3;
const TRUTH: u32 = 0x6909;
const LIE: u32 = 0x680d;
const PLUS: u32 = 0x8a64;
const SUBTRACT: u32 = 0xabd2;
const MULTIPLY: u32 = 0xec90;
const DIVIDE: u32 = 0x8893;
const XOR: u32 = 0xa810;
const EXPONENTIAL: u32 = 0x8c29;
const REMAINS: u32 = 0xe82a;
const INVERT: u32 = 0xaad2;
const QUOTE_DENOTE: u32 = 0x001d;

fn word(words: &[u32], codelet: usize, slot: usize) -> u32 {
    words[codelet * CODELET_WORDS + slot]
}

fn zero_tail(words: &[u32], codelet: usize, from: usize) -> bool {
    let mut slot = from;
    while slot < CODELET_WORDS {
        if word(words, codelet, slot) != 0 {
            return false;
        }
        slot += 1;
    }
    true
}

fn number_operator(operator: u32, left: u32, right: u32) -> Result<u32, u32> {
    if left > MAX_U16 || right > MAX_U16 {
        return Err(ERROR_MALFORMED);
    }
    match operator {
        PLUS => Ok((left + right).min(MAX_U16)),
        SUBTRACT => Ok(if left >= right { left - right } else { 0 }),
        MULTIPLY => Ok(left * right),
        DIVIDE if right == 0 => Err(ERROR_DIVISION_BY_ZERO),
        DIVIDE => Ok(left / right),
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
        REMAINS => Ok(left % right),
        _ => Err(ERROR_UNSUPPORTED),
    }
}

pub fn apply_number_operator(operator: u32, left: u32, right: u32) -> Result<u32, u32> {
    number_operator(operator, left, right)
}

fn arithmetic(words: &[u32], codelet: usize) -> Option<CoreResult> {
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

fn invert(words: &[u32], codelet: usize) -> Option<CoreResult> {
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

fn boolean_literal(words: &[u32], codelet: usize) -> Option<CoreResult> {
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
struct QuoteHeader {
    valid: u32,
    sort: u32,
    scalar_bytes: u32,
    fixed_length: u32,
    explicit: u32,
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

fn quote_header(header: u32) -> QuoteHeader {
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

fn find_quote(words: &[u32], codelet: usize) -> Option<usize> {
    let mut slot = 1;
    while slot < CODELET_WORDS {
        if word(words, codelet, slot) & 0x1f == QUOTE_DENOTE {
            return Some(slot);
        }
        slot += 1;
    }
    None
}

fn literal(words: &[u32], codelet: usize) -> Option<CoreResult> {
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
    if length == 0 || length > RESULT_WORDS || payload + length + 1 >= CODELET_WORDS {
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
        result.values[i] = if sort == 4 {
            value
        } else {
            u32::from(value != 0)
        };
        i += 1;
    }
    Some(result)
}

fn expected_index(nominative: Option<usize>, accusative: usize, mood: usize) -> u32 {
    let mut result = 1u32;
    if let Some(slot) = nominative {
        result |= 1 << slot;
    }
    result | (1 << accusative) | (1 << mood)
}

fn vector_arithmetic(words: &[u32], codelet: usize) -> Option<CoreResult> {
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
            Ok(value) => result.values[i] = value,
            Err(error) => return Some(CoreResult::failure(error, 1)),
        }
        i += 1;
    }
    let _ = right_count;
    Some(result)
}

fn conditional(words: &[u32], start: usize, group_len: usize) -> CoreResult {
    if group_len != 2 {
        return CoreResult::failure(ERROR_BRANCH, group_len as u32);
    }
    let head0 = word(words, start, 0);
    let head1 = word(words, start + 1, 0);
    if head0 & 1 != 0 || head1 & 1 == 0 {
        return CoreResult::failure(ERROR_BRANCH, 2);
    }
    let mut last_slot = 0usize;
    let mut slot = 1;
    while slot < CODELET_WORDS {
        if head1 & (1 << slot) != 0 {
            last_slot = slot;
        }
        slot += 1;
    }
    if last_slot == 0 || !zero_tail(words, start + 1, last_slot + 1) {
        return CoreResult::failure(ERROR_BRANCH, 2);
    }
    let mut logical = [0u32; 18];
    let mut boundaries = [0usize; 8];
    let mut boundary_count = 0usize;
    let mut logical_len = 0usize;
    let mut vector_index = 0usize;
    while vector_index < 2 {
        let head = word(words, start + vector_index, 0);
        let completion = head & 1 != 0;
        let end = if vector_index == 1 {
            last_slot
        } else {
            CODELET_WORDS - 1
        };
        slot = 1;
        while slot <= end {
            logical[logical_len] = word(words, start + vector_index, slot);
            logical_len += 1;
            if (head & (1 << slot) != 0) == completion {
                if boundary_count >= boundaries.len() {
                    return CoreResult::failure(ERROR_BRANCH, 2);
                }
                boundaries[boundary_count] = logical_len;
                boundary_count += 1;
            }
            slot += 1;
        }
        vector_index += 1;
    }
    let mut i = 0;
    if logical_len == 16 {
        let expected = [3usize, 6, 8, 10, 12, 14, 16];
        if boundary_count != expected.len() {
            return CoreResult::failure(ERROR_BRANCH, 2);
        }
        while i < expected.len() {
            if boundaries[i] != expected[i] {
                return CoreResult::failure(ERROR_BRANCH, 2);
            }
            i += 1;
        }
        if !matches!(logical[6], EQUALLY | TINY | GIANT)
            || logical[0] != NUMBER_QUOTE
            || logical[2] != ACCUSATIVE
            || logical[3] != NUMBER_QUOTE
            || logical[5] != SOURCE
            || logical[7] != CONDITIONAL
            || !matches!(logical[8], TRUTH | LIE)
            || logical[9] != ACCUSATIVE
            || !matches!(logical[10], NUMBER_VERB | BOOLEAN_VERB)
            || logical[11] != REALIS
            || !matches!(logical[12], TRUTH | LIE)
            || logical[13] != ACCUSATIVE
            || !matches!(logical[14], NUMBER_VERB | BOOLEAN_VERB)
            || logical[15] != REALIS
        {
            return CoreResult::failure(ERROR_BRANCH, 2);
        }
        let predicate = match logical[6] {
            EQUALLY => logical[1] == logical[4],
            TINY => logical[1] < logical[4],
            GIANT => logical[1] > logical[4],
            _ => false,
        };
        let value = if predicate { logical[8] } else { logical[12] };
        return CoreResult::scalar(VALUE_BOOLEAN, u32::from(value == TRUTH), 0, 2);
    }

    let expected = [3usize, 6, 8, 11, 13, 16, 18];
    if logical_len != 18 || boundary_count != expected.len() {
        return CoreResult::failure(ERROR_BRANCH, 2);
    }
    while i < expected.len() {
        if boundaries[i] != expected[i] {
            return CoreResult::failure(ERROR_BRANCH, 2);
        }
        i += 1;
    }
    let shape = [
        (0, NUMBER_QUOTE),
        (2, ACCUSATIVE),
        (3, NUMBER_QUOTE),
        (5, SOURCE),
        (7, CONDITIONAL),
        (8, NUMBER_QUOTE),
        (10, ACCUSATIVE),
        (11, NUMBER_VERB),
        (12, REALIS),
        (13, NUMBER_QUOTE),
        (15, ACCUSATIVE),
        (16, NUMBER_VERB),
        (17, REALIS),
    ];
    i = 0;
    while i < shape.len() {
        if logical[shape[i].0] != shape[i].1 {
            return CoreResult::failure(ERROR_BRANCH, 2);
        }
        i += 1;
    }
    let predicate = match logical[6] {
        EQUALLY => logical[1] == logical[4],
        TINY => logical[1] < logical[4],
        GIANT => logical[1] > logical[4],
        _ => return CoreResult::failure(ERROR_BRANCH, 2),
    };
    let value = if predicate { logical[9] } else { logical[14] };
    if value > MAX_U16 {
        return CoreResult::failure(ERROR_MALFORMED, 2);
    }
    CoreResult::scalar(VALUE_UNSIGNED, value, 0, 2)
}

/// Interpret one completion-marked sentence group from a flat u32 transport
/// view of the canonical 16-u16 codelet records.
pub fn interpret_group(words: &[u32], start: usize, codelet_count: usize) -> CoreResult {
    if start >= codelet_count || words.len() < codelet_count * CODELET_WORDS {
        return CoreResult::failure(ERROR_MALFORMED, 0);
    }
    let mut end = start;
    while end < codelet_count && word(words, end, 0) & 1 == 0 {
        end += 1;
    }
    if end == codelet_count {
        return CoreResult::failure(ERROR_MALFORMED, (codelet_count - start) as u32);
    }
    let group_len = end - start + 1;
    if group_len > 1 {
        return conditional(words, start, group_len);
    }
    if let Some(result) = invert(words, start) {
        return result;
    }
    if let Some(result) = vector_arithmetic(words, start) {
        return result;
    }
    if let Some(result) = arithmetic(words, start) {
        return result;
    }
    if let Some(result) = boolean_literal(words, start) {
        return result;
    }
    if let Some(result) = literal(words, start) {
        return result;
    }
    CoreResult::failure(ERROR_UNSUPPORTED, 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interpret(codelets: &[[u32; CODELET_WORDS]]) -> CoreResult {
        let words = codelets
            .iter()
            .flat_map(|codelet| codelet.iter().copied())
            .collect::<std::vec::Vec<_>>();
        interpret_group(&words, 0, codelets.len())
    }

    #[test]
    fn executes_numeric_operator_family_with_shared_saturating_semantics() {
        for (operator, left, right, expected) in [
            (PLUS, 65_535, 1, 65_535),
            (SUBTRACT, 9, 4, 5),
            (MULTIPLY, 65_535, 65_535, 4_294_836_225),
            (DIVIDE, 8, 2, 4),
            (XOR, 7, 3, 4),
            (EXPONENTIAL, 3, 4, 81),
            (REMAINS, 9, 4, 1),
        ] {
            let codelet = [
                0x0149,
                NUMBER_QUOTE,
                left,
                ACCUSATIVE,
                NUMBER_QUOTE,
                right,
                DESTINATION,
                operator,
                DEONTIC,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ];
            let result = interpret(&[codelet]);
            assert_eq!(result.error, 0, "operator 0x{operator:04x}");
            assert_eq!(result.value_kind, VALUE_UNSIGNED);
            assert_eq!(result.values[0], expected);
        }
    }

    #[test]
    fn executes_invert_date_and_numeric_vector_literals() {
        let invert = [
            0x0149,
            NUMBER_QUOTE,
            5,
            ACCUSATIVE,
            NUMBER_QUOTE,
            0,
            DATIVE,
            INVERT,
            DEONTIC,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ];
        let date = [
            0x00c1, DATE_QUOTE, 0x9c00, 0x8924, 0x0196, 0, ACCUSATIVE, REALIS, 0, 0, 0, 0, 0, 0, 0,
            0,
        ];
        let vector = [
            0x0061, 0x8f1d, 1, 2, 3, ACCUSATIVE, REALIS, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];

        let result = interpret(&[invert]);
        assert_eq!(result.value_kind, VALUE_SIGNED);
        assert_eq!(result.values[0], (-5i32) as u32);

        let result = interpret(&[date]);
        assert_eq!(result.value_kind, VALUE_DATE);
        assert_eq!(result.values[0], 1_746_057_600_000u64 as u32);
        assert_eq!(result.values[1], (1_746_057_600_000u64 >> 32) as u32);

        let result = interpret(&[vector]);
        assert_eq!(result.value_kind, VALUE_VECTOR_U16);
        assert_eq!(result.length, 3);
        assert_eq!(&result.values[..3], &[1, 2, 3]);
    }

    #[test]
    fn executes_inline_vector_arithmetic_and_bounded_equality_branch() {
        let vector = [
            0x0a41,
            0x8a1d,
            1,
            2,
            3,
            4,
            ACCUSATIVE,
            NUMBER_QUOTE,
            2,
            DESTINATION,
            PLUS,
            DEONTIC,
            0,
            0,
            0,
            0,
        ];
        let branch = [
            [
                0xd6b6,
                NUMBER_QUOTE,
                5,
                ACCUSATIVE,
                NUMBER_QUOTE,
                5,
                SOURCE,
                EQUALLY,
                CONDITIONAL,
                NUMBER_QUOTE,
                7,
                ACCUSATIVE,
                NUMBER_VERB,
                REALIS,
                NUMBER_QUOTE,
                9,
            ],
            [
                0x000b,
                ACCUSATIVE,
                NUMBER_VERB,
                REALIS,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ],
        ];

        let result = interpret(&[vector]);
        assert_eq!(result.error, 0);
        assert_eq!(result.value_kind, VALUE_VECTOR_U16);
        assert_eq!(&result.values[..4], &[3, 4, 5, 6]);

        let result = interpret(&branch);
        assert_eq!(result.error, 0);
        assert_eq!(result.value_kind, VALUE_UNSIGNED);
        assert_eq!(result.values[0], 7);
        assert_eq!(result.consumed_codelets, 2);
    }

    #[test]
    fn returns_typed_pyash_boolean_literals() {
        let truth = [
            0x0015,
            0x6909,
            ACCUSATIVE,
            NUMBER_VERB,
            REALIS,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ];
        let lie = [
            0x0015,
            0x680d,
            ACCUSATIVE,
            NUMBER_VERB,
            REALIS,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ];

        let result = interpret(&[truth]);
        assert_eq!(result.error, 0);
        assert_eq!(result.value_kind, VALUE_BOOLEAN);
        assert_eq!(result.values[0], 1);

        let result = interpret(&[lie]);
        assert_eq!(result.error, 0);
        assert_eq!(result.value_kind, VALUE_BOOLEAN);
        assert_eq!(result.values[0], 0);

        let boolean_verb = [
            0x0015,
            TRUTH,
            ACCUSATIVE,
            BOOLEAN_VERB,
            REALIS,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ];
        let result = interpret(&[boolean_verb]);
        assert_eq!(result.error, 0);
        assert_eq!(result.value_kind, VALUE_BOOLEAN);
        assert_eq!(result.values[0], 1);
    }

    #[test]
    fn conditional_uses_all_three_pyash_numeric_comparators() {
        for (operator, left, right, expected) in [
            (EQUALLY, 5, 5, 7),
            (EQUALLY, 4, 5, 9),
            (TINY, 3, 5, 7),
            (TINY, 5, 3, 9),
            (GIANT, 5, 3, 7),
            (GIANT, 3, 5, 9),
        ] {
            let branch = [
                [
                    0xd6b6,
                    NUMBER_QUOTE,
                    left,
                    ACCUSATIVE,
                    NUMBER_QUOTE,
                    right,
                    SOURCE,
                    operator,
                    CONDITIONAL,
                    NUMBER_QUOTE,
                    7,
                    ACCUSATIVE,
                    NUMBER_VERB,
                    REALIS,
                    NUMBER_QUOTE,
                    9,
                ],
                [
                    0x000b,
                    ACCUSATIVE,
                    NUMBER_VERB,
                    REALIS,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                ],
            ];
            let result = interpret(&branch);
            assert_eq!(result.error, 0, "operator 0x{operator:04x}");
            assert_eq!(result.value_kind, VALUE_UNSIGNED);
            assert_eq!(result.values[0], expected, "operator 0x{operator:04x}");
        }
    }

    #[test]
    fn returns_a_boolean_from_a_canonical_comparison_branch() {
        let codelets = [
            [
                0xaab6,
                NUMBER_QUOTE,
                3,
                ACCUSATIVE,
                NUMBER_QUOTE,
                5,
                SOURCE,
                TINY,
                CONDITIONAL,
                TRUTH,
                ACCUSATIVE,
                BOOLEAN_VERB,
                REALIS,
                LIE,
                ACCUSATIVE,
                BOOLEAN_VERB,
            ],
            [0x0003, REALIS, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ];
        let result = interpret(&codelets);

        assert_eq!(result.error, 0);
        assert_eq!(result.value_kind, VALUE_BOOLEAN);
        assert_eq!(result.values[0], 1);
        assert_eq!(result.consumed_codelets, 2);
    }
}
