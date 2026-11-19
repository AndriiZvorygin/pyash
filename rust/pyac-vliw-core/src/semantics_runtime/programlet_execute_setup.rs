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
    let mut frame_index = 0;
    while frame_index < frames.len() {
        array_put!(frames, frame_index, ProgramletFrame::EMPTY);
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
        &mut invocation_arguments,
        &mut invocation_argument_count,
    ) {
        return Err(error);
    }
    let loop_cursor = match invocation
        .field(FROM_INDEX)
        .map(|field| number_value(sentence_words, field))
        .transpose()
    {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
    let loop_end = match invocation
        .field(TO_INDEX)
        .map(|field| number_value(sentence_words, field))
        .transpose()
    {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
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
    let mut target = NameSpan::EMPTY;
    let name_error = store_name(
        sentence_words,
        NameSpan {
            start: invocation.verb_start,
            length: invocation.verb_length,
        },
        symbol_words,
        &mut symbol_used,
        &mut target,
    );
    if name_error != 0 {
        return Err(name_error);
    }
    let mut routine_name = NameSpan::EMPTY;
    let mut routine_output_name = NameSpan::EMPTY;
    let mut routine_start = 0;
    let mut routine_end = 0;
    let mut routine_kind = 0;
    let routine_error = find_programlet_routine(
        words,
        base_codelet,
        codelet_count,
        target,
        sentence_words,
        sentence_boundaries,
        symbol_words,
        &mut symbol_used,
        &mut routine_name,
        &mut routine_output_name,
        &mut routine_start,
        &mut routine_end,
        &mut routine_kind,
    );
    if routine_error != 0 {
        return Err(routine_error);
    }
    if let Err(error) = validate_programlet_arguments(
        words,
        base_codelet,
        codelet_count,
        routine_start,
        sentence_words,
        sentence_boundaries,
        &invocation_arguments,
        invocation_argument_count,
    ) {
        return Err(error);
    }
    if !number_kind_matches(output_kind, routine_kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut initial_frame = ProgramletFrame {
        routine_start: routine_start as u32,
        routine_end: routine_end as u32,
        program_counter: routine_start as u32,
        routine_name_offset: routine_name.start as u32,
        routine_name_length: routine_name.length as u32,
        arguments: invocation_arguments,
        argument_count: invocation_argument_count,
        state: 1,
        expected_kind: routine_kind,
        loop_active: u32::from(invocation.field(FROM_INDEX).is_some()),
        loop_remaining,
        loop_end: loop_end.unwrap_or(0),
        loop_has_end: u32::from(loop_end.is_some()),
        ..ProgramletFrame::EMPTY
    };
    initial_frame.slots[0] = NumericLocalSlot {
        name_offset: routine_output_name.start as u32,
        name_length: routine_output_name.length as u32,
        value: 0,
        kind: if output_kind == VALUE_BOOLEAN { 3 } else { 1 },
        value_kind: if output_kind == VALUE_BOOLEAN {
            VALUE_BOOLEAN
        } else {
            VALUE_UNSIGNED
        },
    };
    array_put!(frames, 0, initial_frame);
    Ok(symbol_used)
}
