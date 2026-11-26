use super::canonical_signature::{
    SignatureView, TYPE_BOOLEAN, TYPE_CLAUSE, TYPE_NAME, TYPE_NAME_NUMBER, TYPE_QUOTE_TAG,
    case_type, has_cases, signature, token_at, token_boundary, verb_is,
};
use super::embedding_lookup::{LOOKUP_FIRST, LOOKUP_SECOND};
use super::iwsp_vector_ops::{MAXIMUM_VERB_FIRST, MAXIMUM_VERB_SECOND, SUM_VERB};
use super::numeric::quote_header;
use super::pluk_tlas::{PLUK, TLAS};
use super::scalar_product::{PRODUCE_WORD, SCALAR_WORD};
use super::vector_group::VECTOR_VERB;
use super::*;

const TYPE_FIXED16: u32 = TYPE_QUOTE_TAG | (6 << 12) | (2 << 4);
const TYPE_FLOAT32: u32 = TYPE_QUOTE_TAG | (6 << 12) | (4 << 4);
const TYPE_FLOAT64: u32 = TYPE_QUOTE_TAG | (6 << 12) | (8 << 4);
const TYPE_UINT16: u32 = TYPE_QUOTE_TAG | (4 << 12) | (2 << 4);
const TYPE_VECTOR_UINT16: u32 = TYPE_UINT16 | 1;
const TYPE_VECTOR_FLOAT32: u32 = TYPE_FLOAT32 | 1;
const TYPE_VECTOR_FLOAT64: u32 = TYPE_FLOAT64 | 1;

pub(super) const ROUTE_PLUK_TLAS: u32 = 0x100;
pub(super) const ROUTE_SCALAR_PRODUCT: u32 = 0x101;
pub(super) const ROUTE_MUTABLE_VECTOR: u32 = 0x102;
pub(super) const ROUTE_FIXED16: u32 = 0x103;
pub(super) const ROUTE_FLOAT: u32 = 0x104;
pub(super) const ROUTE_VECTOR_LITERAL: u32 = 0x105;
pub(super) const ROUTE_BOOLEAN_COMPOSITION: u32 = 0x106;
pub(super) const ROUTE_BOOLEAN_COMPARISON: u32 = 0x107;
pub(super) const ROUTE_CONDITIONAL: u32 = 0x108;
pub(super) const ROUTE_INVERT: u32 = 0x109;
pub(super) const ROUTE_VECTOR_ARITHMETIC: u32 = 0x10a;
pub(super) const ROUTE_ARITHMETIC: u32 = 0x10b;
pub(super) const ROUTE_BOOLEAN_LITERAL: u32 = 0x10c;
pub(super) const ROUTE_LITERAL: u32 = 0x10d;
pub(super) const ROUTE_VECTOR_FLOAT_ARITHMETIC: u32 = 0x10e;
pub(super) const ROUTE_VECTOR_SUM: u32 = 0x10f;
pub(super) const ROUTE_VECTOR_MAXIMUM: u32 = 0x110;
pub(super) const ROUTE_VECTOR_ARGMAX: u32 = 0x111;
pub(super) const ROUTE_EMBEDDING_LOOKUP: u32 = 0x112;

const VERB_PLUK_TLAS: u32 = 1;
const VERB_SCALAR_PRODUCT: u32 = 2;
const VERB_MUTABLE_VECTOR: u32 = 3;
const VERB_ARITHMETIC: u32 = 4;
const VERB_INVERT: u32 = 5;
const VERB_BOOLEAN_COMPARISON: u32 = 6;
const VERB_BOOLEAN_COMPOSITION: u32 = 7;
const VERB_BOOLEAN_LITERAL: u32 = 8;
const VERB_LITERAL: u32 = 9;
const VERB_VECTOR_SUM: u32 = 10;
const VERB_VECTOR_MAXIMUM: u32 = 11;
const VERB_EMBEDDING_LOOKUP: u32 = 12;
const VERB_UNSUPPORTED: u32 = 0;

