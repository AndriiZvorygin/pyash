use super::*;

const LETTER_VECTOR_QUOTE: u32 = 0x0e1d;
const VARIABLE: u32 = 0xc8c4;
const ESSIVE: u32 = 0x414f;

fn token_count(words: &[u32], start: usize, group_len: usize) -> Option<usize> {
    if group_len == 0 || word(words, start + group_len - 1, 0) & 1 == 0 {
        return None;
    }
    let last = start + group_len - 1;
    let mut final_boundary = 0;
    let mut slot = 1;
    while slot < CODELET_WORDS {
        if word(words, last, 0) & (1 << slot) != 0 {
            final_boundary = slot;
        }
        slot += 1;
    }
    (final_boundary != 0).then_some((group_len - 1) * (CODELET_WORDS - 1) + final_boundary)
}

fn token(words: &[u32], start: usize, group_len: usize, offset: usize) -> Option<u32> {
    if offset >= group_len * (CODELET_WORDS - 1) {
        return None;
    }
    let codelet = start + offset / (CODELET_WORDS - 1);
    let slot = offset % (CODELET_WORDS - 1) + 1;
    Some(word(words, codelet, slot))
}

fn boundary(words: &[u32], start: usize, offset: usize) -> bool {
    let codelet = start + offset / (CODELET_WORDS - 1);
    let slot = offset % (CODELET_WORDS - 1) + 1;
    let header = word(words, codelet, 0);
    (header & (1 << slot) != 0) == (header & 1 != 0)
}

fn expect(
    words: &[u32],
    start: usize,
    group_len: usize,
    offset: &mut usize,
    expected: u32,
    is_boundary: bool,
) -> bool {
    let valid = token(words, start, group_len, *offset) == Some(expected)
        && boundary(words, start, *offset) == is_boundary;
    *offset += 1;
    valid
}

fn expect_text_start(
    words: &[u32],
    start: usize,
    group_len: usize,
    offset: &mut usize,
    length: u32,
) -> bool {
    if !expect(words, start, group_len, offset, LETTER_VECTOR_QUOTE, false)
        || !expect(words, start, group_len, offset, length, false)
    {
        return false;
    }
    true
}

fn expect_text_end(words: &[u32], start: usize, group_len: usize, offset: &mut usize) -> bool {
    expect(words, start, group_len, offset, 0, false)
}

fn expect_state_text(words: &[u32], start: usize, group_len: usize, offset: &mut usize) -> bool {
    expect_text_start(words, start, group_len, offset, 5)
        && expect(words, start, group_len, offset, b's' as u32, false)
        && expect(words, start, group_len, offset, b't' as u32, false)
        && expect(words, start, group_len, offset, b'a' as u32, false)
        && expect(words, start, group_len, offset, b't' as u32, false)
        && expect(words, start, group_len, offset, b'e' as u32, false)
        && expect_text_end(words, start, group_len, offset)
}

fn expect_vector_float32_text(
    words: &[u32],
    start: usize,
    group_len: usize,
    offset: &mut usize,
) -> bool {
    expect_text_start(words, start, group_len, offset, 14)
        && expect(words, start, group_len, offset, b'v' as u32, false)
        && expect(words, start, group_len, offset, b'e' as u32, false)
        && expect(words, start, group_len, offset, b'c' as u32, false)
        && expect(words, start, group_len, offset, b't' as u32, false)
        && expect(words, start, group_len, offset, b'o' as u32, false)
        && expect(words, start, group_len, offset, b'r' as u32, false)
        && expect(words, start, group_len, offset, b' ' as u32, false)
        && expect(words, start, group_len, offset, b'f' as u32, false)
        && expect(words, start, group_len, offset, b'l' as u32, false)
        && expect(words, start, group_len, offset, b'o' as u32, false)
        && expect(words, start, group_len, offset, b'a' as u32, false)
        && expect(words, start, group_len, offset, b't' as u32, false)
        && expect(words, start, group_len, offset, b'3' as u32, false)
        && expect(words, start, group_len, offset, b'2' as u32, false)
        && expect_text_end(words, start, group_len, offset)
}

pub(super) fn mutable_vector_declaration(
    words: &[u32],
    start: usize,
    group_len: usize,
) -> Result<(NameSpan, usize), u32> {
    let length = token_count(words, start, group_len).ok_or(ERROR_MALFORMED)?;
    if length < 2
        || token(words, start, group_len, 0) != Some(NAME_TYPE)
        || token(words, start, group_len, length - 2) != Some(VARIABLE)
        || token(words, start, group_len, length - 1) != Some(REALIS)
    {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut offset = 0;
    if !expect(words, start, group_len, &mut offset, NAME_TYPE, false) {
        return Err(ERROR_UNSUPPORTED);
    }
    let name_start = offset;
    while offset < length
        && !(boundary(words, start, offset)
            && token(words, start, group_len, offset) == Some(NOMINATIVE))
    {
        offset += 1;
    }
    if offset == name_start || offset >= length {
        return Err(ERROR_MALFORMED);
    }
    let name = NameSpan {
        start: name_start,
        length: offset - name_start,
    };
    offset += 1;

    if !expect(words, start, group_len, &mut offset, QUOTED_GRAMMAR, false)
        || !expect(words, start, group_len, &mut offset, 0, false)
        || !expect_state_text(words, start, group_len, &mut offset)
        || !expect_vector_float32_text(words, start, group_len, &mut offset)
        || !expect_state_text(words, start, group_len, &mut offset)
        || !expect(words, start, group_len, &mut offset, QUOTED_GRAMMAR, false)
        || !expect(words, start, group_len, &mut offset, ESSIVE, true)
        || !expect(words, start, group_len, &mut offset, NUMBER_QUOTE, false)
    {
        return Err(ERROR_UNSUPPORTED);
    }
    let vector_length = token(words, start, group_len, offset).ok_or(ERROR_MALFORMED)? as usize;
    if vector_length == 0 || vector_length > MAX_VECTOR_LANES {
        return Err(ERROR_VECTOR_WIDTH);
    }
    offset += 1;
    if !expect(words, start, group_len, &mut offset, INSTRUMENTAL, true)
        || !expect(words, start, group_len, &mut offset, VARIABLE, false)
        || !expect(words, start, group_len, &mut offset, REALIS, true)
        || offset != length
    {
        return Err(ERROR_MALFORMED);
    }
    Ok((name, vector_length))
}

pub(super) fn mutable_vector_group(
    words: &[u32],
    start: usize,
    group_len: usize,
) -> Option<CoreResult> {
    if token(words, start, group_len, 0) != Some(NAME_TYPE) {
        return None;
    }
    match mutable_vector_declaration(words, start, group_len) {
        Ok((_, length)) => {
            let mut result = CoreResult::empty();
            result.value_kind = VALUE_VECTOR_FLOAT32;
            result.length = length as u32;
            result.consumed_codelets = group_len as u32;
            Some(result)
        }
        Err(error) => Some(CoreResult::failure(error, group_len as u32)),
    }
}
