use super::*;

pub(crate) fn read_programlet_float(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<ProgramletNumber, u32> {
    if field.length > 0 {
        let header_word = sentence_at!(*tokens, field.start);
        let header = quote_header(header_word);
        if header.valid != 0 {
            if header.sort != 6 || header.explicit != 0 || header_word & 0x0700 != 0 {
                return Err(ERROR_UNSUPPORTED);
            }
            let value = match (header.scalar_bytes, field.length) {
                (4, 3) => ProgramletNumber {
                    bits: sentence_at!(*tokens, field.start + 1)
                        | (sentence_at!(*tokens, field.start + 2) << 16),
                    high: 0,
                    kind: VALUE_FLOAT32,
                },
                #[cfg(feature = "shader-f64")]
                (8, 5) => ProgramletNumber {
                    bits: sentence_at!(*tokens, field.start + 1)
                        | (sentence_at!(*tokens, field.start + 2) << 16),
                    high: sentence_at!(*tokens, field.start + 3)
                        | (sentence_at!(*tokens, field.start + 4) << 16),
                    kind: VALUE_FLOAT64,
                },
                _ => return Err(ERROR_UNSUPPORTED),
            };
            return Ok(value);
        }
    }
    let name = name_from_field(tokens, field)?;
    if let Some(index) = find_argument(tokens, name, symbols, arguments) {
        let argument = array_at!(*arguments, index);
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
    let slot = array_at!(*slots, index);
    if !matches!(slot.value_kind, VALUE_FLOAT32 | VALUE_FLOAT64) {
        return Err(ERROR_UNSUPPORTED);
    }
    Ok(ProgramletNumber {
        bits: slot.value,
        high: slot.value_high,
        kind: slot.value_kind,
    })
}

pub(crate) fn write_programlet_float(
    tokens: &SentenceView<'_, impl VliwWord>,
    output: SentenceField,
    symbols: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
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
        while index < slots.len() && array_at!(*slots, index).kind != 0 {
            index += 1;
        }
        if index == slots.len() {
            return Err(ERROR_FRAME_CAPACITY);
        }
        index
    };
    let prior = array_at!(*slots, target);
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
