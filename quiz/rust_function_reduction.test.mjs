import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { listProgramletBranches, replaceProgramletBranch } from "../rust/pyac-gpu/programlet_branch_reduction.mjs";
import { listProgramletShapes, replaceProgramletShape } from "../rust/pyac-gpu/programlet_shape_reduction.mjs";
import { prepareReductionWorkspace } from "../rust/pyac-gpu/function_reduction_workspace.mjs";
import { listReductionCandidates, replaceCandidateBody, replaceRustFunctionBody } from "../rust/pyac-gpu/rust_function_source.mjs";
import { interpretationForVariant, profileExitCode, reductionLiveRamFloor, reductionStartupRamFloor, replacementDescription } from "../rust/pyac-gpu/function_reduction_reports.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CORE = path.join(ROOT, "rust/pyac-vliw-core/src/semantics_runtime");

test("function reducer ignores braces in comments and literals and changes only the selected body", () => {
  const source = [
    "fn sample() -> Result<(), u32> {",
    "  let _raw = r#\"not a } body\"#;",
    "  /* outer { /* nested } */ still comment } */",
    "  let _text = \"escaped \\\" } brace\";",
    "  Ok(())",
    "}",
    "fn untouched() { let _ = 7; }",
  ].join("\n");
  const replaced = replaceCandidateBody(source.replace("fn sample", "fn apply_programlet_boolean_action"), "apply_programlet_boolean_action");
  assert.match(replaced.source, /fn apply_programlet_boolean_action\(\) -> Result<\(\), u32> \{ Err\(ERROR_UNSUPPORTED\) \}/u);
  assert.ok(replaced.source.endsWith("fn untouched() { let _ = 7; }"));
  assert.equal(replaced.originalBody.includes("r#\"not a } body\"#"), true);
});

test("function reducer matches const-generic function declarations", () => {
  const source = "fn find_local_slot<const SLOTS: usize>(slots: [u32; SLOTS]) -> Option<usize> { Some(0) }";
  const result = replaceRustFunctionBody(source, "find_local_slot", "None");
  assert.match(result.source, /fn find_local_slot<const SLOTS: usize>\(slots: \[u32; SLOTS\]\) -> Option<usize> \{ None \}/u);
});

test("function reducer rejects unknown names and changed return contracts", () => {
  assert.throws(() => replaceCandidateBody("fn x() {}", "not_a_candidate"), /unknown reduction function/u);
  assert.throws(() => replaceCandidateBody("fn programlet_branch() -> bool { true }", "programlet_branch"), /return type changed/u);
});