fn classify_verb(
    signature: &SignatureView,
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
) -> u32 {
    if verb_is(signature, words, start, group_len, PLUK, Some(TLAS)) {
        return VERB_PLUK_TLAS;
    }
    if verb_is(
        signature,
        words,
        start,
        group_len,
        MAXIMUM_VERB_FIRST,
        Some(MAXIMUM_VERB_SECOND),
    ) {
        return VERB_VECTOR_MAXIMUM;
    }
    if verb_is(
        signature,
        words,
        start,
        group_len,
        SCALAR_WORD,
        Some(PRODUCE_WORD),
    ) {
        return VERB_SCALAR_PRODUCT;
    }
    if verb_is(
        signature,
        words,
        start,
        group_len,
        LOOKUP_FIRST,
        Some(LOOKUP_SECOND),
    ) {
        return VERB_EMBEDDING_LOOKUP;
    }
    if signature.verb_length == 0 {
        return VERB_LITERAL;
    }
    if signature.verb_length != 1 {
        return VERB_UNSUPPORTED;
    }
    let Some(verb) = token_at(words, start, group_len, signature.verb_start) else {
        return VERB_UNSUPPORTED;
    };
    match verb {
        VARIABLE => VERB_MUTABLE_VECTOR,
        PLUS | SUBTRACT | MULTIPLY | DIVIDE | XOR | EXPONENTIAL | REMAINS => VERB_ARITHMETIC,
        INVERT => VERB_INVERT,
        EQUALLY | TINY | GIANT => VERB_BOOLEAN_COMPARISON,
        NEGATORY_QUANTIFIER | AND_GRAMMAR | OR_GRAMMAR => VERB_BOOLEAN_COMPOSITION,
        NUMBER_VERB | BOOLEAN_VERB => VERB_BOOLEAN_LITERAL,
        SUM_VERB => VERB_VECTOR_SUM,
        VECTOR_VERB => VERB_LITERAL,
        _ => VERB_UNSUPPORTED,
    }
}

fn has_boundary_word(words: &[impl VliwWord], start: usize, group_len: usize, target: u32) -> bool {
    let capacity = group_len * (CODELET_WORDS - 1);
    let mut index = 0;
    while index < capacity {
        if token_boundary(words, start, index)
            && token_at(words, start, group_len, index) == Some(target)
        {
            return true;
        }
        index += 1;
    }
    false
}

fn is_multicodelet_vector_literal(words: &[impl VliwWord], start: usize, group_len: usize) -> bool {
    if group_len < 2 {
        return false;
    }
    let Some(header_word) = token_at(words, start, group_len, 0) else {
        return false;
    };
    let header = quote_header(header_word);
    if header.valid == 0 || header_word & 0x0700 == 0 {
        return false;
    }
    let length = if header.explicit != 0 {
        match token_at(words, start, group_len, 1) {
            Some(length) => length as usize,
            None => return false,
        }
    } else {
        let scalar_words = header.scalar_bytes as usize / 2;
        if scalar_words == 0
            || (header.fixed_length as usize)
                .checked_rem(scalar_words)
                .unwrap_or(1)
                != 0
        {
            return false;
        }
        match (header.fixed_length as usize).checked_div(scalar_words) {
            Some(length) => length,
            None => return false,
        }
    };
    if length == 0 || length > MAX_VECTOR_LANES {
        return true;
    }
    let payload_start = if header.explicit != 0 { 2 } else { 1 };
    let payload_words = length * (header.scalar_bytes as usize / 2);
    let case_offset = payload_start + payload_words;
    token_at(words, start, group_len, case_offset) == Some(ACCUSATIVE)
        && (token_at(words, start, group_len, case_offset + 1) == Some(REALIS)
            || (token_at(words, start, group_len, case_offset + 1) == Some(VECTOR_VERB)
                && token_at(words, start, group_len, case_offset + 2) == Some(REALIS)))
}

