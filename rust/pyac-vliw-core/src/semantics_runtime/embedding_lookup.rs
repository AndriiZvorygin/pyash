use super::canonical_signature::{
    TYPE_NAME, TYPE_QUOTE_TAG, case_type, signature, token_at, token_boundary,
};
use super::scalar_product::VectorOperand;
use super::storage_vector::{
    resolve_storage_section_vector, resolve_storage_u16_scalar, resolve_storage_u16_vector_element,
    storage_has_name,
};
use super::*;

pub(super) const LOOKUP_FIRST: u32 = 0xec4a;
pub(super) const LOOKUP_SECOND: u32 = 0xa948;
const TYPE_UINT16: u32 = TYPE_QUOTE_TAG | (4 << 12) | (2 << 4);

#[derive(Clone, Copy)]
enum RowSelector {
    Literal(usize),
    StorageScalar(NameSpan),
    StorageSequenceElement { name: NameSpan, position: usize },
}

#[derive(Clone, Copy)]
pub(super) struct EmbeddingRowBinding {
    pub(super) table: NameSpan,
    pub(super) result: NameSpan,
    row: RowSelector,
}

fn case_value(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    target_case: u32,
) -> Result<NameSpan, u32> {
    let mut field_start = 0;
    let mut offset = 0;
    let capacity = group_len * (CODELET_WORDS - 1);
    while offset < capacity {
        if token_boundary(words, start, offset) {
            let token = token_at(words, start, group_len, offset).ok_or(ERROR_MALFORMED)?;
            if token == target_case {
                return Ok(NameSpan {
                    start: field_start,
                    length: offset - field_start,
                });
            }
            field_start = offset + 1;
        }
        offset += 1;
    }
    Err(ERROR_MALFORMED)
}

fn named_value(
    value: NameSpan,
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
) -> Result<NameSpan, u32> {
    if value.length < 2 || token_at(words, start, group_len, value.start) != Some(NAME_TYPE) {
        return Err(ERROR_MALFORMED);
    }
    Ok(NameSpan {
        start: value.start + 1,
        length: value.length - 1,
    })
}

pub(super) fn parse_embedding_row_binding(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
) -> Result<EmbeddingRowBinding, u32> {
    let signature = signature(words, start, group_len);
    let selector_is_supported = (signature.case_count == 3
        && matches!(
            case_type(&signature, LOCATIVE),
            Some(TYPE_UINT16) | Some(TYPE_NAME)
        ))
        || (signature.case_count == 4
            && case_type(&signature, LOCATIVE) == Some(TYPE_NAME)
            && case_type(&signature, MULTIPLICATIVE) == Some(TYPE_UINT16));
    if signature.error != 0
        || signature.mood != DEONTIC
        || case_type(&signature, SOURCE) != Some(TYPE_NAME)
        || case_type(&signature, DESTINATION) != Some(TYPE_NAME)
        || !selector_is_supported
        || signature.verb_length != 2
        || token_at(words, start, group_len, signature.verb_start) != Some(LOOKUP_FIRST)
        || token_at(words, start, group_len, signature.verb_start + 1) != Some(LOOKUP_SECOND)
    {
        return Err(ERROR_UNSUPPORTED);
    }
    let source = case_value(words, start, group_len, SOURCE)?;
    let destination = case_value(words, start, group_len, DESTINATION)?;
    let location = case_value(words, start, group_len, LOCATIVE)?;
    let table = named_value(source, words, start, group_len)?;
    let result = named_value(destination, words, start, group_len)?;
    let row = if token_at(words, start, group_len, location.start) == Some(0x881d) {
        if location.length != 2 {
            return Err(ERROR_MALFORMED);
        }
        RowSelector::Literal(
            token_at(words, start, group_len, location.start + 1).ok_or(ERROR_MALFORMED)? as usize,
        )
    } else {
        let name = named_value(location, words, start, group_len)?;
        if signature.case_count == 4 {
            let position = case_value(words, start, group_len, MULTIPLICATIVE)?;
            if position.length != 2
                || token_at(words, start, group_len, position.start) != Some(0x881d)
            {
                return Err(ERROR_MALFORMED);
            }
            RowSelector::StorageSequenceElement {
                name,
                position: token_at(words, start, group_len, position.start + 1)
                    .ok_or(ERROR_MALFORMED)? as usize,
            }
        } else {
            RowSelector::StorageScalar(name)
        }
    };
    Ok(EmbeddingRowBinding { table, result, row })
}

