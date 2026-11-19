use super::*;

pub(super) fn close_programlet_paragraph(
    frame: ProgramletFrame,
    sentence: &ParsedSentence,
    sentence_words: &[u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &[u32; PROGRAMLET_SCRATCH_WORDS],
    frames: &mut [ProgramletFrame; MAX_PROGRAMLET_CALL_DEPTH],
    frame_index: usize,
    depth: &mut usize,
    codelet_count: usize,
    result: &mut CoreResult,
) -> u32 {
    if frame.has_returned == 0
        || sentence.field_count != 1
        || sentence.verb_length != 1
        || array_at!(sentence_words, sentence.verb_start) != CEREMONY
    {
        return ERROR_MALFORMED;
    }
    let Some(su) = sentence.field(NOMINATIVE) else {
        return ERROR_MALFORMED;
    };
    let mut closing_name = NameSpan::EMPTY;
    let name_error = name_span(sentence_words, su, false, &mut closing_name);
    if name_error != 0 {
        return name_error;
    }
    let routine_name = NameSpan {
        start: frame.routine_name_offset as usize,
        length: frame.routine_name_length as usize,
    };
    if !names_equal(sentence_words, closing_name, symbol_words, routine_name) {
        return ERROR_MALFORMED;
    }
    if frame.loop_active != 0 && frame.loop_remaining > 1 {
        let mut current = frame;
        current.loop_remaining -= 1;
        let mut current_index = ProgramletNumber::EMPTY;
        if argument_value(&frame.arguments, FROM_INDEX, &mut current_index) {
            let next = if current.loop_has_end != 0 {
                if current_index.bits < current.loop_end {
                    current_index.bits + 1
                } else {
                    current_index.bits - 1
                }
            } else {
                current_index.bits - 1
            };
            if let Err(error) = set_loop_index_argument(&mut current.arguments, next) {
                return error;
            }
        }
        current.program_counter = frame.routine_start;
        current.state = 1;
        current.action_started = 0;
        current.has_returned = 0;
        current.result_value = 0;
        current.result_kind = 0;
        array_put!(frames, frame_index, current);
        return 0;
    }
    if *depth == 1 {
        *result = CoreResult::scalar(
            frame.result_kind,
            frame.result_value,
            0,
            codelet_count as u32,
        );
        return PROGRAMLET_EXECUTION_COMPLETE;
    }
    let caller_index = *depth - 2;
    let return_name = NameSpan {
        start: frame.return_name_offset as usize,
        length: frame.return_name_length as usize,
    };
    let mut caller = array_at!(frames, caller_index);
    if let Err(error) = write_programlet_call_result(
        symbol_words,
        return_name,
        frame.expected_kind,
        ProgramletNumber {
            bits: frame.result_value,
            kind: frame.result_kind,
        },
        &mut caller.slots,
    ) {
        return error;
    }
    array_put!(frames, caller_index, caller);
    array_put!(frames, *depth - 1, ProgramletFrame::EMPTY);
    *depth -= 1;

    0
}
