use super::scalar_product::scalar_product_group;
use super::vector_group::interpret_vector_group;
use super::*;

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
    if let Some(result) = scalar_product_group(words, start, group_len) {
        return result;
    }
    if group_len == 1 {
        if let Some(result) = fixed16::single_codelet(words, start) {
            return result;
        }
        if let Some(result) = single_codelet(words, start) {
            return result;
        }
    }
    if let Some(result) = interpret_vector_group(words, start, group_len) {
        return result;
    }
    if let Some(result) = boolean_composition(words, start, codelet_count) {
        return result;
    }
    if let Some(result) = boolean_comparison(words, start, codelet_count) {
        return result;
    }
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
