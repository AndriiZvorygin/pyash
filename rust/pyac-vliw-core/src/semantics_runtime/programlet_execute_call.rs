use super::*;

pub(super) fn execute_programlet_call(
    sentence: &ParsedSentence,
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    sentence_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    sentence_boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    routine_directory: &ProgramletRoutineDirectory,
    symbol_used: &mut usize,
    frames: &mut [ProgramletFrame; MAX_PROGRAMLET_CALL_DEPTH],
    frame_index: usize,
    depth: &mut usize,
) -> Result<(), u32> {
    frames[frame_index].action_started = 1;
    if sentence.field_count == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(output) = sentence.field(DESTINATION) else {
        return Err(ERROR_MALFORMED);
    };
    let mut return_name = NameSpan::EMPTY;
    let mut return_kind = 0;
    let output_error =
        typed_output_name(sentence_words, output, &mut return_name, &mut return_kind);
    if output_error != 0 {
        return Err(output_error);
    }
    let mut stored_return_name = NameSpan::EMPTY;
    let name_error = store_name(
        sentence_words,
        return_name,
        symbol_words,
        symbol_used,
        &mut stored_return_name,
    );
    if name_error != 0 {
        return Err(name_error);
    }
    let call_loop_remaining = match loop_iterations(sentence, sentence_words) {
        Ok(iterations) => iterations,
        Err(error) => return Err(error),
    };
    let mut call_arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let mut call_argument_count = 0;
    if let Err(error) = capture_programlet_arguments(
        sentence,
        sentence_words,
        symbol_words,
        &frames[frame_index].arguments,
        &frames[frame_index].slots,
        &frames[frame_index].vector_slots,
        &mut call_arguments,
        &mut call_argument_count,
    ) {
        return Err(error);
    }
    let call_loop_cursor = optional_number_field(sentence, FROM_INDEX, sentence_words)?;
    let call_loop_end = optional_number_field(sentence, TO_INDEX, sentence_words)?;
    if let Some(cursor) = call_loop_cursor
        && let Err(error) = set_loop_index_argument(&mut call_arguments, cursor)
    {
        return Err(error);
    }
    if let Some(end) = call_loop_end
        && let Err(error) = set_loop_register_argument(&mut call_arguments, TO_INDEX, end)
    {
        return Err(error);
    }
    let selected = resolve_programlet_routine(
        routine_directory,
        sentence,
        sentence_words,
        sentence_boundaries,
        symbol_words,
        symbol_used,
        &call_arguments,
        call_argument_count,
        return_kind,
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
        symbol_used,
        &mut call_arguments,
        call_argument_count,
    ) {
        return Err(error);
    }
    if !programlet_type_matches(return_kind, selected.output_kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    if sentence.field(FROM_INDEX).is_some() && call_loop_remaining == 0 {
        let mut result = ProgramletNumber::EMPTY;
        if !argument_value(&call_arguments, ACCUSATIVE, &mut result) {
            result.kind = if selected.output_kind == VALUE_BOOLEAN {
                VALUE_BOOLEAN
            } else {
                VALUE_UNSIGNED
            };
        }
        if let Err(error) = write_programlet_call_result(
            symbol_words,
            stored_return_name,
            selected.output_kind,
            result,
            &mut frames[frame_index].slots,
        ) {
            return Err(error);
        }
    } else {
        if *depth >= MAX_PROGRAMLET_CALL_DEPTH {
            return Err(ERROR_CALL_DEPTH);
        }
        let child = &mut frames[*depth];
        clear_programlet_frame(child);
        child.arguments = call_arguments;
        child.argument_count = call_argument_count;
        child.routine_start = selected.routine_start as u32;
        child.routine_end = selected.routine_end as u32;
        child.program_counter = selected.routine_start as u32;
        child.routine_name_offset = selected.name.start as u32;
        child.routine_name_length = selected.name.length as u32;
        child.return_name_offset = stored_return_name.start as u32;
        child.return_name_length = stored_return_name.length as u32;
        child.state = 1;
        child.expected_kind = selected.output_kind;
        child.loop_active = u32::from(sentence.field(FROM_INDEX).is_some());
        child.loop_remaining = call_loop_remaining;
        child.loop_end = call_loop_end.unwrap_or(0);
        child.loop_has_end = u32::from(call_loop_end.is_some());
        if return_kind != VALUE_VECTOR_FLOAT {
            array_put!(
                &mut child.slots,
                0,
                NumericLocalSlot {
                    name_offset: selected.output_name.start as u32,
                    name_length: selected.output_name.length as u32,
                    value: 0,
                    value_high: 0,
                    kind: if return_kind == VALUE_BOOLEAN { 3 } else { 1 },
                    value_kind: if return_kind == VALUE_BOOLEAN {
                        VALUE_BOOLEAN
                    } else {
                        VALUE_UNSIGNED
                    },
                }
            );
        }
        *depth += 1;
    }

    Ok(())
}
