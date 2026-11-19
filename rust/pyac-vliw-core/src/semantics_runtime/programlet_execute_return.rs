use super::*;

pub(super) fn execute_programlet_return(
    frame: ProgramletFrame,
    sentence: &ParsedSentence,
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    next_codelet: usize,
    sentence_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    sentence_boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    frames: &mut [ProgramletFrame; MAX_PROGRAMLET_CALL_DEPTH],
    frame_index: usize,
) -> Result<(), u32> {
    let mut active = array_at!(frames, frame_index);
    let from_index_return = sentence.field(FROM_INDEX);
    if sentence.field_count != 1 || sentence.verb_length != 0 {
        return Err(ERROR_MALFORMED);
    }
    if let Some(return_field) = sentence.field(NOMINATIVE) {
        let mut return_name = NameSpan::EMPTY;
        let name_error = name_span(sentence_words, return_field, false, &mut return_name);
        if name_error != 0 {
            return Err(name_error);
        }
        let Some(index) = find_local_slot(sentence_words, return_name, symbol_words, &active.slots)
        else {
            return Err(ERROR_MALFORMED);
        };
        active.result_value = array_at!(active.slots, index).value;
        active.result_kind = array_at!(active.slots, index).value_kind;
    } else if let Some(return_field) = sentence.field(ACCUSATIVE) {
        if return_field.length == 1
            && matches!(array_at!(sentence_words, return_field.start), TRUTH | LIE)
        {
            active.result_value = u32::from(array_at!(sentence_words, return_field.start) == TRUTH);
            active.result_kind = VALUE_BOOLEAN;
        } else if return_field.length == 2
            && array_at!(sentence_words, return_field.start) == NUMBER_QUOTE
        {
            active.result_value = array_at!(sentence_words, return_field.start + 1);
            active.result_kind = VALUE_UNSIGNED;
        } else if return_field.length >= 2
            && array_at!(sentence_words, return_field.start) == NAME_TYPE
        {
            let mut return_name = NameSpan::EMPTY;
            let name_error = name_span(sentence_words, return_field, false, &mut return_name);
            if name_error != 0 {
                return Err(name_error);
            }
            let Some(index) =
                find_local_slot(sentence_words, return_name, symbol_words, &active.slots)
            else {
                return Err(ERROR_MALFORMED);
            };
            active.result_value = array_at!(active.slots, index).value;
            active.result_kind = array_at!(active.slots, index).value_kind;
        } else {
            return Err(ERROR_UNSUPPORTED);
        }
    } else if from_index_return.is_some() {
        let output = array_at!(active.slots, 0);
        if !number_kind_matches(frame.expected_kind, output.value_kind) {
            return Err(ERROR_UNSUPPORTED);
        }
        active.result_value = output.value;
        active.result_kind = output.value_kind;
    } else {
        return Err(ERROR_MALFORMED);
    }
    if let Some(return_field) = from_index_return {
        let mut returned_index = ProgramletNumber::EMPTY;
        let error = resolve_programlet_value(
            sentence_words,
            return_field,
            symbol_words,
            &active.arguments,
            &active.slots,
            &mut returned_index,
        );
        if error != 0 {
            return Err(error);
        }
        if returned_index.kind != VALUE_UNSIGNED {
            return Err(ERROR_UNSUPPORTED);
        }
        if let Err(error) = set_loop_index_argument(&mut active.arguments, returned_index.bits) {
            return Err(error);
        }
        if active.loop_active != 0 {
            active.loop_remaining = if active.loop_has_end != 0 {
                returned_index.bits.abs_diff(active.loop_end)
            } else {
                returned_index.bits
            };
        }
    }
    if !number_kind_matches(frame.expected_kind, active.result_kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    let next_is_paragraph = match next_sentence_is_paragraph_end(
        words,
        codelet_count,
        base_codelet,
        next_codelet,
        frame.routine_end as usize,
        sentence_words,
        sentence_boundaries,
    ) {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
    active.has_returned = 1;
    active.state = if next_is_paragraph { 2 } else { 1 };

    array_put!(frames, frame_index, active);
    Ok(())
}
