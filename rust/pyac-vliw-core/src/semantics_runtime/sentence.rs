use super::*;

pub(super) fn collect_sentence(
    words: &[u32],
    codelet_count: usize,
    start: usize,
    tokens: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
) -> Result<(usize, usize), u32> {
    collect_sentence_at(
        words,
        codelet_count,
        0,
        codelet_count,
        start,
        tokens,
        boundaries,
    )
}

pub(super) fn collect_sentence_at(
    words: &[u32],
    total_codelet_count: usize,
    base_codelet: usize,
    window_codelet_count: usize,
    start: usize,
    tokens: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
) -> Result<(usize, usize), u32> {
    if start >= window_codelet_count
        || base_codelet > total_codelet_count
        || window_codelet_count > total_codelet_count - base_codelet
        || total_codelet_count > words.len() / CODELET_WORDS
    {
        return Err(ERROR_MALFORMED);
    }
    let mut token_count = 0;
    let mut codelet = start;
    loop {
        if codelet >= window_codelet_count {
            return Err(ERROR_MALFORMED);
        }
        let absolute_codelet = base_codelet + codelet;
        let header = word(words, absolute_codelet, 0);
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
            let value = word(words, absolute_codelet, slot);
            if value > MAX_U16 {
                return Err(ERROR_MALFORMED);
            }
            array_put!(tokens, token_count, value);
            array_put!(
                boundaries,
                token_count,
                u32::from((header & (1 << slot) != 0) == complete)
            );
            token_count += 1;
            slot += 1;
        }
        codelet += 1;
        if complete {
            return Ok((token_count, codelet));
        }
    }
}

pub(super) fn parse_sentence(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &[u32; PROGRAMLET_SCRATCH_WORDS],
    length: usize,
    parsed: &mut ParsedSentence,
) -> u32 {
    parse_sentence_range(tokens, boundaries, 0, length, parsed)
}

pub(super) fn parse_sentence_range(
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
        if array_at!(tokens, index) == DEPENDENT_CLAUSE {
            let Some(tail) = clause_tail(tokens, index, end) else {
                return ERROR_MALFORMED;
            };
            index = tail + 1;
            continue;
        }
        if array_at!(tokens, index) == CLAUSE_TAIL {
            return ERROR_MALFORMED;
        }
        if array_at!(boundaries, index) == 0 {
            index += 1;
            continue;
        }
        let token = array_at!(tokens, index);
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
                if array_at!(result.fields, prior).role == token {
                    return ERROR_MALFORMED;
                }
                prior += 1;
            }
            array_put!(
                &mut result.fields,
                result.field_count,
                SentenceField {
                    role: token,
                    start: value_start,
                    length: index - value_start,
                }
            );
            result.field_count += 1;
            value_start = index + 1;
        } else if matches!(
            token,
            MOOD_DEFINITION | REALIS | DEONTIC | CONDITIONAL | MOOD_RETURN | MOOD_PARAGRAPH
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

pub(super) fn clause_tail(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    start: usize,
    end: usize,
) -> Option<usize> {
    let mut depth = 0usize;
    let mut index = start;
    while index < end {
        if array_at!(tokens, index) == DEPENDENT_CLAUSE {
            depth += 1;
        } else if array_at!(tokens, index) == CLAUSE_TAIL {
            if depth == 0 {
                return None;
            }
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
        index += 1;
    }
    None
}

pub(super) fn embedded_clause_range(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
) -> Result<(usize, usize), u32> {
    let Some(end) = field.start.checked_add(field.length) else {
        return Err(ERROR_MALFORMED);
    };
    if field.length < 3 || array_at!(tokens, field.start) != DEPENDENT_CLAUSE {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(tail) = clause_tail(tokens, field.start, end) else {
        return Err(ERROR_MALFORMED);
    };
    if tail + 1 != end {
        return Err(ERROR_MALFORMED);
    }
    Ok((field.start + 1, tail))
}

pub(super) fn next_sentence_is_paragraph_end(
    words: &[u32],
    codelet_count: usize,
    base_codelet: usize,
    start: usize,
    routine_end: usize,
    tokens: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
) -> Result<bool, u32> {
    if start >= routine_end {
        return Ok(false);
    }
    let (length, _) = collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        start,
        tokens,
        boundaries,
    )?;
    let mut next = ParsedSentence::empty();
    let error = parse_sentence(tokens, boundaries, length, &mut next);
    if error != 0 {
        return Err(error);
    }
    Ok(next.mood == MOOD_PARAGRAPH)
}

pub(super) fn contains_marked_token(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &[u32; PROGRAMLET_SCRATCH_WORDS],
    length: usize,
    target: u32,
) -> bool {
    let mut index = 0;
    while index < length {
        if array_at!(boundaries, index) != 0 && array_at!(tokens, index) == target {
            return true;
        }
        index += 1;
    }
    false
}

pub(super) fn name_span(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
    typed_number: bool,
    name: &mut NameSpan,
) -> u32 {
    let Some(end) = field.start.checked_add(field.length) else {
        return ERROR_MALFORMED;
    };
    if field.length < 2 || end > tokens.len() || array_at!(tokens, field.start) != NAME_TYPE {
        return ERROR_MALFORMED;
    }
    let mut marker = field.start + 1;
    while marker < end && array_at!(tokens, marker) != NAME_TYPE {
        marker += 1;
    }
    let name_start = if marker < end {
        if !typed_number
            || marker != field.start + 2
            || !matches!(
                array_at!(tokens, field.start + 1),
                NUMBER_TYPE | BOOLEAN_TYPE
            )
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

pub(super) fn typed_output_name(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
    name: &mut NameSpan,
    kind: &mut u32,
) -> u32 {
    if field.length < 4
        || array_at!(tokens, field.start) != NAME_TYPE
        || array_at!(tokens, field.start + 2) != NAME_TYPE
    {
        return ERROR_MALFORMED;
    }
    let output_kind = match array_at!(tokens, field.start + 1) {
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
