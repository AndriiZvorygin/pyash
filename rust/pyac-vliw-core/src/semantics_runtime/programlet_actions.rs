use super::*;

#[inline(never)]
pub(super) fn apply_programlet_number_action(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    frames: &mut ProgramletStack,
    frame_index: usize,
) -> Result<(), u32> {
    let arguments = array_at!(frames.arguments, frame_index);
    if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
        return Err(ERROR_MALFORMED);
    }
    let slots = frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, frame_index);
    if sentence.verb_length != 1 {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(to) = sentence.field(DESTINATION) else {
        return Err(ERROR_MALFORMED);
    };
    let mut target_name = NameSpan::EMPTY;
    let name_error = name_span(tokens, to, true, &mut target_name);
    if name_error != 0 {
        return Err(name_error);
    }
    let Some(target_index) = find_local_slot(tokens, target_name, symbols, slots) else {
        return Err(ERROR_MALFORMED);
    };
    let mut target = array_at!(*slots, target_index);
    match target.kind {
        1 => {}
        2 | 4 => return Err(ERROR_CONSTANT_WRITE),
        _ => return Err(ERROR_UNSUPPORTED),
    }

    let ob = sentence.field(ACCUSATIVE);
    let from = sentence.field(SOURCE);
    let by = sentence.field(INSTRUMENTAL);
    let with = sentence.field(COMITATIVE);
    let mut ob_value = ProgramletNumber::EMPTY;
    let mut from_value = ProgramletNumber::EMPTY;
    let mut by_value = ProgramletNumber::EMPTY;
    let mut with_value = ProgramletNumber::EMPTY;
    let ob_present = ob.is_some();
    let from_present = from.is_some();
    let by_present = by.is_some();
    let with_present = with.is_some();
    let mut operand_index = 0;
    while operand_index < 4 {
        let field = match operand_index {
            0 => ob,
            1 => from,
            2 => by,
            _ => with,
        };
        if let Some(field) = field {
            let mut value = ProgramletNumber::EMPTY;
            let error = read_optional_programlet_number(
                true, field, tokens, symbols, &arguments, slots, &mut value,
            );
            if error != 0 {
                return Err(error);
            }
            match operand_index {
                0 => ob_value = value,
                1 => from_value = value,
                2 => by_value = value,
                _ => with_value = value,
            }
        }
        operand_index += 1;
    }
    let operator = sentence_at!(*tokens, sentence.verb_start);

    if operator == INVERT {
        if from_present || by_present || with_present {
            return Err(ERROR_UNSUPPORTED);
        }
        if !ob_present {
            return Err(ERROR_MALFORMED);
        }
        let operand = ob_value;
        let signed = if operand.kind == VALUE_SIGNED {
            operand.bits as i32
        } else if operand.bits <= MAX_U16 {
            operand.bits as i32
        } else {
            return Err(ERROR_UNSUPPORTED);
        };
        let Some(result) = signed.checked_neg() else {
            return Err(ERROR_UNSUPPORTED);
        };
        target.value = result as u32;
        target.value_kind = VALUE_SIGNED;
        array_put!(slots, target_index, target);
        return Ok(());
    }

    let ob_bits = unsigned_programlet_operand(ob_present, ob_value)?;
    let from_bits = unsigned_programlet_operand(from_present, from_value)?;
    let by_bits = unsigned_programlet_operand(by_present, by_value)?;
    let with_bits = unsigned_programlet_operand(with_present, with_value)?;

    let (left, right) = match operator {
        PLUS if !from_present => {
            if !ob_present {
                return Err(ERROR_MALFORMED);
            }
            (target.value, ob_bits)
        }
        PLUS if ob_present => (ob_bits, from_bits),
        PLUS => return Err(ERROR_MALFORMED),
        SUBTRACT if from_present && ob_present => (from_bits, ob_bits),
        SUBTRACT if ob_present => (target.value, ob_bits),
        MULTIPLY | DIVIDE => (
            first_present_operand(ob_present, ob_bits, from_present, from_bits)?,
            first_present_operand(by_present, by_bits, with_present, with_bits)?,
        ),
        EXPONENTIAL => {
            if !ob_present {
                return Err(ERROR_MALFORMED);
            }
            (
                ob_bits,
                first_present_operand(from_present, from_bits, by_present, by_bits)?,
            )
        }
        XOR => {
            if !ob_present {
                return Err(ERROR_MALFORMED);
            }
            (
                ob_bits,
                if with_present {
                    with_bits
                } else {
                    first_present_operand(from_present, from_bits, by_present, by_bits)?
                },
            )
        }
        REMAINS => {
            if !ob_present {
                return Err(ERROR_MALFORMED);
            }
            (
                ob_bits,
                first_present_operand(from_present, from_bits, by_present, by_bits)?,
            )
        }
        _ => return Err(ERROR_UNSUPPORTED),
    };
    target.value = number_operator(operator, left, right)?;
    target.value_kind = VALUE_UNSIGNED;
    array_put!(slots, target_index, target);
    Ok(())
}

#[inline(never)]
pub(super) fn apply_programlet_boolean_action(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<(), u32> {
    let Some(to) = sentence.field(DESTINATION) else {
        return Err(ERROR_MALFORMED);
    };
    let mut target_name = NameSpan::EMPTY;
    let mut target_kind = 0;
    let output_error = typed_output_name(tokens, to, &mut target_name, &mut target_kind);
    if output_error != 0 {
        return Err(output_error);
    }
    if target_kind != VALUE_BOOLEAN {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(target_index) = find_local_slot(tokens, target_name, symbols, slots) else {
        return Err(ERROR_MALFORMED);
    };
    let mut target = array_at!(*slots, target_index);
    match target.kind {
        3 => {}
        4 => return Err(ERROR_CONSTANT_WRITE),
        _ => return Err(ERROR_UNSUPPORTED),
    }
    let Some(ob) = sentence.field(ACCUSATIVE) else {
        return Err(ERROR_MALFORMED);
    };
    let mut value = ProgramletNumber::EMPTY;
    let error = resolve_programlet_value(tokens, ob, symbols, arguments, slots, &mut value);
    if error != 0 {
        return Err(error);
    }
    if value.kind != VALUE_BOOLEAN {
        return Err(ERROR_UNSUPPORTED);
    }
    target.value = value.bits;
    target.value_kind = VALUE_BOOLEAN;
    array_put!(slots, target_index, target);
    Ok(())
}