test("diagnostic shader isolation replaces only the selected entrypoint body", () => {
  const shader = fs.readFileSync(path.join(ROOT, "rust/pyac-gpu/shader/src/lib.rs"), "utf8");
  const result = replaceRustFunctionBody(shader, "execute_pyac_pack", "return;");

  assert.match(result.source, /pub fn execute_pyac_pack\([\s\S]*?\) \{ return; \}/u);
  assert.match(result.source, /pub fn execute_pyac_programlet\([\s\S]*?execute_numeric_programlet/u);
  assert.equal(result.returnType, "()");
});

test("programlet branch reduction replaces only the selected executor arm", () => {
  const source = fs.readFileSync(path.join(CORE, "programlet_execute.rs"), "utf8");
  const names = listProgramletBranches();
  assert.deepEqual(names, ["local-declaration", "vector-action", "number-action", "boolean-action", "call", "return", "paragraph-close"]);
  for (const name of names) {
    const replaced = replaceProgramletBranch(source, name);
    const count = (value) => (value.match(/return CoreResult::failure\(ERROR_UNSUPPORTED, steps\);/gu) || []).length;
    assert.equal(count(replaced.source), count(source) + 1);
    assert.ok(replaced.originalBody.length > replaced.replacementBody.length, `${name} arm should shrink`);
  }
  assert.throws(() => replaceProgramletBranch(source, "unknown"), /unknown programlet branch/u);
});

test("programlet branch no-op preserves dispatch fallthrough without an early return", () => {
  const source = fs.readFileSync(path.join(CORE, "programlet_execute.rs"), "utf8");
  const result = replaceProgramletBranch(source, "boolean-action", "noop");
  assert.equal(result.replacementBody, "{}");
  assert.equal((result.source.match(/== BOOLEAN_VERB/gu) || []).length, 1);
  assert.throws(() => replaceProgramletBranch(source, "boolean-action", "minimal"), /unknown programlet branch replacement mode/u);
});

test("programlet shape reduction makes one bounded diagnostic constant change", () => {
  const source = fs.readFileSync(path.join(ROOT, "rust/pyac-vliw-core/src/semantics_runtime.rs"), "utf8");
  assert.deepEqual(listProgramletShapes(), ["call-depth", "local-slots", "arguments", "vector-local-slots"]);
  const reduced = replaceProgramletShape(source, "call-depth", 1);
  assert.match(reduced.source, /MAX_PROGRAMLET_CALL_DEPTH: usize = 1;/u);
  assert.match(source, /MAX_PROGRAMLET_CALL_DEPTH: usize = 8;/u);
  assert.notEqual(reduced.source, source);
  assert.throws(() => replaceProgramletShape(source, "call-depth", 0), /integer from 1 to 8/u);
  assert.match(replaceProgramletShape(source, "local-slots", 1).source, /MAX_PROGRAMLET_LOCAL_SLOTS: usize = 1;/u);
  assert.throws(() => replaceProgramletShape(source, "unknown", 1), /unknown programlet shape/u);
});

test("reduction workspace preparation is available as an isolated module", () => {
  assert.equal(typeof prepareReductionWorkspace, "function");
});

test("interpret_group is available as a cache-profile reduction candidate", () => {
  const candidate = listReductionCandidates().find(({ name }) => name === "interpret_group");
  assert.deepEqual(candidate, {
    file: "dispatch.rs",
    name: "interpret_group",
    expected: "CoreResult",
    stub: "CoreResult::failure(ERROR_UNSUPPORTED, 0)",
  });
});

test("reducer can isolate pack, programlet, and sections entrypoints", () => {
  const source = fs.readFileSync(path.join(ROOT, "rust/pyac-gpu/profile-function-reduction.mjs"), "utf8");
  assert.match(source, /args\.includes\(`--\$\{name\}-only`\)/u);
  assert.match(source, /PYAC_VLIW_REDUCE_SOURCE_ROOT/u);
  assert.match(source, /--programlet-branch/u);
  assert.match(source, /--branch-variant/u);
  assert.match(source, /--list-programlet-branches/u);
  assert.match(source, /--programlet-shape/u);
  assert.match(source, /--list-programlet-shapes/u);
  const workspace = fs.readFileSync(path.join(ROOT, "rust/pyac-gpu/function_reduction_workspace.mjs"), "utf8");
  assert.match(workspace, /\["pack", "programlet", "sections"\]/u);
  assert.match(workspace, /path\.relative\(source, entry\)/u);
  assert.match(source, /"--features", "vulkan-device-atomics,shader-f64"/u);
  assert.match(source, /"--capabilities", "Float64", "--capabilities", "Int64"/u);
});

test("collector minimal variant preserves dynamic input and a successful downstream path", () => {
  const source = fs.readFileSync(path.join(CORE, "sentence.rs"), "utf8");
  const result = replaceCandidateBody(source, "collect_sentence_at", "minimal");
  assert.match(result.originalBody, /while slot <= last_slot/u);
  assert.match(result.replacementBody, /while slot <= last_boundary/u);
  assert.match(result.replacementBody, /Ok\(\(last_boundary, start \+ 1\)\)/u);
  assert.throws(() => replaceCandidateBody(source, "word", "minimal"), /not supported/u);
});

test("sentence parser minimal variant keeps dynamic data on a successful path", () => {
  const source = fs.readFileSync(path.join(CORE, "sentence.rs"), "utf8");
  const result = replaceCandidateBody(source, "parse_sentence_range", "minimal");
  assert.match(result.replacementBody, /tokens\.token_unchecked\(start\)/u);
  assert.match(result.replacementBody, /tokens\.token_unchecked\(end - 1\)/u);
  assert.match(result.replacementBody, /result\.field_count = 1/u);
  assert.match(result.replacementBody, /\n    0\s*\}$/u);
});

