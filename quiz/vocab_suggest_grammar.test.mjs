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

test("vocab_suggest returns separate English suggestions and Pyac mappings", async () => {
  const result = await runVocabSuggest(["baffled", "bewildered"], { report: () => {} });
  const records = new Map(result.suggestionRecords.map((record) => [record.input, record]));
  const baffled = records.get("baffled");
  const bewildered = records.get("bewildered");
  assert.deepEqual(baffled.wordSuggestions, ["mystified"]);
  assert.deepEqual(baffled.mappings[0], {
    word: "mystified",
    pyac: "hmi2f",
    pyacSequence: ["hmi2f"],
    kind: "dictionary-alias",
    coverageType: "dictionary-alias",
    status: "covered-dictionary-alias",
    rank: 7439,
    source: "vocab-suggest"
  });
  assert.deepEqual(bewildered.wordSuggestions, ["panicked", "mystified", "crazily"]);
  assert.equal(bewildered.mappings.find((mapping) => mapping.word === "mystified")?.pyac, "hmi2f");
});
