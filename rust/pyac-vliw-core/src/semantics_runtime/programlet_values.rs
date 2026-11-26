use super::*;

pub(super) fn number_value(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
) -> Result<u32, u32> {
    if field.length != 2 || sentence_at!(*tokens, field.start) != NUMBER_QUOTE {
        return Err(ERROR_MALFORMED);
    }
    let value = sentence_at!(*tokens, field.start + 1);
    if value > MAX_U16 {
        return Err(ERROR_MALFORMED);
    }
    Ok(value)
}

/// Read a width-tagged literal: `<width> <value>` where the width word bounds it.
///
/// The field is a value, not a name, so it carries a width word instead of the
/// name tag. A value wider than its width word is malformed; clamping would let
/// `3940 po` pass as a uint8.
pub(super) fn width_tagged_value(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
) -> Result<u32, u32> {
    if field.length != 2 {
        return Err(ERROR_MALFORMED);
    }
    let width_word = sentence_at!(*tokens, field.start);
    if !is_width_word(width_word) {
        return Err(ERROR_MALFORMED);
    }
    let value = sentence_at!(*tokens, field.start + 1);
    if value > MAX_U16 || !width_fits(width_word, value) {
        return Err(ERROR_MALFORMED);
    }
    Ok(value)
}

#[inline(never)]
pub(super) fn argument_value(
    arguments: [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    role: u32,
) -> ProgramletNumber {
    let argument = array_at!(arguments, 0);
    if argument.role == role {
        return ProgramletNumber {
            bits: argument.value,
            high: argument.value_high,
            kind: argument.value_kind,
        };
    }
    let argument = array_at!(arguments, 1);
    if argument.role == role {
        return ProgramletNumber {
            bits: argument.value,
            high: argument.value_high,
            kind: argument.value_kind,
        };
    }
    let argument = array_at!(arguments, 2);
    if argument.role == role {
        return ProgramletNumber {
            bits: argument.value,
            high: argument.value_high,
            kind: argument.value_kind,
        };
    }
    let argument = array_at!(arguments, 3);
    if argument.role == role {
        return ProgramletNumber {
            bits: argument.value,
            high: argument.value_high,
            kind: argument.value_kind,
        };
    }
    let argument = array_at!(arguments, 4);
    if argument.role == role {
        return ProgramletNumber {
            bits: argument.value,
            high: argument.value_high,
            kind: argument.value_kind,
        };
    }
    let argument = array_at!(arguments, 5);
    if argument.role == role {
        return ProgramletNumber {
            bits: argument.value,
            high: argument.value_high,
            kind: argument.value_kind,
        };
    }
    let argument = array_at!(arguments, 6);
    if argument.role == role {
        return ProgramletNumber {
            bits: argument.value,
            high: argument.value_high,
            kind: argument.value_kind,
        };
    }
    let argument = array_at!(arguments, 7);
    if argument.role == role {
        return ProgramletNumber {
            bits: argument.value,
            high: argument.value_high,
            kind: argument.value_kind,
        };
    }
    ProgramletNumber::EMPTY
}

pub(super) fn write_programlet_call_result(
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    return_name: NameSpan,
    expected_kind: u32,
    result: ProgramletNumber,
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<(), u32> {
    if !programlet_type_matches(expected_kind, result.kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut target_slot = find_local_slot_in_storage(symbols, return_name, slots);
    if target_slot.is_none() {
        let mut slot_index = 0;
        while slot_index < MAX_PROGRAMLET_LOCAL_SLOTS && array_at!(*slots, slot_index).kind != 0 {
            slot_index += 1;
        }
        if slot_index == MAX_PROGRAMLET_LOCAL_SLOTS {
            return Err(ERROR_FRAME_CAPACITY);
        }
        let mut slot = array_at!(*slots, slot_index);
        slot.name_offset = return_name.start as u32;
        slot.name_length = return_name.length as u32;
        slot.kind = if expected_kind == VALUE_BOOLEAN { 3 } else { 1 };
        array_put!(slots, slot_index, slot);
        target_slot = Some(slot_index);
    }
    let target_slot = target_slot.unwrap_or(0);
    let mut slot = array_at!(*slots, target_slot);
    if slot.kind == 2 || slot.kind == 4 {
        return Err(ERROR_CONSTANT_WRITE);
    }
    if (slot.kind == 3) != (expected_kind == VALUE_BOOLEAN) {
        return Err(ERROR_UNSUPPORTED);
    }
    slot.value = result.bits;
    slot.value_high = result.high;
    slot.value_kind = result.kind;
    array_put!(slots, target_slot, slot);
    Ok(())
}

pub(super) fn set_loop_index_argument(
    arguments: &mut [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    index: usize,
    value: u32,
) -> Result<(), u32> {
    set_loop_register_argument(arguments, index, FROM_INDEX, value)
}

pub(super) fn set_loop_register_argument(
    arguments: &mut [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    index: usize,
    role: u32,
    value: u32,
) -> Result<(), u32> {
    if index >= MAX_PROGRAMLET_ARGUMENTS {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let mut argument = arguments[index];
    argument.role = role;
    argument.value = value;
    argument.value_kind = VALUE_UNSIGNED;
    arguments[index] = argument;
    Ok(())
}

pub(super) fn resolve_programlet_value(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    value: &mut ProgramletNumber,
) -> u32 {
    if field.length == 2 && sentence_at!(*tokens, field.start) == NUMBER_QUOTE {
        let bits = match number_value(tokens, field) {
            Ok(bits) => bits,
            Err(error) => return error,
        };
        *value = ProgramletNumber {
            bits,
            high: 0,
            kind: VALUE_UNSIGNED,
        };
        return 0;
    }
    // A width-tagged literal: the width word bounds the value that follows.
    if field.length == 2 && is_width_word(sentence_at!(*tokens, field.start)) {
        let bits = match width_tagged_value(tokens, field) {
            Ok(bits) => bits,
            Err(error) => return error,
        };
        *value = ProgramletNumber {
            bits,
            high: 0,
            kind: VALUE_UNSIGNED,
        };
        return 0;
    }
    if field.length == 1 && matches!(sentence_at!(*tokens, field.start), TRUTH | LIE) {
        *value = ProgramletNumber {
            bits: u32::from(sentence_at!(*tokens, field.start) == TRUTH),
            high: 0,
            kind: VALUE_BOOLEAN,
        };
        return 0;
    }
    if field.length == 5
        && sentence_at!(*tokens, field.start) == THIS_WORD
        && sentence_at!(*tokens, field.start + 1) == GENITIVE_CASE
        && sentence_at!(*tokens, field.start + 3) == GENITIVE_CASE
    {
        let argument = argument_value(*arguments, sentence_at!(*tokens, field.start + 2));
        if argument.kind == 0 {
            return ERROR_MALFORMED;
        }
        let expected_kind = match sentence_at!(*tokens, field.start + 4) {
            NUMBER_TYPE => VALUE_NUMBER,
            BOOLEAN_TYPE => VALUE_BOOLEAN,
            _ => return ERROR_UNSUPPORTED,
        };
        if !number_kind_matches(expected_kind, argument.kind) {
            return ERROR_UNSUPPORTED;
        }
        *value = argument;
        return 0;
    }
    let typed_name_genitive = field.length == 4
        && sentence_at!(*tokens, field.start) == NAME_TYPE
        && sentence_at!(*tokens, field.start + 2) == GENITIVE_CASE;
    let bare_name_genitive =
        field.length == 3 && sentence_at!(*tokens, field.start + 1) == GENITIVE_CASE;
    let genitive_type = if typed_name_genitive {
        sentence_at!(*tokens, field.start + 3)
    } else if bare_name_genitive {
        sentence_at!(*tokens, field.start + 2)
    } else {
        0
    };
    if matches!(genitive_type, NUMBER_TYPE | BOOLEAN_TYPE) {
        let expected_kind = if genitive_type == NUMBER_TYPE {
            VALUE_NUMBER
        } else {
            VALUE_BOOLEAN
        };
        let name = NameSpan {
            start: field.start,
            length: if typed_name_genitive { 2 } else { 1 },
        };
        let Some(index) = find_local_slot(tokens, name, symbols, slots) else {
            return ERROR_UNSUPPORTED;
        };
        let slot = array_at!(*slots, index);
        if !number_kind_matches(expected_kind, slot.value_kind) {
            return ERROR_UNSUPPORTED;
        }
        *value = ProgramletNumber {
            bits: slot.value,
            high: slot.value_high,
            kind: slot.value_kind,
        };
        return 0;
    }
    // `<class words…> [gi] <name>`: the class words say what the local holds and
    // `gi` marks the name. `gi` alone is an untyped name.
    let mut index = field.start;
    let mut expected_kind = 0;
    while index < field.start + field.length {
        match sentence_at!(*tokens, index) {
            BOOLEAN_TYPE => {
                expected_kind = VALUE_BOOLEAN;
                index += 1;
            }
            NUMBER_TYPE | PAUCAL_WIDTH | PLURAL_WIDTH | MULTAL_WIDTH => {
                expected_kind = VALUE_NUMBER;
                index += 1;
            }
            _ => break,
        }
    }
    if index == field.start && sentence_at!(*tokens, field.start) != NAME_TYPE {
        return ERROR_UNSUPPORTED;
    }
    if sentence_at!(*tokens, index) == NAME_TYPE {
        index += 1;
    }
    let typed_number = expected_kind == VALUE_NUMBER;
    let typed_boolean = expected_kind == VALUE_BOOLEAN;
    let name_start = index;
    let name = NameSpan {
        start: name_start,
        length: field.start + field.length - name_start,
    };
    let Some(index) = find_local_slot(tokens, name, symbols, slots) else {
        return ERROR_MALFORMED;
    };
    let slot = array_at!(*slots, index);
    if typed_number && !number_kind_matches(VALUE_NUMBER, slot.value_kind) {
        return ERROR_UNSUPPORTED;
    }
    if typed_boolean && slot.value_kind != VALUE_BOOLEAN {
        return ERROR_UNSUPPORTED;
    }
    if !matches!(
        slot.value_kind,
        VALUE_UNSIGNED | VALUE_SIGNED | VALUE_BOOLEAN
    ) {
        return ERROR_UNSUPPORTED;
    }
    *value = ProgramletNumber {
        bits: slot.value,
        high: slot.value_high,
        kind: slot.value_kind,
    };
    0
}

pub(super) fn loop_iterations(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
) -> Result<u32, u32> {
    let start = optional_number_field(sentence, FROM_INDEX, tokens)?;
    let end = optional_number_field(sentence, TO_INDEX, tokens)?;
    if end.is_some() && start.is_none() {
        return Err(ERROR_MALFORMED);
    }
    Ok(match (start, end) {
        (Some(start), Some(end)) => start.abs_diff(end),
        (Some(start), None) => start,
        _ => 0,
    })
}

pub(super) fn optional_number_field(
    sentence: &ParsedSentence,
    role: u32,
    tokens: &SentenceView<'_, impl VliwWord>,
) -> Result<Option<u32>, u32> {
    match sentence.field(role) {
        Some(field) => match number_value(tokens, field) {
            Ok(value) => Ok(Some(value)),
            Err(error) => Err(error),
        },
        None => Ok(None),
    }
}

pub(super) fn comparison_operand(
    tokens: &SentenceView<'_, impl VliwWord>,
    start: usize,
    end: usize,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    value: &mut ProgramletNumber,
) -> u32 {
    let Some(length) = end.checked_sub(start) else {
        return ERROR_MALFORMED;
    };
    let field = SentenceField {
        role: 0,
        start,
        length,
    };
    let error = resolve_programlet_value(tokens, field, symbols, arguments, slots, value);
    if error != 0 {
        return error;
    }
    if !matches!(value.kind, VALUE_UNSIGNED | VALUE_SIGNED | VALUE_BOOLEAN) {
        return ERROR_UNSUPPORTED;
    }
    0
}
