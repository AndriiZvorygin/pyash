import test from "node:test";
import assert from "node:assert/strict";

import { runVocabSuggest } from "../command/vocab_suggest.mjs";

test("vocab_suggest reports indefinite pronouns as fused Pyac words", async () => {
  const lines = [];
  const result = await runVocabSuggest([
    "someone", "anyone", "everyone", "nobody", "something", "anything", "everything", "nothing", "another"
  ], { report: (line) => lines.push(String(line)) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  const output = lines.join("\n");
  for (const [surface, pyac] of [
    ["someone", "cyahtlih"],
    ["anyone", "cyahtlah"],
    ["everyone", "cyahwi"],
    ["nobody", "cyahno"],
    ["something", "yatlih"],
    ["anything", "yatlah"],
    ["everything", "yawi"],
    ["nothing", "yano"],
    ["another", "clahtlih"]
  ]) {
    assert.match(output, new RegExp(`${surface}: grammar -> ${pyac}`, "u"));
  }
});

test("vocab_suggest reports both lexical and grammar forms for example", async () => {
  const lines = [];
  const result = await runVocabSuggest(["example"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  const output = lines.join("\n");
  assert.match(output, /example: root -> tlam \(English30k rank 1032\)/u);
  assert.match(output, /example: grammar -> fluh \(English30k rank 1032\)/u);
});
