import test from "node:test";
import assert from "node:assert/strict";

import { runVocabSuggest } from "../command/vocab_suggest.mjs";

test("vocab_suggest reports indefinite pronouns through grammar sequences", async () => {
  const lines = [];
  const result = await runVocabSuggest([
    "someone", "anyone", "everyone", "nobody", "something", "anything", "everything", "nothing", "another"
  ], { report: (line) => lines.push(String(line)) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  const output = lines.join("\n");
  assert.match(output, /someone: grammar -> cyah tlih/u);
  assert.match(output, /anyone: grammar -> cyah tlah/u);
  assert.match(output, /something: grammar -> ya tlih/u);
  assert.match(output, /nothing: grammar -> ya no/u);
  assert.match(output, /another: grammar -> clah tlih/u);
});