fn other_operand_type(signature: &SignatureView, primary_case: u32) -> Option<u32> {
    if signature.case_count != 2 {
        return None;
    }
    let mut index = 0;
    while index < signature.case_count {
        if array_at!(signature.cases, index).case == primary_case {
            let other = 1 - index;
            return Some(array_at!(signature.cases, other).value_type);
        }
        index += 1;
    }
    None
}

fn arithmetic_route(signature: &SignatureView) -> Result<u32, u32> {
    if signature.case_count != 2 {
        return Err(ERROR_UNSUPPORTED);
    }
    let left = case_type(signature, ACCUSATIVE).ok_or(ERROR_UNSUPPORTED)?;
    let right = other_operand_type(signature, ACCUSATIVE).ok_or(ERROR_UNSUPPORTED)?;
    if left == right {
        match left {
            TYPE_FIXED16 => return Ok(ROUTE_FIXED16),
            TYPE_FLOAT32 | TYPE_FLOAT64 => return Ok(ROUTE_FLOAT),
            TYPE_UINT16 => return Ok(ROUTE_ARITHMETIC),
            _ => {}
        }
    }
    if (left == TYPE_NAME
        && matches!(
            right,
            TYPE_NAME | TYPE_FLOAT32 | TYPE_FLOAT64 | TYPE_VECTOR_FLOAT32 | TYPE_VECTOR_FLOAT64
        ))
        || (matches!(left, TYPE_VECTOR_FLOAT32 | TYPE_VECTOR_FLOAT64)
            && matches!(
                right,
                TYPE_NAME
                    | TYPE_FLOAT32
                    | TYPE_FLOAT64
                    | TYPE_UINT16
                    | TYPE_VECTOR_FLOAT32
                    | TYPE_VECTOR_FLOAT64
            ))
    {
        return Ok(ROUTE_VECTOR_FLOAT_ARITHMETIC);
    }
    let mut index = 0;
    while index < signature.case_count {
        if array_at!(signature.cases, index).value_type == TYPE_VECTOR_UINT16 {
            return Ok(ROUTE_VECTOR_ARITHMETIC);
        }
        index += 1;
    }
    Err(ERROR_UNSUPPORTED)
}

fn literal_route(signature: &SignatureView, group_len: usize) -> Result<u32, u32> {
    let Some(value_type) = case_type(signature, ACCUSATIVE) else {
        return Err(ERROR_UNSUPPORTED);
    };
    if value_type & TYPE_QUOTE_TAG == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    if value_type & 1 != 0 && group_len > 1 {
        return Ok(ROUTE_VECTOR_LITERAL);
    }
    if matches!(value_type & !1, TYPE_FLOAT32 | TYPE_FLOAT64) {
        return Ok(ROUTE_FLOAT);
    }
    if value_type == TYPE_FIXED16 {
        return Ok(ROUTE_FIXED16);
    }
    Ok(ROUTE_LITERAL)
}

