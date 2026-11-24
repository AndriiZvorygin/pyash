use super::*;

pub(super) fn capture_programlet_arguments(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    vector_slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    frame_index: usize,
    captured: &mut [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    captured_count: &mut u32,
) -> Result<(), u32> {
    *captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let mut count = 0usize;
    let fields = sentence.fields;
    let mut index = 0;
    while index < sentence.field_count {
        let field = array_at!(fields, index);
        if !matches!(field.role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) {
            if count == MAX_PROGRAMLET_ARGUMENTS {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let mut value = ProgramletNumber::EMPTY;
            let scalar_error =
                resolve_programlet_value(tokens, field, symbols, arguments, slots, &mut value);
            let captured_value = if scalar_error == 0 {
                ProgramletArgument {
                    role: field.role,
                    value: value.bits,
                    value_high: value.high,
                    value_kind: value.kind,
                    ..ProgramletArgument::EMPTY
                }
            } else if let Ok(value) =
                read_programlet_float(tokens, field, symbols, arguments, slots)
            {
                ProgramletArgument {
                    role: field.role,
                    value: value.bits,
                    value_high: value.high,
                    value_kind: value.kind,
                    ..ProgramletArgument::EMPTY
                }
            } else {
                programlet_vector_argument_reference(
                    tokens,
                    field,
                    symbols,
                    arguments,
                    frame_index,
                    vector_slots,
                )?
            };
            array_put!(captured, count, captured_value);
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
    definition_start: usize,
    routine_start: usize,
    symbols: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    symbol_used: &mut usize,
    arguments: &mut [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    argument_count: u32,
) -> Result<(), u32> {
    if argument_count as usize > arguments.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let (definition_length, next) = collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        definition_start,
    )?;
    let definition_view =
        SentenceView::new(words, base_codelet + definition_start, definition_length);
    if next != routine_start {
        return Err(ERROR_MALFORMED);
    }
    let mut definition = ParsedSentence::empty();
    let parse_error = parse_sentence(&definition_view, &mut definition);
    if parse_error != 0 {
        return Err(parse_error);
    }
    if !is_ceremony_definition(&definition, &definition_view) {
        return Err(ERROR_MALFORMED);
    }

    let mut formal_count = 0usize;
    let definition_fields = definition.fields;
    let mut field_index = 0;
    while field_index < definition.field_count {
        let formal = array_at!(definition_fields, field_index);
        if !matches!(
            formal.role,
            NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX
        ) {
            if formal_count >= MAX_PROGRAMLET_ARGUMENTS {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let mut formal_name = NameSpan::EMPTY;
            let mut expected_kind = 0;
            let typed_error = typed_name_span(
                &definition_view,
                formal,
                &mut formal_name,
                &mut expected_kind,
            );
            let named_formal = typed_error == 0 && expected_kind != 0;
            if !named_formal {
                expected_kind = if formal.length == 2
                    && sentence_at!(definition_view, formal.start) == NUMBER_QUOTE
                {
                    VALUE_NUMBER
                } else if formal.length == 1
                    && matches!(sentence_at!(definition_view, formal.start), TRUTH | LIE)
                {
                    VALUE_BOOLEAN
                } else {
                    return Err(ERROR_UNSUPPORTED);
                };
            }
            let mut argument_index = 0;
            while argument_index < argument_count as usize
                && array_at!(*arguments, argument_index).role != formal.role
            {
                argument_index += 1;
            }
            if argument_index == argument_count as usize {
                return Err(ERROR_MALFORMED);
            }
            let mut argument = array_at!(*arguments, argument_index);
            if !programlet_type_matches(expected_kind, argument.value_kind) {
                return Err(ERROR_UNSUPPORTED);
            }
            if named_formal {
                let mut stored_name = NameSpan::EMPTY;
                let error = store_name(
                    &definition_view,
                    formal_name,
                    symbols,
                    symbol_used,
                    &mut stored_name,
                );
                if error != 0 {
                    return Err(error);
                }
                argument.name_offset = stored_name.start as u32;
                argument.name_length = stored_name.length as u32;
                array_put!(arguments, argument_index, argument);
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
