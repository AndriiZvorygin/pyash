use super::*;

#[inline(never)]
pub(super) fn close_programlet_paragraph(
    sentence: &ParsedSentence,
    sentence_view: &SentenceView<'_>,
    symbol_words: &[u32; MAX_PROGRAMLET_PAYLOAD_WORDS],
    frames: &mut ProgramletStack,
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
        result_length,
        return_name_offset,
        return_name_length,
        expected_kind,
    ) = {
        let frame = array_at!(frames.controls, frame_index);
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
            frame.result_length,
            frame.return_name_offset,
            frame.return_name_length,
            frame.expected_kind,
        )
    };
    let result_values = array_at!(frames.result_values, frame_index);
    if has_returned == 0
        || sentence.field_count != 1
        || sentence.verb_length != 1
        || sentence_at!(*sentence_view, sentence.verb_start) != CEREMONY
    {
        return ERROR_MALFORMED;
    }
    let Some(su) = sentence.field(NOMINATIVE) else {
        return ERROR_MALFORMED;
    };
    let mut closing_name = NameSpan::EMPTY;
    let name_error = name_span(sentence_view, su, false, &mut closing_name);
    if name_error != 0 {
        return name_error;
    }
    let routine_name = NameSpan {
        start: routine_name_offset as usize,
        length: routine_name_length as usize,
    };
    if !names_equal(sentence_view, closing_name, symbol_words, routine_name) {
        return ERROR_MALFORMED;
    }
    if loop_active != 0 && loop_remaining > 1 {
        let mut current = array_at!(frames.controls, frame_index);
        current.loop_remaining -= 1;
        let mut arguments = array_at!(frames.arguments, frame_index);
        let current_index = argument_value(arguments, FROM_INDEX);
        if current_index.kind != 0 {
            let next = if loop_has_end != 0 {
                if current_index.bits < loop_end {
                    current_index.bits + 1
                } else {
                    current_index.bits - 1
                }
            } else {
                current_index.bits - 1
            };
            if let Err(error) =
                set_loop_index_argument(&mut arguments, current.argument_count as usize, next)
            {
                return error;
            }
        }
        current.program_counter = routine_start;
        current.state = 1;
        current.action_started = 0;
        current.has_returned = 0;
        current.result_value = 0;
        current.result_kind = 0;
        current.result_length = 0;
        array_put!(&mut frames.arguments, frame_index, arguments);
        array_put!(&mut frames.result_values, frame_index, [0; RESULT_WORDS]);
        array_put!(&mut frames.controls, frame_index, current);
        return 0;
    }
    if *depth == 1 {
        if matches!(result_kind, VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64) {
            result.value_kind = result_kind;
            result.length = result_length;
            result.consumed_codelets = codelet_count as u32;
            result.values = result_values;
        } else {
            *result = CoreResult::scalar(
                result_kind,
                result_value,
                result_values[1],
                codelet_count as u32,
            );
        }
        return PROGRAMLET_EXECUTION_COMPLETE;
    }
    let caller_index = *depth - 2;
    let return_name = NameSpan {
        start: return_name_offset as usize,
        length: return_name_length as usize,
    };
    let caller = array_at!(frames.controls, caller_index);
    if matches!(result_kind, VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64) {
        let mut vector_slots = array_at!(frames.vector_slots, caller_index);
        if let Err(error) = write_programlet_vector_result(
            symbol_words,
            return_name,
            expected_kind,
            result_kind,
            result_length,
            &result_values,
            &mut vector_slots,
            &mut frames.vector_values,
            caller_index,
        ) {
            return error;
        }
        array_put!(&mut frames.vector_slots, caller_index, vector_slots);
    } else {
        if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, caller_index) {
            return ERROR_MALFORMED;
        }
        let slots =
            frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, caller_index);
        if let Err(error) = write_programlet_call_result(
            symbol_words,
            return_name,
            expected_kind,
            ProgramletNumber {
                bits: result_value,
                high: result_values[1],
                kind: result_kind,
            },
            slots,
        ) {
            return error;
        }
    }
    array_put!(&mut frames.controls, caller_index, caller);
    *depth -= 1;

    0
}