test("sentence parser probes isolate borrowed token reads from parsed-result writes", () => {
  const source = fs.readFileSync(path.join(CORE, "sentence.rs"), "utf8");
  const tokenProbe = replaceCandidateBody(source, "parse_sentence_range_token_read_probe", "minimal");
  const writeProbe = replaceCandidateBody(source, "parse_sentence_range_result_write_probe", "minimal");
  assert.match(tokenProbe.replacementBody, /tokens\.token_unchecked\(start\)/u);
  assert.doesNotMatch(tokenProbe.replacementBody, /\*parsed\s*=/u);
  assert.match(writeProbe.replacementBody, /\*parsed\s*=\s*result/u);
  assert.doesNotMatch(writeProbe.replacementBody, /token_unchecked/u);
});

test("sentence parser empty-success probe avoids token reads", () => {
  const source = fs.readFileSync(path.join(CORE, "sentence.rs"), "utf8");
  const probe = replaceCandidateBody(source, "parse_sentence_range_empty_success_probe", "minimal");
  assert.match(probe.replacementBody, /\*parsed = ParsedSentence::empty\(\)/u);
  assert.doesNotMatch(probe.replacementBody, /token_unchecked|sentence_word_unchecked/u);
});

test("programlet parse-only probe stops before initialization continues", () => {
  const source = fs.readFileSync(path.join(CORE, "programlet_execute_setup.rs"), "utf8");
  const probe = replaceCandidateBody(source, "initialize_numeric_programlet", "minimal");
  assert.match(probe.replacementBody, /parse_sentence\(&invocation_view, &mut invocation\)/u);
  assert.match(probe.replacementBody, /Err\(ERROR_UNSUPPORTED\)\s*\}$/u);
  assert.doesNotMatch(probe.replacementBody, /capture_programlet_arguments|resolve_programlet_routine/u);
});

