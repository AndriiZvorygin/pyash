use super::*;

pub fn execute_numeric_programlet(
    words: &[u32],
    codelet_count: usize,
    step_budget: u32,
    sentence_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    sentence_boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    frames: &mut [ProgramletFrame; MAX_PROGRAMLET_CALL_DEPTH],
) -> CoreResult {
    execute_numeric_programlet_at(
        words,
        0,
        codelet_count,
        step_budget,
        sentence_words,
        sentence_boundaries,
        symbol_words,
        frames,
    )
}

pub fn execute_numeric_programlet_at(
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    step_budget: u32,
    sentence_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    sentence_boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    frames: &mut [ProgramletFrame; MAX_PROGRAMLET_CALL_DEPTH],
) -> CoreResult {
    let mut symbol_used = match initialize_numeric_programlet(
        words,
        base_codelet,
        codelet_count,
        step_budget,
        sentence_words,
        sentence_boundaries,
        symbol_words,
        frames,
    ) {
        Ok(used) => used,
        Err(error) => return CoreResult::failure(error, 0),
    };
    if frames[0].loop_active != 0 && frames[0].loop_remaining == 0 {
        let mut output = ProgramletNumber::EMPTY;
        let has_output = argument_value(&frames[0].arguments, ACCUSATIVE, &mut output);
        let (value, kind) = if has_output {
            if !number_kind_matches(frames[0].expected_kind, output.kind) {
                return CoreResult::failure(ERROR_UNSUPPORTED, 0);
            }
            (output.bits, output.kind)
        } else if frames[0].expected_kind == VALUE_BOOLEAN {
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
        let frame = &mut frames[frame_index];
        let pc = frame.program_counter as usize;
        if pc >= frame.routine_end as usize {
            return CoreResult::failure(ERROR_MALFORMED, steps);
        }
        let (length, next_codelet) = match collect_sentence_at(
            words,
            base_codelet + codelet_count,
            base_codelet,
            codelet_count,
            pc,
            sentence_words,
            sentence_boundaries,
        ) {
            Ok(group) => group,
            Err(error) => return CoreResult::failure(error, steps),
        };
        frame.program_counter = next_codelet as u32;
        let sentence =
            if contains_marked_token(sentence_words, sentence_boundaries, length, CONDITIONAL) {
                if steps >= step_budget {
                    return CoreResult::failure(ERROR_STEP_BUDGET, steps);
                }
                steps += 1;
                frame.action_started = 1;
                let mut action = ParsedSentence::empty();
                let mut has_selected_action = false;
                let branch_error = programlet_branch(
                    sentence_words,
                    sentence_boundaries,
                    length,
                    symbol_words,
                    &frame.arguments,
                    &frame.slots,
                    &mut action,
                    &mut has_selected_action,
                );
                if branch_error != 0 {
                    return CoreResult::failure(branch_error, steps);
                }
                if !has_selected_action {
                    continue;
                }
                if steps >= step_budget {
                    return CoreResult::failure(ERROR_STEP_BUDGET, steps);
                }
                steps += 1;
                action
            } else {
                let mut sentence = ParsedSentence::empty();
                let parse_error =
                    parse_sentence(sentence_words, sentence_boundaries, length, &mut sentence);
                if parse_error != 0 {
                    return CoreResult::failure(parse_error, steps);
                }
                steps += 1;
                sentence
            };

        if frame.state == 1
            && sentence.mood == REALIS
            && sentence.verb_length == 1
            && matches!(
                array_at!(sentence_words, sentence.verb_start),
                NUMBER_VERB | BOOLEAN_VERB
            )
        {
            if let Err(error) = declare_programlet_local(
                &sentence,
                sentence_words,
                symbol_words,
                &mut symbol_used,
                frame,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && is_programlet_vector_action(&sentence, sentence_words, symbol_words, frame)
        {
            frame.action_started = 1;
            if let Err(error) = apply_programlet_vector_action(
                &sentence,
                sentence_words,
                symbol_words,
                &mut symbol_used,
                frame,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && sentence.verb_length == 1
            && matches!(
                array_at!(sentence_words, sentence.verb_start),
                PLUS | SUBTRACT | MULTIPLY | DIVIDE | EXPONENTIAL | XOR | REMAINS | INVERT
            )
        {
            frame.action_started = 1;
            if let Err(error) = apply_programlet_number_action(
                &sentence,
                sentence_words,
                symbol_words,
                &frame.arguments,
                &mut frame.slots,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && sentence.verb_length == 1
            && array_at!(sentence_words, sentence.verb_start) == BOOLEAN_VERB
        {
            frame.action_started = 1;
            if let Err(error) = apply_programlet_boolean_action(
                &sentence,
                sentence_words,
                symbol_words,
                &frame.arguments,
                &mut frame.slots,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1 && sentence.mood == DEONTIC {
            if let Err(error) = execute_programlet_call(
                &sentence,
                words,
                base_codelet,
                codelet_count,
                sentence_words,
                sentence_boundaries,
                symbol_words,
                &mut symbol_used,
                frames,
                frame_index,
                &mut depth,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 1 && sentence.mood == MOOD_RETURN {
            if let Err(error) = execute_programlet_return(
                &sentence,
                words,
                base_codelet,
                codelet_count,
                next_codelet,
                sentence_words,
                sentence_boundaries,
                symbol_words,
                frames,
                frame_index,
            ) {
                return CoreResult::failure(error, steps);
            }
        } else if frame.state == 2 && sentence.mood == MOOD_PARAGRAPH {
            let mut result = CoreResult::empty();
            let close_status = close_programlet_paragraph(
                &sentence,
                sentence_words,
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
        } else {
            return CoreResult::failure(ERROR_UNSUPPORTED, steps);
        }
    }
    CoreResult::failure(ERROR_MALFORMED, steps)
}
