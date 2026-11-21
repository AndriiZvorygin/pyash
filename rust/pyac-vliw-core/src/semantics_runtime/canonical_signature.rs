use super::numeric::quote_header;
use super::*;

const MAX_SIGNATURE_CASES: usize = 8;
pub(super) const TYPE_NAME: u32 = 1;
pub(super) const TYPE_NAME_NUMBER: u32 = 2;
pub(super) const TYPE_NAME_BOOLEAN: u32 = 3;
pub(super) const TYPE_BOOLEAN: u32 = 4;
pub(super) const TYPE_CLAUSE: u32 = 5;
const TYPE_VARIABLE: u32 = 6;
pub(super) const TYPE_QUOTE_TAG: u32 = 0x1000_0000;
const TYPE_WORD_TAG: u32 = 0x2000_0000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct SignatureCase {
    pub(super) case: u32,
    pub(super) value_type: u32,
}

impl SignatureCase {
    const EMPTY: Self = Self {
        case: 0,
        value_type: 0,
    };
}

#[derive(Clone, Copy)]
pub(super) struct SignatureView {
    pub(super) error: u32,
    pub(super) verb_start: usize,
    pub(super) verb_length: usize,
    pub(super) cases: [SignatureCase; MAX_SIGNATURE_CASES],
    pub(super) case_count: usize,
    pub(super) mood: u32,
}

impl SignatureView {
    const EMPTY: Self = Self {
        error: 0,
        verb_start: 0,
        verb_length: 0,
        cases: [SignatureCase::EMPTY; MAX_SIGNATURE_CASES],
        case_count: 0,
        mood: 0,
    };

    fn failure(error: u32) -> Self {
        Self {
            error,
            ..Self::EMPTY
        }
    }
}

pub(super) fn token_at(
    words: &[u32],
    start: usize,
    group_len: usize,
    offset: usize,
) -> Option<u32> {
    let codelet = start.checked_add(offset / (CODELET_WORDS - 1))?;
    let slot = offset % (CODELET_WORDS - 1) + 1;
    if codelet >= start + group_len || codelet * CODELET_WORDS + slot >= words.len() {
        return None;
    }
    let value = word(words, codelet, slot);
    (value <= MAX_U16).then_some(value)
}

pub(super) fn token_boundary(words: &[u32], start: usize, offset: usize) -> bool {
    let codelet = start + offset / (CODELET_WORDS - 1);
    let slot = offset % (CODELET_WORDS - 1) + 1;
    let header = word(words, codelet, 0);
    (header & (1 << slot) != 0) == (header & 1 != 0)
}

fn token_count(words: &[u32], start: usize, group_len: usize) -> Result<usize, u32> {
    if group_len == 0
        || start > words.len() / CODELET_WORDS
        || group_len > words.len() / CODELET_WORDS - start
    {
        return Err(ERROR_MALFORMED);
    }
    let last = start + group_len - 1;
    let header = word(words, last, 0);
    if header & 1 == 0 {
        return Err(ERROR_MALFORMED);
    }
    let mut last_boundary = 0;
    let mut slot = 1;
    while slot < CODELET_WORDS {
        if header & (1 << slot) != 0 {
            last_boundary = slot;
        }
        slot += 1;
    }
    if last_boundary == 0 {
        return Err(ERROR_MALFORMED);
    }
    Ok((group_len - 1) * (CODELET_WORDS - 1) + last_boundary)
}

fn is_mood(word: u32) -> bool {
    matches!(
        word,
        MOOD_DEFINITION | REALIS | DEONTIC | CONDITIONAL | MOOD_RETURN | MOOD_PARAGRAPH
    )
}

