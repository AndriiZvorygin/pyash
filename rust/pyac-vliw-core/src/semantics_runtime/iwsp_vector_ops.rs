use super::float::is_finite_f32;
#[cfg(feature = "shader-f64")]
use super::float::is_finite_f64;
use super::numeric::quote_header;
use super::scalar_product::{Cursor, VectorOperand, read_operand};
use super::*;

pub(super) const SUM_VERB: u32 = 0xbc8a;
/// `gjat` = magnitude. The atom, not the phrase "maximum".
pub(super) const GJAT_MAGNITUDE: u32 = 0xa9b2;
/// `bwit` = boundary.
pub(super) const BWIT_BOUNDARY: u32 = 0xa831;
/// The maximum verb is the phrase `gjat bwit`: a magnitude boundary.
pub(super) const MAXIMUM_VERB_FIRST: u32 = GJAT_MAGNITUDE;
pub(super) const MAXIMUM_VERB_SECOND: u32 = BWIT_BOUNDARY;

fn read_scalar(
    cursor: &mut Cursor,
    words: &[impl VliwWord],
    vector_kind: u32,
) -> Result<VectorOperand, u32> {
    let header_word = cursor.read(words, false).ok_or(ERROR_MALFORMED)?;
    let header = quote_header(header_word);
    if header.valid == 0
        || !matches!(header.sort, 4 | 6)
        || header.explicit != 0
        || header_word & 0x0700 != 0
    {
        return Err(ERROR_UNSUPPORTED);
    }
    let result_kind = if vector_kind == VALUE_VECTOR_FLOAT64 {
        VALUE_FLOAT64
    } else {
        VALUE_FLOAT32
    };
    let mut result = VectorOperand {
        kind: result_kind,
        length: 1,
        values: [0; RESULT_WORDS],
        storage_backed: false,
        storage_byte_offset: 0,
    };
    let words_per_value = header.scalar_bytes as usize / 2;
    if !matches!(words_per_value, 1 | 2 | 4) {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut payload = [0u32; 4];
    let mut index = 0;
    while index < words_per_value {
        array_put!(
            &mut payload,
            index,
            cursor.read(words, false).ok_or(ERROR_MALFORMED)? & 0xffff
        );
        index += 1;
    }
    if result.kind == VALUE_FLOAT32 {
        let value = match (header.sort, header.scalar_bytes) {
            (4, 2) => payload[0] as f32,
            (6, 4) => f32::from_bits(payload[0] | (payload[1] << 16)),
            _ => return Err(ERROR_UNSUPPORTED),
        };
        if !is_finite_f32(value) {
            return Err(ERROR_FLOAT_DOMAIN);
        }
        result.values[0] = value.to_bits();
    } else {
        #[cfg(not(feature = "shader-f64"))]
        return Err(ERROR_UNSUPPORTED);
        #[cfg(feature = "shader-f64")]
        {
            let value = match (header.sort, header.scalar_bytes) {
                (4, 2) => payload[0] as f64,
                (6, 4) => f64::from(f32::from_bits(payload[0] | (payload[1] << 16))),
                (6, 8) => {
                    let low = payload[0] | (payload[1] << 16);
                    let high = payload[2] | (payload[3] << 16);
                    f64::from_bits(u64::from(low) | (u64::from(high) << 32))
                }
                _ => return Err(ERROR_UNSUPPORTED),
            };
            if !is_finite_f64(value) {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            let bits = value.to_bits();
            result.values[0] = bits as u32;
            result.values[1] = (bits >> 32) as u32;
        }
    }
    Ok(result)
}

fn read_numeric_operand(
    cursor: &mut Cursor,
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    codelet_count: usize,
    vector_kind: u32,
    result: &mut VectorOperand,
) -> Result<bool, u32> {
    if cursor.peek(words, false) != Some(NAME_TYPE) {
        if let Some(header_word) = cursor.peek(words, false) {
            let header = quote_header(header_word);
            if header.valid != 0 && header_word & 0x0700 == 0 {
                *result = match read_scalar(cursor, words, vector_kind) {
                    Ok(value) => value,
                    Err(error) => return Err(error),
                };
                return Ok(false);
            }
        }
    }
    *result = match read_operand(
        cursor,
        words,
        start,
        group_len,
        codelet_count,
        &StorageView::EMPTY,
    ) {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
    Ok(true)
}

#[cfg(feature = "shader-f64")]
fn vector_bits(operand: &VectorOperand, lane: usize) -> u64 {
    if operand.kind == VALUE_VECTOR_FLOAT32 {
        u64::from(array_at!(operand.values, lane))
    } else {
        u64::from(array_at!(operand.values, lane * 2))
            | (u64::from(array_at!(operand.values, lane * 2 + 1)) << 32)
    }
}

#[cfg(feature = "shader-f64")]
fn scalar_bits(operand: &VectorOperand) -> u64 {
    if operand.kind == VALUE_FLOAT32 {
        u64::from(array_at!(operand.values, 0))
    } else {
        u64::from(array_at!(operand.values, 0)) | (u64::from(array_at!(operand.values, 1)) << 32)
    }
}

pub(super) fn vector_float_arithmetic_group(
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
    let left = match read_operand(
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
    if !matches!(left.kind, VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64)
        || cursor.read(words, true) != Some(ACCUSATIVE)
    {
        return CoreResult::failure(ERROR_MALFORMED, group_len as u32);
    }
    let mut right = VectorOperand {
        kind: 0,
        length: 0,
        values: [0; RESULT_WORDS],
        storage_backed: false,
        storage_byte_offset: 0,
    };
    let right_is_vector = match read_numeric_operand(
        &mut cursor,
        words,
        start,
        group_len,
        codelet_count,
        left.kind,
        &mut right,
    ) {
        Ok(value) => value,
        Err(error) => return CoreResult::failure(error, group_len as u32),
    };
    if cursor.read(words, true) != Some(DESTINATION) {
        return CoreResult::failure(ERROR_MALFORMED, group_len as u32);
    }
    let operator = match cursor.read(words, false) {
        Some(value) => value,
        None => return CoreResult::failure(ERROR_MALFORMED, group_len as u32),
    };
    if cursor.read(words, true) != Some(DEONTIC) || !cursor.zero_tail(words) {
        return CoreResult::failure(ERROR_MALFORMED, group_len as u32);
    }
    if left.kind == VALUE_VECTOR_FLOAT32 {
        if right.kind
            != if right_is_vector {
                VALUE_VECTOR_FLOAT32
            } else {
                VALUE_FLOAT32
            }
        {
            return CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32);
        }
    } else if right.kind
        != if right_is_vector {
            VALUE_VECTOR_FLOAT64
        } else {
            VALUE_FLOAT64
        }
    {
        return CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32);
    }
    if (operator == PLUS && !right_is_vector) || (operator == MULTIPLY && right_is_vector) {
        return CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32);
    }
    if !matches!(operator, PLUS | MULTIPLY) {
        return CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32);
    }
    if right_is_vector && left.length != right.length {
        return CoreResult::failure(ERROR_VECTOR_WIDTH, group_len as u32);
    }

    let mut result = CoreResult::empty();
    result.value_kind = left.kind;
    result.length = left.length as u32;
    result.consumed_codelets = group_len as u32;
    let mut lane = 0;
    while lane < left.length {
        if left.kind == VALUE_VECTOR_FLOAT32 {
            let left_value = f32::from_bits(array_at!(left.values, lane));
            let right_value = f32::from_bits(if right_is_vector {
                array_at!(right.values, lane)
            } else {
                array_at!(right.values, 0)
            });
            let value = if operator == PLUS {
                left_value + right_value
            } else {
                left_value * right_value
            };
            let bits = value.to_bits();
            if bits & 0x7f80_0000 == 0x7f80_0000 {
                return CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32);
            }
            array_put!(&mut result.values, lane, bits);
        } else {
            #[cfg(not(feature = "shader-f64"))]
            return CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32);
            #[cfg(feature = "shader-f64")]
            {
                let left_value = f64::from_bits(vector_bits(&left, lane));
                let right_value = f64::from_bits(if right_is_vector {
                    vector_bits(&right, lane)
                } else {
                    scalar_bits(&right)
                });
                let value = if operator == PLUS {
                    left_value + right_value
                } else {
                    left_value * right_value
                };
                let bits = value.to_bits();
                if bits & 0x7ff0_0000_0000_0000 == 0x7ff0_0000_0000_0000 {
                    return CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32);
                }
                array_put!(&mut result.values, lane * 2, bits as u32);
                array_put!(&mut result.values, lane * 2 + 1, (bits >> 32) as u32);
            }
        }
        lane += 1;
    }
    result
}

