import test from "node:test";
import assert from "node:assert/strict";
import { runVocabSuggest } from "../command/vocab_suggest.mjs";

test("vocab_suggest checks quoted pyash blocks", () => {
  const lines = [];
  const report = (line) => lines.push(line);
  return runVocabSuggest(["quiz/fixtures/vocab_suggest_quoted.pya"], { report }).then(({ exitCode, missing }) => {
    // The quoted block is scanned: the name inside it is reported, and the
    // predicate word inside it is still missing.
    assert.equal(exitCode, 1);
    assert.equal(missing, 1);
    assert.match(lines.join("\n"), /profile/);
    assert.match(lines.join("\n"), /zzzquotedword/);
  });
});
