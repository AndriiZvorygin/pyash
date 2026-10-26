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

test("vocab_suggest reports grammar and lexical root forms for inside", async () => {
  const lines = [];
  const result = await runVocabSuggest(["inside"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  const output = lines.join("\n");
  assert.match(output, /inside: root -> lwak \(English30k rank 1583\)/u);
  assert.match(output, /inside: grammar -> lwah \(English30k rank 1583\)/u);
  assert.doesNotMatch(output, /^inside: ok$/mu);
});

test("vocab_suggest reports the English gloss for an accepted Pyac atom", async () => {
  const lines = [];
  const result = await runVocabSuggest(["twum"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.match(lines.join("\n"), /^twum: brain$/mu);
});

test("vocab_suggest keeps a repository-directory-named token on the vocabulary path", async () => {
  const lines = [];
  const result = await runVocabSuggest(["container"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.match(lines.join("\n"), /^container: root -> hven \(English30k rank \d+\)$/mu);
});
