//! Canonical (runtime) encoding of an operation signature.
//!
//! # The dispatch identity
//!
//! ```text
//! dispatch identity = verb + mood + sorted[(grammatical_case, noun_class)]
//! ```
//!
//! The noun class is the discriminator, not a coarse scalar type: a slot accepts
//! a *class* of value (`name_`, `number_`, `text_`, `vector`, …), and dispatch
//! compares that class. `SignatureView` is the runtime encoding of this
//! identity; `OperationSignatureKey` in `pyac`'s `dictionary::operation` is the
//! dictionary encoding. They describe the same key:
//!
//! - dictionary: `Vec<u16>` of HNUCs, one sequence per case and per class;
//! - runtime here: one packed `u32` per case (see `pack_quote_noun_class` and
//!   `pack_word_noun_class`).
//!
//! Both are derived from the same sentence, so a change to one is a change to
//! the other. Never compare a packed value against an unpacked one.
//!
//! # The case is also encoded differently
//!
//! The dictionary keys a slot with `grammatical_case: Vec<u16>` — a sequence,
//! because a case can in principle be written as more than one word. Here
//! `SignatureCase.case` is one `u32`: the boundary word that closes the field.
//! That is the word whose boundary bit marks the end of the phrase, and it is
//! what `case_type` compares. Today the dictionary's sequence always holds
//! exactly that one word, so the two agree; if a multi-word case appears, this
//! is where the encodings would have to be reconciled.
//!
//! # Arguments versus results
//!
//! Only *inputs* are in the key. A signature's arguments are case-keyed, and
//! their cases must match the caller's; results are outputs keyed by noun class
//! and never take part in dispatch. Input versus output is the case axis, not
//! the mood — a mood is not a direction.

use super::numeric::quote_header;
use super::*;

const MAX_SIGNATURE_CASES: usize = 8;
/// The field holds a name, with no further class word.
pub(super) const TYPE_NAME: u32 = 1;
/// The field holds a name whose payload is a number.
pub(super) const TYPE_NAME_NUMBER: u32 = 2;
/// The field holds a name whose payload is a boolean.
pub(super) const TYPE_NAME_BOOLEAN: u32 = 3;
/// The field holds a boolean.
pub(super) const TYPE_BOOLEAN: u32 = 4;
/// The field holds a dependent clause.
pub(super) const TYPE_CLAUSE: u32 = 5;
/// The field holds a variable reference.
const TYPE_VARIABLE: u32 = 6;
/// Set when the class is a quoted literal; the sort, width, and vector flag
/// pack into the lower bits.
pub(super) const TYPE_QUOTE_TAG: u32 = 0x1000_0000;
/// Set when the class is a bare vocabulary word; the HNUC packs into the lower
/// 16 bits.
const TYPE_WORD_TAG: u32 = 0x2000_0000;

/// Pack a quoted literal's noun class.
///
/// `sort` and `scalar_bytes` come from the quote header, and `vector` is 1 when
/// the quote opens a vector rather than a scalar. The layout is
/// `TYPE_QUOTE_TAG | sort << 12 | scalar_bytes << 4 | vector`.
pub(super) fn pack_quote_noun_class(sort: u32, scalar_bytes: u32, vector: bool) -> u32 {
    TYPE_QUOTE_TAG | ((sort & 0xf) << 12) | ((scalar_bytes & 0xff) << 4) | u32::from(vector)
}

/// Pack a bare vocabulary word's noun class. The HNUC occupies the low 16 bits.
pub(super) fn pack_word_noun_class(hnuc: u32) -> u32 {
    TYPE_WORD_TAG | (hnuc & 0xffff)
}

/// Unpack a noun class into the sort, width, and vector flag of a quoted
/// literal, or `None` when the class is not a quote.
#[cfg(test)]
pub(super) fn unpack_quote_noun_class(class: u32) -> Option<(u32, u32, bool)> {
    if class & TYPE_QUOTE_TAG == 0 {
        return None;
    }
    Some(((class >> 12) & 0xf, (class >> 4) & 0xff, class & 1 != 0))
}

