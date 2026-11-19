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
  for (const candidate of candidates) {
    const source = fs.readFileSync(path.join(CORE, candidate.file), "utf8");
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