test("programlet initializer probe stops before executor loop", () => {
  const source = fs.readFileSync(path.join(CORE, "programlet_execute.rs"), "utf8");
  const probe = replaceCandidateBody(source, "execute_numeric_programlet_at_with_directory_view", "minimal");
  assert.match(probe.replacementBody, /initialize_numeric_programlet\(/u);
  assert.match(probe.replacementBody, /CoreResult::failure\(ERROR_UNSUPPORTED, 0\)/u);
  assert.doesNotMatch(probe.replacementBody, /while depth > 0/u);
});

test("programlet one-sentence probes stop before action dispatch", () => {
  const source = fs.readFileSync(path.join(CORE, "programlet_execute.rs"), "utf8");
  const parseProbe = replaceCandidateBody(source, "programlet_one_sentence_parse_probe", "minimal");
  const branchProbe = replaceCandidateBody(source, "programlet_one_sentence_branch_probe", "minimal");
  assert.match(parseProbe.replacementBody, /collect_sentence_at\(/u);
  assert.match(parseProbe.replacementBody, /parse_sentence\(/u);
  assert.doesNotMatch(parseProbe.replacementBody, /programlet_branch\(/u);
  assert.match(branchProbe.replacementBody, /programlet_branch\(/u);
  assert.doesNotMatch(branchProbe.replacementBody, /while depth > 0/u);
});

test("programlet action condition probe excludes action bodies", () => {
  const source = fs.readFileSync(path.join(CORE, "programlet_execute.rs"), "utf8");
  const probe = replaceCandidateBody(source, "programlet_action_conditions_probe", "minimal");
  for (const fragment of ["is_programlet_vector_action(", "selected = 5", "selected = 6", "selected = 7"]) {
    assert.ok(probe.replacementBody.includes(fragment), `missing condition probe fragment ${fragment}`);
  }
  assert.doesNotMatch(probe.replacementBody, /apply_programlet_number_action\(|close_programlet_paragraph\(/u);
});

test("programlet loop parse probe retains loop state without action dispatch", () => {
  const source = fs.readFileSync(path.join(CORE, "programlet_execute.rs"), "utf8");
  const probe = replaceCandidateBody(source, "programlet_loop_parse_probe", "minimal");
  assert.match(probe.replacementBody, /while depth > 0/u);
  assert.match(probe.replacementBody, /depth -= 1/u);
  assert.doesNotMatch(probe.replacementBody, /programlet_branch\(|execute_programlet_call\(|apply_programlet_vector_action\(/u);
});

test("programlet loop condition probe excludes action handlers", () => {
  const source = fs.readFileSync(path.join(CORE, "programlet_execute.rs"), "utf8");
  const probe = replaceCandidateBody(source, "programlet_loop_conditions_probe", "minimal");
  assert.match(probe.replacementBody, /while depth > 0/u);
  assert.match(probe.replacementBody, /is_programlet_vector_action\(/u);
  assert.doesNotMatch(probe.replacementBody, /apply_programlet_number_action\(|execute_programlet_call\(|close_programlet_paragraph\(/u);
});

test("programlet loop sentence selection retains parser and clause path only", () => {
  const source = fs.readFileSync(path.join(CORE, "programlet_execute.rs"), "utf8");
  const probe = replaceCandidateBody(source, "programlet_loop_sentence_select_probe", "minimal");
  assert.match(probe.replacementBody, /while depth > 0/u);
  assert.match(probe.replacementBody, /contains_marked_token\(/u);
  assert.match(probe.replacementBody, /programlet_branch\(/u);
  assert.match(probe.replacementBody, /parse_sentence\(/u);
  assert.doesNotMatch(probe.replacementBody, /execute_programlet_call\(|apply_programlet_vector_action\(/u);
});

test("baseline variant leaves the selected function source unchanged", () => {
  const source = fs.readFileSync(path.join(CORE, "sentence.rs"), "utf8");
  const result = replaceCandidateBody(source, "collect_sentence_at", "baseline");
  assert.equal(result.source, source);
  assert.equal(result.originalBody, result.replacementBody);
});

test("reduction reports distinguish baseline controls from early-error stubs", () => {
  assert.match(interpretationForVariant("baseline"), /body is unchanged/u);
  assert.doesNotMatch(interpretationForVariant("baseline"), /stubbed/u);
  assert.match(interpretationForVariant("error"), /downstream code may become unreachable/u);
  assert.match(interpretationForVariant("minimal"), /successful return/u);
  assert.match(replacementDescription("baseline"), /none/u);
  assert.match(replacementDescription("error"), /early-error/u);
  assert.match(replacementDescription("minimal"), /success-shaped/u);
});

test("function reducer returns failure when Vulkan pipeline profiling fails", () => {
  assert.equal(profileExitCode({ code: 0, stopReason: null }, null), 0);
  assert.equal(profileExitCode({ code: 0, stopReason: null }, null, false), 1);
  assert.equal(profileExitCode({ code: 0, stopReason: null }, { code: 1, stopReason: null }), 1);
  assert.equal(profileExitCode({ code: 0, stopReason: null }, { code: 0, stopReason: "300s time cap" }), 1);
  assert.equal(profileExitCode({ code: 1, stopReason: null }, null), 1);
});

test("build-only compiler profiling has a lower startup RAM gate than Vulkan probing", () => {
  assert.equal(reductionStartupRamFloor(true), 15 * 1024 ** 3);
  assert.equal(reductionStartupRamFloor(false), 20 * 1024 ** 3);
  assert.equal(reductionLiveRamFloor(true), 8 * 1024 ** 3);
  assert.equal(reductionLiveRamFloor(false), 12 * 1024 ** 3);
});
