use super::*;

#[inline(never)]
pub(super) fn execute_programlet_call(
    sentence: &ParsedSentence,
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    sentence_view: &SentenceView<'_>,
    symbol_words: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    routine_directory_words: &[u32],
    directory_offset: usize,
    directory_entry_count: usize,
    directory_signature_used: usize,
    symbol_used: &mut usize,
    frames: &mut ProgramletStack,
    frame_index: usize,
    depth: &mut usize,
) -> Result<(), u32> {
    let mut caller = array_at!(frames.controls, frame_index);
    caller.action_started = 1;
    if sentence.field_count == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(output) = sentence.field(DESTINATION) else {
        return Err(ERROR_MALFORMED);
    };
    let mut return_name = NameSpan::EMPTY;
    let mut return_kind = 0;
    let output_error = typed_output_name(sentence_view, output, &mut return_name, &mut return_kind);
    if output_error != 0 {
        return Err(output_error);
    }
    let mut stored_return_name = NameSpan::EMPTY;
    let name_error = store_name(
        sentence_view,
        return_name,
        symbol_words,
        symbol_used,
        &mut stored_return_name,
    );
    if name_error != 0 {
        return Err(name_error);
    }
    let call_loop_remaining = match loop_iterations(sentence, sentence_view) {
        Ok(iterations) => iterations,
        Err(error) => return Err(error),
    };
    let mut call_arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let mut call_argument_count = 0;
    let caller_arguments = array_at!(frames.arguments, frame_index);
    if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
        return Err(ERROR_MALFORMED);
    }
    let caller_slots =
        frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, frame_index);
    let caller_vector_slots = array_at!(frames.vector_slots, frame_index);
    if let Err(error) = capture_programlet_arguments(
        sentence,
        sentence_view,
        symbol_words,
        &caller_arguments,
        caller_slots,
        &caller_vector_slots,
        frame_index,
        &mut call_arguments,
        &mut call_argument_count,
    ) {
        return Err(error);
    }
    let call_loop_cursor = optional_number_field(sentence, FROM_INDEX, sentence_view)?;
    let call_loop_end = optional_number_field(sentence, TO_INDEX, sentence_view)?;
    let mut loop_argument_index = call_argument_count as usize;
    if let Some(cursor) = call_loop_cursor
        && let Err(error) =
            set_loop_index_argument(&mut call_arguments, loop_argument_index, cursor)
    {
        return Err(error);
    }
    if call_loop_cursor.is_some() {
        loop_argument_index += 1;
    }
    if let Some(end) = call_loop_end
        && let Err(error) =
            set_loop_register_argument(&mut call_arguments, loop_argument_index, TO_INDEX, end)
    {
        return Err(error);
    }
    let selected = resolve_programlet_routine(
        routine_directory_words,
        directory_offset,
        directory_entry_count,
        directory_signature_used,
        sentence,
        sentence_view,
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
        let mut result = argument_value(call_arguments, ACCUSATIVE);
        if result.kind == 0 {
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
            caller_slots,
        ) {
            return Err(error);
        }
    } else {
        if *depth >= MAX_PROGRAMLET_CALL_DEPTH {
            return Err(ERROR_CALL_DEPTH);
        }
        let child_index = *depth;
        clear_programlet_frame(frames, child_index);
        let mut child = ProgramletFrame::EMPTY;
        array_put!(&mut frames.arguments, child_index, call_arguments);
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
            if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, child_index) {
                return Err(ERROR_MALFORMED);
            }
            let child_slots =
                frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, child_index);
            array_put!(
                child_slots,
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
        array_put!(&mut frames.controls, child_index, child);
        *depth += 1;
    }

    array_put!(&mut frames.controls, frame_index, caller);
    Ok(())
}
