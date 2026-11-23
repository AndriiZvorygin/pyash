use super::mutable_vector::mutable_vector_declaration;
use super::scalar_product::{scalar_product_destination, scalar_product_group};
use super::vector_group::{interpret_vector_group, vector_name_span};
use super::*;

pub(super) const PLUK: u32 = 0x2a64;
pub(super) const TLAS: u32 = 0x896a;

#[derive(Clone, Copy)]
struct TokenSpan {
    start: usize,
    length: usize,
}

impl TokenSpan {
    const EMPTY: Self = Self {
        start: 0,
        length: 0,
    };
}

#[derive(Clone, Copy)]
struct SentenceField {
    role: u32,
    value: TokenSpan,
}

impl SentenceField {
    const EMPTY: Self = Self {
        role: 0,
        value: TokenSpan::EMPTY,
    };
}

#[derive(Clone, Copy)]
struct ParsedOperation {
    fields: [SentenceField; 9],
    field_count: usize,
    verb: TokenSpan,
}

#[derive(Clone, Copy)]
struct VectorResolution {
    present: u32,
    vector: CoreResult,
    mutable: u32,
    declaration_start: usize,
}

impl VectorResolution {
    const EMPTY: Self = Self {
        present: 0,
        vector: CoreResult::empty(),
        mutable: 0,
        declaration_start: 0,
    };
}

fn is_boundary(words: &[u32], codelet: usize, slot: usize) -> bool {
    let head = word(words, codelet, 0);
    (head & (1 << slot) != 0) == (head & 1 != 0)
}

fn group_length(words: &[u32], start: usize, codelet_count: usize) -> Option<usize> {
    let mut end = start;
    while end < codelet_count && word(words, end, 0) & 1 == 0 {
        end += 1;
    }
    (end < codelet_count).then_some(end - start + 1)
}

fn group_token_count(words: &[u32], start: usize, group_len: usize) -> Option<usize> {
    if group_len == 0 || word(words, start + group_len - 1, 0) & 1 == 0 {
        return None;
    }
    let last = start + group_len - 1;
    let mut last_boundary = 0usize;
    let mut slot = 1;
    while slot < CODELET_WORDS {
        if is_boundary(words, last, slot) {
            last_boundary = slot;
        }
        slot += 1;
    }
    if last_boundary == 0 {
        return None;
    }
    Some((group_len - 1) * (CODELET_WORDS - 1) + last_boundary)
}

