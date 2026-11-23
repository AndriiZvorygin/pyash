export const CANDIDATES = [
  { file: "programlet_vector_actions.rs", name: "exp_f32", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)", minimalStub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "exp_f64", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)", minimalStub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "apply_f32", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)", minimalStub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "apply_f64", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)", minimalStub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "reduce_vector", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)", minimalStub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_values.rs", name: "name_from_field", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_values.rs", name: "find_argument", expected: "Option", stub: "None" },
  { file: "programlet_vector_values.rs", name: "find_programlet_vector_slot", expected: "Option", stub: "None" },
  { file: "programlet_vector_actions.rs", name: "apply_programlet_vector_action", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)", minimalStub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "is_programlet_vector_action", expected: "bool", stub: "false" },
  {
    file: "programlet_vector_actions.rs",
    name: "is_programlet_vector_action_true_probe",
    functionName: "is_programlet_vector_action",
    expected: "bool",
    stub: "false",
    minimalStub: "true",
  },
  { file: "programlet_vector_actions.rs", name: "is_programlet_vector_verb", expected: "bool", stub: "false" },
  {
    file: "programlet_vector_values.rs",
    name: "programlet_field_is_vector",
    expected: "bool",
    stub: "false",
    minimalStub: `if field.length == 0 {
        return false;
    }
    let header = quote_header(sentence_at!(*tokens, field.start));
    header.valid != 0 && header.sort == 6 && (sentence_at!(*tokens, field.start) & 0x0700) != 0`,
  },
  {
    file: "programlet_vector_values.rs",
    name: "programlet_field_is_vector_length_probe",
    functionName: "programlet_field_is_vector",
    expected: "bool",
    stub: "false",
    minimalStub: "field.length != 0",
  },
  {
    file: "programlet_vector_values.rs",
    name: "programlet_field_is_vector_nonempty_probe",
    functionName: "programlet_field_is_vector",
    expected: "bool",
    stub: "field.length != 0",
  },
  {
    file: "programlet_vector_values.rs",
    name: "programlet_field_is_vector_true_probe",
    functionName: "programlet_field_is_vector",
    expected: "bool",
    stub: "false",
    minimalStub: "true",
  },
  { file: "programlet_vector_values.rs", name: "read_programlet_vector", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)", minimalStub: "Ok(ProgramletVectorValue { kind: VALUE_VECTOR_FLOAT32, length: 1, ..ProgramletVectorValue::EMPTY })" },
  {
    file: "programlet_vector_values.rs",
    name: "read_programlet_vector_name_probe",
    functionName: "read_programlet_vector",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `let _name = name_from_field(tokens, field)?;
    Ok(ProgramletVectorValue { kind: VALUE_VECTOR_FLOAT32, length: 1, ..ProgramletVectorValue::EMPTY })`,
  },
  {
    file: "programlet_vector_values.rs",
    name: "read_programlet_vector_argument_lookup_probe",
    functionName: "read_programlet_vector",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `let name = name_from_field(tokens, field)?;
    let (kind, length) = if let Some(index) = find_argument(tokens, name, symbols, arguments) {
        let argument = array_at!(*arguments, index);
        (argument.value_kind, argument.vector_length as usize)
    } else {
        (VALUE_VECTOR_FLOAT32, 1)
    };
    Ok(ProgramletVectorValue { kind, length, ..ProgramletVectorValue::EMPTY })`,
  },
  {
    file: "programlet_vector_values.rs",
    name: "read_programlet_vector_argument_payload_probe",
    functionName: "read_programlet_vector",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `let name = name_from_field(tokens, field)?;
    if let Some(index) = find_argument(tokens, name, symbols, arguments) {
        let argument = array_at!(*arguments, index);
        let mut vector = [0; RESULT_WORDS];
        read_programlet_argument_vector(argument_vectors, frame_index, index, &mut vector);
        let first = vector[0];
        return Ok(ProgramletVectorValue {
            kind: argument.value_kind,
            length: if first == 0 { 1 } else { 2 },
            values: vector,
        });
    }
    Ok(ProgramletVectorValue { kind: VALUE_VECTOR_FLOAT32, length: 1, ..ProgramletVectorValue::EMPTY })`,
  },
  { file: "programlet_vector_values/quote.rs", name: "vector_from_quote", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)", minimalStub: "Err(ERROR_UNSUPPORTED)" },
  {
    file: "programlet_vector_values/quote.rs",
    name: "vector_from_quote_header_probe",
    functionName: "vector_from_quote",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if field.length == 0 {
        return Err(ERROR_MALFORMED);
    }
    let header_word = sentence_at!(*tokens, field.start);
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 || !matches!(header.scalar_bytes, 4 | 8) {
        return Err(ERROR_UNSUPPORTED);
    }
    let kind = if header.scalar_bytes == 4 { VALUE_VECTOR_FLOAT32 } else { VALUE_VECTOR_FLOAT64 };
    Ok(ProgramletVectorValue { kind, length: 1, ..ProgramletVectorValue::EMPTY })`,
  },
  {
    file: "programlet_vector_values/quote.rs",
    name: "vector_from_quote_length_probe",
    functionName: "vector_from_quote",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if field.length == 0 { return Err(ERROR_MALFORMED); }
    let header_word = sentence_at!(*tokens, field.start);
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 || !matches!(header.scalar_bytes, 4 | 8) || header_word & 0x0700 == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut cursor = field.start + 1;
    let end = field.start + field.length;
    let words_per_lane = header.scalar_bytes as usize / 2;
    if words_per_lane == 0 { return Err(ERROR_MALFORMED); }
    let length = if header.explicit != 0 {
        if cursor >= end { return Err(ERROR_MALFORMED); }
        let length = sentence_at!(*tokens, cursor) as usize;
        cursor += 1;
        length
    } else {
        header.fixed_length.checked_div(words_per_lane as u32).ok_or(ERROR_MALFORMED)? as usize
    };
    if length == 0 || length > MAX_VECTOR_LANES || cursor + length * words_per_lane != end {
        return Err(ERROR_VECTOR_WIDTH);
    }
    let kind = if header.scalar_bytes == 4 { VALUE_VECTOR_FLOAT32 } else { VALUE_VECTOR_FLOAT64 };
    Ok(ProgramletVectorValue { kind, length, ..ProgramletVectorValue::EMPTY })`,
  },
  {
    file: "programlet_vector_values/quote.rs",
    name: "vector_from_quote_lane_read_probe",
    functionName: "vector_from_quote",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if field.length == 0 { return Err(ERROR_MALFORMED); }
    let header_word = sentence_at!(*tokens, field.start);
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 || !matches!(header.scalar_bytes, 4 | 8) || header_word & 0x0700 == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut cursor = field.start + 1;
    let end = field.start + field.length;
    let words_per_lane = header.scalar_bytes as usize / 2;
    let length = if header.explicit != 0 {
        if cursor >= end { return Err(ERROR_MALFORMED); }
        let length = sentence_at!(*tokens, cursor) as usize;
        cursor += 1;
        length
    } else {
        header.fixed_length.checked_div(words_per_lane as u32).ok_or(ERROR_MALFORMED)? as usize
    };
    if length == 0 || length > MAX_VECTOR_LANES || cursor + length * words_per_lane != end {
        return Err(ERROR_VECTOR_WIDTH);
    }
    let kind = if header.scalar_bytes == 4 { VALUE_VECTOR_FLOAT32 } else { VALUE_VECTOR_FLOAT64 };
    let mut lane = 0usize;
    while lane < length {
        let low = sentence_at!(*tokens, cursor) | (sentence_at!(*tokens, cursor + 1) << 16);
        if kind == VALUE_VECTOR_FLOAT32 && low & 0x7f80_0000 == 0x7f80_0000 {
            return Err(ERROR_FLOAT_DOMAIN);
        }
        #[cfg(feature = "shader-f64")]
        if kind == VALUE_VECTOR_FLOAT64 {
            let high = sentence_at!(*tokens, cursor + 2) | (sentence_at!(*tokens, cursor + 3) << 16);
            if high & 0x7ff0_0000 == 0x7ff0_0000 { return Err(ERROR_FLOAT_DOMAIN); }
        }
        let _lane_read = low;
        cursor += words_per_lane;
        lane += 1;
    }
    Ok(ProgramletVectorValue { kind, length, ..ProgramletVectorValue::EMPTY })`,
  },
  {
    file: "programlet_vector_values/quote.rs",
    name: "vector_from_quote_f32_lane_write_probe",
    functionName: "vector_from_quote",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if field.length == 0 { return Err(ERROR_MALFORMED); }
    let header_word = sentence_at!(*tokens, field.start);
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 || header.scalar_bytes != 4 || header_word & 0x0700 == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut cursor = field.start + 1;
    let end = field.start + field.length;
    let length = if header.explicit != 0 {
        if cursor >= end { return Err(ERROR_MALFORMED); }
        let length = sentence_at!(*tokens, cursor) as usize;
        cursor += 1;
        length
    } else {
        header.fixed_length.checked_div(2).ok_or(ERROR_MALFORMED)? as usize
    };
    if length == 0 || length > MAX_VECTOR_LANES || cursor + length * 2 != end {
        return Err(ERROR_VECTOR_WIDTH);
    }
    let mut value = ProgramletVectorValue { kind: VALUE_VECTOR_FLOAT32, length, ..ProgramletVectorValue::EMPTY };
    let mut lane = 0usize;
    while lane < length {
        let low = sentence_at!(*tokens, cursor) | (sentence_at!(*tokens, cursor + 1) << 16);
        if low & 0x7f80_0000 == 0x7f80_0000 { return Err(ERROR_FLOAT_DOMAIN); }
        array_put!(&mut value.values, lane, low);
        cursor += 2;
        lane += 1;
    }
    Ok(value)`,
  },
  {
    file: "programlet_vector_values/quote.rs",
    name: "vector_from_quote_f64_lane_write_probe",
    functionName: "vector_from_quote",
    expected: "Result",
    stub: "Err(ERROR_UNSUPPORTED)",
    minimalStub: `if field.length == 0 { return Err(ERROR_MALFORMED); }
    let header_word = sentence_at!(*tokens, field.start);
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 || header.scalar_bytes != 8 || header_word & 0x0700 == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut cursor = field.start + 1;
    let end = field.start + field.length;
    let length = if header.explicit != 0 {
        if cursor >= end { return Err(ERROR_MALFORMED); }
        let length = sentence_at!(*tokens, cursor) as usize;
        cursor += 1;
        length
    } else {
        header.fixed_length.checked_div(4).ok_or(ERROR_MALFORMED)? as usize
    };
    if length == 0 || length > MAX_VECTOR_LANES || cursor + length * 4 != end {
        return Err(ERROR_VECTOR_WIDTH);
    }
    let mut value = ProgramletVectorValue { kind: VALUE_VECTOR_FLOAT64, length, ..ProgramletVectorValue::EMPTY };
    let mut lane = 0usize;
    while lane < length {
        let low = sentence_at!(*tokens, cursor) | (sentence_at!(*tokens, cursor + 1) << 16);
        let high = sentence_at!(*tokens, cursor + 2) | (sentence_at!(*tokens, cursor + 3) << 16);
        if high & 0x7ff0_0000 == 0x7ff0_0000 { return Err(ERROR_FLOAT_DOMAIN); }
        array_put!(&mut value.values, lane * 2, low);
        array_put!(&mut value.values, lane * 2 + 1, high);
        cursor += 4;
        lane += 1;
    }
    Ok(value)`,
  },
  { file: "programlet_vector_values.rs", name: "write_programlet_vector", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_values/floats.rs", name: "read_programlet_float", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
];
