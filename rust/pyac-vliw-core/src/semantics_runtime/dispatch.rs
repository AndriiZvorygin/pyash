use super::iwsp_vector_ops::{
    vector_float_arithmetic_group, vector_maximum_group, vector_sum_group,
};
use super::mutable_vector::mutable_vector_group;
use super::pluk_tlas::pluk_tlas_group;
use super::scalar_product::scalar_product_group;
use super::signature_dispatch::*;
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
    let route = match select_signature_route(words, start, group_len) {
        Ok(route) => route,
        Err(error) => return CoreResult::failure(error, group_len as u32),
    };
    let result = match route {
        ROUTE_PLUK_TLAS => pluk_tlas_group(words, start, group_len, codelet_count),
        ROUTE_SCALAR_PRODUCT => scalar_product_group(words, start, group_len, codelet_count),
        ROUTE_VECTOR_FLOAT_ARITHMETIC => Some(vector_float_arithmetic_group(
            words,
            start,
            group_len,
            codelet_count,
        )),
        ROUTE_VECTOR_SUM => Some(vector_sum_group(words, start, group_len, codelet_count)),
        ROUTE_VECTOR_MAXIMUM => Some(vector_maximum_group(words, start, group_len, codelet_count)),
        ROUTE_MUTABLE_VECTOR => mutable_vector_group(words, start, group_len),
        ROUTE_FIXED16 if group_len == 1 => fixed16::single_codelet(words, start),
        ROUTE_FLOAT if group_len == 1 => single_codelet(words, start),
        ROUTE_VECTOR_LITERAL => interpret_vector_group(words, start, group_len),
        ROUTE_BOOLEAN_COMPOSITION => boolean_composition(words, start, codelet_count),
        ROUTE_BOOLEAN_COMPARISON => boolean_comparison(words, start, codelet_count),
        ROUTE_CONDITIONAL => return conditional(words, start, group_len),
        ROUTE_INVERT if group_len == 1 => invert(words, start),
        ROUTE_VECTOR_ARITHMETIC if group_len == 1 => vector_arithmetic(words, start),
        ROUTE_ARITHMETIC if group_len == 1 => arithmetic(words, start),
        ROUTE_BOOLEAN_LITERAL if group_len == 1 => boolean_literal(words, start),
        ROUTE_LITERAL if group_len == 1 => literal(words, start),
        _ => None,
    };
    result.unwrap_or_else(|| CoreResult::failure(ERROR_MALFORMED, group_len as u32))
}
