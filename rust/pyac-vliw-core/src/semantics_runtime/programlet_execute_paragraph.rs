use super::*;

pub(super) fn close_programlet_paragraph(
    sentence: &ParsedSentence,
    sentence_words: &[u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &[u32; PROGRAMLET_SCRATCH_WORDS],
    frames: &mut [ProgramletFrame; MAX_PROGRAMLET_CALL_DEPTH],
    frame_index: usize,
    depth: &mut usize,
    codelet_count: usize,
    result: &mut CoreResult,
) -> u32 {
    let (
        has_returned,
        routine_name_offset,
        routine_name_length,
        loop_active,
        loop_remaining,
        loop_end,
        loop_has_end,
        routine_start,
        result_kind,
        result_value,
        return_name_offset,
        return_name_length,
        expected_kind,
    ) = {
        let frame = &frames[frame_index];
        (
            frame.has_returned,
            frame.routine_name_offset,
            frame.routine_name_length,
            frame.loop_active,
            frame.loop_remaining,
            frame.loop_end,
            frame.loop_has_end,
            frame.routine_start,
            frame.result_kind,
            frame.result_value,
            frame.return_name_offset,
            frame.return_name_length,
            frame.expected_kind,
        )
    };
    if has_returned == 0
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
        start: routine_name_offset as usize,
        length: routine_name_length as usize,
    };
    if !names_equal(sentence_words, closing_name, symbol_words, routine_name) {
        return ERROR_MALFORMED;
    }
    if loop_active != 0 && loop_remaining > 1 {
        let current = &mut frames[frame_index];
        current.loop_remaining -= 1;
        let mut current_index = ProgramletNumber::EMPTY;
        if argument_value(&current.arguments, FROM_INDEX, &mut current_index) {
            let next = if loop_has_end != 0 {
                if current_index.bits < loop_end {
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
        current.program_counter = routine_start;
        current.state = 1;
        current.action_started = 0;
        current.has_returned = 0;
        current.result_value = 0;
        current.result_kind = 0;
        return 0;
    }
    if *depth == 1 {
        *result = CoreResult::scalar(result_kind, result_value, 0, codelet_count as u32);
        return PROGRAMLET_EXECUTION_COMPLETE;
    }
    let caller_index = *depth - 2;
    let return_name = NameSpan {
        start: return_name_offset as usize,
        length: return_name_length as usize,
    };
    if let Err(error) = write_programlet_call_result(
        symbol_words,
        return_name,
        expected_kind,
        ProgramletNumber {
            bits: result_value,
            kind: result_kind,
        },
        &mut frames[caller_index].slots,
    ) {
        return error;
    }
    *depth -= 1;

    0
}
