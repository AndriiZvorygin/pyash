import test from "node:test";
import assert from "node:assert/strict";
import { runVocabSuggest } from "../command/vocab_suggest.mjs";

test("vocab_suggest checks quoted pyash blocks", () => {
  const lines = [];
  const report = (line) => lines.push(line);
  return runVocabSuggest(["quiz/fixtures/vocab_suggest_quoted.pya"], { report }).then(({ exitCode }) => {
    assert.equal(exitCode, 1);
    assert.match(lines.join("\n"), /profile/);
  });
});
