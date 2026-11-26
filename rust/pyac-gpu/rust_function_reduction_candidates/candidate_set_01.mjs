export const CANDIDATES = [
  { file: "dispatch.rs", name: "interpret_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "signature_dispatch.rs", name: "select_signature_route", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "signature_dispatch.rs", name: "classify_verb", expected: "u32", stub: "VERB_UNSUPPORTED" },
  { file: "canonical_signature.rs", name: "signature", expected: "SignatureView", stub: "SignatureView::failure(ERROR_UNSUPPORTED)" },
  { file: "signature_dispatch.rs", name: "is_multicodelet_vector_literal", expected: "bool", stub: "false" },
  { file: "signature_dispatch.rs", name: "has_boundary_word", expected: "bool", stub: "false" },
  { file: "boolean.rs", name: "boolean_composition", expected: "Option", stub: "None" },
  { file: "boolean.rs", name: "boolean_comparison", expected: "Option", stub: "None" },
  { file: "pluk_tlas.rs", name: "pluk_tlas_group", expected: "Option", stub: "None" },
  { file: "pluk_tlas.rs", name: "resolve_vector", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "scalar_product.rs", name: "scalar_product_group", expected: "Option", stub: "None" },
  { file: "named_vector.rs", name: "resolve_prior_vector", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "iwsp_vector_ops.rs", name: "iwsp_vector_float_arithmetic_group", functionName: "vector_float_arithmetic_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "iwsp_vector_ops.rs", name: "iwsp_vector_sum_group", functionName: "vector_sum_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "iwsp_vector_ops.rs", name: "iwsp_vector_maximum_group", functionName: "vector_maximum_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "mutable_vector.rs", name: "mutable_vector_group", expected: "Option", stub: "None" },
  { file: "fixed16.rs", name: "fixed16_single_codelet", functionName: "single_codelet", expected: "Option", stub: "None" },
  { file: "float.rs", name: "float_single_codelet", functionName: "single_codelet", expected: "Option", stub: "None" },
  { file: "vector_group.rs", name: "interpret_vector_group", expected: "Option", stub: "None" },
  { file: "vector_group.rs", name: "vector_name_span", expected: "Option", stub: "None" },
  { file: "mutable_vector.rs", name: "mutable_vector_declaration", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "scalar_product.rs", name: "scalar_product_destination", expected: "Result", stub: "Ok(ScalarProductDestination::NONE)" },
  { file: "conditional.rs", name: "conditional", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "numeric.rs", name: "invert", expected: "Option", stub: "None" },
  { file: "numeric.rs", name: "vector_arithmetic", expected: "Option", stub: "None" },
  { file: "numeric.rs", name: "arithmetic", expected: "Option", stub: "None" },
  { file: "numeric.rs", name: "number_operator", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "numeric.rs", name: "boolean_literal", expected: "Option", stub: "None" },
  { file: "numeric.rs", name: "numeric_literal", functionName: "literal", expected: "Option", stub: "None" },
  { file: "float.rs", name: "float_literal", functionName: "literal", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "programlet_entrypoints.rs", name: "execute_numeric_programlet_at", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "programlet_entrypoints.rs", name: "execute_numeric_programlet", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "programlet_entrypoints.rs", name: "execute_numeric_programlet_at_with_directory_words", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  {
    file: "programlet_execute.rs",
    name: "execute_numeric_programlet_at_with_directory_view",
    expected: "CoreResult",
    stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)",
    minimalStub: `let _initialization = initialize_numeric_programlet(
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
    );
    CoreResult::failure(ERROR_UNSUPPORTED, 0)`,
  },
  {
    file: "programlet_execute.rs",
    name: "programlet_one_sentence_parse_probe",
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
    let frame = array_at!(frames.controls, 0);
    let pc = frame.program_counter as usize;
    let (token_count, _) = match collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        pc,
    ) {
        Ok(group) => group,
        Err(error) => return CoreResult::failure(error, 0),
    };
    let sentence_view = SentenceView::new(words, base_codelet + pc, token_count);
    let mut sentence = ParsedSentence::empty();
    let parse_error = parse_sentence(&sentence_view, &mut sentence);
    if parse_error != 0 {
        return CoreResult::failure(parse_error, 0);
    }
    CoreResult::failure(ERROR_UNSUPPORTED, 1)`,
  },
  {
    file: "programlet_execute.rs",
    name: "programlet_one_sentence_branch_probe",
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
    let frame = array_at!(frames.controls, 0);
    let pc = frame.program_counter as usize;
    let (token_count, _) = match collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        pc,
    ) {
        Ok(group) => group,
        Err(error) => return CoreResult::failure(error, 0),
    };
    let sentence_view = SentenceView::new(words, base_codelet + pc, token_count);
    let mut action = ParsedSentence::empty();
    let mut has_selected_action = false;
    let arguments = array_at!(frames.arguments, 0);
    let slots = frame_row::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, 0);
    let branch_error = programlet_branch(
        &sentence_view,
        symbol_words,
        &arguments,
        slots,
        &mut action,
        &mut has_selected_action,
    );
    if branch_error != 0 {
        return CoreResult::failure(branch_error, 0);
    }
    CoreResult::failure(ERROR_UNSUPPORTED, 1)`,
  },
  {
    file: "programlet_execute.rs",
    name: "programlet_action_conditions_probe",
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
    let frame = array_at!(frames.controls, 0);
    let pc = frame.program_counter as usize;
    let (token_count, _) = match collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        pc,
    ) {
        Ok(group) => group,
        Err(error) => return CoreResult::failure(error, 0),
    };
    let sentence_view = SentenceView::new(words, base_codelet + pc, token_count);
    let mut sentence = ParsedSentence::empty();
    let parse_error = parse_sentence(&sentence_view, &mut sentence);
    if parse_error != 0 {
        return CoreResult::failure(parse_error, 0);
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
            &array_at!(frames.arguments, 0),
            &array_at!(frames.vector_slots, 0),
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
    CoreResult::failure(ERROR_UNSUPPORTED, selected)`,
  },
  {
    file: "programlet_execute.rs",
    name: "programlet_loop_parse_probe",
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
        steps += 1;
        depth -= 1;
    }
    CoreResult::failure(ERROR_UNSUPPORTED, steps)`,
  },
];