pub(super) fn vector_sum_group(
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
    if !matches!(vector.kind, VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64)
        || cursor.read(words, true) != Some(ACCUSATIVE)
        || cursor.read(words, false) != Some(SUM_VERB)
        || cursor.read(words, true) != Some(DEONTIC)
        || !cursor.zero_tail(words)
    {
        return CoreResult::failure(ERROR_MALFORMED, group_len as u32);
    }
    if vector.kind == VALUE_VECTOR_FLOAT32 {
        let mut sum = 0.0f32;
        let mut lane = 0;
        while lane < vector.length {
            sum += f32::from_bits(array_at!(vector.values, lane));
            lane += 1;
        }
        let bits = sum.to_bits();
        if bits & 0x7f80_0000 == 0x7f80_0000 {
            return CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32);
        }
        return CoreResult::scalar(VALUE_FLOAT32, bits, 0, group_len as u32);
    }
    #[cfg(not(feature = "shader-f64"))]
    {
        CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32)
    }
    #[cfg(feature = "shader-f64")]
    {
        let mut sum = 0.0f64;
        let mut lane = 0;
        while lane < vector.length {
            sum += f64::from_bits(vector_bits(&vector, lane));
            lane += 1;
        }
        let bits = sum.to_bits();
        if bits & 0x7ff0_0000_0000_0000 == 0x7ff0_0000_0000_0000 {
            return CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32);
        }
        CoreResult::scalar(
            VALUE_FLOAT64,
            bits as u32,
            (bits >> 32) as u32,
            group_len as u32,
        )
    }
}