fn resolve_row_index(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    binding: EmbeddingRowBinding,
    storage: &StorageView<'_>,
) -> Result<usize, u32> {
    match binding.row {
        RowSelector::Literal(row) => Ok(row),
        RowSelector::StorageScalar(name) => {
            resolve_storage_u16_scalar(words, start, group_len, name, storage)?
                .map(usize::from)
                .ok_or(ERROR_UNSUPPORTED)
        }
        RowSelector::StorageSequenceElement { name, position } => {
            resolve_storage_u16_vector_element(words, start, group_len, name, position, storage)?
                .map(usize::from)
                .ok_or(ERROR_UNSUPPORTED)
        }
    }
}

fn names_equal(
    words: &[impl VliwWord],
    left_start: usize,
    left_len: usize,
    left: NameSpan,
    right_start: usize,
    right_len: usize,
    right: NameSpan,
) -> bool {
    if left.length != right.length {
        return false;
    }
    let mut index = 0;
    let mut same = true;
    while index < left.length {
        same &= token_at(words, left_start, left_len, left.start + index)
            == token_at(words, right_start, right_len, right.start + index);
        index += 1;
    }
    same
}

pub(super) fn embedding_lookup_group(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    codelet_count: usize,
    storage: &StorageView<'_>,
) -> CoreResult {
    let binding = match parse_embedding_row_binding(words, start, group_len) {
        Ok(binding) => binding,
        Err(error) => return CoreResult::failure(error, group_len as u32),
    };
    match storage_has_name(words, start, group_len, binding.result, storage) {
        Ok(true) => return CoreResult::failure(ERROR_DUPLICATE_SIGNATURE, group_len as u32),
        Err(error) => return CoreResult::failure(error, group_len as u32),
        Ok(false) => {}
    }
    let row = match resolve_row_index(words, start, group_len, binding, storage) {
        Ok(row) => row,
        Err(error) => return CoreResult::failure(error, group_len as u32),
    };
    match resolve_storage_section_vector(words, start, group_len, binding.table, Some(row), storage)
    {
        Ok(Some(_)) => {
            let mut result = CoreResult::empty();
            result.consumed_codelets = group_len.min(codelet_count) as u32;
            result
        }
        Ok(None) => CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32),
        Err(error) => CoreResult::failure(error, group_len as u32),
    }
}

pub(super) fn resolve_prior_embedding_vector(
    words: &[impl VliwWord],
    reference_start: usize,
    reference_group_len: usize,
    reference: NameSpan,
    storage: &StorageView<'_>,
) -> Result<Option<VectorOperand>, u32> {
    let codelet_count = words.len() / CODELET_WORDS;
    let mut group_start = 0;
    let mut found = None;
    while group_start < reference_start && group_start < codelet_count {
        let mut end = group_start;
        while end < reference_start && end < codelet_count && word(words, end, 0) & 1 == 0 {
            end += 1;
        }
        if end >= reference_start || end >= codelet_count {
            break;
        }
        let group_len = end - group_start + 1;
        if super::signature_dispatch::select_signature_route(words, group_start, group_len)
            == Ok(super::signature_dispatch::ROUTE_EMBEDDING_LOOKUP)
        {
            let binding = parse_embedding_row_binding(words, group_start, group_len)?;
            if names_equal(
                words,
                group_start,
                group_len,
                binding.result,
                reference_start,
                reference_group_len,
                reference,
            ) {
                let row = resolve_row_index(words, group_start, group_len, binding, storage)?;
                found = resolve_storage_section_vector(
                    words,
                    group_start,
                    group_len,
                    binding.table,
                    Some(row),
                    storage,
                )?;
                if found.is_none() {
                    return Err(ERROR_UNSUPPORTED);
                }
            }
        }
        group_start = end + 1;
    }
    Ok(found)
}
