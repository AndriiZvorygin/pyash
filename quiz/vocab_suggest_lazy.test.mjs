import test from "node:test";
import assert from "node:assert/strict";

import { runVocabSuggest } from "../command/vocab_suggest.mjs";

test("direct vocabulary checks resolve staged grammar, lemma, and compound paths", async () => {
  const cases = [
    ["someone", /someone: grammar -> cyahtlih/u],
    ["walked", /walked: lemma walk -> pfin/u],
    ["acid-rain", /acid-rain: found compound acid \+ rain -> flat myic \(accepted-delimited\)/u]
  ];
  for (const [token, expected] of cases) {
    const lines = [];
    const result = await runVocabSuggest([token], { report: (line) => lines.push(String(line)) });
    assert.equal(result.exitCode, 0, token);
    assert.match(lines.join("\n"), expected, token);
  }
});

test("Chinese dictionary lookup uses preferred COW forms from active WordNet sense links", async () => {
  const lines = [];
  const result = await runVocabSuggest(["love", "to", "zh"], { report: (line) => lines.push(String(line)) });

  assert.equal(result.exitCode, 0);
  const cowLine = lines.findIndex((line) => line.startsWith("love: COW WordNet Chinese "));
  const senseLine = lines.findIndex((line) => line.startsWith("love: WordNet n:09869006-n "));
  assert.notEqual(cowLine, -1);
  assert.ok(senseLine > cowLine, "Chinese lookup should precede the English WordNet detail");
  assert.match(lines[cowLine], /; Pinyin .*\(frequency-preferred\)$/u);
  assert.ok(result.chineseLookups.some((row) => row.source === "cow-wordnet-crosswalk"
    && row.input === "love" && row.wordNetSenseIds.includes("n:09869006-n")));
});

test("Chinese dictionary lookup can query COW forms by WordNet sense without an active Pyash target", async () => {
  const lines = [];
  const result = await runVocabSuggest(["n:09869006-n", "to", "zh"], { report: (line) => lines.push(String(line)) });

  assert.equal(result.exitCode, 0);
  const chineseLine = lines.findIndex((line) => line.startsWith("n:09869006-n: COW WordNet Chinese "));
  const englishLine = lines.findIndex((line) => line.startsWith("n:09869006-n [n;"));
  assert.notEqual(chineseLine, -1);
  assert.ok(englishLine > chineseLine, "COW Chinese output should precede the English sense detail");
  assert.ok(result.chineseLookups.some((row) => row.matchedWordNetSenseIds.includes("n:09869006-n")));
});
