use super::numeric::quote_header;
use super::programlet_symbols::ProgramletWordSource;
use super::programlet_vector_storage::{read_vector_words, write_vector_words};
use super::*;
#[path = "programlet_vector_values/quote.rs"]
mod quote;
use quote::vector_from_quote;

#[path = "programlet_vector_values/floats.rs"]
mod floats;
pub(super) use floats::{read_programlet_float, write_programlet_float};

fn read_local_vector_values(
    backing: &[u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
    frame: usize,
    slot: usize,
) -> [u32; RESULT_WORDS] {
    if frame >= MAX_PROGRAMLET_CALL_DEPTH || slot >= MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS {
        return [0; RESULT_WORDS];
    }
    let base = (frame * MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS + slot) * RESULT_WORDS;
    read_vector_words(backing, base)
}

pub(super) fn write_local_vector_values(
    backing: &mut [u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
    frame: usize,
    slot: usize,
    values: &[u32; RESULT_WORDS],
) {
    if frame >= MAX_PROGRAMLET_CALL_DEPTH || slot >= MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS {
        return;
    }
    let base = (frame * MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS + slot) * RESULT_WORDS;
    write_vector_words(backing, base, values);
}

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
    source: &impl ProgramletWordSource,
    name: NameSpan,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
) -> Option<usize> {
    let mut index = 0;
    while index < slots.len() {
        let slot = array_at!(*slots, index);
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

fn name_from_field(tokens: &SentenceView<'_>, field: SentenceField) -> Result<NameSpan, u32> {
    let mut name = NameSpan::EMPTY;
    let mut kind = 0;
    let error = typed_name_span(tokens, field, &mut name, &mut kind);
    if error != 0 {
        return Err(error);
    }
    Ok(name)
}

fn vector_quote_shape(
    tokens: &SentenceView<'_>,
    field: SentenceField,
) -> Result<(u32, usize), u32> {
    if field.length == 0 {
        return Err(ERROR_MALFORMED);
    }
    let header_word = sentence_at!(*tokens, field.start);
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 || !matches!(header.scalar_bytes, 4 | 8) {
        return Err(ERROR_UNSUPPORTED);
    }
    if header_word & 0x0700 == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let words_per_lane = header.scalar_bytes as usize / 2;
    let mut cursor = field.start + 1;
    let end = field.start + field.length;
    let length = if header.explicit != 0 {
        if cursor >= end {
            return Err(ERROR_MALFORMED);
        }
        let length = sentence_at!(*tokens, cursor) as usize;
        cursor += 1;
        length
    } else {
        header
            .fixed_length
            .checked_div(words_per_lane as u32)
            .ok_or(ERROR_MALFORMED)? as usize
    };
    if length == 0 || length > MAX_VECTOR_LANES || cursor + length * words_per_lane != end {
        return Err(ERROR_VECTOR_WIDTH);
    }
    #[cfg(not(feature = "shader-f64"))]
    if header.scalar_bytes == 8 {
        return Err(ERROR_UNSUPPORTED);
    }
    Ok((
        if header.scalar_bytes == 4 {
            VALUE_VECTOR_FLOAT32
        } else {
            VALUE_VECTOR_FLOAT64
        },
        length,
    ))
}

pub(super) fn programlet_vector_argument_reference(
    tokens: &SentenceView<'_>,
    field: SentenceField,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    frame_index: usize,
    slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
) -> Result<ProgramletArgument, u32> {
    if field.length > 0 && quote_header(sentence_at!(*tokens, field.start)).valid != 0 {
        let (kind, length) = vector_quote_shape(tokens, field)?;
        return Ok(ProgramletArgument {
            role: field.role,
            value_kind: kind,
            vector_length: length as u32,
            vector_source_kind: VECTOR_SOURCE_QUOTE,
            vector_source_index: tokens.word_index(field.start) as u32,
            vector_source_length: field.length as u32,
            ..ProgramletArgument::EMPTY
        });
    }

    let name = name_from_field(tokens, field)?;
    if let Some(index) = find_argument(tokens, name, symbols, arguments) {
        let mut argument = array_at!(*arguments, index);
        if !matches!(
            argument.value_kind,
            VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64
        ) || argument.vector_source_kind == 0
        {
            return Err(ERROR_UNSUPPORTED);
        }
        argument.role = field.role;
        argument.name_offset = 0;
        argument.name_length = 0;
        return Ok(argument);
    }

    let Some(index) = find_programlet_vector_slot(tokens, name, symbols, slots) else {
        return Err(ERROR_MALFORMED);
    };
    let slot = array_at!(*slots, index);
    Ok(ProgramletArgument {
        role: field.role,
        value_kind: slot.value_kind,
        vector_length: slot.length,
        vector_source_kind: VECTOR_SOURCE_LOCAL,
        vector_source_index: index as u32,
        vector_source_frame: frame_index as u32,
        ..ProgramletArgument::EMPTY
    })
}

pub(super) fn programlet_field_is_vector(
    tokens: &SentenceView<'_>,
    field: SentenceField,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
) -> bool {
    if field.length == 0 {
        return false;
    }
    let header = quote_header(sentence_at!(*tokens, field.start));
    if header.valid != 0 {
        return header.sort == 6 && (sentence_at!(*tokens, field.start) & 0x0700) != 0;
    }
    let Ok(name) = name_from_field(tokens, field) else {
        return false;
    };
    if let Some(index) = find_argument(tokens, name, symbols, arguments) {
        if matches!(
            array_at!(*arguments, index).value_kind,
            VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64
        ) {
            return true;
        }
    }
    find_programlet_vector_slot(tokens, name, symbols, slots).is_some()
}

fn find_argument(
    source: &impl ProgramletWordSource,
    name: NameSpan,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
) -> Option<usize> {
    let mut index = 0;
    while index < arguments.len() {
        let argument = array_at!(*arguments, index);
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
    tokens: &SentenceView<'_>,
    field: SentenceField,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    frame_index: usize,
    slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    vector_values: &[u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
) -> Result<ProgramletVectorValue, u32> {
    if field.length > 0 {
        let header = quote_header(sentence_at!(*tokens, field.start));
        if header.valid != 0 {
            return vector_from_quote(tokens, tokens.word_index(field.start), field.length);
        }
    }
    let name = name_from_field(tokens, field)?;
    if let Some(index) = find_argument(tokens, name, symbols, arguments) {
        let argument = array_at!(*arguments, index);
        if !matches!(
            argument.value_kind,
            VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64
        ) || argument.vector_length == 0
            || argument.vector_length as usize > MAX_VECTOR_LANES
        {
            return Err(ERROR_UNSUPPORTED);
        }
        return match argument.vector_source_kind {
            VECTOR_SOURCE_QUOTE => {
                let source_start = argument.vector_source_index as usize;
                let source_length = argument.vector_source_length as usize;
                if !tokens.word_span_is_valid(source_start, source_length) {
                    return Err(ERROR_MALFORMED);
                }
                vector_from_quote(tokens, source_start, source_length)
            }
            VECTOR_SOURCE_LOCAL => Ok(ProgramletVectorValue {
                kind: argument.value_kind,
                length: argument.vector_length as usize,
                values: read_local_vector_values(
                    vector_values,
                    argument.vector_source_frame as usize,
                    argument.vector_source_index as usize,
                ),
            }),
            _ => Err(ERROR_UNSUPPORTED),
        };
    }
    let Some(index) = find_programlet_vector_slot(tokens, name, symbols, slots) else {
        return Err(ERROR_MALFORMED);
    };
    let slot = array_at!(*slots, index);
    Ok(ProgramletVectorValue {
        kind: slot.value_kind,
        length: slot.length as usize,
        values: read_local_vector_values(vector_values, frame_index, index),
    })
}

pub(super) fn write_programlet_vector(
    tokens: &SentenceView<'_>,
    output: SentenceField,
    symbols: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    symbol_used: &mut usize,
    result: ProgramletVectorValue,
    slots: &mut [ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    vector_values: &mut [u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
    frame_index: usize,
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
        while index < slots.len() && array_at!(*slots, index).value_kind != 0 {
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
        }
    );
    write_local_vector_values(vector_values, frame_index, target, &result.values);
    Ok(())
}

pub(super) fn write_programlet_vector_lane(
    tokens: &SentenceView<'_>,
    output: SentenceField,
    lane: usize,
    value: ProgramletNumber,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    vector_values: &mut [u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
    frame_index: usize,
) -> Result<(), u32> {
    let name = name_from_field(tokens, output)?;
    let index = find_programlet_vector_slot(tokens, name, symbols, slots).ok_or(ERROR_MALFORMED)?;
    let slot = array_at!(*slots, index);
    if lane >= slot.length as usize {
        return Err(ERROR_VECTOR_WIDTH);
    }
    let expected_kind = if slot.value_kind == VALUE_VECTOR_FLOAT32 {
        VALUE_FLOAT32
    } else if slot.value_kind == VALUE_VECTOR_FLOAT64 {
        VALUE_FLOAT64
    } else {
        return Err(ERROR_UNSUPPORTED);
    };
    if value.kind != expected_kind {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut values = read_local_vector_values(vector_values, frame_index, index);
    let offset = lane * if expected_kind == VALUE_FLOAT64 { 2 } else { 1 };
    array_put!(&mut values, offset, value.bits);
    if expected_kind == VALUE_FLOAT64 {
        array_put!(&mut values, offset + 1, value.high);
    }
    write_local_vector_values(vector_values, frame_index, index, &values);
    Ok(())
}

pub(super) fn write_programlet_vector_result(
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    return_name: NameSpan,
    expected_kind: u32,
    result_kind: u32,
    result_length: u32,
    result_values: &[u32; RESULT_WORDS],
    slots: &mut [ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    vector_values: &mut [u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
    frame_index: usize,
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
            while index < slots.len() && array_at!(*slots, index).value_kind != 0 {
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
        }
    );
    write_local_vector_values(vector_values, frame_index, target, result_values);
    Ok(())
}
