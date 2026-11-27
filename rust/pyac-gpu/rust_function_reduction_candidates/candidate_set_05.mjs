export const CANDIDATES = [
  { file: "programlet_vector_values/floats.rs", name: "write_programlet_float", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_dispatch_index.rs", name: "append_name", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  {
    file: "programlet_dispatch_signature.rs",
    name: "insert_case",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if *count >= cases.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    cases[*count] = SignatureCase { role, value_type };
    *count += 1;
    Ok(())`,
  },
  {
    file: "programlet_dispatch_signature.rs",
    name: "sort_cases",
    expected: "()",
    stub: "()",
    minimalStub: "()",
  },
  {
    file: "programlet_dispatch_index.rs",
    name: "make_call_signature",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `let mut cases = [SignatureCase::EMPTY; MAX_ROUTINE_SIGNATURE_CASES];
    let case_count = 0;
    Ok(CallSignature {
        cases,
        case_count,
        verb_start: sentence.verb_start,
        length: sentence.verb_length,
    })`,
  },
  { file: "programlet_dispatch_index.rs", name: "definition_signature", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_dispatch_index/body_scan.rs", name: "close_matches_verb", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_dispatch_index.rs", name: "sort_directory", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)", minimalStub: "Ok(())" },
  { file: "programlet_dispatch_index/body_scan.rs", name: "find_routine_body_end", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_symbols.rs", name: "is_ceremony_definition", expected: "bool", stub: "false", minimalStub: "false" },
  { file: "iwsp_vector_ops.rs", name: "vector_float_arithmetic_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "iwsp_vector_ops.rs", name: "vector_sum_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "iwsp_vector_ops.rs", name: "vector_maximum_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  {
    file: "programlet_dispatch_index.rs",
    name: "build_programlet_routine_directory",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `directory.entries = [RoutineEntry::EMPTY; MAX_PROGRAMLET_ROUTINES];
    directory.signatures = [0; MAX_PROGRAMLET_SYMBOL_WORDS];
    let signature_length = codelet_count * (CODELET_WORDS - 1);
    directory.entry_count = usize::from(codelet_count > 0);
    directory.signature_used = signature_length;
    if codelet_count > 0 {
        array_put!(
            &mut directory.entries,
            0,
            RoutineEntry {
                signature_start: 0,
                signature_length: signature_length as u32,
                verb_start: 0,
                verb_length: 1,
                definition_start: 0,
                routine_start: 0,
                routine_end: codelet_count as u32,
                output_name_start: 0,
                output_name_length: 1,
                output_kind: VALUE_UNSIGNED,
            }
        );
    }
    let mut index = 0;
    while index < signature_length {
        array_put!(
            &mut directory.signatures,
            index,
            word(words, base_codelet + index / (CODELET_WORDS - 1), index % (CODELET_WORDS - 1))
        );
        index += 1;
    }
    Ok(())`,
  },
  {
    file: "programlet_dispatch_index.rs",
    name: "resolve_programlet_routine",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if argument_count > 0 {
        let argument = arguments[0];
        if argument.role == u32::MAX && argument.value_kind == u32::MAX {
            return Err(ERROR_MALFORMED);
        }
    }
    Ok(SelectedProgramletRoutine {
        name: NameSpan::EMPTY,
        output_name: NameSpan::EMPTY,
        output_kind: VALUE_UNSIGNED,
        definition_start: 0,
        routine_start: 0,
        routine_end: 0,
    })`,
  },
  {
    file: "programlet_execute_call.rs",
    name: "execute_programlet_call",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `let mut caller = array_at!(frames.controls, frame_index);
    caller.action_started = 1;
    if sentence.field_count == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(output) = sentence.field(DESTINATION) else {
        return Err(ERROR_MALFORMED);
    };
    let mut return_name = NameSpan::EMPTY;
    let mut return_kind = 0;
    let output_error = typed_output_name(sentence_view, output, &mut return_name, &mut return_kind);
    if output_error != 0 {
        return Err(output_error);
    }
    let mut stored_return_name = NameSpan::EMPTY;
    let name_error = store_name(sentence_view, return_name, symbol_words, symbol_used, &mut stored_return_name);
    if name_error != 0 {
        return Err(name_error);
    }
    let _call_loop_remaining = loop_iterations(sentence, sentence_view)?;
    let mut call_arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let mut call_argument_vectors = [[0; RESULT_WORDS]; MAX_PROGRAMLET_ARGUMENTS];
    let mut call_argument_count = 0;
    let caller_arguments = array_at!(frames.arguments, frame_index);
    if !frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&frames.slots, frame_index) {
        return Err(ERROR_MALFORMED);
    }
    let caller_slots = frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut frames.slots, frame_index);
    let caller_vector_slots = array_at!(frames.vector_slots, frame_index);
    capture_programlet_arguments(
        sentence,
        sentence_view,
        symbol_words,
        &caller_arguments,
        caller_slots,
        &caller_vector_slots,
        &frames.argument_vectors,
        frame_index,
        &frames.vector_values,
        &mut call_arguments,
        &mut call_argument_vectors,
        &mut call_argument_count,
    )?;
    let call_loop_cursor = optional_number_field(sentence, FROM_INDEX, sentence_view)?;
    let loop_argument_index = call_argument_count as usize;
    if let Some(cursor) = call_loop_cursor {
        set_loop_index_argument(&mut call_arguments, loop_argument_index, cursor)?;
    }
    let selected = resolve_programlet_routine(
        routine_directory_words,
        directory_offset,
        directory_entry_count,
        directory_signature_used,
        sentence,
        sentence_view,
        symbol_words,
        symbol_used,
        &call_arguments,
        call_argument_count,
        return_kind,
    )?;
    if let Err(error) = validate_programlet_arguments(
        words,
        base_codelet,
        codelet_count,
        selected.definition_start,
        selected.routine_start,
        symbol_words,
        symbol_used,
        &mut call_arguments,
        call_argument_count,
    ) {
        return Err(error);
    }
    if !programlet_type_matches(return_kind, selected.output_kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    Ok(())`,
  },
  {
    file: "programlet_execute_declare.rs",
    name: "declare_programlet_local",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if frame.action_started != 0 || sentence.field_count != 3 {
        return Err(ERROR_MALFORMED);
    }
    let (Some(su), Some(_ob), Some(_as_field)) = (
        sentence.field(NOMINATIVE),
        sentence.field(ACCUSATIVE),
        sentence.field(ESSIVE),
    ) else {
        return Err(ERROR_MALFORMED);
    };
    let mut name = NameSpan::EMPTY;
    let name_error = name_span(sentence_view, su, false, &mut name);
    if name_error != 0 {
        return Err(name_error);
    }
    Ok(())`,
  },
  { file: "programlet_execute_return.rs", name: "execute_programlet_return", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
];
