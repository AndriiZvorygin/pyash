use super::numeric::quote_header;
use super::*;

#[derive(Clone, Copy)]
pub(super) struct ProgramletVectorValue {
    pub kind: u32,
    pub length: usize,
    pub values: [u32; RESULT_WORDS],
}

impl ProgramletVectorValue {
    const EMPTY: Self = Self {
        kind: 0,
        length: 0,
        values: [0; RESULT_WORDS],
    };
}

pub(super) fn find_programlet_vector_slot(
    source: &[u32; PROGRAMLET_SCRATCH_WORDS],
    name: NameSpan,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
) -> Option<usize> {
    let mut index = 0;
    while index < slots.len() {
        let slot = array_at!(slots, index);
        if slot.value_kind != 0
            && names_equal(
                source,
                name,
                symbols,
                NameSpan {
                    start: slot.name_offset as usize,
                    length: slot.name_length as usize,
                },
            )
        {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn name_from_field(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
) -> Result<NameSpan, u32> {
    let mut name = NameSpan::EMPTY;
    let mut kind = 0;
    let error = typed_name_span(tokens, field, &mut name, &mut kind);
    if error != 0 {
        return Err(error);
    }
    Ok(name)
}

pub(super) fn programlet_field_is_vector(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
) -> bool {
    if field.length == 0 {
        return false;
    }
    let header = quote_header(array_at!(tokens, field.start));
    if header.valid != 0 {
        return header.sort == 6 && (array_at!(tokens, field.start) & 0x0700) != 0;
    }
    let Ok(name) = name_from_field(tokens, field) else {
        return false;
    };
    find_argument(tokens, name, symbols, arguments).is_some_and(|index| {
        matches!(
            array_at!(arguments, index).value_kind,
            VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64
        )
    }) || find_programlet_vector_slot(tokens, name, symbols, slots).is_some()
}

fn vector_from_quote(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
) -> Result<ProgramletVectorValue, u32> {
    if field.length == 0 {
        return Err(ERROR_MALFORMED);
    }
    let header_word = array_at!(tokens, field.start);
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 || !matches!(header.scalar_bytes, 4 | 8) {
        return Err(ERROR_UNSUPPORTED);
    }
    let is_vector = (header_word & 0x0700) != 0;
    if !is_vector {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut cursor = field.start + 1;
    let end = field.start + field.length;
    let length = if header.explicit != 0 {
        if cursor >= end {
            return Err(ERROR_MALFORMED);
        }
        let length = array_at!(tokens, cursor) as usize;
        cursor += 1;
        length
    } else {
        header.fixed_length as usize / (header.scalar_bytes as usize / 2)
    };
    let words_per_lane = header.scalar_bytes as usize / 2;
    if length == 0 || length > MAX_VECTOR_LANES || cursor + length * words_per_lane != end {
        return Err(ERROR_VECTOR_WIDTH);
    }
    let kind = if header.scalar_bytes == 4 {
        VALUE_VECTOR_FLOAT32
    } else {
        VALUE_VECTOR_FLOAT64
    };
    let mut value = ProgramletVectorValue {
        kind,
        length,
        ..ProgramletVectorValue::EMPTY
    };
    let mut lane = 0;
    while lane < length {
        let low = array_at!(tokens, cursor) | (array_at!(tokens, cursor + 1) << 16);
        if kind == VALUE_VECTOR_FLOAT32 {
            if low & 0x7f80_0000 == 0x7f80_0000 {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            array_put!(&mut value.values, lane, low);
        } else {
            #[cfg(not(feature = "shader-f64"))]
            return Err(ERROR_UNSUPPORTED);
            #[cfg(feature = "shader-f64")]
            {
                let high = array_at!(tokens, cursor + 2) | (array_at!(tokens, cursor + 3) << 16);
                if high & 0x7ff0_0000 == 0x7ff0_0000 {
                    return Err(ERROR_FLOAT_DOMAIN);
                }
                array_put!(&mut value.values, lane * 2, low);
                array_put!(&mut value.values, lane * 2 + 1, high);
            }
        }
        cursor += words_per_lane;
        lane += 1;
    }
    Ok(value)
}

fn find_argument(
    source: &[u32; PROGRAMLET_SCRATCH_WORDS],
    name: NameSpan,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
) -> Option<usize> {
    let mut index = 0;
    while index < arguments.len() {
        let argument = array_at!(arguments, index);
        if argument.name_length != 0
            && names_equal(
                source,
                name,
                symbols,
                NameSpan {
                    start: argument.name_offset as usize,
                    length: argument.name_length as usize,
                },
            )
        {
            return Some(index);
        }
        index += 1;
    }
    None
}

pub(super) fn read_programlet_vector(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
) -> Result<ProgramletVectorValue, u32> {
    if field.length > 0 {
        let header = quote_header(array_at!(tokens, field.start));
        if header.valid != 0 {
            return vector_from_quote(tokens, field);
        }
    }
    let name = name_from_field(tokens, field)?;
    if let Some(index) = find_argument(tokens, name, symbols, arguments) {
        let argument = array_at!(arguments, index);
        if !matches!(
            argument.value_kind,
            VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64
        ) || argument.vector_length == 0
            || argument.vector_length as usize > MAX_VECTOR_LANES
        {
            return Err(ERROR_UNSUPPORTED);
        }
        return Ok(ProgramletVectorValue {
            kind: argument.value_kind,
            length: argument.vector_length as usize,
            values: argument.vector_values,
        });
    }
    let Some(index) = find_programlet_vector_slot(tokens, name, symbols, slots) else {
        return Err(ERROR_MALFORMED);
    };
    let slot = array_at!(slots, index);
    Ok(ProgramletVectorValue {
        kind: slot.value_kind,
        length: slot.length as usize,
        values: slot.values,
    })
}

pub(super) fn write_programlet_vector(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    output: SentenceField,
    symbols: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_used: &mut usize,
    result: ProgramletVectorValue,
    slots: &mut [ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
) -> Result<(), u32> {
    let mut name = NameSpan::EMPTY;
    let mut expected_kind = 0;
    let error = typed_name_span(tokens, output, &mut name, &mut expected_kind);
    if error != 0 {
        return Err(error);
    }
    if !programlet_type_matches(expected_kind, result.kind)
        || result.length == 0
        || result.length > MAX_VECTOR_LANES
    {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut stored = NameSpan::EMPTY;
    let error = store_name(tokens, name, symbols, symbol_used, &mut stored);
    if error != 0 {
        return Err(error);
    }
    let target = if let Some(index) = find_programlet_vector_slot(tokens, name, symbols, slots) {
        index
    } else {
        let mut index = 0;
        while index < slots.len() && array_at!(slots, index).value_kind != 0 {
            index += 1;
        }
        if index == slots.len() {
            return Err(ERROR_FRAME_CAPACITY);
        }
        index
    };
    array_put!(
        slots,
        target,
        ProgramletVectorSlot {
            name_offset: stored.start as u32,
            name_length: stored.length as u32,
            value_kind: result.kind,
            length: result.length as u32,
            values: result.values,
        }
    );
    Ok(())
}

pub(super) fn write_programlet_vector_result(
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    return_name: NameSpan,
    expected_kind: u32,
    result_kind: u32,
    result_length: u32,
    result_values: &[u32; RESULT_WORDS],
    slots: &mut [ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
) -> Result<(), u32> {
    if !programlet_type_matches(expected_kind, result_kind)
        || result_length == 0
        || result_length as usize > MAX_VECTOR_LANES
    {
        return Err(ERROR_UNSUPPORTED);
    }
    let target =
        if let Some(index) = find_programlet_vector_slot(symbols, return_name, symbols, slots) {
            index
        } else {
            let mut index = 0;
            while index < slots.len() && array_at!(slots, index).value_kind != 0 {
                index += 1;
            }
            if index == slots.len() {
                return Err(ERROR_FRAME_CAPACITY);
            }
            index
        };
    array_put!(
        slots,
        target,
        ProgramletVectorSlot {
            name_offset: return_name.start as u32,
            name_length: return_name.length as u32,
            value_kind: result_kind,
            length: result_length,
            values: *result_values,
        }
    );
    Ok(())
}

pub(super) fn read_programlet_float(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<ProgramletNumber, u32> {
    if field.length > 0 {
        let header_word = array_at!(tokens, field.start);
        let header = quote_header(header_word);
        if header.valid != 0 {
            if header.sort != 6 || header.explicit != 0 || header_word & 0x0700 != 0 {
                return Err(ERROR_UNSUPPORTED);
            }
            let value = match (header.scalar_bytes, field.length) {
                (4, 3) => ProgramletNumber {
                    bits: array_at!(tokens, field.start + 1)
                        | (array_at!(tokens, field.start + 2) << 16),
                    high: 0,
                    kind: VALUE_FLOAT32,
                },
                #[cfg(feature = "shader-f64")]
                (8, 5) => ProgramletNumber {
                    bits: array_at!(tokens, field.start + 1)
                        | (array_at!(tokens, field.start + 2) << 16),
                    high: array_at!(tokens, field.start + 3)
                        | (array_at!(tokens, field.start + 4) << 16),
                    kind: VALUE_FLOAT64,
                },
                _ => return Err(ERROR_UNSUPPORTED),
            };
            return Ok(value);
        }
    }
    let name = name_from_field(tokens, field)?;
    if let Some(index) = find_argument(tokens, name, symbols, arguments) {
        let argument = array_at!(arguments, index);
        if !matches!(argument.value_kind, VALUE_FLOAT32 | VALUE_FLOAT64) {
            return Err(ERROR_UNSUPPORTED);
        }
        return Ok(ProgramletNumber {
            bits: argument.value,
            high: argument.value_high,
            kind: argument.value_kind,
        });
    }
    let Some(index) = find_local_slot(tokens, name, symbols, slots) else {
        return Err(ERROR_MALFORMED);
    };
    let slot = array_at!(slots, index);
    if !matches!(slot.value_kind, VALUE_FLOAT32 | VALUE_FLOAT64) {
        return Err(ERROR_UNSUPPORTED);
    }
    Ok(ProgramletNumber {
        bits: slot.value,
        high: slot.value_high,
        kind: slot.value_kind,
    })
}

pub(super) fn write_programlet_float(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    output: SentenceField,
    symbols: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_used: &mut usize,
    expected_kind: u32,
    result: ProgramletNumber,
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<(), u32> {
    let mut name = NameSpan::EMPTY;
    let mut output_kind = 0;
    let error = typed_name_span(tokens, output, &mut name, &mut output_kind);
    if error != 0 {
        return Err(error);
    }
    if output_kind != expected_kind || !programlet_type_matches(expected_kind, result.kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut stored = NameSpan::EMPTY;
    let error = store_name(tokens, name, symbols, symbol_used, &mut stored);
    if error != 0 {
        return Err(error);
    }
    let target = if let Some(index) = find_local_slot(tokens, name, symbols, slots) {
        index
    } else {
        let mut index = 0;
        while index < slots.len() && array_at!(slots, index).kind != 0 {
            index += 1;
        }
        if index == slots.len() {
            return Err(ERROR_FRAME_CAPACITY);
        }
        index
    };
    let prior = array_at!(slots, target);
    if prior.kind == 2 || prior.kind == 4 {
        return Err(ERROR_CONSTANT_WRITE);
    }
    array_put!(
        slots,
        target,
        NumericLocalSlot {
            name_offset: stored.start as u32,
            name_length: stored.length as u32,
            value: result.bits,
            value_high: result.high,
            kind: 1,
            value_kind: result.kind,
        }
    );
    Ok(())
}
