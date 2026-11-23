use super::vector_group::{interpret_vector_group, vector_name_span};
use super::*;

fn group_length(words: &[u32], start: usize, codelet_count: usize) -> Option<usize> {
    let mut end = start;
    while end < codelet_count && word(words, end, 0) & 1 == 0 {
        end += 1;
    }
    (end < codelet_count).then_some(end - start + 1)
}

fn token_at(words: &[u32], start: usize, group_len: usize, offset: usize) -> Option<u32> {
    if offset >= group_len * (CODELET_WORDS - 1) {
        return None;
    }
    let codelet = start + offset / (CODELET_WORDS - 1);
    let slot = offset % (CODELET_WORDS - 1) + 1;
    Some(word(words, codelet, slot))
}

fn names_equal(
    words: &[u32],
    reference_start: usize,
    reference_group_len: usize,
    reference: NameSpan,
    binding_start: usize,
    binding_group_len: usize,
    binding: NameSpan,
) -> bool {
    if reference.length == 0 || reference.length != binding.length {
        return false;
    }
    let mut index = 0;
    while index < reference.length {
        if token_at(
            words,
            reference_start,
            reference_group_len,
            reference.start + index,
        ) != token_at(
            words,
            binding_start,
            binding_group_len,
            binding.start + index,
        ) {
            return false;
        }
        index += 1;
    }
    true
}

pub(super) fn resolve_prior_vector(
    words: &[u32],
    codelet_count: usize,
    before: usize,
    reference_start: usize,
    reference_group_len: usize,
    reference: NameSpan,
) -> Result<CoreResult, u32> {
    let mut cursor = 0;
    let mut resolved = CoreResult::empty();
    let mut found = false;
    while cursor < before {
        let length = group_length(words, cursor, codelet_count).ok_or(ERROR_MALFORMED)?;
        if cursor + length > before {
            return Err(ERROR_MALFORMED);
        }
        if let Some(binding) = vector_name_span(words, cursor, length) {
            if names_equal(
                words,
                reference_start,
                reference_group_len,
                reference,
                cursor,
                length,
                binding,
            ) {
                if found {
                    return Err(ERROR_MALFORMED);
                }
                resolved = if length == 1 {
                    super::single_codelet(words, cursor)
                } else {
                    interpret_vector_group(words, cursor, length)
                }
                .ok_or(ERROR_UNSUPPORTED)?;
                if resolved.error != 0 {
                    return Err(resolved.error);
                }
                if !matches!(
                    resolved.value_kind,
                    VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64
                ) {
                    return Err(ERROR_UNSUPPORTED);
                }
                found = true;
            }
        }
        cursor += length;
    }
    if found {
        Ok(resolved)
    } else {
        Err(ERROR_UNSUPPORTED)
    }
}
