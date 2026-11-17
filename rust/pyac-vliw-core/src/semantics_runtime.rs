#![no_std]

#[cfg(test)]
extern crate std;

pub const CODELET_WORDS: usize = 16;
pub const RESULT_WORDS: usize = 32;
pub const MAX_PROGRAMLET_CODELETS: usize = 64;
pub const PROGRAMLET_SCRATCH_WORDS: usize = MAX_PROGRAMLET_CODELETS * (CODELET_WORDS - 1);
pub const MAX_PROGRAMLET_LOCAL_SLOTS: usize = 64;
pub const MAX_PROGRAMLET_CALL_DEPTH: usize = 8;
const MAX_U16: u32 = 65_535;
pub const MAX_PROGRAMLET_ARGUMENTS: usize = 8;

pub const VALUE_UNSIGNED: u32 = 1;
pub const VALUE_SIGNED: u32 = 2;
pub const VALUE_DATE: u32 = 3;
pub const VALUE_VECTOR_U16: u32 = 4;
pub const VALUE_VECTOR_U32: u32 = 5;
pub const VALUE_VECTOR_BOOL: u32 = 6;
pub const VALUE_BOOLEAN: u32 = 7;
const VALUE_NUMBER: u32 = 8;

pub const ERROR_UNSUPPORTED: u32 = 1;
pub const ERROR_DIVISION_BY_ZERO: u32 = 2;
pub const ERROR_MALFORMED: u32 = 3;
pub const ERROR_VECTOR_WIDTH: u32 = 4;
pub const ERROR_BRANCH: u32 = 5;
pub const ERROR_FRAME_CAPACITY: u32 = 6;
pub const ERROR_CONSTANT_WRITE: u32 = 7;
pub const ERROR_STEP_BUDGET: u32 = 8;
pub const ERROR_PROGRAM_CAPACITY: u32 = 9;
pub const ERROR_CALL_DEPTH: u32 = 10;
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

    pub const fn failure(error: u32, consumed_codelets: u32) -> Self {
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
const NAME_TYPE: u32 = 0x225e;
const NUMBER_TYPE: u32 = 0x327e;
const BOOLEAN_TYPE: u32 = 0x538f;
const VARIABLE: u32 = 0xc8c4;
const PERMANENTLY: u32 = 0x0b50;
const CEREMONY: u32 = 0xe8c9;
const MOOD_DEFINITION: u32 = 0x5217;
const MOOD_PARAGRAPH: u32 = 0x4e27;
const MOOD_RETURN: u32 = 0xa828;
const ESSIVE: u32 = 0x414f;
const FROM_INDEX: u32 = 0x6357;
const TO_INDEX: u32 = 0x4e4f;
const GENITIVE_CASE: u32 = 0x215e;
const THIS_WORD: u32 = 0x4a57;
pub const DEFAULT_PROGRAMLET_STEP_BUDGET: u32 = 65_536;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NumericLocalSlot {
    pub name_offset: u32,
    pub name_length: u32,
    pub value: u32,
    pub kind: u32,
    pub value_kind: u32,
}

impl NumericLocalSlot {
    pub const EMPTY: Self = Self {
        name_offset: 0,
        name_length: 0,
        value: 0,
        kind: 0,
        value_kind: 0,
    };
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramletArgument {
    pub role: u32,
    pub value: u32,
    pub value_kind: u32,
}

impl ProgramletArgument {
    pub const EMPTY: Self = Self {
        role: 0,
        value: 0,
        value_kind: 0,
    };
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramletFrame {
    pub slots: [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    pub arguments: [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    pub argument_count: u32,
    pub routine_start: u32,
    pub routine_end: u32,
    pub program_counter: u32,
    pub routine_name_offset: u32,
    pub routine_name_length: u32,
    pub return_name_offset: u32,
    pub return_name_length: u32,
    pub result_value: u32,
    pub expected_kind: u32,
    pub result_kind: u32,
    pub state: u32,
    pub action_started: u32,
    pub has_returned: u32,
    pub loop_active: u32,
    pub loop_remaining: u32,
    pub loop_end: u32,
    pub loop_has_end: u32,
}

impl ProgramletFrame {
    pub const EMPTY: Self = Self {
        slots: [NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS],
        arguments: [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS],
        argument_count: 0,
        routine_start: 0,
        routine_end: 0,
        program_counter: 0,
        routine_name_offset: 0,
        routine_name_length: 0,
        return_name_offset: 0,
        return_name_length: 0,
        result_value: 0,
        expected_kind: 0,
        result_kind: 0,
        state: 0,
        action_started: 0,
        has_returned: 0,
        loop_active: 0,
        loop_remaining: 0,
        loop_end: 0,
        loop_has_end: 0,
    };
}

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

#[derive(Clone, Copy)]
struct SentenceField {
    role: u32,
    start: usize,
    length: usize,
}

impl SentenceField {
    const EMPTY: Self = Self {
        role: 0,
        start: 0,
        length: 0,
    };
}

#[derive(Clone, Copy)]
struct ParsedSentence {
    fields: [SentenceField; 8],
    field_count: usize,
    verb_start: usize,
    verb_length: usize,
    mood: u32,
}

impl ParsedSentence {
    const fn empty() -> Self {
        Self {
            fields: [SentenceField::EMPTY; 8],
            field_count: 0,
            verb_start: 0,
            verb_length: 0,
            mood: 0,
        }
    }

    fn field(&self, role: u32) -> Option<SentenceField> {
        let mut index = 0;
        while index < self.field_count {
            if self.fields[index].role == role {
                return Some(self.fields[index]);
            }
            index += 1;
        }
        None
    }
}

#[derive(Clone, Copy)]
struct NameSpan {
    start: usize,
    length: usize,
}

impl NameSpan {
    const EMPTY: Self = Self {
        start: 0,
        length: 0,
    };
}

fn collect_sentence(
    words: &[u32],
    codelet_count: usize,
    start: usize,
    tokens: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
) -> Result<(usize, usize), u32> {
    if start >= codelet_count || codelet_count > words.len() / CODELET_WORDS {
        return Err(ERROR_MALFORMED);
    }
    let mut token_count = 0;
    let mut codelet = start;
    loop {
        if codelet >= codelet_count {
            return Err(ERROR_MALFORMED);
        }
        let header = word(words, codelet, 0);
        let complete = header & 1 != 0;
        let mut last_boundary = 0;
        let mut slot = 1;
        while slot < CODELET_WORDS {
            if (header & (1 << slot) != 0) == complete {
                last_boundary = slot;
            }
            slot += 1;
        }
        if complete && last_boundary == 0 {
            return Err(ERROR_MALFORMED);
        }
        let last_slot = if complete {
            last_boundary
        } else {
            CODELET_WORDS - 1
        };
        slot = 1;
        while slot <= last_slot {
            if token_count >= tokens.len() || token_count >= boundaries.len() {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let value = word(words, codelet, slot);
            if value > MAX_U16 {
                return Err(ERROR_MALFORMED);
            }
            tokens[token_count] = value;
            boundaries[token_count] = u32::from((header & (1 << slot) != 0) == complete);
            token_count += 1;
            slot += 1;
        }
        codelet += 1;
        if complete {
            return Ok((token_count, codelet));
        }
    }
}

fn parse_sentence(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &[u32; PROGRAMLET_SCRATCH_WORDS],
    length: usize,
    parsed: &mut ParsedSentence,
) -> u32 {
    parse_sentence_range(tokens, boundaries, 0, length, parsed)
}

fn parse_sentence_range(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &[u32; PROGRAMLET_SCRATCH_WORDS],
    start: usize,
    end: usize,
    parsed: &mut ParsedSentence,
) -> u32 {
    if start >= end || end > tokens.len() || end > boundaries.len() {
        return ERROR_MALFORMED;
    }
    let mut result = ParsedSentence::empty();
    let mut value_start = start;
    let mut index = start;
    while index < end {
        if boundaries[index] == 0 {
            index += 1;
            continue;
        }
        let token = tokens[index];
        if matches!(
            token,
            NOMINATIVE
                | ACCUSATIVE
                | ESSIVE
                | DESTINATION
                | SOURCE
                | COMITATIVE
                | INSTRUMENTAL
                | FROM_INDEX
                | TO_INDEX
        ) {
            if value_start >= index || result.field_count == result.fields.len() {
                return ERROR_MALFORMED;
            }
            let mut prior = 0;
            while prior < result.field_count {
                if result.fields[prior].role == token {
                    return ERROR_MALFORMED;
                }
                prior += 1;
            }
            result.fields[result.field_count] = SentenceField {
                role: token,
                start: value_start,
                length: index - value_start,
            };
            result.field_count += 1;
            value_start = index + 1;
        } else if matches!(
            token,
            MOOD_DEFINITION | REALIS | DEONTIC | MOOD_RETURN | MOOD_PARAGRAPH
        ) {
            if result.mood != 0 {
                return ERROR_MALFORMED;
            }
            result.mood = token;
            result.verb_start = value_start;
            result.verb_length = index - value_start;
            if result.verb_length == 0 && token != MOOD_RETURN {
                return ERROR_MALFORMED;
            }
            if result.verb_length > 0 && token == MOOD_RETURN {
                return ERROR_MALFORMED;
            }
            if index + 1 != end {
                return ERROR_MALFORMED;
            }
            *parsed = result;
            return 0;
        } else {
            return ERROR_UNSUPPORTED;
        }
        index += 1;
    }
    ERROR_MALFORMED
}

fn contains_marked_token(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &[u32; PROGRAMLET_SCRATCH_WORDS],
    length: usize,
    target: u32,
) -> bool {
    let mut index = 0;
    while index < length {
        if boundaries[index] != 0 && tokens[index] == target {
            return true;
        }
        index += 1;
    }
    false
}

fn name_span(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
    typed_number: bool,
    name: &mut NameSpan,
) -> u32 {
    let Some(end) = field.start.checked_add(field.length) else {
        return ERROR_MALFORMED;
    };
    if field.length < 2 || end > tokens.len() || tokens[field.start] != NAME_TYPE {
        return ERROR_MALFORMED;
    }
    let mut marker = field.start + 1;
    while marker < end && tokens[marker] != NAME_TYPE {
        marker += 1;
    }
    let name_start = if marker < end {
        if !typed_number
            || marker != field.start + 2
            || !matches!(tokens[field.start + 1], NUMBER_TYPE | BOOLEAN_TYPE)
        {
            return ERROR_MALFORMED;
        }
        marker + 1
    } else {
        if typed_number {
            return ERROR_MALFORMED;
        }
        field.start + 1
    };
    if name_start >= end {
        return ERROR_MALFORMED;
    }
    *name = NameSpan {
        start: name_start,
        length: end - name_start,
    };
    0
}

fn typed_output_name(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
    name: &mut NameSpan,
    kind: &mut u32,
) -> u32 {
    if field.length < 4 || tokens[field.start] != NAME_TYPE || tokens[field.start + 2] != NAME_TYPE
    {
        return ERROR_MALFORMED;
    }
    let output_kind = match tokens[field.start + 1] {
        NUMBER_TYPE => VALUE_NUMBER,
        BOOLEAN_TYPE => VALUE_BOOLEAN,
        _ => return ERROR_UNSUPPORTED,
    };
    *name = NameSpan {
        start: field.start + 3,
        length: field.length - 3,
    };
    *kind = output_kind;
    0
}

#[derive(Clone, Copy)]
struct ProgramletNumber {
    bits: u32,
    kind: u32,
}

impl ProgramletNumber {
    const EMPTY: Self = Self { bits: 0, kind: 0 };
}

fn number_kind_matches(expected: u32, actual: u32) -> bool {
    if expected == VALUE_NUMBER {
        matches!(actual, VALUE_NUMBER | VALUE_UNSIGNED | VALUE_SIGNED)
    } else {
        expected == actual
    }
}

fn compare_programlet_numbers(left: ProgramletNumber, right: ProgramletNumber) -> u32 {
    match (left.kind == VALUE_SIGNED, right.kind == VALUE_SIGNED) {
        (true, true) => compare_signed(left.bits as i32, right.bits as i32),
        (true, false) => {
            let left = left.bits as i32;
            if left < 0 {
                0
            } else {
                compare_unsigned(left as u32, right.bits)
            }
        }
        (false, true) => {
            let signed_right = right.bits as i32;
            if signed_right < 0 {
                2
            } else {
                compare_unsigned(left.bits, signed_right as u32)
            }
        }
        (false, false) => compare_unsigned(left.bits, right.bits),
    }
}

fn compare_signed(left: i32, right: i32) -> u32 {
    if left < right {
        0
    } else if left > right {
        2
    } else {
        1
    }
}

fn compare_unsigned(left: u32, right: u32) -> u32 {
    if left < right {
        0
    } else if left > right {
        2
    } else {
        1
    }
}

fn number_value(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
) -> Result<u32, u32> {
    if field.length != 2 || tokens[field.start] != NUMBER_QUOTE {
        return Err(ERROR_MALFORMED);
    }
    let value = tokens[field.start + 1];
    if value > MAX_U16 {
        return Err(ERROR_MALFORMED);
    }
    Ok(value)
}

fn argument_value(
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    role: u32,
    value: &mut ProgramletNumber,
) -> bool {
    let mut index = 0;
    while index < arguments.len() {
        let argument = arguments[index];
        if argument.role == role {
            *value = ProgramletNumber {
                bits: argument.value,
                kind: argument.value_kind,
            };
            return true;
        }
        index += 1;
    }
    false
}

fn write_programlet_call_result(
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    return_name: NameSpan,
    expected_kind: u32,
    result: ProgramletNumber,
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<(), u32> {
    if !number_kind_matches(expected_kind, result.kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut target_slot = find_local_slot(symbols, return_name, symbols, slots);
    if target_slot.is_none() {
        let mut slot_index = 0;
        while slot_index < MAX_PROGRAMLET_LOCAL_SLOTS && slots[slot_index].kind != 0 {
            slot_index += 1;
        }
        if slot_index == MAX_PROGRAMLET_LOCAL_SLOTS {
            return Err(ERROR_FRAME_CAPACITY);
        }
        slots[slot_index].name_offset = return_name.start as u32;
        slots[slot_index].name_length = return_name.length as u32;
        slots[slot_index].kind = if expected_kind == VALUE_BOOLEAN { 3 } else { 1 };
        target_slot = Some(slot_index);
    }
    let target_slot = target_slot.unwrap_or(0);
    if slots[target_slot].kind == 2 || slots[target_slot].kind == 4 {
        return Err(ERROR_CONSTANT_WRITE);
    }
    if (slots[target_slot].kind == 3) != (expected_kind == VALUE_BOOLEAN) {
        return Err(ERROR_UNSUPPORTED);
    }
    slots[target_slot].value = result.bits;
    slots[target_slot].value_kind = result.kind;
    Ok(())
}

fn set_loop_index_argument(
    arguments: &mut [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    value: u32,
) -> Result<(), u32> {
    let mut empty_index = arguments.len();
    let mut index = 0;
    while index < arguments.len() {
        if arguments[index].role == FROM_INDEX {
            arguments[index].value = value;
            arguments[index].value_kind = VALUE_UNSIGNED;
            return Ok(());
        }
        if arguments[index].role == 0 && empty_index == arguments.len() {
            empty_index = index;
        }
        index += 1;
    }
    if empty_index == arguments.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    arguments[empty_index] = ProgramletArgument {
        role: FROM_INDEX,
        value,
        value_kind: VALUE_UNSIGNED,
    };
    Ok(())
}

fn resolve_programlet_value(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    value: &mut ProgramletNumber,
) -> u32 {
    if field.length == 2 && tokens[field.start] == NUMBER_QUOTE {
        let bits = match number_value(tokens, field) {
            Ok(bits) => bits,
            Err(error) => return error,
        };
        *value = ProgramletNumber {
            bits,
            kind: VALUE_UNSIGNED,
        };
        return 0;
    }
    if field.length == 1 && matches!(tokens[field.start], TRUTH | LIE) {
        *value = ProgramletNumber {
            bits: u32::from(tokens[field.start] == TRUTH),
            kind: VALUE_BOOLEAN,
        };
        return 0;
    }
    if field.length == 5
        && tokens[field.start] == THIS_WORD
        && tokens[field.start + 1] == GENITIVE_CASE
        && tokens[field.start + 3] == GENITIVE_CASE
    {
        let mut argument = ProgramletNumber::EMPTY;
        if !argument_value(arguments, tokens[field.start + 2], &mut argument) {
            return ERROR_MALFORMED;
        }
        let expected_kind = match tokens[field.start + 4] {
            NUMBER_TYPE => VALUE_NUMBER,
            BOOLEAN_TYPE => VALUE_BOOLEAN,
            _ => return ERROR_UNSUPPORTED,
        };
        if !number_kind_matches(expected_kind, argument.kind) {
            return ERROR_UNSUPPORTED;
        }
        *value = argument;
        return 0;
    }
    if tokens[field.start] != NAME_TYPE {
        return ERROR_UNSUPPORTED;
    }
    let typed_number = field.length >= 4
        && tokens[field.start + 1] == NUMBER_TYPE
        && tokens[field.start + 2] == NAME_TYPE;
    let typed_boolean = field.length >= 4
        && tokens[field.start + 1] == BOOLEAN_TYPE
        && tokens[field.start + 2] == NAME_TYPE;
    let mut name = NameSpan::EMPTY;
    let name_error = name_span(tokens, field, typed_number || typed_boolean, &mut name);
    if name_error != 0 {
        return name_error;
    }
    let Some(index) = find_local_slot(tokens, name, symbols, slots) else {
        return ERROR_MALFORMED;
    };
    let slot = slots[index];
    if typed_number && !number_kind_matches(VALUE_NUMBER, slot.value_kind) {
        return ERROR_UNSUPPORTED;
    }
    if typed_boolean && slot.value_kind != VALUE_BOOLEAN {
        return ERROR_UNSUPPORTED;
    }
    if !matches!(
        slot.value_kind,
        VALUE_UNSIGNED | VALUE_SIGNED | VALUE_BOOLEAN
    ) {
        return ERROR_UNSUPPORTED;
    }
    *value = ProgramletNumber {
        bits: slot.value,
        kind: slot.value_kind,
    };
    0
}

fn capture_programlet_arguments(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    captured: &mut [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    captured_count: &mut u32,
) -> Result<(), u32> {
    *captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let mut count = 0usize;
    let mut index = 0;
    while index < sentence.field_count {
        let field = sentence.fields[index];
        if !matches!(field.role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) {
            if count == MAX_PROGRAMLET_ARGUMENTS {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let mut value = ProgramletNumber::EMPTY;
            let value_error =
                resolve_programlet_value(tokens, field, symbols, arguments, slots, &mut value);
            if value_error != 0 {
                return Err(value_error);
            }
            captured[count] = ProgramletArgument {
                role: field.role,
                value: value.bits,
                value_kind: value.kind,
            };
            count += 1;
        }
        index += 1;
    }
    *captured_count = count as u32;
    Ok(())
}

fn validate_programlet_arguments(
    words: &[u32],
    codelet_count: usize,
    routine_start: usize,
    tokens: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    argument_count: u32,
) -> Result<(), u32> {
    if argument_count as usize > arguments.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let definition_at = routine_start.checked_sub(1).ok_or(ERROR_MALFORMED)?;
    let (length, _) = collect_sentence(words, codelet_count, definition_at, tokens, boundaries)?;
    let mut definition = ParsedSentence::empty();
    let parse_error = parse_sentence(tokens, boundaries, length, &mut definition);
    if parse_error != 0 {
        return Err(parse_error);
    }
    if !is_ceremony_definition(&definition, tokens) {
        return Err(ERROR_MALFORMED);
    }

    let mut formal_count = 0usize;
    let mut field_index = 0;
    while field_index < definition.field_count {
        let formal = definition.fields[field_index];
        if !matches!(
            formal.role,
            NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX
        ) {
            if formal_count >= MAX_PROGRAMLET_ARGUMENTS {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let expected_kind = if formal.length == 2 && tokens[formal.start] == NUMBER_QUOTE {
                VALUE_NUMBER
            } else if formal.length == 1 && matches!(tokens[formal.start], TRUTH | LIE) {
                VALUE_BOOLEAN
            } else {
                return Err(ERROR_UNSUPPORTED);
            };
            let mut argument_index = 0;
            while argument_index < argument_count as usize
                && arguments[argument_index].role != formal.role
            {
                argument_index += 1;
            }
            if argument_index == argument_count as usize {
                return Err(ERROR_MALFORMED);
            }
            let argument = arguments[argument_index];
            if !number_kind_matches(expected_kind, argument.value_kind) {
                return Err(ERROR_UNSUPPORTED);
            }
            formal_count += 1;
        }
        field_index += 1;
    }
    if formal_count != argument_count as usize {
        return Err(ERROR_MALFORMED);
    }
    Ok(())
}

fn loop_iterations(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
) -> Result<u32, u32> {
    let start = sentence
        .field(FROM_INDEX)
        .map(|field| number_value(tokens, field))
        .transpose()?;
    let end = sentence
        .field(TO_INDEX)
        .map(|field| number_value(tokens, field))
        .transpose()?;
    if end.is_some() && start.is_none() {
        return Err(ERROR_MALFORMED);
    }
    Ok(match (start, end) {
        (Some(start), Some(end)) => start.abs_diff(end),
        (Some(start), None) => start,
        _ => 0,
    })
}

fn comparison_operand(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    start: usize,
    end: usize,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    value: &mut ProgramletNumber,
) -> u32 {
    let Some(length) = end.checked_sub(start) else {
        return ERROR_MALFORMED;
    };
    let field = SentenceField {
        role: 0,
        start,
        length,
    };
    let error = resolve_programlet_value(tokens, field, symbols, arguments, slots, value);
    if error != 0 {
        return error;
    }
    if !matches!(value.kind, VALUE_UNSIGNED | VALUE_SIGNED | VALUE_BOOLEAN) {
        return ERROR_UNSUPPORTED;
    }
    0
}

fn programlet_branch(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &[u32; PROGRAMLET_SCRATCH_WORDS],
    length: usize,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    selected_action: &mut ParsedSentence,
    has_selected_action: &mut bool,
) -> u32 {
    let mut conditional_at = None;
    let mut index = 0;
    while index < length {
        if boundaries[index] != 0 && tokens[index] == CONDITIONAL {
            conditional_at = Some(index);
            break;
        }
        index += 1;
    }
    let Some(conditional_at) = conditional_at else {
        return ERROR_UNSUPPORTED;
    };
    let mut accusative_at = None;
    let mut source_at = None;
    index = 0;
    while index < conditional_at {
        if boundaries[index] != 0 {
            if tokens[index] == ACCUSATIVE {
                accusative_at = Some(index);
            } else if tokens[index] == SOURCE {
                source_at = Some(index);
            }
        }
        index += 1;
    }
    let Some(accusative_at) = accusative_at else {
        return ERROR_MALFORMED;
    };
    let Some(source_at) = source_at else {
        return ERROR_MALFORMED;
    };
    if source_at <= accusative_at || source_at + 2 != conditional_at {
        return ERROR_UNSUPPORTED;
    }
    let mut left = ProgramletNumber::EMPTY;
    let left_error = comparison_operand(
        tokens,
        0,
        accusative_at,
        symbols,
        arguments,
        slots,
        &mut left,
    );
    if left_error != 0 {
        return left_error;
    }
    let mut right = ProgramletNumber::EMPTY;
    let right_error = comparison_operand(
        tokens,
        accusative_at + 1,
        source_at,
        symbols,
        arguments,
        slots,
        &mut right,
    );
    if right_error != 0 {
        return right_error;
    }
    if (left.kind == VALUE_BOOLEAN) != (right.kind == VALUE_BOOLEAN) {
        return ERROR_UNSUPPORTED;
    }
    let ordering = compare_programlet_numbers(left, right);
    let predicate = match tokens[source_at + 1] {
        EQUALLY => ordering == 1,
        TINY => ordering == 0,
        GIANT => ordering == 2,
        _ => return ERROR_UNSUPPORTED,
    };

    let mut first_mood = conditional_at + 1;
    while first_mood < length
        && (boundaries[first_mood] == 0
            || !matches!(
                tokens[first_mood],
                REALIS | DEONTIC | MOOD_RETURN | MOOD_PARAGRAPH
            ))
    {
        first_mood += 1;
    }
    if first_mood == length || tokens[first_mood] != DEONTIC {
        return ERROR_UNSUPPORTED;
    }
    let mut first_action = ParsedSentence::empty();
    let first_action_error = parse_sentence_range(
        tokens,
        boundaries,
        conditional_at + 1,
        first_mood + 1,
        &mut first_action,
    );
    if first_action_error != 0 {
        return first_action_error;
    }
    let has_alternative = first_mood + 1 < length;
    let alternative = if has_alternative {
        let mut alternative = ParsedSentence::empty();
        let error =
            parse_sentence_range(tokens, boundaries, first_mood + 1, length, &mut alternative);
        if error != 0 {
            return error;
        }
        alternative
    } else {
        ParsedSentence::empty()
    };
    if first_action.mood != DEONTIC || (has_alternative && alternative.mood != DEONTIC) {
        return ERROR_UNSUPPORTED;
    }
    *has_selected_action = predicate || has_alternative;
    *selected_action = if predicate { first_action } else { alternative };
    0
}

fn read_optional_programlet_number(
    present: bool,
    field: SentenceField,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    value: &mut ProgramletNumber,
) -> u32 {
    if !present {
        return 0;
    }
    let error = resolve_programlet_value(tokens, field, symbols, arguments, slots, value);
    if error != 0 {
        return error;
    }
    if !matches!(value.kind, VALUE_UNSIGNED | VALUE_SIGNED) {
        return ERROR_UNSUPPORTED;
    }
    0
}

fn unsigned_programlet_operand(present: bool, value: ProgramletNumber) -> Result<u32, u32> {
    if !present {
        return Ok(0);
    }
    if value.kind == VALUE_SIGNED && (value.bits as i32) < 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    if value.bits > MAX_U16 {
        return Err(ERROR_MALFORMED);
    }
    Ok(value.bits)
}

fn first_present_operand(
    first_present: bool,
    first: u32,
    second_present: bool,
    second: u32,
) -> Result<u32, u32> {
    if first_present {
        Ok(first)
    } else if second_present {
        Ok(second)
    } else {
        Err(ERROR_MALFORMED)
    }
}

fn apply_programlet_number_action(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<(), u32> {
    if sentence.verb_length != 1 {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(to) = sentence.field(DESTINATION) else {
        return Err(ERROR_MALFORMED);
    };
    let mut target_name = NameSpan::EMPTY;
    let name_error = name_span(tokens, to, true, &mut target_name);
    if name_error != 0 {
        return Err(name_error);
    }
    let Some(target_index) = find_local_slot(tokens, target_name, symbols, slots) else {
        return Err(ERROR_MALFORMED);
    };
    match slots[target_index].kind {
        1 => {}
        2 | 4 => return Err(ERROR_CONSTANT_WRITE),
        _ => return Err(ERROR_UNSUPPORTED),
    }

    let ob = sentence.field(ACCUSATIVE);
    let from = sentence.field(SOURCE);
    let by = sentence.field(INSTRUMENTAL);
    let with = sentence.field(COMITATIVE);
    let mut ob_value = ProgramletNumber::EMPTY;
    let mut from_value = ProgramletNumber::EMPTY;
    let mut by_value = ProgramletNumber::EMPTY;
    let mut with_value = ProgramletNumber::EMPTY;
    let ob_present = ob.is_some();
    let from_present = from.is_some();
    let by_present = by.is_some();
    let with_present = with.is_some();
    let ob_error = read_optional_programlet_number(
        ob_present,
        ob.unwrap_or(SentenceField::EMPTY),
        tokens,
        symbols,
        arguments,
        slots,
        &mut ob_value,
    );
    let from_error = read_optional_programlet_number(
        from_present,
        from.unwrap_or(SentenceField::EMPTY),
        tokens,
        symbols,
        arguments,
        slots,
        &mut from_value,
    );
    let by_error = read_optional_programlet_number(
        by_present,
        by.unwrap_or(SentenceField::EMPTY),
        tokens,
        symbols,
        arguments,
        slots,
        &mut by_value,
    );
    let with_error = read_optional_programlet_number(
        with_present,
        with.unwrap_or(SentenceField::EMPTY),
        tokens,
        symbols,
        arguments,
        slots,
        &mut with_value,
    );
    if ob_error != 0 {
        return Err(ob_error);
    }
    if from_error != 0 {
        return Err(from_error);
    }
    if by_error != 0 {
        return Err(by_error);
    }
    if with_error != 0 {
        return Err(with_error);
    }
    let operator = tokens[sentence.verb_start];

    if operator == INVERT {
        if from_present || by_present || with_present {
            return Err(ERROR_UNSUPPORTED);
        }
        if !ob_present {
            return Err(ERROR_MALFORMED);
        }
        let operand = ob_value;
        let signed = if operand.kind == VALUE_SIGNED {
            operand.bits as i32
        } else if operand.bits <= MAX_U16 {
            operand.bits as i32
        } else {
            return Err(ERROR_UNSUPPORTED);
        };
        let Some(result) = signed.checked_neg() else {
            return Err(ERROR_UNSUPPORTED);
        };
        slots[target_index].value = result as u32;
        slots[target_index].value_kind = VALUE_SIGNED;
        return Ok(());
    }

    let ob_bits = unsigned_programlet_operand(ob_present, ob_value)?;
    let from_bits = unsigned_programlet_operand(from_present, from_value)?;
    let by_bits = unsigned_programlet_operand(by_present, by_value)?;
    let with_bits = unsigned_programlet_operand(with_present, with_value)?;

    let (left, right) = match operator {
        PLUS if !from_present => {
            if !ob_present {
                return Err(ERROR_MALFORMED);
            }
            (slots[target_index].value, ob_bits)
        }
        PLUS if ob_present => (ob_bits, from_bits),
        PLUS => return Err(ERROR_MALFORMED),
        SUBTRACT if from_present && ob_present => (from_bits, ob_bits),
        SUBTRACT if ob_present => (slots[target_index].value, ob_bits),
        MULTIPLY | DIVIDE => (
            first_present_operand(ob_present, ob_bits, from_present, from_bits)?,
            first_present_operand(by_present, by_bits, with_present, with_bits)?,
        ),
        EXPONENTIAL => {
            if !ob_present {
                return Err(ERROR_MALFORMED);
            }
            (
                ob_bits,
                first_present_operand(from_present, from_bits, by_present, by_bits)?,
            )
        }
        XOR => {
            if !ob_present {
                return Err(ERROR_MALFORMED);
            }
            (
                ob_bits,
                if with_present {
                    with_bits
                } else {
                    first_present_operand(from_present, from_bits, by_present, by_bits)?
                },
            )
        }
        REMAINS => {
            if !ob_present {
                return Err(ERROR_MALFORMED);
            }
            (
                ob_bits,
                first_present_operand(from_present, from_bits, by_present, by_bits)?,
            )
        }
        _ => return Err(ERROR_UNSUPPORTED),
    };
    slots[target_index].value = number_operator(operator, left, right)?;
    slots[target_index].value_kind = VALUE_UNSIGNED;
    Ok(())
}

fn apply_programlet_boolean_action(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<(), u32> {
    let Some(to) = sentence.field(DESTINATION) else {
        return Err(ERROR_MALFORMED);
    };
    let mut target_name = NameSpan::EMPTY;
    let mut target_kind = 0;
    let output_error = typed_output_name(tokens, to, &mut target_name, &mut target_kind);
    if output_error != 0 {
        return Err(output_error);
    }
    if target_kind != VALUE_BOOLEAN {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(target_index) = find_local_slot(tokens, target_name, symbols, slots) else {
        return Err(ERROR_MALFORMED);
    };
    match slots[target_index].kind {
        3 => {}
        4 => return Err(ERROR_CONSTANT_WRITE),
        _ => return Err(ERROR_UNSUPPORTED),
    }
    let Some(ob) = sentence.field(ACCUSATIVE) else {
        return Err(ERROR_MALFORMED);
    };
    let mut value = ProgramletNumber::EMPTY;
    let error = resolve_programlet_value(tokens, ob, symbols, arguments, slots, &mut value);
    if error != 0 {
        return Err(error);
    }
    if value.kind != VALUE_BOOLEAN {
        return Err(ERROR_UNSUPPORTED);
    }
    slots[target_index].value = value.bits;
    slots[target_index].value_kind = VALUE_BOOLEAN;
    Ok(())
}

fn names_equal<const WORDS: usize>(
    left: &[u32; WORDS],
    left_span: NameSpan,
    right: &[u32; WORDS],
    right_span: NameSpan,
) -> bool {
    if left_span.length != right_span.length
        || left_span.start + left_span.length > left.len()
        || right_span.start + right_span.length > right.len()
    {
        return false;
    }
    let mut index = 0;
    while index < left_span.length {
        if left[left_span.start + index] != right[right_span.start + index] {
            return false;
        }
        index += 1;
    }
    true
}

fn store_name(
    source: &[u32; PROGRAMLET_SCRATCH_WORDS],
    span: NameSpan,
    storage: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    used: &mut usize,
    stored: &mut NameSpan,
) -> u32 {
    let Some(end) = span.start.checked_add(span.length) else {
        return ERROR_MALFORMED;
    };
    let Some(stored_end) = used.checked_add(span.length) else {
        return ERROR_FRAME_CAPACITY;
    };
    if end > source.len() || stored_end > storage.len() {
        return ERROR_FRAME_CAPACITY;
    }
    let start = *used;
    let mut index = 0;
    while index < span.length {
        storage[start + index] = source[span.start + index];
        index += 1;
    }
    *used = stored_end;
    *stored = NameSpan {
        start,
        length: span.length,
    };
    0
}

fn find_local_slot<const SLOTS: usize>(
    source: &[u32; PROGRAMLET_SCRATCH_WORDS],
    span: NameSpan,
    storage: &[u32; PROGRAMLET_SCRATCH_WORDS],
    slots: &[NumericLocalSlot; SLOTS],
) -> Option<usize> {
    let mut index = 0;
    while index < slots.len() {
        let slot = slots[index];
        if slot.kind != 0
            && names_equal(
                source,
                span,
                storage,
                NameSpan {
                    start: slot.name_offset as usize,
                    length: slot.name_length as usize,
                },
            )
        {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn is_ceremony_definition(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
) -> bool {
    sentence.mood == MOOD_DEFINITION
        && sentence.verb_length == 1
        && tokens[sentence.verb_start] == CEREMONY
}

fn find_programlet_routine(
    words: &[u32],
    codelet_count: usize,
    target: NameSpan,
    sentence_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    sentence_boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_used: &mut usize,
    routine_name: &mut NameSpan,
    routine_output_name: &mut NameSpan,
    routine_start: &mut usize,
    routine_end: &mut usize,
    routine_kind: &mut u32,
) -> u32 {
    let mut cursor = 0;
    while cursor < codelet_count {
        let (length, next_codelet) = match collect_sentence(
            words,
            codelet_count,
            cursor,
            sentence_words,
            sentence_boundaries,
        ) {
            Ok(group) => group,
            Err(error) => return error,
        };
        let mut sentence = ParsedSentence::empty();
        let parse_error =
            parse_sentence(sentence_words, sentence_boundaries, length, &mut sentence);
        if parse_error != 0 {
            return parse_error;
        }
        if !is_ceremony_definition(&sentence, sentence_words) {
            cursor = next_codelet;
            continue;
        }
        let Some(su) = sentence.field(NOMINATIVE) else {
            return ERROR_MALFORMED;
        };
        let Some(output) = sentence.field(DESTINATION) else {
            return ERROR_MALFORMED;
        };
        let mut declared_output_name = NameSpan::EMPTY;
        let mut output_kind = 0;
        let output_error = typed_output_name(
            sentence_words,
            output,
            &mut declared_output_name,
            &mut output_kind,
        );
        if output_error != 0 {
            return output_error;
        }
        let mut source_name = NameSpan::EMPTY;
        let name_error = name_span(sentence_words, su, false, &mut source_name);
        if name_error != 0 {
            return name_error;
        }
        let matches_target = names_equal(sentence_words, source_name, symbol_words, target);
        let stored_output_name = if matches_target {
            let mut stored = NameSpan::EMPTY;
            let error = store_name(
                sentence_words,
                declared_output_name,
                symbol_words,
                symbol_used,
                &mut stored,
            );
            if error != 0 {
                return error;
            }
            stored
        } else {
            NameSpan {
                start: 0,
                length: 0,
            }
        };
        let stored_name = if matches_target {
            let mut stored = NameSpan::EMPTY;
            let error = store_name(
                sentence_words,
                source_name,
                symbol_words,
                symbol_used,
                &mut stored,
            );
            if error != 0 {
                return error;
            }
            stored
        } else {
            NameSpan {
                start: 0,
                length: 0,
            }
        };
        let body_start = next_codelet;
        cursor = body_start;
        loop {
            if cursor >= codelet_count {
                return ERROR_MALFORMED;
            }
            let (body_length, body_next) = match collect_sentence(
                words,
                codelet_count,
                cursor,
                sentence_words,
                sentence_boundaries,
            ) {
                Ok(group) => group,
                Err(error) => return error,
            };
            let is_branch = contains_marked_token(
                sentence_words,
                sentence_boundaries,
                body_length,
                CONDITIONAL,
            );
            let mut body_sentence = ParsedSentence::empty();
            if !is_branch {
                let error = parse_sentence(
                    sentence_words,
                    sentence_boundaries,
                    body_length,
                    &mut body_sentence,
                );
                if error != 0 {
                    return error;
                }
            }
            if !is_branch && is_ceremony_definition(&body_sentence, sentence_words) {
                return ERROR_MALFORMED;
            }
            if !is_branch && body_sentence.mood == MOOD_PARAGRAPH {
                if matches_target {
                    let closing_su = match body_sentence.field(NOMINATIVE) {
                        Some(field) => field,
                        None => return ERROR_MALFORMED,
                    };
                    let mut closing_name = NameSpan::EMPTY;
                    let name_error =
                        name_span(sentence_words, closing_su, false, &mut closing_name);
                    if name_error != 0 {
                        return name_error;
                    }
                    if !names_equal(sentence_words, closing_name, symbol_words, stored_name) {
                        return ERROR_MALFORMED;
                    }
                    *routine_name = stored_name;
                    *routine_output_name = stored_output_name;
                    *routine_start = body_start;
                    *routine_end = body_next;
                    *routine_kind = output_kind;
                    return 0;
                }
                cursor = body_next;
                break;
            }
            cursor = body_next;
        }
    }
    ERROR_UNSUPPORTED
}

/// Returns whether the first canonical Pyash sentence is a ceremony
/// definition. Recognition scans index-marked case and mood boundaries without
/// imposing a separate function-name length limit.
pub fn is_numeric_programlet(words: &[u32], codelet_count: usize) -> bool {
    if codelet_count == 0 || codelet_count > words.len() / CODELET_WORDS {
        return false;
    }
    let mut has_su = false;
    let mut has_to = false;
    let mut previous_word = 0;
    let mut previous_boundary = false;
    let mut codelet = 0;
    loop {
        if codelet >= codelet_count {
            return false;
        }
        let header = word(words, codelet, 0);
        let complete = header & 1 != 0;
        let mut last_boundary = 0;
        let mut slot = 1;
        while slot < CODELET_WORDS {
            if (header & (1 << slot) != 0) == complete {
                last_boundary = slot;
            }
            slot += 1;
        }
        if complete && last_boundary == 0 {
            return false;
        }
        let last_slot = if complete {
            last_boundary
        } else {
            CODELET_WORDS - 1
        };
        slot = 1;
        while slot <= last_slot {
            let value = word(words, codelet, slot);
            let boundary = (header & (1 << slot) != 0) == complete;
            if boundary && value == NOMINATIVE {
                has_su = true;
            } else if boundary && value == DESTINATION {
                has_to = true;
            } else if boundary && value == MOOD_DEFINITION {
                return complete
                    && slot == last_slot
                    && has_su
                    && has_to
                    && previous_word == CEREMONY
                    && !previous_boundary;
            }
            previous_word = value;
            previous_boundary = boundary;
            slot += 1;
        }
        codelet += 1;
        if complete {
            return false;
        }
    }
}

/// Execute a canonical Pyash numeric programlet using bounded local call frames.
/// All memory is caller-owned so the same interpreter can run in Rust-GPU.
pub fn execute_numeric_programlet(
    words: &[u32],
    codelet_count: usize,
    step_budget: u32,
    sentence_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    sentence_boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    frames: &mut [ProgramletFrame; MAX_PROGRAMLET_CALL_DEPTH],
) -> CoreResult {
    if codelet_count == 0 || codelet_count > words.len() / CODELET_WORDS {
        return CoreResult::failure(ERROR_MALFORMED, 0);
    }
    if codelet_count > MAX_PROGRAMLET_CODELETS {
        return CoreResult::failure(ERROR_PROGRAM_CAPACITY, 0);
    }
    if step_budget == 0 {
        return CoreResult::failure(ERROR_STEP_BUDGET, 0);
    }
    let mut frame_index = 0;
    while frame_index < frames.len() {
        frames[frame_index] = ProgramletFrame::EMPTY;
        frame_index += 1;
    }
    let mut symbol_used = 0usize;

    let mut invocation_start = 0;
    let mut codelet = 0usize;
    while codelet < codelet_count {
        let (length, next_codelet) = match collect_sentence(
            words,
            codelet_count,
            codelet,
            sentence_words,
            sentence_boundaries,
        ) {
            Ok(group) => group,
            Err(error) => return CoreResult::failure(error, 0),
        };
        if !contains_marked_token(sentence_words, sentence_boundaries, length, CONDITIONAL) {
            let mut parsed = ParsedSentence::empty();
            let parse_error =
                parse_sentence(sentence_words, sentence_boundaries, length, &mut parsed);
            if parse_error != 0 {
                return CoreResult::failure(parse_error, 0);
            }
        }
        invocation_start = codelet;
        codelet = next_codelet;
    }

    let (invocation_length, _) = match collect_sentence(
        words,
        codelet_count,
        invocation_start,
        sentence_words,
        sentence_boundaries,
    ) {
        Ok(group) => group,
        Err(error) => return CoreResult::failure(error, 0),
    };
    let mut invocation = ParsedSentence::empty();
    let parse_error = parse_sentence(
        sentence_words,
        sentence_boundaries,
        invocation_length,
        &mut invocation,
    );
    if parse_error != 0 {
        return CoreResult::failure(parse_error, 0);
    }
    if invocation.mood != DEONTIC || invocation.field_count == 0 {
        return CoreResult::failure(ERROR_UNSUPPORTED, 0);
    }
    let Some(output) = invocation.field(DESTINATION) else {
        return CoreResult::failure(ERROR_MALFORMED, 0);
    };
    let mut output_name = NameSpan::EMPTY;
    let mut output_kind = 0;
    let output_error =
        typed_output_name(sentence_words, output, &mut output_name, &mut output_kind);
    if output_error != 0 {
        return CoreResult::failure(output_error, 0);
    }
    let loop_remaining = match loop_iterations(&invocation, sentence_words) {
        Ok(iterations) => iterations,
        Err(error) => return CoreResult::failure(error, 0),
    };
    let mut invocation_arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let mut invocation_argument_count = 0;
    if let Err(error) = capture_programlet_arguments(
        &invocation,
        sentence_words,
        symbol_words,
        &[ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS],
        &[NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS],
        &mut invocation_arguments,
        &mut invocation_argument_count,
    ) {
        return CoreResult::failure(error, 0);
    }
    let loop_cursor = match invocation
        .field(FROM_INDEX)
        .map(|field| number_value(sentence_words, field))
        .transpose()
    {
        Ok(value) => value,
        Err(error) => return CoreResult::failure(error, 0),
    };
    let loop_end = match invocation
        .field(TO_INDEX)
        .map(|field| number_value(sentence_words, field))
        .transpose()
    {
        Ok(value) => value,
        Err(error) => return CoreResult::failure(error, 0),
    };
    if let Some(cursor) = loop_cursor
        && let Err(error) = set_loop_index_argument(&mut invocation_arguments, cursor)
    {
        return CoreResult::failure(error, 0);
    }
    let mut target = NameSpan::EMPTY;
    let name_error = store_name(
        sentence_words,
        NameSpan {
            start: invocation.verb_start,
            length: invocation.verb_length,
        },
        symbol_words,
        &mut symbol_used,
        &mut target,
    );
    if name_error != 0 {
        return CoreResult::failure(name_error, 0);
    }
    let mut routine_name = NameSpan::EMPTY;
    let mut routine_output_name = NameSpan::EMPTY;
    let mut routine_start = 0;
    let mut routine_end = 0;
    let mut routine_kind = 0;
    let routine_error = find_programlet_routine(
        words,
        codelet_count,
        target,
        sentence_words,
        sentence_boundaries,
        symbol_words,
        &mut symbol_used,
        &mut routine_name,
        &mut routine_output_name,
        &mut routine_start,
        &mut routine_end,
        &mut routine_kind,
    );
    if routine_error != 0 {
        return CoreResult::failure(routine_error, 0);
    }
    if let Err(error) = validate_programlet_arguments(
        words,
        codelet_count,
        routine_start,
        sentence_words,
        sentence_boundaries,
        &invocation_arguments,
        invocation_argument_count,
    ) {
        return CoreResult::failure(error, 0);
    }
    if !number_kind_matches(output_kind, routine_kind) {
        return CoreResult::failure(ERROR_UNSUPPORTED, 0);
    }
    frames[0] = ProgramletFrame {
        routine_start: routine_start as u32,
        routine_end: routine_end as u32,
        program_counter: routine_start as u32,
        routine_name_offset: routine_name.start as u32,
        routine_name_length: routine_name.length as u32,
        arguments: invocation_arguments,
        argument_count: invocation_argument_count,
        state: 1,
        expected_kind: routine_kind,
        loop_active: u32::from(invocation.field(FROM_INDEX).is_some()),
        loop_remaining,
        loop_end: loop_end.unwrap_or(0),
        loop_has_end: u32::from(loop_end.is_some()),
        ..ProgramletFrame::EMPTY
    };
    frames[0].slots[0] = NumericLocalSlot {
        name_offset: routine_output_name.start as u32,
        name_length: routine_output_name.length as u32,
        value: 0,
        kind: if output_kind == VALUE_BOOLEAN { 3 } else { 1 },
        value_kind: if output_kind == VALUE_BOOLEAN {
            VALUE_BOOLEAN
        } else {
            VALUE_UNSIGNED
        },
    };
    if frames[0].loop_active != 0 && frames[0].loop_remaining == 0 {
        let mut output = ProgramletNumber::EMPTY;
        let has_output = argument_value(&frames[0].arguments, ACCUSATIVE, &mut output);
        let (value, kind) = if has_output {
            if !number_kind_matches(frames[0].expected_kind, output.kind) {
                return CoreResult::failure(ERROR_UNSUPPORTED, 0);
            }
            (output.bits, output.kind)
        } else if frames[0].expected_kind == VALUE_BOOLEAN {
            (0, VALUE_BOOLEAN)
        } else {
            (0, VALUE_UNSIGNED)
        };
        return CoreResult::scalar(kind, value, 0, codelet_count as u32);
    }

    let mut depth = 1usize;
    let mut steps = 1u32;
    while depth > 0 {
        let frame_index = depth - 1;
        let frame = frames[frame_index];
        let pc = frame.program_counter as usize;
        if pc >= frame.routine_end as usize {
            return CoreResult::failure(ERROR_MALFORMED, steps);
        }
        let (length, next_codelet) = match collect_sentence(
            words,
            codelet_count,
            pc,
            sentence_words,
            sentence_boundaries,
        ) {
            Ok(group) => group,
            Err(error) => return CoreResult::failure(error, steps),
        };
        frames[frame_index].program_counter = next_codelet as u32;
        let sentence =
            if contains_marked_token(sentence_words, sentence_boundaries, length, CONDITIONAL) {
                if steps >= step_budget {
                    return CoreResult::failure(ERROR_STEP_BUDGET, steps);
                }
                steps += 1;
                frames[frame_index].action_started = 1;
                let mut action = ParsedSentence::empty();
                let mut has_selected_action = false;
                let branch_error = programlet_branch(
                    sentence_words,
                    sentence_boundaries,
                    length,
                    symbol_words,
                    &frames[frame_index].arguments,
                    &frames[frame_index].slots,
                    &mut action,
                    &mut has_selected_action,
                );
                if branch_error != 0 {
                    return CoreResult::failure(branch_error, steps);
                }
                if !has_selected_action {
                    continue;
                }
                if steps >= step_budget {
                    return CoreResult::failure(ERROR_STEP_BUDGET, steps);
                }
                steps += 1;
                action
            } else {
                let mut sentence = ParsedSentence::empty();
                let parse_error =
                    parse_sentence(sentence_words, sentence_boundaries, length, &mut sentence);
                if parse_error != 0 {
                    return CoreResult::failure(parse_error, steps);
                }
                if sentence.mood != MOOD_PARAGRAPH {
                    if steps >= step_budget {
                        return CoreResult::failure(ERROR_STEP_BUDGET, steps);
                    }
                    steps += 1;
                }
                sentence
            };

        if frame.state == 1
            && sentence.mood == REALIS
            && sentence.verb_length == 1
            && matches!(
                sentence_words[sentence.verb_start],
                NUMBER_VERB | BOOLEAN_VERB
            )
        {
            if frame.action_started != 0 || sentence.field_count != 3 {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            let (Some(su), Some(ob), Some(as_field)) = (
                sentence.field(NOMINATIVE),
                sentence.field(ACCUSATIVE),
                sentence.field(ESSIVE),
            ) else {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            };
            let mut name = NameSpan::EMPTY;
            let name_error = name_span(sentence_words, su, false, &mut name);
            if name_error != 0 {
                return CoreResult::failure(name_error, steps);
            }
            let value_kind = if sentence_words[sentence.verb_start] == BOOLEAN_VERB {
                VALUE_BOOLEAN
            } else {
                VALUE_NUMBER
            };
            let expected_verb = if value_kind == VALUE_BOOLEAN {
                BOOLEAN_VERB
            } else {
                NUMBER_VERB
            };
            let mut value = ProgramletNumber::EMPTY;
            let value_error = resolve_programlet_value(
                sentence_words,
                ob,
                symbol_words,
                &frames[frame_index].arguments,
                &frames[frame_index].slots,
                &mut value,
            );
            if value_error != 0 {
                return CoreResult::failure(value_error, steps);
            }
            if !number_kind_matches(value_kind, value.kind) {
                return CoreResult::failure(ERROR_UNSUPPORTED, steps);
            }
            let kind = if as_field.length == 2
                && sentence_words[as_field.start] == NAME_TYPE
                && sentence_words[as_field.start + 1] == VARIABLE
            {
                if value_kind == VALUE_BOOLEAN { 3 } else { 1 }
            } else if as_field.length == 3
                && sentence_words[as_field.start] == NAME_TYPE
                && sentence_words[as_field.start + 1] == PERMANENTLY
                && sentence_words[as_field.start + 2] == expected_verb
            {
                if value_kind == VALUE_BOOLEAN { 4 } else { 2 }
            } else {
                return CoreResult::failure(ERROR_UNSUPPORTED, steps);
            };
            let slot_index = if let Some(existing) = find_local_slot(
                sentence_words,
                name,
                symbol_words,
                &frames[frame_index].slots,
            ) {
                existing
            } else {
                let mut free = 0;
                while free < MAX_PROGRAMLET_LOCAL_SLOTS && frames[frame_index].slots[free].kind != 0
                {
                    free += 1;
                }
                if free == MAX_PROGRAMLET_LOCAL_SLOTS {
                    return CoreResult::failure(ERROR_FRAME_CAPACITY, steps);
                }
                let mut stored = NameSpan::EMPTY;
                let name_error = store_name(
                    sentence_words,
                    name,
                    symbol_words,
                    &mut symbol_used,
                    &mut stored,
                );
                if name_error != 0 {
                    return CoreResult::failure(name_error, steps);
                }
                frames[frame_index].slots[free].name_offset = stored.start as u32;
                frames[frame_index].slots[free].name_length = stored.length as u32;
                free
            };
            frames[frame_index].slots[slot_index].value = value.bits;
            frames[frame_index].slots[slot_index].kind = kind;
            frames[frame_index].slots[slot_index].value_kind = value.kind;
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && sentence.verb_length == 1
            && matches!(
                sentence_words[sentence.verb_start],
                PLUS | SUBTRACT | MULTIPLY | DIVIDE | EXPONENTIAL | XOR | REMAINS | INVERT
            )
        {
            frames[frame_index].action_started = 1;
            if let Err(error) = apply_programlet_number_action(
                &sentence,
                sentence_words,
                symbol_words,
                &frames[frame_index].arguments,
                &mut frames[frame_index].slots,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && sentence.verb_length == 1
            && sentence_words[sentence.verb_start] == BOOLEAN_VERB
        {
            frames[frame_index].action_started = 1;
            if let Err(error) = apply_programlet_boolean_action(
                &sentence,
                sentence_words,
                symbol_words,
                &frames[frame_index].arguments,
                &mut frames[frame_index].slots,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1 && sentence.mood == DEONTIC {
            frames[frame_index].action_started = 1;
            if sentence.field_count == 0 {
                return CoreResult::failure(ERROR_UNSUPPORTED, steps);
            }
            let Some(output) = sentence.field(DESTINATION) else {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            };
            let mut return_name = NameSpan::EMPTY;
            let mut return_kind = 0;
            let output_error =
                typed_output_name(sentence_words, output, &mut return_name, &mut return_kind);
            if output_error != 0 {
                return CoreResult::failure(output_error, steps);
            }
            let mut stored_return_name = NameSpan::EMPTY;
            let name_error = store_name(
                sentence_words,
                return_name,
                symbol_words,
                &mut symbol_used,
                &mut stored_return_name,
            );
            if name_error != 0 {
                return CoreResult::failure(name_error, steps);
            }
            let call_loop_remaining = match loop_iterations(&sentence, sentence_words) {
                Ok(iterations) => iterations,
                Err(error) => return CoreResult::failure(error, steps),
            };
            let mut call_name = NameSpan::EMPTY;
            let name_error = store_name(
                sentence_words,
                NameSpan {
                    start: sentence.verb_start,
                    length: sentence.verb_length,
                },
                symbol_words,
                &mut symbol_used,
                &mut call_name,
            );
            if name_error != 0 {
                return CoreResult::failure(name_error, steps);
            }
            let mut call_arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
            let mut call_argument_count = 0;
            if let Err(error) = capture_programlet_arguments(
                &sentence,
                sentence_words,
                symbol_words,
                &frames[frame_index].arguments,
                &frames[frame_index].slots,
                &mut call_arguments,
                &mut call_argument_count,
            ) {
                return CoreResult::failure(error, steps);
            }
            let call_loop_cursor = match sentence
                .field(FROM_INDEX)
                .map(|field| number_value(sentence_words, field))
                .transpose()
            {
                Ok(value) => value,
                Err(error) => return CoreResult::failure(error, steps),
            };
            let call_loop_end = match sentence
                .field(TO_INDEX)
                .map(|field| number_value(sentence_words, field))
                .transpose()
            {
                Ok(value) => value,
                Err(error) => return CoreResult::failure(error, steps),
            };
            if let Some(cursor) = call_loop_cursor
                && let Err(error) = set_loop_index_argument(&mut call_arguments, cursor)
            {
                return CoreResult::failure(error, steps);
            }
            let mut called_name = NameSpan::EMPTY;
            let mut called_output_name = NameSpan::EMPTY;
            let mut called_start = 0;
            let mut called_end = 0;
            let mut called_kind = 0;
            let routine_error = find_programlet_routine(
                words,
                codelet_count,
                call_name,
                sentence_words,
                sentence_boundaries,
                symbol_words,
                &mut symbol_used,
                &mut called_name,
                &mut called_output_name,
                &mut called_start,
                &mut called_end,
                &mut called_kind,
            );
            if routine_error != 0 {
                return CoreResult::failure(routine_error, steps);
            }
            if let Err(error) = validate_programlet_arguments(
                words,
                codelet_count,
                called_start,
                sentence_words,
                sentence_boundaries,
                &call_arguments,
                call_argument_count,
            ) {
                return CoreResult::failure(error, steps);
            }
            if !number_kind_matches(return_kind, called_kind) {
                return CoreResult::failure(ERROR_UNSUPPORTED, steps);
            }
            if sentence.field(FROM_INDEX).is_some() && call_loop_remaining == 0 {
                let mut result = ProgramletNumber::EMPTY;
                if !argument_value(&call_arguments, ACCUSATIVE, &mut result) {
                    result.kind = if called_kind == VALUE_BOOLEAN {
                        VALUE_BOOLEAN
                    } else {
                        VALUE_UNSIGNED
                    };
                }
                if let Err(error) = write_programlet_call_result(
                    symbol_words,
                    stored_return_name,
                    called_kind,
                    result,
                    &mut frames[frame_index].slots,
                ) {
                    return CoreResult::failure(error, steps);
                }
            } else {
                if depth == MAX_PROGRAMLET_CALL_DEPTH {
                    return CoreResult::failure(ERROR_CALL_DEPTH, steps);
                }
                frames[depth] = ProgramletFrame {
                    routine_start: called_start as u32,
                    routine_end: called_end as u32,
                    program_counter: called_start as u32,
                    routine_name_offset: called_name.start as u32,
                    routine_name_length: called_name.length as u32,
                    arguments: call_arguments,
                    argument_count: call_argument_count,
                    return_name_offset: stored_return_name.start as u32,
                    return_name_length: stored_return_name.length as u32,
                    state: 1,
                    expected_kind: called_kind,
                    loop_active: u32::from(sentence.field(FROM_INDEX).is_some()),
                    loop_remaining: call_loop_remaining,
                    loop_end: call_loop_end.unwrap_or(0),
                    loop_has_end: u32::from(call_loop_end.is_some()),
                    ..ProgramletFrame::EMPTY
                };
                frames[depth].slots[0] = NumericLocalSlot {
                    name_offset: called_output_name.start as u32,
                    name_length: called_output_name.length as u32,
                    value: 0,
                    kind: if return_kind == VALUE_BOOLEAN { 3 } else { 1 },
                    value_kind: if return_kind == VALUE_BOOLEAN {
                        VALUE_BOOLEAN
                    } else {
                        VALUE_UNSIGNED
                    },
                };
                depth += 1;
            }
        } else if frame.state == 1 && sentence.mood == MOOD_RETURN {
            if sentence.field_count != 1 || sentence.verb_length != 0 {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            if let Some(return_field) = sentence.field(NOMINATIVE) {
                let mut return_name = NameSpan::EMPTY;
                let name_error = name_span(sentence_words, return_field, false, &mut return_name);
                if name_error != 0 {
                    return CoreResult::failure(name_error, steps);
                }
                let Some(index) = find_local_slot(
                    sentence_words,
                    return_name,
                    symbol_words,
                    &frames[frame_index].slots,
                ) else {
                    return CoreResult::failure(ERROR_MALFORMED, steps);
                };
                frames[frame_index].result_value = frames[frame_index].slots[index].value;
                frames[frame_index].result_kind = frames[frame_index].slots[index].value_kind;
            } else if let Some(return_field) = sentence.field(ACCUSATIVE) {
                if return_field.length == 1
                    && matches!(sentence_words[return_field.start], TRUTH | LIE)
                {
                    frames[frame_index].result_value =
                        u32::from(sentence_words[return_field.start] == TRUTH);
                    frames[frame_index].result_kind = VALUE_BOOLEAN;
                } else if return_field.length == 2
                    && sentence_words[return_field.start] == NUMBER_QUOTE
                {
                    frames[frame_index].result_value = sentence_words[return_field.start + 1];
                    frames[frame_index].result_kind = VALUE_UNSIGNED;
                } else if return_field.length >= 2
                    && sentence_words[return_field.start] == NAME_TYPE
                {
                    let mut return_name = NameSpan::EMPTY;
                    let name_error =
                        name_span(sentence_words, return_field, false, &mut return_name);
                    if name_error != 0 {
                        return CoreResult::failure(name_error, steps);
                    }
                    let Some(index) = find_local_slot(
                        sentence_words,
                        return_name,
                        symbol_words,
                        &frames[frame_index].slots,
                    ) else {
                        return CoreResult::failure(ERROR_MALFORMED, steps);
                    };
                    frames[frame_index].result_value = frames[frame_index].slots[index].value;
                    frames[frame_index].result_kind = frames[frame_index].slots[index].value_kind;
                } else {
                    return CoreResult::failure(ERROR_UNSUPPORTED, steps);
                }
            } else {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            if !number_kind_matches(frame.expected_kind, frames[frame_index].result_kind) {
                return CoreResult::failure(ERROR_UNSUPPORTED, steps);
            }
            frames[frame_index].has_returned = 1;
            frames[frame_index].state = 2;
        } else if frame.state == 2 && sentence.mood == MOOD_PARAGRAPH {
            if frame.has_returned == 0
                || sentence.field_count != 1
                || sentence.verb_length != 1
                || sentence_words[sentence.verb_start] != CEREMONY
            {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            let Some(su) = sentence.field(NOMINATIVE) else {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            };
            let mut closing_name = NameSpan::EMPTY;
            let name_error = name_span(sentence_words, su, false, &mut closing_name);
            if name_error != 0 {
                return CoreResult::failure(name_error, steps);
            }
            let routine_name = NameSpan {
                start: frame.routine_name_offset as usize,
                length: frame.routine_name_length as usize,
            };
            if !names_equal(sentence_words, closing_name, symbol_words, routine_name) {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            if frame.loop_active != 0 && frame.loop_remaining > 1 {
                frames[frame_index].loop_remaining -= 1;
                let mut current = ProgramletNumber::EMPTY;
                if argument_value(&frame.arguments, FROM_INDEX, &mut current) {
                    let next = if frame.loop_has_end != 0 {
                        if current.bits < frame.loop_end {
                            current.bits + 1
                        } else {
                            current.bits - 1
                        }
                    } else {
                        current.bits - 1
                    };
                    if let Err(error) =
                        set_loop_index_argument(&mut frames[frame_index].arguments, next)
                    {
                        return CoreResult::failure(error, steps);
                    }
                }
                frames[frame_index].program_counter = frame.routine_start;
                frames[frame_index].state = 1;
                frames[frame_index].action_started = 0;
                frames[frame_index].has_returned = 0;
                frames[frame_index].result_value = 0;
                frames[frame_index].result_kind = 0;
                let mut slot_index = 1;
                while slot_index < MAX_PROGRAMLET_LOCAL_SLOTS {
                    frames[frame_index].slots[slot_index] = NumericLocalSlot::EMPTY;
                    slot_index += 1;
                }
                continue;
            }
            if depth == 1 {
                return CoreResult::scalar(
                    frame.result_kind,
                    frame.result_value,
                    0,
                    codelet_count as u32,
                );
            }
            let caller_index = depth - 2;
            let return_name = NameSpan {
                start: frame.return_name_offset as usize,
                length: frame.return_name_length as usize,
            };
            if let Err(error) = write_programlet_call_result(
                symbol_words,
                return_name,
                frame.expected_kind,
                ProgramletNumber {
                    bits: frame.result_value,
                    kind: frame.result_kind,
                },
                &mut frames[caller_index].slots,
            ) {
                return CoreResult::failure(error, steps);
            }
            frames[depth - 1] = ProgramletFrame::EMPTY;
            depth -= 1;
        } else {
            return CoreResult::failure(ERROR_UNSUPPORTED, steps);
        }
    }
    CoreResult::failure(ERROR_MALFORMED, steps)
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