pub(super) fn vector_maximum_group(
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
    if !matches!(vector.kind, VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64)
        || cursor.read(words, true) != Some(ACCUSATIVE)
        || cursor.read(words, false) != Some(MAXIMUM_VERB_FIRST)
        || cursor.read(words, false) != Some(MAXIMUM_VERB_SECOND)
        || cursor.read(words, true) != Some(DEONTIC)
        || !cursor.zero_tail(words)
    {
        return CoreResult::failure(ERROR_MALFORMED, group_len as u32);
    }
    if vector.length == 0 {
        return CoreResult::failure(ERROR_VECTOR_WIDTH, group_len as u32);
    }
    if vector.kind == VALUE_VECTOR_FLOAT32 {
        let mut maximum = f32::from_bits(vector.values[0]);
        let mut lane = 1;
        while lane < vector.length {
            let value = f32::from_bits(array_at!(vector.values, lane));
            if value > maximum {
                maximum = value;
            }
            lane += 1;
        }
        return CoreResult::scalar(VALUE_FLOAT32, maximum.to_bits(), 0, group_len as u32);
    }
    #[cfg(not(feature = "shader-f64"))]
    {
        CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32)
    }
    #[cfg(feature = "shader-f64")]
    {
        let mut maximum = f64::from_bits(vector_bits(&vector, 0));
        let mut lane = 1;
        while lane < vector.length {
            let value = f64::from_bits(vector_bits(&vector, lane));
            if value > maximum {
                maximum = value;
            }
            lane += 1;
        }
        let bits = maximum.to_bits();
        CoreResult::scalar(
            VALUE_FLOAT64,
            bits as u32,
            (bits >> 32) as u32,
            group_len as u32,
        )
    }
}
