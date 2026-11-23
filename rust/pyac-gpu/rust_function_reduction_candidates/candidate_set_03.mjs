export const CANDIDATES = [
  {
    file: "programlet_arguments.rs",
    name: "capture_programlet_arguments_dynamic_count_probe",
    functionName: "capture_programlet_arguments",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `*captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    *captured_vectors = [[0; RESULT_WORDS]; MAX_PROGRAMLET_ARGUMENTS];
    let fields = sentence.fields;
    let mut index = 0usize;
    let mut count = 0usize;
    while index < sentence.field_count {
        let field = array_at!(fields, index);
        if !matches!(field.role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) {
            count += 1;
        }
        index += 1;
    }
    if count > MAX_PROGRAMLET_ARGUMENTS {
        return Err(ERROR_FRAME_CAPACITY);
    }
    *captured_count = count as u32;
    Ok(())`,
  },
  {
    file: "programlet_arguments.rs",
    name: "capture_programlet_arguments_scalar_read_probe",
    functionName: "capture_programlet_arguments",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `*captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    *captured_vectors = [[0; RESULT_WORDS]; MAX_PROGRAMLET_ARGUMENTS];
    let fields = sentence.fields;
    let mut index = 0usize;
    let mut count = 0usize;
    while index < sentence.field_count {
        let field = array_at!(fields, index);
        if !matches!(field.role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) {
            let mut value = ProgramletNumber::EMPTY;
            let error = resolve_programlet_value(tokens, field, symbols, arguments, slots, &mut value);
            if error == u32::MAX || value.kind == u32::MAX {
                return Err(ERROR_MALFORMED);
            }
            count += 1;
        }
        index += 1;
    }
    *captured_count = count as u32;
    Ok(())`,
  },
  {
    file: "programlet_arguments.rs",
    name: "capture_programlet_arguments_scalar_store_probe",
    functionName: "capture_programlet_arguments",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `*captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    *captured_vectors = [[0; RESULT_WORDS]; MAX_PROGRAMLET_ARGUMENTS];
    let fields = sentence.fields;
    let mut index = 0usize;
    let mut count = 0usize;
    while index < sentence.field_count {
        let field = array_at!(fields, index);
        if !matches!(field.role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) {
            if count == MAX_PROGRAMLET_ARGUMENTS {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let mut value = ProgramletNumber::EMPTY;
            let error = resolve_programlet_value(tokens, field, symbols, arguments, slots, &mut value);
            if error != 0 {
                return Err(error);
            }
            array_put!(captured, count, ProgramletArgument {
                role: field.role,
                value: value.bits,
                value_high: value.high,
                value_kind: value.kind,
                ..ProgramletArgument::EMPTY
            });
            count += 1;
        }
        index += 1;
    }
    *captured_count = count as u32;
    Ok(())`,
  },
  {
    file: "programlet_arguments.rs",
    name: "capture_programlet_arguments_float_probe",
    functionName: "capture_programlet_arguments",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `*captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    *captured_vectors = [[0; RESULT_WORDS]; MAX_PROGRAMLET_ARGUMENTS];
    let fields = sentence.fields;
    let mut index = 0usize;
    let mut count = 0usize;
    while index < sentence.field_count {
        let field = array_at!(fields, index);
        if !matches!(field.role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) {
            if count == MAX_PROGRAMLET_ARGUMENTS {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let mut scalar = ProgramletNumber::EMPTY;
            let scalar_error = resolve_programlet_value(tokens, field, symbols, arguments, slots, &mut scalar);
            let captured_value = if scalar_error == 0 {
                ProgramletArgument {
                    role: field.role,
                    value: scalar.bits,
                    value_high: scalar.high,
                    value_kind: scalar.kind,
                    ..ProgramletArgument::EMPTY
                }
            } else if let Ok(value) = read_programlet_float(tokens, field, symbols, arguments, slots) {
                ProgramletArgument {
                    role: field.role,
                    value: value.bits,
                    value_high: value.high,
                    value_kind: value.kind,
                    ..ProgramletArgument::EMPTY
                }
            } else {
                return Err(ERROR_UNSUPPORTED);
            };
            array_put!(captured, count, captured_value);
            count += 1;
        }
        index += 1;
    }
    *captured_count = count as u32;
    Ok(())`,
  },
  {
    file: "programlet_arguments.rs",
    name: "capture_programlet_arguments_vector_single_lane_store_probe",
    functionName: "capture_programlet_arguments",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `*captured = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    *captured_vectors = [0; MAX_PROGRAMLET_CALL_VECTOR_WORDS];
    let fields = sentence.fields;
    let mut index = 0usize;
    let mut count = 0usize;
    while index < sentence.field_count {
        let field = array_at!(fields, index);
        if !matches!(field.role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX) {
            if count == MAX_PROGRAMLET_ARGUMENTS {
                return Err(ERROR_FRAME_CAPACITY);
            }
            let mut scalar = ProgramletNumber::EMPTY;
            let scalar_error = resolve_programlet_value(tokens, field, symbols, arguments, slots, &mut scalar);
            let captured_value = if scalar_error == 0 {
                ProgramletArgument {
                    role: field.role,
                    value: scalar.bits,
                    value_high: scalar.high,
                    value_kind: scalar.kind,
                    ..ProgramletArgument::EMPTY
                }
            } else if let Ok(value) = read_programlet_float(tokens, field, symbols, arguments, slots) {
                ProgramletArgument {
                    role: field.role,
                    value: value.bits,
                    value_high: value.high,
                    value_kind: value.kind,
                    ..ProgramletArgument::EMPTY
                }
            } else {
                let vector = read_programlet_vector(
                    tokens,
                    field,
                    symbols,
                    arguments,
                    argument_vectors,
                    frame_index,
                    vector_slots,
                    vector_values,
                )?;
                array_put!(captured_vectors, count * RESULT_WORDS, vector.values[0]);
                ProgramletArgument {
                    role: field.role,
                    value_kind: vector.kind,
                    vector_length: vector.length as u32,
                    ..ProgramletArgument::EMPTY
                }
            };
            array_put!(captured, count, captured_value);
            count += 1;
        }
        index += 1;
    }
    *captured_count = count as u32;
    Ok(())`,
  },
  {
    file: "programlet_arguments.rs",
    name: "validate_programlet_arguments",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `let (definition_length, next) = collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        definition_start,
    )?;
    if next != routine_start {
        return Err(ERROR_MALFORMED);
    }
    let definition_view =
        SentenceView::new(words, base_codelet + definition_start, definition_length);
    let mut definition = ParsedSentence::empty();
    let parse_error = parse_sentence(&definition_view, &mut definition);
    if parse_error != 0 {
        return Err(parse_error);
    }
    if !is_ceremony_definition(&definition, &definition_view) {
        return Err(ERROR_MALFORMED);
    }
    if !is_ceremony_definition(&definition, &definition_view) {
        return Err(ERROR_MALFORMED);
    }
    let mut formal_count = 0usize;
    let definition_fields = definition.fields;
    if definition.field_count > 0
        && !matches!(definition_fields[0].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX)
    {
        formal_count += 1;
    }
    if definition.field_count > 1
        && !matches!(definition_fields[1].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX)
    {
        formal_count += 1;
    }
    if definition.field_count > 2
        && !matches!(definition_fields[2].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX)
    {
        formal_count += 1;
    }
    if definition.field_count > 3
        && !matches!(definition_fields[3].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX)
    {
        formal_count += 1;
    }
    if definition.field_count > 4
        && !matches!(definition_fields[4].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX)
    {
        formal_count += 1;
    }
    if definition.field_count > 5
        && !matches!(definition_fields[5].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX)
    {
        formal_count += 1;
    }
    if definition.field_count > 6
        && !matches!(definition_fields[6].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX)
    {
        formal_count += 1;
    }
    if definition.field_count > 7
        && !matches!(definition_fields[7].role, NOMINATIVE | DESTINATION | FROM_INDEX | TO_INDEX)
    {
        formal_count += 1;
    }
    if formal_count != argument_count as usize {
        return Err(ERROR_MALFORMED);
    }
    Ok(())`,
  },
  { file: "programlet_values.rs", name: "loop_iterations", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  {
    file: "programlet_values.rs",
    name: "set_loop_register_argument",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if index >= MAX_PROGRAMLET_ARGUMENTS {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let mut argument = arguments[index];
    argument.role = role;
    argument.value = value;
    argument.value_kind = VALUE_UNSIGNED;
    arguments[index] = argument;
    Ok(())`,
  },
  { file: "programlet_values.rs", name: "number_value", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  {
    file: "programlet_values.rs",
    name: "argument_value",
    expected: "ProgramletNumber",
    stub: "ProgramletNumber::EMPTY",
    minimalStub: "ProgramletNumber::EMPTY",
  },
  {
    file: "programlet_values.rs",
    name: "resolve_programlet_value",
    expected: "u32",
    stub: "ERROR_UNSUPPORTED",
    minimalStub: `if field.length == 2 && sentence_at!(*tokens, field.start) == NUMBER_QUOTE {
        *value = ProgramletNumber { bits: sentence_at!(*tokens, field.start + 1), high: 0, kind: VALUE_UNSIGNED };
        return 0;
    }
    if field.length == 1 {
        let token = sentence_at!(*tokens, field.start);
        if token == TRUTH || token == LIE {
            *value = ProgramletNumber { bits: u32::from(token == TRUTH), high: 0, kind: VALUE_BOOLEAN };
            return 0;
        }
    }
    if field.length == 5
        && sentence_at!(*tokens, field.start) == THIS_WORD
        && sentence_at!(*tokens, field.start + 1) == GENITIVE_CASE
        && sentence_at!(*tokens, field.start + 3) == GENITIVE_CASE
    {
        *value = argument_value(*arguments, sentence_at!(*tokens, field.start + 2));
        return 0;
    }
    ERROR_UNSUPPORTED`,
  },
  {
    file: "sentence.rs",
    name: "name_span",
    expected: "u32",
    stub: "ERROR_UNSUPPORTED",
    minimalStub: `let _typed_number = typed_number;
    *name = NameSpan::EMPTY;
    0`,
  },
  { file: "sentence.rs", name: "typed_name_span", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "programlet_symbols.rs", name: "store_name", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "programlet_symbols.rs", name: "find_local_slot", expected: "Option", stub: "Some(0)" },
];
