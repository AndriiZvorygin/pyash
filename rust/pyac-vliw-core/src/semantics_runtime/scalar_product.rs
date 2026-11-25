use super::named_vector::resolve_prior_vector;
use super::numeric::{QuoteHeader, quote_header, word};
use super::storage_vector::resolve_storage_vector;
use super::*;

pub(super) const SCALAR_WORD: u32 = 0x0d62;
pub(super) const PRODUCE_WORD: u32 = 0x8944;

#[derive(Clone, Copy)]
pub(super) struct Cursor {
    pub(super) start: usize,
    pub(super) codelet: usize,
    pub(super) slot: usize,
    pub(super) end: usize,
}

#[derive(Clone, Copy)]
pub(super) struct VectorOperand {
    pub(super) kind: u32,
    pub(super) length: usize,
    pub(super) values: [u32; RESULT_WORDS],
    pub(super) storage_backed: bool,
    pub(super) storage_byte_offset: usize,
}

fn boundary_at(words: &[impl VliwWord], codelet: usize, slot: usize) -> bool {
    let head = word(words, codelet, 0);
    (head & (1 << slot) != 0) == (head & 1 != 0)
}

impl Cursor {
    pub(super) fn peek(&self, words: &[impl VliwWord], boundary: bool) -> Option<u32> {
        if self.codelet >= self.end
            || self.slot >= CODELET_WORDS
            || boundary_at(words, self.codelet, self.slot) != boundary
        {
            return None;
        }
        Some(word(words, self.codelet, self.slot))
    }

    pub(super) fn offset(&self) -> usize {
        (self.codelet - self.start) * (CODELET_WORDS - 1) + self.slot - 1
    }

    pub(super) fn read(&mut self, words: &[impl VliwWord], boundary: bool) -> Option<u32> {
        if self.codelet >= self.end || self.slot >= CODELET_WORDS {
            return None;
        }
        if boundary_at(words, self.codelet, self.slot) != boundary {
            return None;
        }
        let value = word(words, self.codelet, self.slot);
        self.slot += 1;
        if self.slot == CODELET_WORDS {
            self.codelet += 1;
            self.slot = 1;
        }
        Some(value)
    }

    pub(super) fn zero_tail(&self, words: &[impl VliwWord]) -> bool {
        let mut codelet = self.codelet;
        let mut slot = self.slot;
        while codelet < self.end {
            while slot < CODELET_WORDS {
                if word(words, codelet, slot) != 0 {
                    return false;
                }
                slot += 1;
            }
            codelet += 1;
            slot = 1;
        }
        true
    }
}

#[derive(Clone, Copy)]
pub(super) struct ScalarProductDestination {
    pub(super) present: u32,
    pub(super) name: NameSpan,
    pub(super) index: usize,
}

impl ScalarProductDestination {
    const NONE: Self = Self {
        present: 0,
        name: NameSpan::EMPTY,
        index: 0,
    };
}

fn read_destination(
    words: &[impl VliwWord],
    cursor: &mut Cursor,
) -> Result<ScalarProductDestination, u32> {
    if cursor.peek(words, false) != Some(NAME_TYPE) {
        return Ok(ScalarProductDestination::NONE);
    }
    let saved = *cursor;
    cursor.read(words, false).ok_or(ERROR_MALFORMED)?;
    let name_start = cursor.offset();
    let mut name_length = 0;
    while cursor.peek(words, false).is_some() {
        cursor.read(words, false).ok_or(ERROR_MALFORMED)?;
        name_length += 1;
    }
    if name_length == 0 {
        return Err(ERROR_MALFORMED);
    }
    if cursor.peek(words, true) != Some(DESTINATION) {
        *cursor = saved;
        return Ok(ScalarProductDestination::NONE);
    }
    cursor.read(words, true).ok_or(ERROR_MALFORMED)?;
    if cursor.read(words, false) != Some(NUMBER_QUOTE) {
        return Err(ERROR_MALFORMED);
    }
    let index = cursor.read(words, false).ok_or(ERROR_MALFORMED)? as usize;
    if index > MAX_U16 as usize || cursor.read(words, true) != Some(LOCATIVE) {
        return Err(ERROR_MALFORMED);
    }
    Ok(ScalarProductDestination {
        present: 1,
        name: NameSpan {
            start: name_start,
            length: name_length,
        },
        index,
    })
}

