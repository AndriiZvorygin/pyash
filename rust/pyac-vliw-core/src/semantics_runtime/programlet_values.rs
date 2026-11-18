use super::*;

pub(super) fn number_kind_matches(expected: u32, actual: u32) -> bool {
    if expected == VALUE_NUMBER {
        matches!(actual, VALUE_NUMBER | VALUE_UNSIGNED | VALUE_SIGNED)
    } else {
        expected == actual
    }
}

pub(super) fn compare_programlet_numbers(left: ProgramletNumber, right: ProgramletNumber) -> u32 {
    match (left.kind == VALUE_SIGNED, right.kind == VALUE_SIGNED) {
        (true, true) => compare_signed(left.bits as i32, right.bits as i32),
        (true, false) => {
            let left = left.bits as i32;
            if left < 0 {
                0
            } else {
                compare_unsigned(left as u32, right.bits)
            }
        }
        (false, true) => {
            let signed_right = right.bits as i32;
            if signed_right < 0 {
                2
            } else {
                compare_unsigned(left.bits, signed_right as u32)
            }
        }
        (false, false) => compare_unsigned(left.bits, right.bits),
    }
}

pub(super) fn compare_signed(left: i32, right: i32) -> u32 {
    if left < right {
        0
    } else if left > right {
        2
    } else {
        1
    }
}

pub(super) fn compare_unsigned(left: u32, right: u32) -> u32 {
    if left < right {
        0
    } else if left > right {
        2
    } else {
        1
    }
}

pub(super) fn number_value(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
) -> Result<u32, u32> {
    if field.length != 2 || array_at!(tokens, field.start) != NUMBER_QUOTE {
        return Err(ERROR_MALFORMED);
    }
    let value = array_at!(tokens, field.start + 1);
    if value > MAX_U16 {
        return Err(ERROR_MALFORMED);
    }
    Ok(value)
}

pub(super) fn argument_value(
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    role: u32,
    value: &mut ProgramletNumber,
) -> bool {
    let mut index = 0;
    while index < arguments.len() {
        let argument = array_at!(arguments, index);
        if argument.role == role {
            *value = ProgramletNumber {
                bits: argument.value,
                kind: argument.value_kind,
            };
            return true;
        }
        index += 1;
    }
    false
}

