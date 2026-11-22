const CANDIDATES = [
  { file: "programlet_execute.rs", name: "execute_numeric_programlet_at", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "programlet_execute.rs", name: "execute_numeric_programlet", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "programlet_branch.rs", name: "programlet_branch", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "boolean.rs", name: "evaluate_boolean_expression_with_env", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_actions.rs", name: "apply_programlet_number_action", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_actions.rs", name: "apply_programlet_boolean_action", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_execute_setup.rs", name: "initialize_numeric_programlet", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
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
    let token = word(words, absolute_codelet, 1);
    if token > MAX_U16 {
        return Err(ERROR_MALFORMED);
    }
    array_put!(tokens, 0, token);
    array_put!(boundaries, 0, u32::from((header & 2 != 0) == complete));
    Ok((1, start + 1))`,
  },
  { file: "numeric.rs", name: "word", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "sentence.rs", name: "parse_sentence", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "sentence.rs", name: "parse_sentence_range", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "sentence.rs", name: "contains_marked_token", expected: "bool", stub: "false" },
  { file: "sentence.rs", name: "typed_output_name", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "programlet_values.rs", name: "capture_programlet_arguments", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_values.rs", name: "validate_programlet_arguments", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_values.rs", name: "loop_iterations", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_symbols.rs", name: "store_name", expected: "u32", stub: "ERROR_UNSUPPORTED" },
  { file: "programlet_vector_actions.rs", name: "exp_f32", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "exp_f64", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "apply_f32", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "apply_f64", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "reduce_vector", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_actions.rs", name: "apply_programlet_vector_action", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_values.rs", name: "read_programlet_vector", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_values.rs", name: "write_programlet_vector", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_values.rs", name: "read_programlet_float", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_vector_values.rs", name: "write_programlet_float", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "iwsp_vector_ops.rs", name: "vector_float_arithmetic_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "iwsp_vector_ops.rs", name: "vector_sum_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "iwsp_vector_ops.rs", name: "vector_maximum_group", expected: "CoreResult", stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)" },
  { file: "programlet_dispatch_index.rs", name: "build_programlet_routine_directory", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_dispatch_index.rs", name: "resolve_programlet_routine", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_execute_call.rs", name: "execute_programlet_call", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_execute_declare.rs", name: "declare_programlet_local", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
  { file: "programlet_execute_return.rs", name: "execute_programlet_return", expected: "Result", stub: "Err(ERROR_UNSUPPORTED)" },
];

export function listReductionCandidates() {
  return CANDIDATES.map((candidate) => ({ ...candidate }));
}

function skipQuotedOrComment(source, index) {
  if (source.startsWith("//", index)) {
    const end = source.indexOf("\n", index + 2);
    return end < 0 ? source.length : end;
  }
  if (source.startsWith("/*", index)) {
    let depth = 1;
    let cursor = index + 2;
    while (cursor < source.length && depth) {
      if (source.startsWith("/*", cursor)) {
        depth += 1;
        cursor += 2;
      } else if (source.startsWith("*/", cursor)) {
        depth -= 1;
        cursor += 2;
      } else cursor += 1;
    }
    if (depth) throw new Error("unterminated Rust block comment");
    return cursor;
  }

  const rawStart = source.slice(index).match(/^(?:br|cr|r)(#*)"/u);
  if (rawStart) {
    const close = `"${"#".repeat(rawStart[1].length)}`;
    const end = source.indexOf(close, index + rawStart[0].length);
    if (end < 0) throw new Error("unterminated Rust raw string");
    return end + close.length;
  }

  const quoteAt = source[index] === "b" && source[index + 1] === '"' ? index + 1 : index;
  if (source[quoteAt] === '"') {
    let cursor = quoteAt + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") cursor += 2;
      else if (source[cursor++] === '"') return cursor;
    }
    throw new Error("unterminated Rust string");
  }
  if (source[index] === "'") {
    let cursor = index + 1;
    if (source[cursor] === "\\") cursor += 2;
    else cursor += 1;
    if (source[cursor] === "'") return cursor + 1;
  }
  return index;
}

function findBodyStart(source, signatureStart) {
  let parens = 0;
  let brackets = 0;
  for (let cursor = signatureStart; cursor < source.length;) {
    const skipped = skipQuotedOrComment(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }
    const char = source[cursor];
    if (char === "(") parens += 1;
    else if (char === ")") parens -= 1;
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets -= 1;
    else if (char === "{" && parens === 0 && brackets === 0) return cursor;
    cursor += 1;
  }
  throw new Error("function body was not found");
}

function findBodyEnd(source, bodyStart) {
  let depth = 0;
  for (let cursor = bodyStart; cursor < source.length;) {
    const skipped = skipQuotedOrComment(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }
    if (source[cursor] === "{") depth += 1;
    else if (source[cursor] === "}" && --depth === 0) return cursor + 1;
    cursor += 1;
  }
  throw new Error("function body has unmatched braces");
}

export function replaceCandidateBody(source, functionName, variant = "error") {
  const candidate = CANDIDATES.find(({ name }) => name === functionName);
  if (!candidate) throw new Error(`unknown reduction function: ${functionName}`);
  if (!new Set(["baseline", "error", "minimal"]).has(variant)) throw new Error(`variant ${variant} is not supported`);
  const stub = variant === "error" ? candidate.stub : candidate.minimalStub;
  if (variant === "minimal" && !stub) throw new Error(`variant ${variant} is not supported for ${functionName}`);
  const declaration = new RegExp(`\\bfn\\s+${functionName}\\s*\\(`, "gu");
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1) throw new Error(`expected one declaration for ${functionName}; found ${matches.length}`);
  const signatureStart = matches[0].index + matches[0][0].length - 1;
  const bodyStart = findBodyStart(source, signatureStart);
  const signature = source.slice(signatureStart, bodyStart);
  const returnType = signature.match(/\)\s*->\s*([^\{]+)$/su)?.[1]?.trim() || "()";
  if (!returnType.startsWith(candidate.expected)) {
    throw new Error(`${functionName} return type changed: expected ${candidate.expected}, got ${returnType}`);
  }
  const bodyEnd = findBodyEnd(source, bodyStart);
  return {
    source: variant === "baseline" ? source : `${source.slice(0, bodyStart)}{ ${stub} }${source.slice(bodyEnd)}`,
    candidate,
    variant,
    originalBody: source.slice(bodyStart, bodyEnd),
    replacementBody: variant === "baseline" ? source.slice(bodyStart, bodyEnd) : `{ ${stub} }`,
  };
}