pub(super) fn scalar_product_destination(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
) -> Result<ScalarProductDestination, u32> {
    let end = start + group_len;
    if group_len == 0 || !operation_suffix(words, start, end) {
        return Ok(ScalarProductDestination::NONE);
    }
    let mut cursor = Cursor {
        start,
        codelet: start,
        slot: 1,
        end,
    };
    skip_operand(&mut cursor, words)?;
    if cursor.read(words, true) != Some(ACCUSATIVE) {
        return Err(ERROR_MALFORMED);
    }
    read_destination(words, &mut cursor)
}

fn vector_length(
    header: QuoteHeader,
    cursor: &mut Cursor,
    words: &[impl VliwWord],
) -> Result<usize, u32> {
    let scalar_words = header.scalar_bytes as usize / 2;
    if scalar_words == 0 {
        return Err(ERROR_MALFORMED);
    }
    let length = if header.explicit != 0 {
        cursor.read(words, false).ok_or(ERROR_MALFORMED)? as usize
    } else {
        (header.fixed_length as usize)
            .checked_div(scalar_words)
            .ok_or(ERROR_MALFORMED)?
    };
    if length == 0 || length > MAX_VECTOR_LANES {
        return Err(ERROR_VECTOR_WIDTH);
    }
    Ok(length)
}

