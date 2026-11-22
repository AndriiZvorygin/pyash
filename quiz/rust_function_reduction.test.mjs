import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { listReductionCandidates, replaceCandidateBody } from "../rust/pyac-gpu/rust_function_source.mjs";
import { interpretationForVariant, profileExitCode, replacementDescription } from "../rust/pyac-gpu/function_reduction_reports.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CORE = path.join(ROOT, "rust/pyac-vliw-core/src/semantics_runtime");

test("function reducer has one explicit diagnostic replacement per candidate", () => {
  const candidates = listReductionCandidates();
  assert.ok(candidates.length >= 8);
  assert.equal(new Set(candidates.map(({ name }) => name)).size, candidates.length);
  assert.ok(candidates.some(({ name }) => name === "build_programlet_routine_directory"));
  assert.ok(candidates.some(({ name }) => name === "resolve_programlet_routine"));
  for (const name of [
    "exp_f32",
    "apply_programlet_vector_action",
    "reduce_vector",
    "vector_float_arithmetic_group",
    "vector_sum_group",
    "vector_maximum_group",
  ]) {
    assert.ok(candidates.some((candidate) => candidate.name === name), `missing candidate ${name}`);
  }
  assert.ok(!candidates.some(({ name }) => name === "find_programlet_routine"));
  for (const candidate of candidates) {
    const sourcePath = path.join(CORE, candidate.file);
    assert.ok(fs.existsSync(sourcePath), `missing candidate source ${candidate.file}`);
    const source = fs.readFileSync(sourcePath, "utf8");
    const result = replaceCandidateBody(source, candidate.name);
    assert.equal(result.source.slice(0, result.source.indexOf(result.replacementBody)), source.slice(0, source.indexOf(result.originalBody)));
    assert.equal((result.source.match(new RegExp(`\\bfn\\s+${candidate.name}\\s*\\(`, "gu")) || []).length, 1);
    assert.ok(result.source.includes(result.replacementBody));
  }
});

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

test("function reducer rejects unknown names and changed return contracts", () => {
  assert.throws(() => replaceCandidateBody("fn x() {}", "not_a_candidate"), /unknown reduction function/u);
  assert.throws(() => replaceCandidateBody("fn programlet_branch() -> bool { true }", "programlet_branch"), /return type changed/u);
});

test("collector minimal variant preserves dynamic input and a successful downstream path", () => {
  const source = fs.readFileSync(path.join(CORE, "sentence.rs"), "utf8");
  const result = replaceCandidateBody(source, "collect_sentence_at", "minimal");
  assert.match(result.originalBody, /while slot <= last_slot/u);
  assert.match(result.replacementBody, /word\(words, absolute_codelet, 1\)/u);
  assert.match(result.replacementBody, /Ok\(\(1, start \+ 1\)\)/u);
  assert.throws(() => replaceCandidateBody(source, "word", "minimal"), /not supported/u);
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
