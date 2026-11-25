use super::*;

pub fn execute_numeric_programlet_at_with_directory_words_and_storage(
    words: &[impl VliwWord],
    base_codelet: usize,
    codelet_count: usize,
    step_budget: u32,
    routine_directory_words: &[u32],
    directory_offset: usize,
    storage: &StorageView<'_>,
    symbol_words: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    frames: &mut ProgramletStack,
) -> CoreResult {
    #[cfg(not(target_arch = "spirv"))]
    let directory =
        validate_programlet_routine_directory_words(routine_directory_words, directory_offset);
    #[cfg(target_arch = "spirv")]
    let directory =
        read_programlet_routine_directory_header(routine_directory_words, directory_offset);
    let (directory_entry_count, directory_signature_used) = match directory {
        Ok(directory) => directory,
        Err(error) => return CoreResult::failure(error, 0),
    };
    execute_numeric_programlet_at_with_directory_view(
        words,
        base_codelet,
        codelet_count,
        step_budget,
        routine_directory_words,
        directory_offset,
        directory_entry_count,
        directory_signature_used,
        storage,
        symbol_words,
        frames,
    )
}

fn execute_numeric_programlet_at_with_directory_view(
    words: &[impl VliwWord],
    base_codelet: usize,
    codelet_count: usize,
    step_budget: u32,
    routine_directory_words: &[u32],
    directory_offset: usize,
    directory_entry_count: usize,
    directory_signature_used: usize,
    storage: &StorageView<'_>,
    symbol_words: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    frames: &mut ProgramletStack,
) -> CoreResult {
    let mut symbol_used = match initialize_numeric_programlet(
        words,
        base_codelet,
        codelet_count,
        step_budget,
        symbol_words,
        frames,
        routine_directory_words,
        directory_offset,
        directory_entry_count,
        directory_signature_used,
    ) {
        Ok(used) => used,
        Err(error) => return CoreResult::failure(error, 0),
    };
    let initial_frame = array_at!(frames.controls, 0);
    if initial_frame.loop_active != 0 && initial_frame.loop_remaining == 0 {
        let initial_arguments = array_at!(frames.arguments, 0);
        let output = argument_value(initial_arguments, ACCUSATIVE);
        let (value, kind) = if output.kind != 0 {
            if !number_kind_matches(initial_frame.expected_kind, output.kind) {
                return CoreResult::failure(ERROR_UNSUPPORTED, 0);
            }
            (output.bits, output.kind)
        } else if initial_frame.expected_kind == VALUE_BOOLEAN {
            (0, VALUE_BOOLEAN)
        } else {
            (0, VALUE_UNSIGNED)
        };
        return CoreResult::scalar(kind, value, 0, codelet_count as u32);
    }

    let mut depth = 1usize;
    let mut steps = 0u32;
    while depth > 0 {
        if steps >= step_budget {
            return CoreResult::failure(ERROR_STEP_BUDGET, steps);
        }
        let frame_index = depth - 1;
        let mut frame = array_at!(frames.controls, frame_index);
        let pc = frame.program_counter as usize;
        if pc >= frame.routine_end as usize {
            return CoreResult::failure(ERROR_MALFORMED, steps);
        }
        let (token_count, next_codelet) = match collect_sentence_at(
            words,
            base_codelet + codelet_count,
            base_codelet,
            codelet_count,
            pc,
        ) {
            Ok(group) => group,
            Err(error) => return CoreResult::failure(error, steps),
        };
        let sentence_view = SentenceView::new(words, base_codelet + pc, token_count);
        frame.program_counter = next_codelet as u32;
        let sentence = if contains_marked_token(&sentence_view, CONDITIONAL) {
            if steps >= step_budget {
                return CoreResult::failure(ERROR_STEP_BUDGET, steps);
            }
            steps += 1;
            frame.action_started = 1;
            let mut action = ParsedSentence::empty();
            let mut has_selected_action = false;
            let arguments = array_at!(frames.arguments, frame_index);
            if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            let slots = frame_row::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index);
            let branch_error = programlet_branch(
                &sentence_view,
                symbol_words,
                &arguments,
                slots,
                &mut action,
                &mut has_selected_action,
            );
            if branch_error != 0 {
                return CoreResult::failure(branch_error, steps);
            }
            if !has_selected_action {
                array_put!(&mut frames.controls, frame_index, frame);
                continue;
            }
            if steps >= step_budget {
                return CoreResult::failure(ERROR_STEP_BUDGET, steps);
            }
            steps += 1;
            action
        } else {
            let mut sentence = ParsedSentence::empty();
            let parse_error = parse_sentence(&sentence_view, &mut sentence);
            if parse_error != 0 {
                return CoreResult::failure(parse_error, steps);
            }
            steps += 1;
            sentence
        };

        if frame.state == 1 && is_programlet_vector_declaration(&sentence, &sentence_view) {
            let (_, length) =
                match mutable_vector_declaration(words, base_codelet + pc, next_codelet - pc) {
                    Ok(declaration) => declaration,
                    Err(error) => return CoreResult::failure(error, steps),
                };
            let mut vector_slots = array_at!(frames.vector_slots, frame_index);
            if let Err(error) = declare_programlet_vector_local(
                &sentence,
                &sentence_view,
                symbol_words,
                &mut symbol_used,
                &mut vector_slots,
                &mut frames.vector_values,
                frame_index,
                length,
            ) {
                return CoreResult::failure(error, steps);
            }
            array_put!(&mut frames.vector_slots, frame_index, vector_slots);
        } else if frame.state == 1
            && sentence.mood == REALIS
            && sentence.verb_length == 1
            && matches!(
                sentence_at!(sentence_view, sentence.verb_start),
                NUMBER_VERB | BOOLEAN_VERB
            )
        {
            let arguments = array_at!(frames.arguments, frame_index);
            if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            let slots =
                frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, frame_index);
            if let Err(error) = declare_programlet_local(
                &sentence,
                &sentence_view,
                symbol_words,
                &mut symbol_used,
                &mut frame,
                &arguments,
                slots,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1 && is_programlet_composition_action(&sentence, &sentence_view) {
            frame.action_started = 1;
            if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            let arguments = array_at!(frames.arguments, frame_index);
            let slots =
                frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, frame_index);
            let vector_slots = array_at!(frames.vector_slots, frame_index);
            if let Err(error) = apply_programlet_composition_action(
                &sentence,
                &sentence_view,
                symbol_words,
                &mut symbol_used,
                &arguments,
                frame_index,
                slots,
                &vector_slots,
                &mut frames.vector_values,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1
            && is_programlet_vector_select(
                &sentence,
                &sentence_view,
                symbol_words,
                &array_at!(frames.arguments, frame_index),
                &array_at!(frames.vector_slots, frame_index),
            )
        {
            frame.action_started = 1;
            if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            let arguments = array_at!(frames.arguments, frame_index);
            let vector_slots = array_at!(frames.vector_slots, frame_index);
            let slots =
                frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, frame_index);
            if let Err(error) = apply_programlet_vector_select(
                &sentence,
                &sentence_view,
                symbol_words,
                &mut symbol_used,
                &arguments,
                frame_index,
                slots,
                &vector_slots,
                &frames.vector_values,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && is_programlet_embedding_lookup(words, base_codelet + pc, next_codelet - pc)
        {
            frame.action_started = 1;
            let vector_slots = array_at!(frames.vector_slots, frame_index);
            if let Err(error) = apply_programlet_embedding_lookup(
                words,
                base_codelet + pc,
                next_codelet - pc,
                &sentence_view,
                storage,
                symbol_words,
                &vector_slots,
                &mut frames.vector_values,
                frame_index,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && is_programlet_vector_action(
                &sentence,
                &sentence_view,
                symbol_words,
                &array_at!(frames.arguments, frame_index),
                &array_at!(frames.vector_slots, frame_index),
            )
        {
            frame.action_started = 1;
            let arguments = array_at!(frames.arguments, frame_index);
            if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            let slots =
                frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, frame_index);
            let mut vector_slots = array_at!(frames.vector_slots, frame_index);
            if let Err(error) = apply_programlet_vector_action(
                &sentence,
                &sentence_view,
                symbol_words,
                &mut symbol_used,
                &arguments,
                frame_index,
                slots,
                &mut vector_slots,
                &mut frames.vector_values,
            ) {
                return CoreResult::failure(error, steps);
            }
            array_put!(&mut frames.vector_slots, frame_index, vector_slots);
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && sentence.verb_length == 1
            && matches!(
                sentence_at!(sentence_view, sentence.verb_start),
                PLUS | SUBTRACT | MULTIPLY | DIVIDE | EXPONENTIAL | XOR | REMAINS | INVERT
            )
        {
            frame.action_started = 1;
            if let Err(error) = apply_programlet_number_action(
                &sentence,
                &sentence_view,
                symbol_words,
                frames,
                frame_index,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && sentence.verb_length == 1
            && sentence_at!(sentence_view, sentence.verb_start) == BOOLEAN_VERB
        {
            frame.action_started = 1;
            let arguments = array_at!(frames.arguments, frame_index);
            if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
                return CoreResult::failure(ERROR_MALFORMED, steps);
            }
            let slots =
                frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, frame_index);
            if let Err(error) = apply_programlet_boolean_action(
                &sentence,
                &sentence_view,
                symbol_words,
                &arguments,
                slots,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1 && sentence.mood == DEONTIC {
            array_put!(&mut frames.controls, frame_index, frame);
            if let Err(error) = execute_programlet_call(
                &sentence,
                words,
                base_codelet,
                codelet_count,
                &sentence_view,
                symbol_words,
                routine_directory_words,
                directory_offset,
                directory_entry_count,
                directory_signature_used,
                &mut symbol_used,
                frames,
                frame_index,
                &mut depth,
            ) {
                return CoreResult::failure(error, steps);
            }
            continue;
        } else if frame.state == 1 && sentence.mood == MOOD_RETURN {
            array_put!(&mut frames.controls, frame_index, frame);
            if let Err(error) = execute_programlet_return(
                &sentence,
                words,
                base_codelet,
                codelet_count,
                next_codelet,
                &sentence_view,
                symbol_words,
                frames,
                frame_index,
            ) {
                return CoreResult::failure(error, steps);
            }
            continue;
        } else if frame.state == 2 && sentence.mood == MOOD_PARAGRAPH {
            array_put!(&mut frames.controls, frame_index, frame);
            let mut result = CoreResult::empty();
            let close_status = close_programlet_paragraph(
                &sentence,
                &sentence_view,
                symbol_words,
                frames,
                frame_index,
                &mut depth,
                codelet_count,
                &mut result,
            );
            if close_status == PROGRAMLET_EXECUTION_COMPLETE {
                return result;
            }
            if close_status != 0 {
                return CoreResult::failure(close_status, steps);
            }
            continue;
        } else {
            return CoreResult::failure(ERROR_UNSUPPORTED, steps);
        }
        array_put!(&mut frames.controls, frame_index, frame);
    }
    CoreResult::failure(ERROR_MALFORMED, steps)
}
