use super::*;

pub(super) fn initialize_numeric_programlet(
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    step_budget: u32,
    sentence_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    sentence_boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    frames: &mut [ProgramletFrame; MAX_PROGRAMLET_CALL_DEPTH],
    routine_directory: &mut ProgramletRoutineDirectory,
) -> Result<usize, u32> {
    if codelet_count == 0
        || base_codelet > words.len() / CODELET_WORDS
        || codelet_count > words.len() / CODELET_WORDS - base_codelet
    {
        return Err(ERROR_MALFORMED);
    }
    if codelet_count > MAX_PROGRAMLET_CODELETS {
        return Err(ERROR_PROGRAM_CAPACITY);
    }
    if step_budget == 0 {
        return Err(ERROR_STEP_BUDGET);
    }
    build_programlet_routine_directory(
        words,
        base_codelet,
        codelet_count,
        sentence_words,
        sentence_boundaries,
        routine_directory,
    )?;
    let mut frame_index = 0;
    while frame_index < frames.len() {
        clear_programlet_frame(&mut frames[frame_index]);
        frame_index += 1;
    }
    let mut symbol_used = 0usize;

    let mut invocation_start = 0;
    let mut codelet = 0usize;
    while codelet < codelet_count {
        let (length, next_codelet) = match collect_sentence_at(
            words,
            base_codelet + codelet_count,
            base_codelet,
            codelet_count,
            codelet,
            sentence_words,
            sentence_boundaries,
        ) {
            Ok(group) => group,
            Err(error) => return Err(error),
        };
        if !contains_marked_token(sentence_words, sentence_boundaries, length, CONDITIONAL) {
            let mut parsed = ParsedSentence::empty();
            let parse_error =
                parse_sentence(sentence_words, sentence_boundaries, length, &mut parsed);
            if parse_error != 0 {
                return Err(parse_error);
            }
        }
        invocation_start = codelet;
        codelet = next_codelet;
    }

    let (invocation_length, _) = match collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        invocation_start,
        sentence_words,
        sentence_boundaries,
    ) {
        Ok(group) => group,
        Err(error) => return Err(error),
    };
    let mut invocation = ParsedSentence::empty();
    let parse_error = parse_sentence(
        sentence_words,
        sentence_boundaries,
        invocation_length,
        &mut invocation,
    );
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
    let output_error =
        typed_output_name(sentence_words, output, &mut _output_name, &mut output_kind);
    if output_error != 0 {
        return Err(output_error);
    }
    let loop_remaining = match loop_iterations(&invocation, sentence_words) {
        Ok(iterations) => iterations,
        Err(error) => return Err(error),
    };
    let mut invocation_arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let mut invocation_argument_count = 0;
    if let Err(error) = capture_programlet_arguments(
        &invocation,
        sentence_words,
        symbol_words,
        &[ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS],
        &[NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS],
        &[ProgramletVectorSlot::EMPTY; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
        &mut invocation_arguments,
        &mut invocation_argument_count,
    ) {
        return Err(error);
    }
    let loop_cursor = optional_number_field(&invocation, FROM_INDEX, sentence_words)?;
    let loop_end = optional_number_field(&invocation, TO_INDEX, sentence_words)?;
    if let Some(cursor) = loop_cursor
        && let Err(error) = set_loop_index_argument(&mut invocation_arguments, cursor)
    {
        return Err(error);
    }
    if let Some(end) = loop_end
        && let Err(error) = set_loop_register_argument(&mut invocation_arguments, TO_INDEX, end)
    {
        return Err(error);
    }
    let selected = resolve_programlet_routine(
        routine_directory,
        &invocation,
        sentence_words,
        sentence_boundaries,
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
        sentence_words,
        sentence_boundaries,
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
    let initial_frame = &mut frames[0];
    initial_frame.routine_start = selected.routine_start as u32;
    initial_frame.routine_end = selected.routine_end as u32;
    initial_frame.program_counter = selected.routine_start as u32;
    initial_frame.routine_name_offset = selected.name.start as u32;
    initial_frame.routine_name_length = selected.name.length as u32;
    initial_frame.arguments = invocation_arguments;
    initial_frame.argument_count = invocation_argument_count;
    initial_frame.state = 1;
    initial_frame.expected_kind = selected.output_kind;
    initial_frame.loop_active = u32::from(invocation.field(FROM_INDEX).is_some());
    initial_frame.loop_remaining = loop_remaining;
    initial_frame.loop_end = loop_end.unwrap_or(0);
    initial_frame.loop_has_end = u32::from(loop_end.is_some());
    if output_kind != VALUE_VECTOR_FLOAT {
        array_put!(
            &mut initial_frame.slots,
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
    Ok(symbol_used)
}