fn token_at(words: &[u32], start: usize, group_len: usize, offset: usize) -> Option<u32> {
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

fn boundary_at_token(words: &[u32], start: usize, offset: usize) -> bool {
    let codelet = start + offset / (CODELET_WORDS - 1);
    let slot = offset % (CODELET_WORDS - 1) + 1;
    is_boundary(words, codelet, slot)
}

fn is_case(role: u32) -> bool {
    matches!(
        role,
        NOMINATIVE
            | ACCUSATIVE
            | ESSIVE
            | DESTINATION
            | LOCATIVE
            | SOURCE
            | COMITATIVE
            | INSTRUMENTAL
            | FROM_INDEX
            | TO_INDEX
    )
}

fn is_mood(mood: u32) -> bool {
    matches!(
        mood,
        MOOD_DEFINITION | REALIS | DEONTIC | CONDITIONAL | MOOD_RETURN | MOOD_PARAGRAPH
    )
}

fn operation_suffix(words: &[u32], start: usize, group_len: usize) -> bool {
    let Some(token_count) = group_token_count(words, start, group_len) else {
        return false;
    };
    if token_count < 3 {
        return false;
    }
    let verb_start = token_count - 3;
    token_at(words, start, group_len, verb_start) == Some(PLUK)
        && token_at(words, start, group_len, verb_start + 1) == Some(TLAS)
        && token_at(words, start, group_len, verb_start + 2) == Some(DEONTIC)
        && !boundary_at_token(words, start, verb_start)
        && !boundary_at_token(words, start, verb_start + 1)
        && boundary_at_token(words, start, verb_start + 2)
}

fn parse_operation(
    words: &[u32],
    start: usize,
    group_len: usize,
) -> Result<(ParsedOperation, u32), u32> {
    let token_count = group_token_count(words, start, group_len).ok_or(ERROR_MALFORMED)?;
    let mut parsed = ParsedOperation {
        fields: [SentenceField::EMPTY; 9],
        field_count: 0,
        verb: TokenSpan::EMPTY,
    };
    let mut field_start = 0usize;
    let mut mood = 0;
    let mut index = 0usize;
    while index < token_count {
        let token = token_at(words, start, group_len, index).ok_or(ERROR_MALFORMED)?;
        if boundary_at_token(words, start, index) {
            if is_case(token) {
                if index == field_start || parsed.field_count == parsed.fields.len() {
                    return Err(ERROR_MALFORMED);
                }
                let mut prior = 0;
                while prior < parsed.field_count {
                    if array_at!(parsed.fields, prior).role == token {
                        return Err(ERROR_MALFORMED);
                    }
                    prior += 1;
                }
                array_put!(
                    &mut parsed.fields,
                    parsed.field_count,
                    SentenceField {
                        role: token,
                        value: TokenSpan {
                            start: field_start,
                            length: index - field_start,
                        },
                    }
                );
                parsed.field_count += 1;
                field_start = index + 1;
            } else if is_mood(token) {
                if mood != 0 || index + 1 != token_count {
                    return Err(ERROR_MALFORMED);
                }
                parsed.verb = TokenSpan {
                    start: field_start,
                    length: index - field_start,
                };
                mood = token;
            } else {
                return Err(ERROR_UNSUPPORTED);
            }
        }
        index += 1;
    }
    if mood == 0 || parsed.verb.length == 0 {
        return Err(ERROR_MALFORMED);
    }
    Ok((parsed, mood))
}

fn field(parsed: &ParsedOperation, role: u32) -> Option<TokenSpan> {
    let mut index = 0;
    while index < parsed.field_count {
        let field = array_at!(parsed.fields, index);
        if field.role == role {
            return Some(field.value);
        }
        index += 1;
    }
    None
}

fn field_name(
    words: &[u32],
    start: usize,
    group_len: usize,
    field: TokenSpan,
) -> Result<TokenSpan, u32> {
    if field.length < 2 || token_at(words, start, group_len, field.start) != Some(NAME_TYPE) {
        return Err(ERROR_MALFORMED);
    }
    Ok(TokenSpan {
        start: field.start + 1,
        length: field.length - 1,
    })
}

fn output_name(
    words: &[u32],
    start: usize,
    group_len: usize,
    field: TokenSpan,
) -> Result<TokenSpan, u32> {
    if field.length < 4
        || token_at(words, start, group_len, field.start) != Some(NAME_TYPE)
        || token_at(words, start, group_len, field.start + 2) != Some(NAME_TYPE)
    {
        return Err(ERROR_MALFORMED);
    }
    match token_at(words, start, group_len, field.start + 1) {
        Some(NUMBER_TYPE) => Ok(TokenSpan {
            start: field.start + 3,
            length: field.length - 3,
        }),
        Some(BOOLEAN_TYPE) => Err(ERROR_UNSUPPORTED),
        _ => Err(ERROR_UNSUPPORTED),
    }
}

fn names_equal(
    words: &[u32],
    left_start: usize,
    left_group_len: usize,
    left: TokenSpan,
    right_start: usize,
    right_group_len: usize,
    right: NameSpan,
) -> bool {
    if left.length != right.length {
        return false;
    }
    let mut index = 0;
    while index < left.length {
        if token_at(words, left_start, left_group_len, left.start + index)
            != token_at(words, right_start, right_group_len, right.start + index)
        {
            return false;
        }
        index += 1;
    }
    true
}

fn resolve_vector(
    words: &[u32],
    codelet_count: usize,
    before: usize,
    reference_start: usize,
    reference_group_len: usize,
    reference: TokenSpan,
) -> Result<CoreResult, u32> {
    let mut cursor = 0usize;
    let mut found = VectorResolution::EMPTY;
    while cursor < before {
        let length = group_length(words, cursor, codelet_count).ok_or(ERROR_MALFORMED)?;
        if cursor + length > before {
            return Err(ERROR_MALFORMED);
        }
        if let Some(name) = vector_name_span(words, cursor, length) {
            if names_equal(
                words,
                reference_start,
                reference_group_len,
                reference,
                cursor,
                length,
                name,
            ) {
                if found.present != 0 {
                    return Err(ERROR_MALFORMED);
                }
                let decoded = if length == 1 {
                    super::single_codelet(words, cursor)
                } else {
                    interpret_vector_group(words, cursor, length)
                }
                .ok_or(ERROR_UNSUPPORTED)?;
                if decoded.error != 0 {
                    return Err(decoded.error);
                }
                if decoded.value_kind != VALUE_VECTOR_FLOAT32 {
                    return Err(ERROR_UNSUPPORTED);
                }
                found = VectorResolution {
                    present: 1,
                    vector: decoded,
                    mutable: 0,
                    declaration_start: cursor,
                };
            }
        }
        if let Ok((name, vector_length)) = mutable_vector_declaration(words, cursor, length) {
            if names_equal(
                words,
                reference_start,
                reference_group_len,
                reference,
                cursor,
                length,
                name,
            ) {
                if found.present != 0 {
                    return Err(ERROR_MALFORMED);
                }
                let mut vector = CoreResult::empty();
                vector.value_kind = VALUE_VECTOR_FLOAT32;
                vector.length = vector_length as u32;
                vector.consumed_codelets = length as u32;
                found = VectorResolution {
                    present: 1,
                    vector,
                    mutable: 1,
                    declaration_start: cursor,
                };
            }
        }
        if let Ok(destination) = scalar_product_destination(words, cursor, length) {
            if destination.present != 0
                && names_equal(
                    words,
                    reference_start,
                    reference_group_len,
                    reference,
                    cursor,
                    length,
                    destination.name,
                )
            {
                if found.present == 0 {
                    return Err(ERROR_UNSUPPORTED);
                }
                if found.mutable == 0 {
                    return Err(ERROR_CONSTANT_WRITE);
                }
                if cursor < found.declaration_start
                    || destination.index >= found.vector.length as usize
                {
                    return Err(ERROR_VECTOR_WIDTH);
                }
                let result = scalar_product_group(words, cursor, length, codelet_count)
                    .ok_or(ERROR_UNSUPPORTED)?;
                if result.error != 0 {
                    return Err(result.error);
                }
                if result.value_kind != VALUE_FLOAT32 {
                    return Err(ERROR_UNSUPPORTED);
                }
                let mut vector = found.vector;
                let mut vector_values = vector.values;
                let result_values = result.values;
                array_put!(
                    &mut vector_values,
                    destination.index,
                    array_at!(result_values, 0)
                );
                vector.values = vector_values;
                found.vector = vector;
            }
        }
        cursor += length;
    }
    if found.present == 0 {
        Err(ERROR_UNSUPPORTED)
    } else {
        Ok(found.vector)
    }
}

pub(super) fn pluk_tlas_group(
    words: &[u32],
    start: usize,
    group_len: usize,
    codelet_count: usize,
) -> Option<CoreResult> {
    if !operation_suffix(words, start, group_len) {
        return None;
    }
    let parsed = match parse_operation(words, start, group_len) {
        Ok((parsed, mood)) if mood == DEONTIC => parsed,
        Ok(_) => return Some(CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32)),
        Err(error) => return Some(CoreResult::failure(error, group_len as u32)),
    };
    if parsed.verb.length != 2
        || token_at(words, start, group_len, parsed.verb.start) != Some(PLUK)
        || token_at(words, start, group_len, parsed.verb.start + 1) != Some(TLAS)
        || parsed.field_count != 3
    {
        return Some(CoreResult::failure(ERROR_MALFORMED, group_len as u32));
    }
    let (prediction_field, answer_field, output_field) = match (
        field(&parsed, ACCUSATIVE),
        field(&parsed, INSTRUMENTAL),
        field(&parsed, DESTINATION),
    ) {
        (Some(prediction), Some(answer), Some(output)) => (prediction, answer, output),
        _ => return Some(CoreResult::failure(ERROR_MALFORMED, group_len as u32)),
    };
    let prediction_name = match field_name(words, start, group_len, prediction_field) {
        Ok(name) => name,
        Err(error) => return Some(CoreResult::failure(error, group_len as u32)),
    };
    let answer_name = match field_name(words, start, group_len, answer_field) {
        Ok(name) => name,
        Err(error) => return Some(CoreResult::failure(error, group_len as u32)),
    };
    if let Err(error) = output_name(words, start, group_len, output_field) {
        return Some(CoreResult::failure(error, group_len as u32));
    }
    let prediction = match resolve_vector(
        words,
        codelet_count,
        start,
        start,
        group_len,
        prediction_name,
    ) {
        Ok(vector) => vector,
        Err(error) => return Some(CoreResult::failure(error, group_len as u32)),
    };
    let answer = match resolve_vector(words, codelet_count, start, start, group_len, answer_name) {
        Ok(vector) => vector,
        Err(error) => return Some(CoreResult::failure(error, group_len as u32)),
    };
    if prediction.length != answer.length {
        return Some(CoreResult::failure(ERROR_VECTOR_WIDTH, group_len as u32));
    }
    let mut correct = 0u32;
    let mut lane = 0;
    while lane < prediction.length as usize {
        if f32::from_bits(array_at!(prediction.values, lane))
            == f32::from_bits(array_at!(answer.values, lane))
        {
            correct += 1;
        }
        lane += 1;
    }
    Some(CoreResult::scalar(
        VALUE_UNSIGNED,
        correct,
        0,
        group_len as u32,
    ))
}
