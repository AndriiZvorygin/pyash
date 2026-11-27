export const CANDIDATES = [
  {
    file: "programlet_execute.rs",
    name: "programlet_loop_conditions_probe",
    functionName: "execute_numeric_programlet_at_with_directory_view",
    expected: "CoreResult",
    stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)",
    minimalStub: `let _symbol_used = match initialize_numeric_programlet(
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
    let mut depth = 1usize;
    let mut steps = 0u32;
    while depth > 0 {
        let frame_index = depth - 1;
        let frame = array_at!(frames.controls, frame_index);
        let pc = frame.program_counter as usize;
        let (token_count, _) = match collect_sentence_at(
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
        let mut sentence = ParsedSentence::empty();
        let parse_error = parse_sentence(&sentence_view, &mut sentence);
        if parse_error != 0 {
            return CoreResult::failure(parse_error, steps);
        }
        let mut selected = 0;
        if frame.state == 1
            && sentence.mood == REALIS
            && sentence.verb_length == 1
            && matches!(sentence_at!(sentence_view, sentence.verb_start), NUMBER_VERB | BOOLEAN_VERB)
        {
            selected = 1;
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
            selected = 2;
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && sentence.verb_length == 1
            && matches!(sentence_at!(sentence_view, sentence.verb_start), PLUS | SUBTRACT | MULTIPLY | DIVIDE | EXPONENTIAL | XOR | REMAINS | INVERT)
        {
            selected = 3;
        } else if frame.state == 1
            && sentence.mood == DEONTIC
            && sentence.verb_length == 1
            && sentence_at!(sentence_view, sentence.verb_start) == BOOLEAN_VERB
        {
            selected = 4;
        } else if frame.state == 1 && sentence.mood == DEONTIC {
            selected = 5;
        } else if frame.state == 1 && sentence.mood == MOOD_RETURN {
            selected = 6;
        } else if frame.state == 2 && sentence.mood == MOOD_PARAGRAPH {
            selected = 7;
        }
        steps = selected;
        depth -= 1;
    }
    CoreResult::failure(ERROR_UNSUPPORTED, steps)`,
  },
  {
    file: "programlet_execute.rs",
    name: "programlet_loop_sentence_select_probe",
    functionName: "execute_numeric_programlet_at_with_directory_view",
    expected: "CoreResult",
    stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)",
    minimalStub: `let _symbol_used = match initialize_numeric_programlet(
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
    let mut depth = 1usize;
    let mut steps = 0u32;
    while depth > 0 {
        let frame_index = depth - 1;
        let frame = array_at!(frames.controls, frame_index);
        let pc = frame.program_counter as usize;
        let (token_count, _) = match collect_sentence_at(
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
        if contains_marked_token(&sentence_view, CONDITIONAL) {
            let mut action = ParsedSentence::empty();
            let mut has_selected_action = false;
            let arguments = array_at!(frames.arguments, frame_index);
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
            steps += u32::from(has_selected_action);
        } else {
            let mut sentence = ParsedSentence::empty();
            let parse_error = parse_sentence(&sentence_view, &mut sentence);
            if parse_error != 0 {
                return CoreResult::failure(parse_error, steps);
            }
            steps += 1;
        }
        depth -= 1;
    }
    CoreResult::failure(ERROR_UNSUPPORTED, steps)`,
  },
  { file: "programlet_branch.rs", name: "programlet_branch", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "programlet_branch.rs", name: "read_optional_programlet_number", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "boolean.rs", name: "evaluate_boolean_expression_with_env", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_actions.rs", name: "apply_programlet_number_action", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_actions.rs", name: "apply_programlet_boolean_action", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  {
    file: "programlet_execute_setup.rs",
    name: "initialize_numeric_programlet",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if codelet_count == 0 {
        return Err(ERROR_MALFORMED);
    }
    let invocation_start = last_programlet_sentence_start(words, base_codelet, codelet_count)?;
    let (invocation_length, _) = collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        invocation_start,
    )?;
    let invocation_view = SentenceView::new(words, base_codelet + invocation_start, invocation_length);
    let mut invocation = ParsedSentence::empty();
    let parse_error = parse_sentence(&invocation_view, &mut invocation);
    if parse_error != 0 {
        return Err(parse_error);
    }
    Err(ERROR_UNSUPPORTED)`,
  },
  { file: "programlet_frame.rs", name: "clear_programlet_frame", expected: "()", stub: "" },
  {
    file: "sentence.rs",
    name: "collect_sentence_at",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if start >= window_codelet_count
        || base_codelet > total_codelet_count
        || window_codelet_count > total_codelet_count - base_codelet
        || total_codelet_count > words.len() / CODELET_WORDS
    {
        return Err(ERROR_MALFORMED);
    }
    let absolute_codelet = base_codelet + start;
    let header = word(words, absolute_codelet, 0);
    let complete = header & 1 != 0;
    if !complete {
        return Err(ERROR_MALFORMED);
    }
    let mut last_boundary = 0;
    let mut slot = 1;
    while slot < CODELET_WORDS {
        if (header & (1 << slot) != 0) == complete {
            last_boundary = slot;
        }
        slot += 1;
    }
    if last_boundary == 0 {
        return Err(ERROR_MALFORMED);
    }
    slot = 1;
    while slot <= last_boundary {
        if word(words, absolute_codelet, slot) > MAX_U16 {
            return Err(ERROR_MALFORMED);
        }
        slot += 1;
    }
    Ok((last_boundary, start + 1))`,
  },
  { file: "numeric.rs", name: "word", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "sentence.rs", name: "parse_sentence", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  {
    file: "sentence.rs",
    name: "parse_sentence_range",
    expected: "u32",
    stub: "ERROR_UNSUPPORTED",
    minimalStub: `let mut result = ParsedSentence::empty();
    result.fields[0] = SentenceField { role: tokens.token_unchecked(start), start, length: end - start };
    result.field_count = 1;
    result.verb_start = start;
    result.verb_length = end - start;
    result.mood = tokens.token_unchecked(end - 1);
    *parsed = result;
    0`,
  },
  {
    file: "sentence.rs",
    name: "parse_sentence_range_token_read_probe",
    functionName: "parse_sentence_range",
    expected: "u32",
    stub: "ERROR_UNSUPPORTED",
    minimalStub: `let _first = tokens.token_unchecked(start);
    let _last = tokens.token_unchecked(end - 1);
    0`,
  },
  {
    file: "sentence.rs",
    name: "parse_sentence_range_result_write_probe",
    functionName: "parse_sentence_range",
    expected: "u32",
    stub: "ERROR_UNSUPPORTED",
    minimalStub: `let mut result = ParsedSentence::empty();
    result.fields[0] = SentenceField { role: NOMINATIVE, start, length: end - start };
    result.field_count = 1;
    result.verb_start = start;
    result.verb_length = end - start;
    result.mood = REALIS;
    *parsed = result;
    0`,
  },
  {
    file: "sentence.rs",
    name: "parse_sentence_range_empty_success_probe",
    functionName: "parse_sentence_range",
    expected: "u32",
    stub: "ERROR_UNSUPPORTED",
    minimalStub: `*parsed = ParsedSentence::empty();
    0`,
  },
  { file: "sentence.rs", name: "contains_marked_token", expected: "bool", stub: "false" },
  { file: "sentence.rs", name: "typed_output_name", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  {
    file: "programlet_arguments.rs",
    name: "capture_programlet_arguments",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `*captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    *captured_vectors = [0; MAX_PROGRAMLET_CALL_VECTOR_WORDS];
    *captured_count = 0;
    Ok(())`,
  },
  {
    file: "programlet_arguments.rs",
    name: "capture_programlet_arguments_count_probe",
    functionName: "capture_programlet_arguments",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `*captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    *captured_vectors = [[0; RESULT_WORDS]; MAX_PROGRAMLET_ARGUMENTS];
    if sentence.field_count > MAX_PROGRAMLET_ARGUMENTS {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let fields = sentence.fields;
    let mut count = 0usize;
    if sentence.field_count > 0 && !matches!(fields[0].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) { count += 1; }
    if sentence.field_count > 1 && !matches!(fields[1].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) { count += 1; }
    if sentence.field_count > 2 && !matches!(fields[2].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) { count += 1; }
    if sentence.field_count > 3 && !matches!(fields[3].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) { count += 1; }
    if sentence.field_count > 4 && !matches!(fields[4].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) { count += 1; }
    if sentence.field_count > 5 && !matches!(fields[5].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) { count += 1; }
    if sentence.field_count > 6 && !matches!(fields[6].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) { count += 1; }
    if sentence.field_count > 7 && !matches!(fields[7].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) { count += 1; }
    *captured_count = count as u32;
    Ok(())`,
  },
];
