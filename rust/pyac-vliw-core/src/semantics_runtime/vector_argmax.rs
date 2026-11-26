use super::float::is_finite_f32;
#[cfg(feature = "shader-f64")]
use super::float::is_finite_f64;
use super::pluk_tlas::resolve_named_vector_for_read;
use super::scalar_product::{Cursor, read_operand};
use super::signature_dispatch::ROUTE_VECTOR_ARGMAX;
use super::*;

use super::iwsp_vector_ops::{MAXIMUM_VERB_FIRST, MAXIMUM_VERB_SECOND};

fn skip_named_number_target(cursor: &mut Cursor, words: &[impl VliwWord]) -> Result<(), u32> {
    // `<class words…> [gi] <name> <case>`: the class word leads and `gi` marks
    // the name, so the width word comes first and the tag at most once.
    let mut typed = false;
    while matches!(
        cursor.peek(words, false),
        Some(word) if is_width_word(word)
    ) {
        cursor.read(words, false);
        typed = true;
    }
    if !typed {
        return Err(ERROR_MALFORMED);
    }
    if cursor.peek(words, false) == Some(NAME_TYPE) {
        cursor.read(words, false);
    }
    let mut name_words = 0;
    while cursor.peek(words, false).is_some() {
        cursor.read(words, false).ok_or(ERROR_MALFORMED)?;
        name_words += 1;
    }
    if name_words == 0 || cursor.read(words, true) != Some(DESTINATION) {
        return Err(ERROR_MALFORMED);
    }
    Ok(())
}

fn maximum_index(vector: &super::scalar_product::VectorOperand) -> Result<u32, u32> {
    if vector.length == 0 {
        return Err(ERROR_VECTOR_WIDTH);
    }
    let mut winner = 0usize;
    if vector.kind == VALUE_VECTOR_FLOAT32 {
        let mut maximum = f32::from_bits(vector.values[0]);
        if !is_finite_f32(maximum) {
            return Err(ERROR_FLOAT_DOMAIN);
        }
        let mut lane = 1;
        while lane < vector.length {
            let value = f32::from_bits(array_at!(vector.values, lane));
            if !is_finite_f32(value) {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            if value > maximum {
                maximum = value;
                winner = lane;
            }
            lane += 1;
        }
        return Ok(winner as u32);
    }
    #[cfg(feature = "shader-f64")]
    if vector.kind == VALUE_VECTOR_FLOAT64 {
        let mut maximum = f64::from_bits(
            u64::from(array_at!(vector.values, 0)) | (u64::from(array_at!(vector.values, 1)) << 32),
        );
        if !is_finite_f64(maximum) {
            return Err(ERROR_FLOAT_DOMAIN);
        }
        let mut lane = 1;
        while lane < vector.length {
            let offset = lane * 2;
            let value = f64::from_bits(
                u64::from(array_at!(vector.values, offset))
                    | (u64::from(array_at!(vector.values, offset + 1)) << 32),
            );
            if !is_finite_f64(value) {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            if value > maximum {
                maximum = value;
                winner = lane;
            }
            lane += 1;
        }
        return Ok(winner as u32);
    }
    Err(ERROR_UNSUPPORTED)
}

pub(super) fn vector_argmax_group(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    codelet_count: usize,
) -> CoreResult {
    let mut cursor = Cursor {
        start,
        codelet: start,
        slot: 1,
        end: start + group_len,
    };
    let vector = if cursor.peek(words, false) == Some(NAME_TYPE) {
        cursor.read(words, false);
        let name_start = cursor.offset();
        let mut name_length = 0;
        while cursor.peek(words, false).is_some() {
            cursor.read(words, false);
            name_length += 1;
        }
        if name_length == 0 || cursor.read(words, true) != Some(ACCUSATIVE) {
            return CoreResult::failure(ERROR_MALFORMED, group_len as u32);
        }
        match resolve_named_vector_for_read(
            words,
            codelet_count,
            start,
            start,
            group_len,
            NameSpan {
                start: name_start,
                length: name_length,
            },
        ) {
            Ok(value) => value,
            Err(error) => return CoreResult::failure(error, group_len as u32),
        }
    } else {
        let vector = match read_operand(
            &mut cursor,
            words,
            start,
            group_len,
            codelet_count,
            &StorageView::EMPTY,
        ) {
            Ok(value) => value,
            Err(error) => return CoreResult::failure(error, group_len as u32),
        };
        if cursor.read(words, true) != Some(ACCUSATIVE) {
            return CoreResult::failure(ERROR_MALFORMED, group_len as u32);
        }
        let mut result = CoreResult::empty();
        result.value_kind = vector.kind;
        result.length = vector.length as u32;
        result.values = vector.values;
        result
    };
    if let Err(error) = skip_named_number_target(&mut cursor, words) {
        return CoreResult::failure(error, group_len as u32);
    }
    if cursor.read(words, false) != Some(MAXIMUM_VERB_FIRST)
        || cursor.read(words, false) != Some(MAXIMUM_VERB_SECOND)
        || cursor.read(words, true) != Some(DEONTIC)
        || !cursor.zero_tail(words)
    {
        return CoreResult::failure(ERROR_MALFORMED, group_len as u32);
    }
    if select_signature_route(words, start, group_len) != Ok(ROUTE_VECTOR_ARGMAX) {
        return CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32);
    }
    let vector = super::scalar_product::VectorOperand {
        kind: vector.value_kind,
        length: vector.length as usize,
        values: vector.values,
        storage_backed: false,
        storage_byte_offset: 0,
    };
    match maximum_index(&vector) {
        Ok(index) => CoreResult::scalar(VALUE_UNSIGNED, index, 0, group_len as u32),
        Err(error) => CoreResult::failure(error, group_len as u32),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vector(values: &[f32]) -> super::super::scalar_product::VectorOperand {
        let mut words = [0; RESULT_WORDS];
        for (index, value) in values.iter().enumerate() {
            words[index] = value.to_bits();
        }
        super::super::scalar_product::VectorOperand {
            kind: VALUE_VECTOR_FLOAT32,
            length: values.len(),
            values: words,
            storage_backed: false,
            storage_byte_offset: 0,
        }
    }

    #[test]
    fn maximum_index_rejects_empty_vectors() {
        assert_eq!(maximum_index(&vector(&[])), Err(ERROR_VECTOR_WIDTH));
    }

    #[test]
    fn maximum_index_rejects_non_finite_values() {
        assert_eq!(maximum_index(&vector(&[f32::NAN])), Err(ERROR_FLOAT_DOMAIN));
    }
}

use super::signature_dispatch::select_signature_route;