fn read_vector(cursor: &mut Cursor, words: &[impl VliwWord]) -> Result<VectorOperand, u32> {
    let header_word = cursor.read(words, false).ok_or(ERROR_MALFORMED)?;
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 || !matches!(header.scalar_bytes, 4 | 8) {
        return Err(ERROR_UNSUPPORTED);
    }
    let is_vector = (header_word & 0x0700) != 0;
    if !is_vector {
        return Err(ERROR_UNSUPPORTED);
    }
    let length = vector_length(header, cursor, words)?;
    let kind = if header.scalar_bytes == 4 {
        VALUE_VECTOR_FLOAT32
    } else {
        VALUE_VECTOR_FLOAT64
    };
    let mut values = [0u32; RESULT_WORDS];
    let words_per_lane = header.scalar_bytes as usize / 2;
    let mut lane = 0;
    while lane < length {
        let mut lane_words = [0u32; 4];
        let mut index = 0;
        while index < words_per_lane {
            array_put!(
                &mut lane_words,
                index,
                cursor.read(words, false).ok_or(ERROR_MALFORMED)? & 0xffff
            );
            index += 1;
        }
        if kind == VALUE_VECTOR_FLOAT32 {
            let bits = lane_words[0] | (lane_words[1] << 16);
            if bits & 0x7f80_0000 == 0x7f80_0000 {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            array_put!(&mut values, lane, bits);
        } else {
            let low = lane_words[0] | (lane_words[1] << 16);
            let high = lane_words[2] | (lane_words[3] << 16);
            if high & 0x7ff0_0000 == 0x7ff0_0000 {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            array_put!(&mut values, lane * 2, low);
            array_put!(&mut values, lane * 2 + 1, high);
        }
        lane += 1;
    }
    Ok(VectorOperand {
        kind,
        length,
        values,
        storage_backed: false,
        storage_byte_offset: 0,
    })
}

fn read_name_span(cursor: &mut Cursor, words: &[impl VliwWord]) -> Result<NameSpan, u32> {
    cursor.read(words, false).ok_or(ERROR_MALFORMED)?;
    let start = cursor.offset();
    let mut length = 0;
    while cursor.peek(words, false).is_some() {
        cursor.read(words, false).ok_or(ERROR_MALFORMED)?;
        length += 1;
    }
    if length == 0 {
        return Err(ERROR_MALFORMED);
    }
    Ok(NameSpan { start, length })
}

pub(super) fn read_operand(
    cursor: &mut Cursor,
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    codelet_count: usize,
    storage: &StorageView<'_>,
) -> Result<VectorOperand, u32> {
    read_operand_with_row_index(
        cursor,
        words,
        start,
        group_len,
        codelet_count,
        None,
        storage,
    )
}

pub(super) fn read_operand_with_row_index(
    cursor: &mut Cursor,
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    codelet_count: usize,
    row_index: Option<usize>,
    storage: &StorageView<'_>,
) -> Result<VectorOperand, u32> {
    if cursor.peek(words, false) != Some(NAME_TYPE) {
        let mut vector = read_vector(cursor, words)?;
        vector.storage_backed = false;
        vector.storage_byte_offset = 0;
        return Ok(vector);
    }
    let name = read_name_span(cursor, words)?;
    let prior = resolve_prior_vector(words, codelet_count, start, start, group_len, name);
    let backed = resolve_storage_vector(words, start, group_len, name, row_index, storage)?;
    match (prior, backed) {
        (Ok(_), Some(_)) => Err(ERROR_DUPLICATE_SIGNATURE),
        (Ok(result), None) => Ok(VectorOperand {
            kind: result.value_kind,
            length: result.length as usize,
            values: result.values,
            storage_backed: false,
            storage_byte_offset: 0,
        }),
        (Err(error), Some(value)) if error == ERROR_UNSUPPORTED => Ok(value),
        (Err(error), Some(_)) => Err(error),
        (Err(error), None) => Err(error),
    }
}

fn skip_operand(cursor: &mut Cursor, words: &[impl VliwWord]) -> Result<(), u32> {
    if cursor.peek(words, false) == Some(NAME_TYPE) {
        read_name_span(cursor, words)?;
    } else {
        match read_vector(cursor, words) {
            Ok(_) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn operation_suffix(words: &[impl VliwWord], start: usize, end: usize) -> bool {
    if start >= end || end > words.len() / CODELET_WORDS {
        return false;
    }
    let mut matched = 0;
    let earliest = if end - start > 3 { end - 3 } else { start };
    let mut codelet = end;
    while codelet > earliest && matched < 3 {
        codelet -= 1;
        let mut slot = CODELET_WORDS;
        while slot > 1 && matched < 3 {
            slot -= 1;
            let value = word(words, codelet, slot);
            if value != 0 {
                let expected = match matched {
                    0 => DEONTIC,
                    1 => PRODUCE_WORD,
                    2 => SCALAR_WORD,
                    _ => return false,
                };
                if value != expected {
                    return false;
                }
                matched += 1;
            }
        }
    }
    matched == 3
}

pub(super) fn scalar_product_group(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    codelet_count: usize,
) -> Option<CoreResult> {
    scalar_product_group_with_storage(words, start, group_len, codelet_count, &StorageView::EMPTY)
}

pub(super) fn scalar_product_group_with_storage(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    codelet_count: usize,
    storage: &StorageView<'_>,
) -> Option<CoreResult> {
    let end = start + group_len;
    if group_len == 0 || !operation_suffix(words, start, end) {
        return None;
    }
    let mut cursor = Cursor {
        start,
        codelet: start,
        slot: 1,
        end,
    };
    let left = match read_operand(&mut cursor, words, start, group_len, codelet_count, storage) {
        Ok(value) => value,
        Err(error) => return Some(CoreResult::failure(error, group_len as u32)),
    };
    if cursor.read(words, true) != Some(ACCUSATIVE) {
        return Some(CoreResult::failure(ERROR_MALFORMED, group_len as u32));
    }
    let destination = match read_destination(words, &mut cursor) {
        Ok(destination) => destination,
        Err(error) => return Some(CoreResult::failure(error, group_len as u32)),
    };
    let right = match read_operand_with_row_index(
        &mut cursor,
        words,
        start,
        group_len,
        codelet_count,
        (destination.present != 0).then_some(destination.index),
        storage,
    ) {
        Ok(value) => value,
        Err(error) => return Some(CoreResult::failure(error, group_len as u32)),
    };
    if left.kind != right.kind {
        return Some(CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32));
    }
    if left.length != right.length {
        return Some(CoreResult::failure(ERROR_VECTOR_WIDTH, group_len as u32));
    }
    if cursor.read(words, true) != Some(INSTRUMENTAL)
        || cursor.read(words, false) != Some(SCALAR_WORD)
        || cursor.read(words, false) != Some(PRODUCE_WORD)
        || cursor.read(words, true) != Some(DEONTIC)
        || !cursor.zero_tail(words)
    {
        return Some(CoreResult::failure(ERROR_MALFORMED, group_len as u32));
    }

    if left.kind == VALUE_VECTOR_FLOAT32 {
        let mut sum = 0.0f32;
        let mut lane = 0;
        while lane < left.length {
            let left_bits = operand_f32_bits(&left, lane, storage)?;
            let right_bits = operand_f32_bits(&right, lane, storage)?;
            if left_bits & 0x7f80_0000 == 0x7f80_0000 || right_bits & 0x7f80_0000 == 0x7f80_0000 {
                return Some(CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32));
            }
            sum += f32::from_bits(left_bits) * f32::from_bits(right_bits);
            lane += 1;
        }
        let bits = sum.to_bits();
        if bits & 0x7f80_0000 == 0x7f80_0000 {
            return Some(CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32));
        }
        return Some(CoreResult::scalar(VALUE_FLOAT32, bits, 0, group_len as u32));
    }

    #[cfg(feature = "shader-f64")]
    {
        let mut sum = 0.0f64;
        let mut lane = 0;
        while lane < left.length {
            let left_bits = operand_f64_bits(&left, lane, storage)?;
            let right_bits = operand_f64_bits(&right, lane, storage)?;
            if left_bits & 0x7ff0_0000_0000_0000 == 0x7ff0_0000_0000_0000
                || right_bits & 0x7ff0_0000_0000_0000 == 0x7ff0_0000_0000_0000
            {
                return Some(CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32));
            }
            sum += f64::from_bits(left_bits) * f64::from_bits(right_bits);
            lane += 1;
        }
        let bits = sum.to_bits();
        if bits & 0x7ff0_0000_0000_0000 == 0x7ff0_0000_0000_0000 {
            return Some(CoreResult::failure(ERROR_FLOAT_DOMAIN, group_len as u32));
        }
        Some(CoreResult::scalar(
            VALUE_FLOAT64,
            bits as u32,
            (bits >> 32) as u32,
            group_len as u32,
        ))
    }
    #[cfg(not(feature = "shader-f64"))]
    {
        Some(CoreResult::failure(ERROR_UNSUPPORTED, group_len as u32))
    }
}

fn operand_f32_bits(
    operand: &VectorOperand,
    lane: usize,
    storage: &StorageView<'_>,
) -> Option<u32> {
    if operand.storage_backed {
        storage.read_payload_u32(
            operand
                .storage_byte_offset
                .checked_add(lane.checked_mul(4)?)?,
        )
    } else {
        Some(array_at!(operand.values, lane))
    }
}

#[cfg(feature = "shader-f64")]
fn operand_f64_bits(
    operand: &VectorOperand,
    lane: usize,
    storage: &StorageView<'_>,
) -> Option<u64> {
    if operand.storage_backed {
        storage.read_payload_u64(
            operand
                .storage_byte_offset
                .checked_add(lane.checked_mul(8)?)?,
        )
    } else {
        Some(
            u64::from(array_at!(operand.values, lane * 2))
                | (u64::from(array_at!(operand.values, lane * 2 + 1)) << 32),
        )
    }
}