fn value_type(
    words: &[u32],
    start: usize,
    group_len: usize,
    case: u32,
    value_start: usize,
    value_length: usize,
) -> Result<u32, u32> {
    let first = token_at(words, start, group_len, value_start).ok_or(ERROR_MALFORMED)?;
    if first == NAME_TYPE {
        if value_length >= 3
            && token_at(words, start, group_len, value_start + 1) == Some(NUMBER_TYPE)
            && token_at(words, start, group_len, value_start + 2) == Some(NAME_TYPE)
        {
            return Ok(TYPE_NAME_NUMBER);
        }
        if value_length >= 3
            && token_at(words, start, group_len, value_start + 1) == Some(BOOLEAN_TYPE)
            && token_at(words, start, group_len, value_start + 2) == Some(NAME_TYPE)
        {
            return Ok(TYPE_NAME_BOOLEAN);
        }
        return Ok(TYPE_NAME);
    }
    if first == DEPENDENT_CLAUSE {
        return Ok(TYPE_CLAUSE);
    }
    if first == VARIABLE {
        return Ok(TYPE_VARIABLE);
    }
    if matches!(first, TRUTH | LIE) {
        return Ok(TYPE_BOOLEAN);
    }
    if first == NUMBER_TYPE {
        return Ok(TYPE_WORD_TAG | NUMBER_TYPE);
    }
    if first == BOOLEAN_TYPE {
        return Ok(TYPE_BOOLEAN);
    }
    if case == NOMINATIVE {
        return Ok(TYPE_NAME);
    }
    let quote = quote_header(first);
    if quote.valid != 0 {
        let vector = u32::from(first & 0x0700 != 0);
        return Ok(TYPE_QUOTE_TAG | (quote.sort << 12) | (quote.scalar_bytes << 4) | vector);
    }
    Ok(TYPE_WORD_TAG)
}

pub(super) fn signature(words: &[u32], start: usize, group_len: usize) -> SignatureView {
    let length = match token_count(words, start, group_len) {
        Ok(length) => length,
        Err(error) => return SignatureView::failure(error),
    };
    let mut view = SignatureView::EMPTY;
    let mut field_start = 0;
    let mut nested_clause_depth = 0usize;
    let mut index = 0;
    while index < length {
        let Some(token) = token_at(words, start, group_len, index) else {
            return SignatureView::failure(ERROR_MALFORMED);
        };
        if token == DEPENDENT_CLAUSE {
            nested_clause_depth += 1;
            index += 1;
            continue;
        }
        if token == CLAUSE_TAIL {
            if nested_clause_depth == 0 {
                return SignatureView::failure(ERROR_MALFORMED);
            }
            nested_clause_depth -= 1;
            index += 1;
            continue;
        }
        if nested_clause_depth != 0 || !token_boundary(words, start, index) {
            index += 1;
            continue;
        }
        if is_mood(token) {
            if index + 1 != length || view.mood != 0 || field_start > index {
                return SignatureView::failure(ERROR_MALFORMED);
            }
            view.verb_start = field_start;
            view.verb_length = index - field_start;
            view.mood = token;
            index += 1;
            continue;
        }
        if field_start >= index || view.case_count == MAX_SIGNATURE_CASES {
            return SignatureView::failure(ERROR_MALFORMED);
        }
        let value_type = match value_type(
            words,
            start,
            group_len,
            token,
            field_start,
            index - field_start,
        ) {
            Ok(value_type) => value_type,
            Err(error) => return SignatureView::failure(error),
        };
        let entry = SignatureCase {
            case: token,
            value_type,
        };
        let mut insert = view.case_count;
        while insert > 0 && view.cases[insert - 1].case > entry.case {
            view.cases[insert] = view.cases[insert - 1];
            insert -= 1;
        }
        if (insert > 0 && view.cases[insert - 1].case == entry.case)
            || (insert < view.case_count && view.cases[insert].case == entry.case)
        {
            return SignatureView::failure(ERROR_MALFORMED);
        }
        view.cases[insert] = entry;
        view.case_count += 1;
        field_start = index + 1;
        index += 1;
    }
    if nested_clause_depth != 0 || view.mood == 0 {
        return SignatureView::failure(ERROR_MALFORMED);
    }
    view
}

pub(super) fn verb_is(
    signature: &SignatureView,
    words: &[u32],
    start: usize,
    group_len: usize,
    first: u32,
    second: Option<u32>,
) -> bool {
    let expected_length = if second.is_some() { 2 } else { 1 };
    signature.verb_length == expected_length
        && token_at(words, start, group_len, signature.verb_start) == Some(first)
        && second.is_none_or(|word| {
            token_at(words, start, group_len, signature.verb_start + 1) == Some(word)
        })
}

pub(super) fn case_type(signature: &SignatureView, case: u32) -> Option<u32> {
    let mut index = 0;
    while index < signature.case_count {
        if signature.cases[index].case == case {
            return Some(signature.cases[index].value_type);
        }
        index += 1;
    }
    None
}

pub(super) fn has_cases<const N: usize>(
    signature: &SignatureView,
    expected: &[(u32, u32); N],
) -> bool {
    if signature.case_count != N {
        return false;
    }
    let mut index = 0;
    while index < N {
        if case_type(signature, expected[index].0) != Some(expected[index].1) {
            return false;
        }
        index += 1;
    }
    true
}

#[cfg(test)]
#[path = "tests/canonical_signature.rs"]
mod tests;
