import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { listReductionCandidates, replaceCandidateBody } from "../rust/pyac-gpu/rust_function_source.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CORE = path.join(ROOT, "rust/pyac-vliw-core/src/semantics_runtime");

test("function reducer has one explicit diagnostic replacement per candidate", () => {
  const candidates = listReductionCandidates();
  assert.ok(candidates.length >= 8);
  assert.equal(new Set(candidates.map(({ name }) => name)).size, candidates.length);
  assert.ok(candidates.some(({ name }) => name === "build_programlet_routine_directory"));
  assert.ok(candidates.some(({ name }) => name === "resolve_programlet_routine"));
  assert.ok(candidates.some(({ name }) => name === "number_operator"));
  assert.ok(candidates.some(({ name }) => name === "read_optional_programlet_number"));
  const loopArgumentStub = candidates.find(({ name }) => name === "set_loop_register_argument").minimalStub;
  assert.match(loopArgumentStub, /index >= MAX_PROGRAMLET_ARGUMENTS/u);
  assert.match(loopArgumentStub, /arguments\[index\] = argument/u);
  assert.ok(candidates.some(({ name }) => name === "resolve_programlet_value"));
  assert.ok(candidates.some(({ name }) => name === "find_local_slot"));
  assert.ok(candidates.some(({ name }) => name === "argument_value"));
  assert.equal(candidates.find(({ name }) => name === "argument_value").minimalStub, "ProgramletNumber::EMPTY");
  assert.ok(candidates.some(({ name }) => name === "number_value"));
  assert.ok(candidates.some(({ name }) => name === "name_span"));
  assert.match(candidates.find(({ name }) => name === "resolve_programlet_value").minimalStub, /VALUE_UNSIGNED/u);
  assert.match(candidates.find(({ name }) => name === "resolve_programlet_value").minimalStub, /THIS_WORD/u);
  assert.match(candidates.find(({ name }) => name === "declare_programlet_local").minimalStub, /name_span\(/u);
  assert.match(candidates.find(({ name }) => name === "name_span").minimalStub, /NameSpan::EMPTY/u);
  assert.doesNotMatch(candidates.find(({ name }) => name === "name_span").minimalStub, /sentence_at!/u);
  assert.match(candidates.find(({ name }) => name === "execute_programlet_call").minimalStub, /loop_iterations\(/u);
  assert.match(candidates.find(({ name }) => name === "execute_programlet_call").minimalStub, /validate_programlet_arguments\(/u);
  assert.match(candidates.find(({ name }) => name === "validate_programlet_arguments").minimalStub, /parse_sentence\(&definition_view/u);
  assert.match(candidates.find(({ name }) => name === "validate_programlet_arguments").minimalStub, /definition_fields\[7\]/u);
  assert.ok(candidates.some(({ name }) => name === "execute_numeric_programlet_at_with_directory_words"));
  assert.ok(candidates.some(({ name }) => name === "execute_numeric_programlet_at_with_directory_view"));
  assert.equal(candidates.find(({ name }) => name === "sort_directory").minimalStub, "Ok(())");
  assert.equal(candidates.find(({ name }) => name === "sort_cases").minimalStub, "()");
  assert.match(candidates.find(({ name }) => name === "make_call_signature").minimalStub, /case_count = 0/u);
  assert.match(candidates.find(({ name }) => name === "resolve_programlet_routine").minimalStub, /arguments\[0\]/u);
  assert.match(candidates.find(({ name }) => name === "resolve_programlet_routine").minimalStub, /argument\.value_kind/u);
  assert.doesNotMatch(candidates.find(({ name }) => name === "resolve_programlet_routine").minimalStub, /make_call_signature\(/u);
  assert.match(candidates.find(({ name }) => name === "capture_programlet_arguments").minimalStub, /\*captured_count = 0/u);
  assert.match(candidates.find(({ name }) => name === "capture_programlet_arguments_count_probe").minimalStub, /fields\[7\]\.role/u);
  assert.match(candidates.find(({ name }) => name === "capture_programlet_arguments_dynamic_count_probe").minimalStub, /while index < sentence\.field_count/u);
  assert.match(candidates.find(({ name }) => name === "capture_programlet_arguments_scalar_read_probe").minimalStub, /resolve_programlet_value\(/u);
  assert.match(candidates.find(({ name }) => name === "capture_programlet_arguments_scalar_store_probe").minimalStub, /array_put!\(captured, count/u);
  assert.match(candidates.find(({ name }) => name === "capture_programlet_arguments_float_probe").minimalStub, /read_programlet_float\(/u);
  assert.doesNotMatch(candidates.find(({ name }) => name === "capture_programlet_arguments_float_probe").minimalStub, /read_programlet_vector\(/u);
  assert.match(candidates.find(({ name }) => name === "capture_programlet_arguments_vector_single_lane_store_probe").minimalStub, /read_programlet_vector\(/u);
  assert.match(candidates.find(({ name }) => name === "capture_programlet_arguments_vector_single_lane_store_probe").minimalStub, /array_put!\(captured_vectors, count \* RESULT_WORDS/u);
  assert.equal(candidates.find(({ name }) => name === "is_programlet_vector_action").stub, "false");
  assert.equal(candidates.find(({ name }) => name === "is_programlet_vector_verb").stub, "false");
  assert.equal(candidates.find(({ name }) => name === "programlet_field_is_vector").stub, "false");
  assert.match(candidates.find(({ name }) => name === "programlet_field_is_vector").minimalStub, /quote_header\(/u);
  assert.equal(candidates.find(({ name }) => name === "programlet_field_is_vector_length_probe").minimalStub, "field.length != 0");
  assert.equal(candidates.find(({ name }) => name === "programlet_field_is_vector_nonempty_probe").stub, "field.length != 0");
  assert.equal(
    candidates.find(({ name }) => name === "read_programlet_vector").minimalStub,
    "Ok(ProgramletVectorValue { kind: VALUE_VECTOR_FLOAT32, length: 1, ..ProgramletVectorValue::EMPTY })",
  );
  assert.equal(candidates.find(({ name }) => name === "vector_from_quote").minimalStub, "Err(ERROR_UNSUPPORTED)");
  assert.match(candidates.find(({ name }) => name === "vector_from_quote_header_probe").minimalStub, /quote_header\(header_word\)/u);
  assert.match(candidates.find(({ name }) => name === "vector_from_quote_length_probe").minimalStub, /length > MAX_VECTOR_LANES/u);
  assert.match(candidates.find(({ name }) => name === "vector_from_quote_lane_read_probe").minimalStub, /while lane < length/u);
  assert.doesNotMatch(candidates.find(({ name }) => name === "vector_from_quote_lane_read_probe").minimalStub, /array_put!/u);
  assert.match(candidates.find(({ name }) => name === "vector_from_quote_f32_lane_write_probe").minimalStub, /array_put!\(&mut value\.values, lane, low\)/u);
  assert.match(candidates.find(({ name }) => name === "vector_from_quote_f64_lane_write_probe").minimalStub, /lane \* 2 \+ 1/u);
  assert.match(candidates.find(({ name }) => name === "build_programlet_routine_directory").minimalStub, /while index < signature_length/u);
  for (const name of [
    "exp_f32",
    "apply_programlet_vector_action",
    "clear_programlet_frame",
    "vector_from_quote",
    "reduce_vector",
    "vector_float_arithmetic_group",
    "vector_sum_group",
    "vector_maximum_group",
  ]) {
    assert.ok(candidates.some((candidate) => (candidate.functionName || candidate.name) === name), `missing candidate ${name}`);
  }
  assert.ok(!candidates.some(({ name }) => name === "find_programlet_routine"));
  for (const candidate of candidates) {
    const sourcePath = path.join(CORE, candidate.file);
    assert.ok(fs.existsSync(sourcePath), `missing candidate source ${candidate.file}`);
    const source = fs.readFileSync(sourcePath, "utf8");
    const result = replaceCandidateBody(source, candidate.name);
    const functionName = candidate.functionName || candidate.name;
    assert.equal(result.source.slice(0, result.source.indexOf(result.replacementBody)), source.slice(0, source.indexOf(result.originalBody)));
    assert.equal((result.source.match(new RegExp(`\\bfn\\s+${functionName}\\s*(?:<[^\\n>]*>)?\\s*\\(`, "gu")) || []).length, 1);
    assert.ok(result.source.includes(result.replacementBody));
  }
});
