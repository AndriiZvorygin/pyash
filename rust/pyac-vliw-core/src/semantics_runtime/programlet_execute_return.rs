use super::*;

#[inline(never)]
pub(super) fn execute_programlet_return(
    sentence: &ParsedSentence,
    words: &[impl VliwWord],
    base_codelet: usize,
    codelet_count: usize,
    next_codelet: usize,
    sentence_view: &SentenceView<'_, impl VliwWord>,
    symbol_words: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    frames: &mut ProgramletStack,
    frame_index: usize,
) -> Result<(), u32> {
    let mut active = array_at!(frames.controls, frame_index);
    let mut arguments = array_at!(frames.arguments, frame_index);
    if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
        return Err(ERROR_MALFORMED);
    }
    let slots = frame_row::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index);
    let vector_slots = array_at!(frames.vector_slots, frame_index);
    let mut result_values = array_at!(frames.result_values, frame_index);
    let from_index_return = sentence.field(FROM_INDEX);
    if sentence.field_count != 1 || sentence.verb_length != 0 {
        return Err(ERROR_MALFORMED);
    }
    if let Some(return_field) = sentence.field(NOMINATIVE) {
        if let Ok(vector) = read_programlet_vector(
            sentence_view,
            return_field,
            symbol_words,
            &arguments,
            frame_index,
            &vector_slots,
            &frames.vector_values,
        ) {
            active.result_kind = vector.kind;
            active.result_length = vector.length as u32;
            result_values = vector.values;
        } else if let Ok(value) =
            read_programlet_float(sentence_view, return_field, symbol_words, &arguments, slots)
        {
            active.result_value = value.bits;
            result_values[0] = value.bits;
            result_values[1] = value.high;
            active.result_length = 1;
            active.result_kind = value.kind;
        } else {
            let mut return_name = NameSpan::EMPTY;
            let name_error = name_span(sentence_view, return_field, false, &mut return_name);
            if name_error != 0 {
                return Err(name_error);
            }
            let Some(index) = find_local_slot(sentence_view, return_name, symbol_words, slots)
            else {
                return Err(ERROR_MALFORMED);
            };
            active.result_value = array_at!(slots, index).value;
            result_values[0] = active.result_value;
            result_values[1] = array_at!(slots, index).value_high;
            active.result_length = 1;
            active.result_kind = array_at!(slots, index).value_kind;
        }
    } else if let Some(return_field) = sentence.field(ACCUSATIVE) {
        if return_field.length == 1
            && matches!(
                sentence_at!(*sentence_view, return_field.start),
                TRUTH | LIE
            )
        {
            active.result_value =
                u32::from(sentence_at!(*sentence_view, return_field.start) == TRUTH);
            result_values[0] = active.result_value;
            result_values[1] = 0;
            active.result_length = 1;
            active.result_kind = VALUE_BOOLEAN;
        } else if return_field.length == 2
            && sentence_at!(*sentence_view, return_field.start) == NUMBER_QUOTE
        {
            active.result_value = sentence_at!(*sentence_view, return_field.start + 1);
            result_values[0] = active.result_value;
            result_values[1] = 0;
            active.result_length = 1;
            active.result_kind = VALUE_UNSIGNED;
        } else if return_field.length >= 2
            && sentence_at!(*sentence_view, return_field.start) == NAME_TYPE
        {
            let mut return_name = NameSpan::EMPTY;
            let name_error = name_span(sentence_view, return_field, false, &mut return_name);
            if name_error != 0 {
                return Err(name_error);
            }
            let Some(index) = find_local_slot(sentence_view, return_name, symbol_words, slots)
            else {
                return Err(ERROR_MALFORMED);
            };
            active.result_value = array_at!(slots, index).value;
            result_values[0] = active.result_value;
            result_values[1] = array_at!(slots, index).value_high;
            active.result_length = 1;
            active.result_kind = array_at!(slots, index).value_kind;
        } else {
            return Err(ERROR_UNSUPPORTED);
        }
    } else if from_index_return.is_some() {
        let output = array_at!(slots, 0);
        if !programlet_type_matches(active.expected_kind, output.value_kind) {
            return Err(ERROR_UNSUPPORTED);
        }
        active.result_value = output.value;
        result_values[0] = output.value;
        result_values[1] = output.value_high;
        active.result_length = 1;
        active.result_kind = output.value_kind;
    } else {
        return Err(ERROR_MALFORMED);
    }
    if let Some(return_field) = from_index_return {
        let mut returned_index = ProgramletNumber::EMPTY;
        let error = resolve_programlet_value(
            sentence_view,
            return_field,
            symbol_words,
            &arguments,
            slots,
            &mut returned_index,
        );
        if error != 0 {
            return Err(error);
        }
        if returned_index.kind != VALUE_UNSIGNED {
            return Err(ERROR_UNSUPPORTED);
        }
        if let Err(error) = set_loop_index_argument(
            &mut arguments,
            active.argument_count as usize,
            returned_index.bits,
        ) {
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
    if !programlet_type_matches(active.expected_kind, active.result_kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    let next_is_paragraph = match next_sentence_is_paragraph_end(
        words,
        codelet_count,
        base_codelet,
        next_codelet,
        active.routine_end as usize,
    ) {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
    active.has_returned = 1;
    active.state = if next_is_paragraph { 2 } else { 1 };
    array_put!(&mut frames.arguments, frame_index, arguments);
    array_put!(&mut frames.result_values, frame_index, result_values);
    array_put!(&mut frames.controls, frame_index, active);

    Ok(())
}