pub(super) fn select_signature_route(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
) -> Result<u32, u32> {
    // These forms carry their signature across continuation codelets; route by
    // the quote header and closing case before interpreting payload as tokens.
    if is_multicodelet_vector_literal(words, start, group_len) {
        return Ok(ROUTE_VECTOR_LITERAL);
    }
    // Conditional branches are a programlet control-flow encoding, not an
    // ordinary operation signature.
    if group_len > 1 && has_boundary_word(words, start, group_len, CONDITIONAL) {
        return Ok(ROUTE_CONDITIONAL);
    }

    let signature = signature(words, start, group_len);
    if signature.error != 0 {
        return Err(signature.error);
    }
    match classify_verb(&signature, words, start, group_len) {
        VERB_PLUK_TLAS
            if has_cases(
                &signature,
                &[
                    (ACCUSATIVE, TYPE_NAME),
                    (DESTINATION, TYPE_NAME_NUMBER),
                    (INSTRUMENTAL, TYPE_NAME),
                ],
            ) =>
        {
            Ok(ROUTE_PLUK_TLAS)
        }
        VERB_SCALAR_PRODUCT
            if case_type(&signature, ACCUSATIVE).is_some()
                && case_type(&signature, INSTRUMENTAL).is_some() =>
        {
            Ok(ROUTE_SCALAR_PRODUCT)
        }
        VERB_EMBEDDING_LOOKUP
            if signature.mood == DEONTIC
                && ((signature.case_count == 3
                    && matches!(
                        case_type(&signature, LOCATIVE),
                        Some(TYPE_UINT16) | Some(TYPE_NAME)
                    ))
                    || (signature.case_count == 4
                        && case_type(&signature, LOCATIVE) == Some(TYPE_NAME)
                        && case_type(&signature, MULTIPLICATIVE) == Some(TYPE_UINT16)))
                && case_type(&signature, SOURCE) == Some(TYPE_NAME)
                && case_type(&signature, DESTINATION) == Some(TYPE_NAME) =>
        {
            Ok(ROUTE_EMBEDDING_LOOKUP)
        }
        VERB_MUTABLE_VECTOR
            if case_type(&signature, NOMINATIVE) == Some(TYPE_NAME)
                && case_type(&signature, ESSIVE).is_some()
                && case_type(&signature, INSTRUMENTAL).is_some() =>
        {
            Ok(ROUTE_MUTABLE_VECTOR)
        }
        VERB_ARITHMETIC => arithmetic_route(&signature),
        VERB_INVERT
            if signature.case_count == 2
                && case_type(&signature, ACCUSATIVE) == Some(TYPE_UINT16)
                && case_type(&signature, DATIVE) == Some(TYPE_UINT16) =>
        {
            Ok(ROUTE_INVERT)
        }
        VERB_BOOLEAN_COMPARISON
            if signature.case_count == 2
                && case_type(&signature, SOURCE).is_some()
                && (case_type(&signature, NOMINATIVE).is_some()
                    || case_type(&signature, ACCUSATIVE).is_some()) =>
        {
            Ok(ROUTE_BOOLEAN_COMPARISON)
        }
        VERB_BOOLEAN_COMPOSITION if all_case_types(&signature, TYPE_CLAUSE) => {
            Ok(ROUTE_BOOLEAN_COMPOSITION)
        }
        VERB_BOOLEAN_LITERAL if has_cases(&signature, &[(ACCUSATIVE, TYPE_BOOLEAN)]) => {
            Ok(ROUTE_BOOLEAN_LITERAL)
        }
        VERB_VECTOR_SUM
            if signature.case_count == 1
                && matches!(
                    case_type(&signature, ACCUSATIVE),
                    Some(TYPE_VECTOR_FLOAT32) | Some(TYPE_VECTOR_FLOAT64) | Some(TYPE_NAME)
                ) =>
        {
            Ok(ROUTE_VECTOR_SUM)
        }
        VERB_VECTOR_MAXIMUM
            if signature.case_count == 2
                && matches!(
                    case_type(&signature, ACCUSATIVE),
                    Some(TYPE_VECTOR_FLOAT32) | Some(TYPE_VECTOR_FLOAT64) | Some(TYPE_NAME)
                )
                && case_type(&signature, DESTINATION) == Some(TYPE_NAME_NUMBER) =>
        {
            Ok(ROUTE_VECTOR_ARGMAX)
        }
        VERB_VECTOR_MAXIMUM
            if signature.case_count == 1
                && matches!(
                    case_type(&signature, ACCUSATIVE),
                    Some(TYPE_VECTOR_FLOAT32) | Some(TYPE_VECTOR_FLOAT64) | Some(TYPE_NAME)
                ) =>
        {
            Ok(ROUTE_VECTOR_MAXIMUM)
        }
        VERB_LITERAL => literal_route(&signature, group_len),
        _ => Err(ERROR_UNSUPPORTED),
    }
}

fn all_case_types(signature: &SignatureView, expected: u32) -> bool {
    let mut index = 0;
    while index < signature.case_count {
        if array_at!(signature.cases, index).value_type != expected {
            return false;
        }
        index += 1;
    }
    true
}

#[cfg(test)]
#[path = "tests/signature_dispatch.rs"]
mod tests;