pub(super) fn write_programlet_call_result(
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    return_name: NameSpan,
    expected_kind: u32,
    result: ProgramletNumber,
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<(), u32> {
    if !number_kind_matches(expected_kind, result.kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut target_slot = find_local_slot(symbols, return_name, symbols, slots);
    if target_slot.is_none() {
        let mut slot_index = 0;
        while slot_index < MAX_PROGRAMLET_LOCAL_SLOTS && array_at!(slots, slot_index).kind != 0 {
            slot_index += 1;
        }
        if slot_index == MAX_PROGRAMLET_LOCAL_SLOTS {
            return Err(ERROR_FRAME_CAPACITY);
        }
        let mut slot = array_at!(slots, slot_index);
        slot.name_offset = return_name.start as u32;
        slot.name_length = return_name.length as u32;
        slot.kind = if expected_kind == VALUE_BOOLEAN { 3 } else { 1 };
        array_put!(slots, slot_index, slot);
        target_slot = Some(slot_index);
    }
    let target_slot = target_slot.unwrap_or(0);
    let mut slot = array_at!(slots, target_slot);
    if slot.kind == 2 || slot.kind == 4 {
        return Err(ERROR_CONSTANT_WRITE);
    }
    if (slot.kind == 3) != (expected_kind == VALUE_BOOLEAN) {
        return Err(ERROR_UNSUPPORTED);
    }
    slot.value = result.bits;
    slot.value_kind = result.kind;
    array_put!(slots, target_slot, slot);
    Ok(())
}

pub(super) fn set_loop_index_argument(
    arguments: &mut [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    value: u32,
) -> Result<(), u32> {
    set_loop_register_argument(arguments, FROM_INDEX, value)
}

pub(super) fn set_loop_register_argument(
    arguments: &mut [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    role: u32,
    value: u32,
) -> Result<(), u32> {
    let mut empty_index = arguments.len();
    let mut index = 0;
    while index < arguments.len() {
        let mut argument = array_at!(arguments, index);
        if argument.role == role {
            argument.value = value;
            argument.value_kind = VALUE_UNSIGNED;
            array_put!(arguments, index, argument);
            return Ok(());
        }
        if argument.role == 0 && empty_index == arguments.len() {
            empty_index = index;
        }
        index += 1;
    }
    if empty_index == arguments.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    array_put!(
        arguments,
        empty_index,
        ProgramletArgument {
            role,
            value,
            value_kind: VALUE_UNSIGNED,
        }
    );
    Ok(())
}

pub(super) fn resolve_programlet_value(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    value: &mut ProgramletNumber,
) -> u32 {
    if field.length == 2 && array_at!(tokens, field.start) == NUMBER_QUOTE {
        let bits = match number_value(tokens, field) {
            Ok(bits) => bits,
            Err(error) => return error,
        };
        *value = ProgramletNumber {
            bits,
            kind: VALUE_UNSIGNED,
        };
        return 0;
    }
    if field.length == 1 && matches!(array_at!(tokens, field.start), TRUTH | LIE) {
        *value = ProgramletNumber {
            bits: u32::from(array_at!(tokens, field.start) == TRUTH),
            kind: VALUE_BOOLEAN,
        };
        return 0;
    }
    if field.length == 5
        && array_at!(tokens, field.start) == THIS_WORD
        && array_at!(tokens, field.start + 1) == GENITIVE_CASE
        && array_at!(tokens, field.start + 3) == GENITIVE_CASE
    {
        let mut argument = ProgramletNumber::EMPTY;
        if !argument_value(arguments, array_at!(tokens, field.start + 2), &mut argument) {
            return ERROR_MALFORMED;
        }
        let expected_kind = match array_at!(tokens, field.start + 4) {
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
        && array_at!(tokens, field.start) == NAME_TYPE
        && array_at!(tokens, field.start + 2) == GENITIVE_CASE;
    let bare_name_genitive =
        field.length == 3 && array_at!(tokens, field.start + 1) == GENITIVE_CASE;
    let genitive_type = if typed_name_genitive {
        array_at!(tokens, field.start + 3)
    } else if bare_name_genitive {
        array_at!(tokens, field.start + 2)
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
        let slot = array_at!(slots, index);
        if !number_kind_matches(expected_kind, slot.value_kind) {
            return ERROR_UNSUPPORTED;
        }
        *value = ProgramletNumber {
            bits: slot.value,
            kind: slot.value_kind,
        };
        return 0;
    }
    if array_at!(tokens, field.start) != NAME_TYPE {
        return ERROR_UNSUPPORTED;
    }
    let typed_number = field.length >= 4
        && array_at!(tokens, field.start + 1) == NUMBER_TYPE
        && array_at!(tokens, field.start + 2) == NAME_TYPE;
    let typed_boolean = field.length >= 4
        && array_at!(tokens, field.start + 1) == BOOLEAN_TYPE
        && array_at!(tokens, field.start + 2) == NAME_TYPE;
    if field.length > 2 && !typed_number && !typed_boolean {
        return ERROR_UNSUPPORTED;
    }
    let mut name = NameSpan::EMPTY;
    let name_error = name_span(tokens, field, typed_number || typed_boolean, &mut name);
    if name_error != 0 {
        return name_error;
    }
    let Some(index) = find_local_slot(tokens, name, symbols, slots) else {
        return ERROR_MALFORMED;
    };
    let slot = array_at!(slots, index);
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
        kind: slot.value_kind,
    };
    0
}

pub(super) fn capture_programlet_arguments(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    captured: &mut [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    captured_count: &mut u32,
) -> Result<(), u32> {
    *captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let mut count = 0usize;
    let mut index = 0;
    while index < sentence.field_count {
        let field = array_at!(sentence.fields, index);
        if !matches!(field.role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) {
            if count == MAX_PROGRAMLET_ARGUMENTS {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let mut value = ProgramletNumber::EMPTY;
            let value_error =
                resolve_programlet_value(tokens, field, symbols, arguments, slots, &mut value);
            if value_error != 0 {
                return Err(value_error);
            }
            array_put!(
                captured,
                count,
                ProgramletArgument {
                    role: field.role,
                    value: value.bits,
                    value_kind: value.kind,
                }
            );
            count += 1;
        }
        index += 1;
    }
    *captured_count = count as u32;
    Ok(())
}

pub(super) fn validate_programlet_arguments(
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    routine_start: usize,
    tokens: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    argument_count: u32,
) -> Result<(), u32> {
    if argument_count as usize > arguments.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let definition_at = routine_start.checked_sub(1).ok_or(ERROR_MALFORMED)?;
    let (length, _) = collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        definition_at,
        tokens,
        boundaries,
    )?;
    let mut definition = ParsedSentence::empty();
    let parse_error = parse_sentence(tokens, boundaries, length, &mut definition);
    if parse_error != 0 {
        return Err(parse_error);
    }
    if !is_ceremony_definition(&definition, tokens) {
        return Err(ERROR_MALFORMED);
    }

    let mut formal_count = 0usize;
    let mut field_index = 0;
    while field_index < definition.field_count {
        let formal = array_at!(definition.fields, field_index);
        if !matches!(
            formal.role,
            NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX
        ) {
            if formal_count >= MAX_PROGRAMLET_ARGUMENTS {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let expected_kind = if formal.length == 2
                && array_at!(tokens, formal.start) == NUMBER_QUOTE
            {
                VALUE_NUMBER
            } else if formal.length == 1 && matches!(array_at!(tokens, formal.start), TRUTH | LIE) {
                VALUE_BOOLEAN
            } else {
                return Err(ERROR_UNSUPPORTED);
            };
            let mut argument_index = 0;
            while argument_index < argument_count as usize
                && array_at!(arguments, argument_index).role != formal.role
            {
                argument_index += 1;
            }
            if argument_index == argument_count as usize {
                return Err(ERROR_MALFORMED);
            }
            let argument = array_at!(arguments, argument_index);
            if !number_kind_matches(expected_kind, argument.value_kind) {
                return Err(ERROR_UNSUPPORTED);
            }
            formal_count += 1;
        }
        field_index += 1;
    }
    if formal_count != argument_count as usize {
        return Err(ERROR_MALFORMED);
    }
    Ok(())
}

pub(super) fn loop_iterations(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
) -> Result<u32, u32> {
    let start = sentence
        .field(FROM_INDEX)
        .map(|field| number_value(tokens, field))
        .transpose()?;
    let end = sentence
        .field(TO_INDEX)
        .map(|field| number_value(tokens, field))
        .transpose()?;
    if end.is_some() && start.is_none() {
        return Err(ERROR_MALFORMED);
    }
    Ok(match (start, end) {
        (Some(start), Some(end)) => start.abs_diff(end),
        (Some(start), None) => start,
        _ => 0,
    })
}

pub(super) fn comparison_operand(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    start: usize,
    end: usize,
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
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