/// Unpack a bare-word noun class into its HNUC, or `None` for any other class.
#[cfg(test)]
pub(super) fn unpack_word_noun_class(class: u32) -> Option<u32> {
    if class & TYPE_WORD_TAG == 0 {
        return None;
    }
    Some(class & 0xffff)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct SignatureCase {
    pub(super) case: u32,
    /// The packed noun class; see the module comment.
    pub(super) noun_class: u32,
}

impl SignatureCase {
    const EMPTY: Self = Self {
        case: 0,
        noun_class: 0,
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
    words: &[impl VliwWord],
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

pub(super) fn token_boundary(words: &[impl VliwWord], start: usize, offset: usize) -> bool {
    let codelet = start + offset / (CODELET_WORDS - 1);
    let slot = offset % (CODELET_WORDS - 1) + 1;
    let header = word(words, codelet, 0);
    (header & (1 << slot) != 0) == (header & 1 != 0)
}

fn token_count(words: &[impl VliwWord], start: usize, group_len: usize) -> Result<usize, u32> {
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

fn noun_class(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    case: u32,
    value_start: usize,
    value_length: usize,
) -> Result<u32, u32> {
    let first = token_at(words, start, group_len, value_start).ok_or(ERROR_MALFORMED)?;
    // `<class words…> [gi] <name>`: the class words say what the field holds and
    // `gi` marks the name. `gi` alone is an untyped name.
    // Ordinary Pyash typed names are encoded as `gi <class…> gi <name>`.
    // Programlet internals also use class-first fields, so continue parsing
    // class words at the beginning when there is no leading name marker.
    let mut index = value_start + usize::from(first == NAME_TYPE);
    let mut class_type = 0u32;
    while index < value_start + value_length {
        match token_at(words, start, group_len, index) {
            Some(BOOLEAN_TYPE) => {
                class_type = TYPE_NAME_BOOLEAN;
                index += 1;
            }
            Some(word) if is_width_word(word) => {
                class_type = TYPE_NAME_NUMBER;
                index += 1;
            }
            _ => break,
        }
    }
    if class_type != 0 {
        if token_at(words, start, group_len, index) == Some(NAME_TYPE) {
            index += 1;
        }
        if index >= value_start + value_length {
            return Err(ERROR_MALFORMED);
        }
        return Ok(class_type);
    }
    if first == NAME_TYPE {
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
        return Ok(pack_word_noun_class(NUMBER_TYPE));
    }
    if first == BOOLEAN_TYPE {
        return Ok(TYPE_BOOLEAN);
    }
    if case == NOMINATIVE {
        return Ok(TYPE_NAME);
    }
    let quote = quote_header(first);
    if quote.valid != 0 {
        let vector = first & 0x0700 != 0;
        return Ok(pack_quote_noun_class(
            quote.sort,
            quote.scalar_bytes,
            vector,
        ));
    }
    Ok(TYPE_WORD_TAG)
}

pub(super) fn signature(words: &[impl VliwWord], start: usize, group_len: usize) -> SignatureView {
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
        let noun_class = match noun_class(
            words,
            start,
            group_len,
            token,
            field_start,
            index - field_start,
        ) {
            Ok(noun_class) => noun_class,
            Err(error) => return SignatureView::failure(error),
        };
        let entry = SignatureCase {
            case: token,
            noun_class,
        };
        let mut insert = view.case_count;
        while insert > 0 && array_at!(view.cases, insert - 1).case > entry.case {
            let previous = array_at!(view.cases, insert - 1);
            array_put!(&mut view.cases, insert, previous);
            insert -= 1;
        }
        if (insert > 0 && array_at!(view.cases, insert - 1).case == entry.case)
            || (insert < view.case_count && array_at!(view.cases, insert).case == entry.case)
        {
            return SignatureView::failure(ERROR_MALFORMED);
        }
        array_put!(&mut view.cases, insert, entry);
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
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    first: u32,
    second: Option<u32>,
) -> bool {
    if signature.verb_length != if second.is_some() { 2 } else { 1 }
        || token_at(words, start, group_len, signature.verb_start) != Some(first)
    {
        return false;
    }
    match second {
        Some(word) => token_at(words, start, group_len, signature.verb_start + 1) == Some(word),
        None => true,
    }
}

pub(super) fn case_type(signature: &SignatureView, case: u32) -> Option<u32> {
    let mut index = 0;
    while index < signature.case_count {
        let entry = array_at!(signature.cases, index);
        if entry.case == case {
            return Some(entry.noun_class);
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
        let Some((case, noun_class)) = expected_pair(expected, index) else {
            return false;
        };
        if case_type(signature, case) != Some(noun_class) {
            return false;
        }
        index += 1;
    }
    true
}

fn expected_pair<const N: usize>(expected: &[(u32, u32); N], index: usize) -> Option<(u32, u32)> {
    if index >= N {
        return None;
    }
    #[cfg(target_arch = "spirv")]
    {
        // SAFETY: the length guard above proves the const-sized array index is valid.
        Some(unsafe {
            *<[(u32, u32); N] as spirv_std::arch::IndexUnchecked<(u32, u32)>>::index_unchecked(
                expected, index,
            )
        })
    }
    #[cfg(not(target_arch = "spirv"))]
    {
        Some(expected[index])
    }
}

#[cfg(test)]
#[path = "tests/canonical_signature.rs"]
mod tests;
