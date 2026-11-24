use super::*;

pub(super) fn last_programlet_sentence_start(
    words: &[impl VliwWord],
    base_codelet: usize,
    codelet_count: usize,
) -> Result<usize, u32> {
    let mut current_sentence_start = 0;
    let mut last_sentence_start = 0;
    let mut codelet = 0;
    while codelet < codelet_count {
        let absolute_codelet = base_codelet + codelet;
        let header = word(words, absolute_codelet, 0);
        let complete = header & 1 != 0;
        let mut last_boundary = 0;
        let mut slot = 1;
        while slot < CODELET_WORDS {
            if (header & (1 << slot) != 0) == complete {
                last_boundary = slot;
            }
            slot += 1;
        }
        if complete && last_boundary == 0 {
            return Err(ERROR_MALFORMED);
        }
        let last_slot = if complete {
            last_boundary
        } else {
            CODELET_WORDS - 1
        };
        slot = 1;
        while slot <= last_slot {
            if word(words, absolute_codelet, slot) > MAX_U16 {
                return Err(ERROR_MALFORMED);
            }
            slot += 1;
        }
        codelet += 1;
        if complete {
            last_sentence_start = current_sentence_start;
            current_sentence_start = codelet;
        }
    }
    if current_sentence_start != codelet_count {
        return Err(ERROR_MALFORMED);
    }
    Ok(last_sentence_start)
}

pub(super) fn initialize_numeric_programlet(
    words: &[impl VliwWord],
    base_codelet: usize,
    codelet_count: usize,
    step_budget: u32,
    symbol_words: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    frames: &mut ProgramletStack,
    routine_directory_words: &[u32],
    directory_offset: usize,
    directory_entry_count: usize,
    directory_signature_used: usize,
) -> Result<usize, u32> {
    if codelet_count == 0
        || base_codelet > words.len() / CODELET_WORDS
        || codelet_count > words.len() / CODELET_WORDS - base_codelet
    {
        return Err(ERROR_MALFORMED);
    }
    if step_budget == 0 {
        return Err(ERROR_STEP_BUDGET);
    }
    let mut frame_index = 0;
    while frame_index < MAX_PROGRAMLET_CALL_DEPTH {
        clear_programlet_frame(frames, frame_index);
        frame_index += 1;
    }
    let mut symbol_used = 0usize;

    let invocation_start = last_programlet_sentence_start(words, base_codelet, codelet_count)?;

    let (invocation_length, _) = match collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        invocation_start,
    ) {
        Ok(group) => group,
        Err(error) => return Err(error),
    };
    let invocation_view =
        SentenceView::new(words, base_codelet + invocation_start, invocation_length);
    let mut invocation = ParsedSentence::empty();
    let parse_error = parse_sentence(&invocation_view, &mut invocation);
    if parse_error != 0 {
        return Err(parse_error);
    }
    if invocation.mood != DEONTIC || invocation.field_count == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(output) = invocation.field(DESTINATION) else {
        return Err(ERROR_MALFORMED);
    };
    let mut _output_name = NameSpan::EMPTY;
    let mut output_kind = 0;
    let output_error = typed_output_name(
        &invocation_view,
        output,
        &mut _output_name,
        &mut output_kind,
    );
    if output_error != 0 {
        return Err(output_error);
    }
    let loop_remaining = match loop_iterations(&invocation, &invocation_view) {
        Ok(iterations) => iterations,
        Err(error) => return Err(error),
    };
    let mut invocation_arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let mut invocation_argument_count = 0;
    if let Err(error) = capture_programlet_arguments(
        &invocation,
        &invocation_view,
        symbol_words,
        &[ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS],
        &[NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS],
        &[ProgramletVectorSlot::EMPTY; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
        0,
        &mut invocation_arguments,
        &mut invocation_argument_count,
    ) {
        return Err(error);
    }
    let loop_cursor = optional_number_field(&invocation, FROM_INDEX, &invocation_view)?;
    let loop_end = optional_number_field(&invocation, TO_INDEX, &invocation_view)?;
    let mut loop_argument_index = invocation_argument_count as usize;
    if let Some(cursor) = loop_cursor
        && let Err(error) =
            set_loop_index_argument(&mut invocation_arguments, loop_argument_index, cursor)
    {
        return Err(error);
    }
    if loop_cursor.is_some() {
        loop_argument_index += 1;
    }
    if let Some(end) = loop_end
        && let Err(error) = set_loop_register_argument(
            &mut invocation_arguments,
            loop_argument_index,
            TO_INDEX,
            end,
        )
    {
        return Err(error);
    }
    let selected = resolve_programlet_routine(
        routine_directory_words,
        directory_offset,
        directory_entry_count,
        directory_signature_used,
        &invocation,
        &invocation_view,
        symbol_words,
        &mut symbol_used,
        &invocation_arguments,
        invocation_argument_count,
        output_kind,
    )?;
    if let Err(error) = validate_programlet_arguments(
        words,
        base_codelet,
        codelet_count,
        selected.definition_start,
        selected.routine_start,
        symbol_words,
        &mut symbol_used,
        &mut invocation_arguments,
        invocation_argument_count,
    ) {
        return Err(error);
    }
    if !programlet_type_matches(output_kind, selected.output_kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut initial_frame = array_at!(frames.controls, 0);
    initial_frame.routine_start = selected.routine_start as u32;
    initial_frame.routine_end = selected.routine_end as u32;
    initial_frame.program_counter = selected.routine_start as u32;
    initial_frame.routine_name_offset = selected.name.start as u32;
    initial_frame.routine_name_length = selected.name.length as u32;
    array_put!(&mut frames.arguments, 0, invocation_arguments);
    initial_frame.argument_count = invocation_argument_count;
    initial_frame.state = 1;
    initial_frame.expected_kind = selected.output_kind;
    initial_frame.loop_active = u32::from(invocation.field(FROM_INDEX).is_some());
    initial_frame.loop_remaining = loop_remaining;
    initial_frame.loop_end = loop_end.unwrap_or(0);
    initial_frame.loop_has_end = u32::from(loop_end.is_some());
    if output_kind != VALUE_VECTOR_FLOAT {
        if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, 0) {
            return Err(ERROR_MALFORMED);
        }
        let slots = frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, 0);
        array_put!(
            slots,
            0,
            NumericLocalSlot {
                name_offset: selected.output_name.start as u32,
                name_length: selected.output_name.length as u32,
                value: 0,
                value_high: 0,
                kind: if output_kind == VALUE_BOOLEAN { 3 } else { 1 },
                value_kind: if output_kind == VALUE_BOOLEAN {
                    VALUE_BOOLEAN
                } else {
                    VALUE_UNSIGNED
                },
            }
        );
    }
    array_put!(&mut frames.controls, 0, initial_frame);
    Ok(symbol_used)
}
